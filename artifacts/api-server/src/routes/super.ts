import { Router, type IRouter } from "express";
import { createHmac } from "crypto";
import dns from "dns";
import multer from "multer";
import { saveTenantUpload } from "../lib/uploadHelper.js";
import { db } from "@workspace/db";
import {
  tenantsTable, tenantAdminsTable, tenantBillingsTable,
  settingsTable, newsletterSubscribersTable, emailTemplatesTable, emailCampaignsTable,
  emailGroupsTable, emailGroupMembersTable,
  courtBookingsTable, classBookingsTable, courtsTable, courtSchedulesTable,
  clientsTable, monthlyPlansTable, monthlyReservationsLogTable,
  tournamentsTable, homeSlides, homeCards, couponsTable,
} from "@workspace/db/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { superAdminAuth } from "../middlewares/adminAuth.js";
import { hashPassword } from "../middlewares/adminAuth.js";
import { invalidateDefaultTenantCache } from "../middlewares/domainTenant.js";
import { generateTenantCharge, markBillingPaid, getAllSuperSettings, setSuperSetting, getSuperWebhookSecret, getSuperSetting, sendWelcomeEmail, sendCancellationEmail } from "../lib/billingJob.js";
import { verifyPicPayPayment, verifyPicPayWebhookToken } from "../lib/picpay.js";
import { captureScreenshots } from "./screenshots.js";
import { setSetting } from "./settings.js";
import { MercadoPagoConfig, Payment } from "mercadopago";
import type { Request } from "express";

const router: IRouter = Router();

// ── Mercado Pago Webhook (público — sem auth, chamado pelo MP) ─────────────────

async function verifyBillingWebhookSignature(req: Request): Promise<boolean> {
  const secret = await getSuperWebhookSecret();
  if (!secret) return true; // sem secret configurado: aceita tudo (útil em dev)

  const xSignature = req.headers["x-signature"] as string | undefined;
  if (!xSignature) return true; // sem assinatura: aceita (modo teste do MP)

  const xRequestId = (req.headers["x-request-id"] ?? "") as string;
  const parts: Record<string, string> = {};
  for (const chunk of xSignature.split(",")) {
    const idx = chunk.indexOf("=");
    if (idx > 0) parts[chunk.slice(0, idx).trim()] = chunk.slice(idx + 1).trim();
  }
  const ts = parts["ts"];
  const v1 = parts["v1"];
  if (!ts || !v1) return true;

  const dataId =
    (req.body as Record<string, unknown>)?.["data"]
      ? ((req.body as Record<string, Record<string, unknown>>)["data"]["id"] ?? "")
      : ((req.query as Record<string, string>)["data.id"] ?? "");

  const message = `id:${dataId};request-id:${xRequestId};ts:${ts}`;
  const expected = createHmac("sha256", secret).update(message).digest("hex");
  return expected === v1;
}

// POST /super/billing/webhook — recebe notificação do Mercado Pago ao pagar PIX
router.post("/billing/webhook", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const type = (body["type"] ?? body["topic"]) as string | undefined;
  const dataId = ((body["data"] as Record<string, unknown>)?.["id"] ?? body["id"]) as string | undefined;

  const signatureValid = await verifyBillingWebhookSignature(req);
  if (!signatureValid) {
    // Log o aviso mas ainda processa — mesmo comportamento do webhook de agendamentos
    console.warn("[billing/webhook] Assinatura inválida — processando mesmo assim (modo tolerante)");
  }

  if ((type === "payment" || type === "payment_id") && dataId) {
    try {
      const mpToken = await getSuperSetting("billing_mp_token");
      if (!mpToken) { res.status(200).json({ ok: true, skipped: "no_token" }); return; }

      const mp = new MercadoPagoConfig({ accessToken: mpToken });
      const paymentClient = new Payment(mp);
      const payment = await paymentClient.get({ id: dataId });

      if (payment.status === "approved") {
        const paymentIdStr = String(dataId);

        const [billing] = await db.select().from(tenantBillingsTable)
          .where(eq(tenantBillingsTable.mpPaymentId, paymentIdStr))
          .limit(1);

        if (billing && billing.status !== "paid") {
          await markBillingPaid(billing.id);
          res.status(200).json({ ok: true, billingId: billing.id, tenantId: billing.tenantId });
          return;
        }
      }
    } catch (err) {
      console.error("[billing/webhook] Erro ao processar pagamento:", err);
      res.status(500).json({ error: "Erro interno" });
      return;
    }
  }

  res.status(200).json({ ok: true });
});

// POST /super/billing/picpay-webhook — recebe notificação do PicPay ao pagar PIX
// PicPay envia: { referenceId, authorizationId, status: { code, message }, requesterName }
router.post("/billing/picpay-webhook", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const referenceId = body["referenceId"] as string | undefined;
  const statusCode = (body["status"] as Record<string, unknown> | undefined)?.["code"] as number | undefined;

  console.info("[billing/picpay-webhook] Recebido:", { referenceId, statusCode });

  // Responde 200 imediatamente para o PicPay
  res.status(200).json({ ok: true });

  if (!referenceId || (statusCode !== 103 && statusCode !== 104)) return;

  try {
    // Verificar token de segurança
    const incomingToken = req.query["token"] as string | undefined;
    const expectedToken = await getSuperSetting("billing_picpay_key");
    if (!verifyPicPayWebhookToken(incomingToken, expectedToken)) {
      console.warn("[billing/picpay-webhook] Token inválido — ignorando");
      return;
    }

    // Verificar pagamento via API do PicPay
    const picpayToken = await getSuperSetting("billing_picpay_token");
    if (!picpayToken) {
      console.warn("[billing/picpay-webhook] Token PicPay não configurado");
      return;
    }
    const isPaid = await verifyPicPayPayment(picpayToken, referenceId);
    if (!isPaid) {
      console.warn("[billing/picpay-webhook] Pagamento não confirmado pela API PicPay:", referenceId);
      return;
    }

    // Localizar a cobrança pelo referenceId armazenado em mpPaymentId
    const [billing] = await db.select().from(tenantBillingsTable)
      .where(eq(tenantBillingsTable.mpPaymentId, referenceId))
      .limit(1);

    if (billing && billing.status !== "paid") {
      await markBillingPaid(billing.id);
      console.info("[billing/picpay-webhook] Cobrança paga:", { billingId: billing.id, tenantId: billing.tenantId });
    } else if (!billing) {
      console.warn("[billing/picpay-webhook] Cobrança não encontrada para referenceId:", referenceId);
    }
  } catch (err) {
    console.error("[billing/picpay-webhook] Erro ao processar:", err);
  }
});

router.use(superAdminAuth);

// ── Tenants ───────────────────────────────────────────────────────────────────

// GET /super/tenants — list all tenants
router.get("/tenants", async (_req, res) => {
  const tenants = await db.select().from(tenantsTable).orderBy(tenantsTable.id);
  const admins = await db.select({
    id: tenantAdminsTable.id,
    tenantId: tenantAdminsTable.tenantId,
    name: tenantAdminsTable.name,
    email: tenantAdminsTable.email,
    active: tenantAdminsTable.active,
    notifyBookings: tenantAdminsTable.notifyBookings,
    createdAt: tenantAdminsTable.createdAt,
  }).from(tenantAdminsTable);

  const result = tenants.map((t) => ({
    ...t,
    admins: admins.filter((a) => a.tenantId === t.id),
  }));

  res.json(result);
});

// POST /super/tenants — create a new tenant
router.post("/tenants", async (req, res) => {
  const { name, slug, customDomain, billingEmail } = req.body as {
    name?: string; slug?: string; customDomain?: string; billingEmail?: string;
  };

  if (!name || !slug) {
    res.status(400).json({ error: "name e slug são obrigatórios" });
    return;
  }

  const slugClean = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");

  const [existing] = await db.select({ id: tenantsTable.id }).from(tenantsTable).where(eq(tenantsTable.slug, slugClean)).limit(1);
  if (existing) {
    res.status(409).json({ error: "Slug já em uso" });
    return;
  }

  const emailClean = billingEmail?.trim() || null;

  const [tenant] = await db.insert(tenantsTable).values({
    name: name.trim(),
    slug: slugClean,
    customDomain: customDomain?.trim() || null,
    billingEmail: emailClean,
    active: true,
  }).returning();

  // Seed generic default settings so the tenant starts with a clean slate
  await Promise.all([
    setSetting("company_name", "Sua empresa aqui", tenant.id),
    setSetting("company_description", "", tenant.id),
    setSetting("company_phone", "", tenant.id),
    setSetting("company_address", "", tenant.id),
    setSetting("company_cnpj", "", tenant.id),
    setSetting("logo_url", "", tenant.id),
    setSetting("favicon_url", "", tenant.id),
    setSetting("theme_primary", "#c9a227", tenant.id),
    setSetting("theme_primary_foreground", "#000000", tenant.id),
    setSetting("theme_background", "", tenant.id),
    setSetting("instagram_handle", "", tenant.id),
    setSetting("instagram_description", "", tenant.id),
  ]);

  // Envia e-mail de boas-vindas ao novo cliente
  if (emailClean) {
    sendWelcomeEmail(emailClean, tenant.name, tenant.slug).catch(err => {
      console.error("[super] Erro ao enviar e-mail de boas-vindas:", err);
    });
  }

  res.status(201).json(tenant);
});

// PUT /super/tenants/:id — update tenant
router.put("/tenants/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { name, customDomain, active, monthlyPrice, subscriptionStatus, nextBillingDate, billingEmail } =
    req.body as {
      name?: string; customDomain?: string; active?: boolean;
      monthlyPrice?: number | null; subscriptionStatus?: string;
      nextBillingDate?: string | null; billingEmail?: string | null;
    };

  const updates: Partial<typeof tenantsTable.$inferInsert> = { updatedAt: new Date() };
  if (name !== undefined) updates.name = name.trim();
  if (customDomain !== undefined) updates.customDomain = customDomain.trim() || null;
  if (active !== undefined) updates.active = active;
  if (monthlyPrice !== undefined) updates.monthlyPrice = monthlyPrice != null ? String(monthlyPrice) : null;
  if (subscriptionStatus !== undefined) updates.subscriptionStatus = subscriptionStatus;
  if (nextBillingDate !== undefined) updates.nextBillingDate = nextBillingDate ? new Date(nextBillingDate) : null;
  if (billingEmail !== undefined) updates.billingEmail = billingEmail?.trim() || null;

  // Get current state before update to detect cancellation
  const [before] = await db.select({ subscriptionStatus: tenantsTable.subscriptionStatus, billingEmail: tenantsTable.billingEmail })
    .from(tenantsTable).where(eq(tenantsTable.id, id)).limit(1);

  const [tenant] = await db.update(tenantsTable).set(updates).where(eq(tenantsTable.id, id)).returning();
  if (!tenant) { res.status(404).json({ error: "Tenant não encontrado" }); return; }

  // Envia e-mail de cancelamento se o status mudou para cancelled
  if (
    subscriptionStatus === "cancelled" &&
    before?.subscriptionStatus !== "cancelled" &&
    tenant.billingEmail
  ) {
    sendCancellationEmail(tenant.billingEmail, tenant.name).catch(err => {
      console.error("[super] Erro ao enviar e-mail de cancelamento:", err);
    });
  }

  res.json(tenant);
});

// DELETE /super/tenants/:id — permanently delete tenant and ALL its data
router.delete("/tenants/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (id === 1) { res.status(400).json({ error: "Não é possível excluir o tenant principal" }); return; }

  const [tenant] = await db.select({ id: tenantsTable.id }).from(tenantsTable).where(eq(tenantsTable.id, id)).limit(1);
  if (!tenant) { res.status(404).json({ error: "Tenant não encontrado" }); return; }

  // Cascade delete all tenant data in dependency order
  await db.delete(emailCampaignsTable).where(eq(emailCampaignsTable.tenantId, id));
  await db.delete(emailTemplatesTable).where(eq(emailTemplatesTable.tenantId, id));
  await db.delete(newsletterSubscribersTable).where(eq(newsletterSubscribersTable.tenantId, id));

  // Email groups: delete members first (no tenantId on members, delete via group ids)
  const groups = await db.select({ id: emailGroupsTable.id }).from(emailGroupsTable).where(eq(emailGroupsTable.tenantId, id));
  for (const g of groups) {
    await db.delete(emailGroupMembersTable).where(eq(emailGroupMembersTable.groupId, g.id));
  }
  await db.delete(emailGroupsTable).where(eq(emailGroupsTable.tenantId, id));

  await db.delete(homeSlides).where(eq(homeSlides.tenantId, id));
  await db.delete(homeCards).where(eq(homeCards.tenantId, id));
  await db.delete(couponsTable).where(eq(couponsTable.tenantId, id));

  await db.delete(classBookingsTable).where(eq(classBookingsTable.tenantId, id));
  await db.delete(courtBookingsTable).where(eq(courtBookingsTable.tenantId, id));
  await db.delete(courtSchedulesTable).where(eq(courtSchedulesTable.tenantId, id));
  await db.delete(courtsTable).where(eq(courtsTable.tenantId, id));

  const planIds = await db.select({ id: monthlyPlansTable.id }).from(monthlyPlansTable).where(eq(monthlyPlansTable.tenantId, id));
  if (planIds.length > 0) {
    await db.delete(monthlyReservationsLogTable).where(inArray(monthlyReservationsLogTable.monthlyPlanId, planIds.map(p => p.id)));
  }
  await db.delete(monthlyPlansTable).where(eq(monthlyPlansTable.tenantId, id));
  await db.delete(clientsTable).where(eq(clientsTable.tenantId, id));

  // Tournaments cascade-delete: categories, pairs, groups, matches, registrations, players, sponsors, gallery, points, coupons
  await db.delete(tournamentsTable).where(eq(tournamentsTable.tenantId, id));

  await db.delete(settingsTable).where(eq(settingsTable.tenantId, id));
  await db.delete(tenantAdminsTable).where(eq(tenantAdminsTable.tenantId, id));
  await db.delete(tenantBillingsTable).where(eq(tenantBillingsTable.tenantId, id));
  await db.delete(tenantsTable).where(eq(tenantsTable.id, id));

  res.json({ success: true });
});

// ── Tenant Admins ─────────────────────────────────────────────────────────────

// GET /super/tenants/:tenantId/admins — list admins for a tenant
router.get("/tenants/:tenantId/admins", async (req, res) => {
  const tenantId = Number(req.params.tenantId);
  const admins = await db.select({
    id: tenantAdminsTable.id,
    tenantId: tenantAdminsTable.tenantId,
    name: tenantAdminsTable.name,
    email: tenantAdminsTable.email,
    active: tenantAdminsTable.active,
    notifyBookings: tenantAdminsTable.notifyBookings,
    createdAt: tenantAdminsTable.createdAt,
  }).from(tenantAdminsTable).where(eq(tenantAdminsTable.tenantId, tenantId));

  res.json(admins);
});

// POST /super/tenants/:tenantId/admins — create a tenant admin
router.post("/tenants/:tenantId/admins", async (req, res) => {
  const tenantId = Number(req.params.tenantId);
  const { name, email, password } = req.body as { name?: string; email?: string; password?: string };

  if (!name || !email || !password) {
    res.status(400).json({ error: "name, email e password são obrigatórios" });
    return;
  }

  if (password.length < 6) {
    res.status(400).json({ error: "Senha deve ter pelo menos 6 caracteres" });
    return;
  }

  const [tenant] = await db.select({ id: tenantsTable.id }).from(tenantsTable).where(eq(tenantsTable.id, tenantId)).limit(1);
  if (!tenant) { res.status(404).json({ error: "Tenant não encontrado" }); return; }

  const emailLower = email.trim().toLowerCase();
  const [existing] = await db.select({ id: tenantAdminsTable.id }).from(tenantAdminsTable).where(and(eq(tenantAdminsTable.email, emailLower), eq(tenantAdminsTable.tenantId, tenantId))).limit(1);
  if (existing) { res.status(409).json({ error: "E-mail já cadastrado neste tenant" }); return; }

  const passwordHash = await hashPassword(password);

  const [admin] = await db.insert(tenantAdminsTable).values({
    tenantId,
    name: name.trim(),
    email: emailLower,
    passwordHash,
    active: true,
  }).returning({ id: tenantAdminsTable.id, tenantId: tenantAdminsTable.tenantId, name: tenantAdminsTable.name, email: tenantAdminsTable.email, active: tenantAdminsTable.active, createdAt: tenantAdminsTable.createdAt });

  res.status(201).json(admin);
});

// PUT /super/tenants/:tenantId/admins/:adminId — update admin (name, active, notifyBookings, reset password)
router.put("/tenants/:tenantId/admins/:adminId", async (req, res) => {
  const tenantId = Number(req.params.tenantId);
  const adminId = Number(req.params.adminId);
  const { name, active, password, notifyBookings } = req.body as { name?: string; active?: boolean; password?: string; notifyBookings?: boolean };

  const updates: Partial<typeof tenantAdminsTable.$inferInsert> = {};
  if (name !== undefined) updates.name = name.trim();
  if (active !== undefined) updates.active = active;
  if (notifyBookings !== undefined) updates.notifyBookings = notifyBookings;
  if (password) {
    if (password.length < 6) { res.status(400).json({ error: "Senha deve ter pelo menos 6 caracteres" }); return; }
    updates.passwordHash = await hashPassword(password);
  }

  const [admin] = await db.update(tenantAdminsTable)
    .set(updates)
    .where(and(eq(tenantAdminsTable.id, adminId), eq(tenantAdminsTable.tenantId, tenantId)))
    .returning({ id: tenantAdminsTable.id, tenantId: tenantAdminsTable.tenantId, name: tenantAdminsTable.name, email: tenantAdminsTable.email, active: tenantAdminsTable.active, notifyBookings: tenantAdminsTable.notifyBookings });

  if (!admin) { res.status(404).json({ error: "Admin não encontrado" }); return; }
  res.json(admin);
});

// DELETE /super/tenants/:tenantId/admins/:adminId — deactivate admin
router.delete("/tenants/:tenantId/admins/:adminId", async (req, res) => {
  const tenantId = Number(req.params.tenantId);
  const adminId = Number(req.params.adminId);

  const [admin] = await db.update(tenantAdminsTable)
    .set({ active: false })
    .where(and(eq(tenantAdminsTable.id, adminId), eq(tenantAdminsTable.tenantId, tenantId)))
    .returning({ id: tenantAdminsTable.id });

  if (!admin) { res.status(404).json({ error: "Admin não encontrado" }); return; }
  res.json({ success: true });
});

// ── Diagnóstico de token MP ───────────────────────────────────────────────────

// POST /super/settings/test-mp-token — verifica se o token salvo está funcionando
router.post("/settings/test-mp-token", async (_req, res) => {
  const mpToken = await getSuperSetting("billing_mp_token");
  if (!mpToken) {
    res.status(400).json({ ok: false, error: "Token não configurado" });
    return;
  }
  try {
    const mp = new MercadoPagoConfig({ accessToken: mpToken });
    const paymentClient = new Payment(mp);
    // Busca um pagamento inexistente — se o token for válido recebemos 404, se inválido 401
    await paymentClient.get({ id: "0" }).catch((err: unknown) => {
      const status = (err as Record<string, number>)?.status;
      if (status === 401) throw err; // token inválido
      // 404 ou outro = token válido, só não existe esse payment
    });
    res.json({ ok: true, message: "Token válido — Mercado Pago aceitou a autenticação" });
  } catch (err: unknown) {
    const status = (err as Record<string, number>)?.status;
    const desc = (err as Record<string, string>)?.description ?? "Token inválido ou sem permissão";
    res.status(400).json({ ok: false, error: `MP ${status ?? ""}: ${desc}` });
  }
});

// ── Super Admin Settings (billing credentials) ────────────────────────────────

const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// POST /super/settings/logo — upload platform logo to GCS
router.post("/settings/logo", logoUpload.single("logo"), async (req, res) => {
  if (!req.file) { res.status(400).json({ error: "Nenhum arquivo enviado" }); return; }
  try {
    const { objectPath } = await saveTenantUpload(0, "super", req.file.buffer, req.file.originalname, req.file.mimetype);
    await setSuperSetting("platform_logo_url", objectPath);
    res.json({ url: `/api/uploads${objectPath}`, path: objectPath });
  } catch (err) {
    console.error("Platform logo upload error:", err);
    res.status(500).json({ error: "Falha ao fazer upload do logo" });
  }
});

// POST /super/settings/favicon — upload platform favicon to GCS
router.post("/settings/favicon", logoUpload.single("favicon"), async (req, res) => {
  if (!req.file) { res.status(400).json({ error: "Nenhum arquivo enviado" }); return; }
  try {
    const { objectPath } = await saveTenantUpload(0, "super", req.file.buffer, req.file.originalname, req.file.mimetype);
    await setSuperSetting("platform_favicon_url", objectPath);
    res.json({ url: `/api/uploads${objectPath}`, path: objectPath });
  } catch (err) {
    console.error("Platform favicon upload error:", err);
    res.status(500).json({ error: "Falha ao fazer upload do favicon" });
  }
});

// GET /super/settings
router.get("/settings", async (_req, res) => {
  const settings = await getAllSuperSettings();
  // mask password and token before returning
  const safe = { ...settings };
  if (safe.payment_provider) safe.payment_provider = safe.payment_provider;
  if (safe.billing_mp_token) safe.billing_mp_token = "••••••••";
  if (safe.billing_smtp_pass) safe.billing_smtp_pass = "••••••••";
  if (safe.billing_mp_webhook_secret) safe.billing_mp_webhook_secret = "••••••••";
  if (safe.billing_picpay_token) safe.billing_picpay_token = "••••••••";
  if (safe.billing_picpay_key) safe.billing_picpay_key = "••••••••";
  res.json(safe);
});

// PUT /super/settings
router.put("/settings", async (req, res) => {
  const allowed = [
    "payment_provider",
    "billing_mp_token", "billing_mp_webhook_secret",
    "billing_picpay_token", "billing_picpay_key",
    "billing_smtp_host", "billing_smtp_port",
    "billing_smtp_user", "billing_smtp_pass",
    "billing_smtp_from", "billing_smtp_from_name",
    "platform_name", "platform_tagline", "platform_logo_url", "platform_favicon_url",
    "default_tenant_id",
  ];
  // Keys that can be explicitly cleared (non-sensitive, non-password fields)
  const clearableKeys = new Set(["payment_provider", "platform_name", "platform_tagline", "platform_logo_url", "platform_favicon_url", "default_tenant_id"]);
  const body = req.body as Record<string, string>;
  for (const key of allowed) {
    if (key in body && body[key] !== undefined) {
      const val = String(body[key]).trim();
      // skip masked placeholders — means user didn't change them
      if (val === "••••••••") continue;
      if (val === "" && !clearableKeys.has(key)) continue; // don't save empty strings for sensitive keys
      await setSuperSetting(key, val);
    }
  }
  // Invalidate default tenant cache so middleware picks up the change immediately
  invalidateDefaultTenantCache();
  res.json({ success: true });
});

// POST /super/settings/change-password
router.post("/settings/change-password", async (req, res) => {
  const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };
  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: "Senha atual e nova senha são obrigatórias" });
    return;
  }
  if (newPassword.length < 6) {
    res.status(400).json({ error: "A nova senha deve ter pelo menos 6 caracteres" });
    return;
  }

  const adminPassword = process.env.ADMIN_PASSWORD ?? "";
  const { timingSafeEqual } = await import("crypto");
  const { verifyPassword } = await import("../middlewares/adminAuth.js");

  const [overrideRow] = await db
    .select({ value: settingsTable.value })
    .from(settingsTable)
    .where(and(eq(settingsTable.tenantId, 0), eq(settingsTable.key, "super_admin_password_hash")))
    .limit(1);

  let valid = false;
  if (overrideRow?.value) {
    valid = await verifyPassword(currentPassword, overrideRow.value);
  } else {
    const a = Buffer.from(currentPassword);
    const b = Buffer.from(adminPassword);
    valid = a.length === b.length && timingSafeEqual(a, b);
  }

  if (!valid) {
    res.status(401).json({ error: "Senha atual incorreta" });
    return;
  }

  const newHash = await hashPassword(newPassword);
  await db
    .insert(settingsTable)
    .values({ tenantId: 0, key: "super_admin_password_hash", value: newHash })
    .onConflictDoUpdate({
      target: [settingsTable.tenantId, settingsTable.key],
      set: { value: newHash },
    });

  res.json({ success: true });
});

// ── Server info (DNS target) ──────────────────────────────────────────────────

router.get("/server-info", (_req, res) => {
  const domains = process.env.REPLIT_DOMAINS ?? "";
  const devDomain = process.env.REPLIT_DEV_DOMAIN ?? "";
  const appUrl = process.env.APP_URL ?? "";

  let dnsTarget = "";
  if (appUrl) {
    try { dnsTarget = new URL(appUrl).hostname; } catch { /* ignore */ }
  }
  if (!dnsTarget && domains) {
    dnsTarget = domains.split(",")[0].trim();
  }
  if (!dnsTarget && devDomain) {
    dnsTarget = devDomain;
  }

  res.json({ dnsTarget, devDomain, appUrl });
});

// ── Billing ───────────────────────────────────────────────────────────────────

// GET /super/tenants/:id/billings — list billing history for a tenant
router.get("/tenants/:id/billings", async (req, res) => {
  const tenantId = Number(req.params.id);
  const billings = await db.select().from(tenantBillingsTable)
    .where(eq(tenantBillingsTable.tenantId, tenantId))
    .orderBy(desc(tenantBillingsTable.createdAt))
    .limit(24);
  res.json(billings);
});

// POST /super/tenants/:id/charge — manually generate a PIX charge
router.post("/tenants/:id/charge", async (req, res) => {
  const tenantId = Number(req.params.id);
  try {
    const { billing, error } = await generateTenantCharge(tenantId);
    res.status(201).json({ billing, warning: error ?? null });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erro ao gerar cobrança";
    res.status(400).json({ error: message });
  }
});

// POST /super/billings/:billingId/paid — mark a billing as paid
router.post("/billings/:billingId/paid", async (req, res) => {
  const billingId = Number(req.params.billingId);
  try {
    await markBillingPaid(billingId);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Erro ao marcar como pago" });
  }
});

// GET /super/tenants/:id/dns-check — resolve custom domain DNS
router.get("/tenants/:id/dns-check", async (req, res) => {
  const tenantId = Number(req.params.id);
  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId)).limit(1);
  if (!tenant) return res.status(404).json({ error: "Tenant não encontrado" });
  if (!tenant.customDomain) return res.status(400).json({ error: "Domínio não configurado" });

  const domain = tenant.customDomain;
  try {
    try {
      const cnames = await dns.promises.resolveCname(domain);
      return res.json({ connected: true, type: "CNAME", value: cnames[0] });
    } catch {
      const addresses = await dns.promises.resolve4(domain);
      return res.json({ connected: true, type: "A", value: addresses[0] });
    }
  } catch {
    return res.json({ connected: false, error: "DNS não resolvido — propagação pendente ou domínio não configurado" });
  }
});

// POST /super/screenshots/capture — capture screenshots for any tenant (super admin only)
router.post("/screenshots/capture", async (req, res) => {
  const { tenantId, baseUrl } = req.body as { tenantId?: number; baseUrl?: string };
  if (!tenantId || !baseUrl) {
    res.status(400).json({ error: "tenantId e baseUrl são obrigatórios" });
    return;
  }
  const result = await captureScreenshots(Number(tenantId), baseUrl);
  if (!result.success) {
    res.status(503).json({ error: result.error });
    return;
  }
  res.json({ success: true, tenantId, results: result.results });
});

// DELETE /super/billings/:billingId — delete a pending billing
router.delete("/billings/:billingId", async (req, res) => {
  const billingId = Number(req.params.billingId);
  const [billing] = await db.select().from(tenantBillingsTable)
    .where(eq(tenantBillingsTable.id, billingId)).limit(1);
  if (!billing) return res.status(404).json({ error: "Cobrança não encontrada" });
  if (billing.status !== "pending") return res.status(400).json({ error: "Apenas cobranças pendentes podem ser excluídas" });
  await db.delete(tenantBillingsTable).where(eq(tenantBillingsTable.id, billingId));
  res.json({ success: true });
});

export default router;
