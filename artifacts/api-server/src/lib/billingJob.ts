import { db } from "@workspace/db";
import { tenantsTable, tenantBillingsTable, settingsTable } from "@workspace/db/schema";
import { eq, and, lte, isNotNull } from "drizzle-orm";
import { MercadoPagoConfig, Payment } from "mercadopago";
import nodemailer from "nodemailer";
import { generatePicPayPix, verifyPicPayPayment } from "./picpay.js";

// tenantId = 0 é reservado para configurações do super admin (cobrança SaaS)
export const SUPER_ADMIN_TENANT_ID = 0;

// ── Settings helpers ───────────────────────────────────────────────────────────

export async function getSuperSetting(key: string): Promise<string | null> {
  const rows = await db.select({ value: settingsTable.value })
    .from(settingsTable)
    .where(and(eq(settingsTable.tenantId, SUPER_ADMIN_TENANT_ID), eq(settingsTable.key, key)))
    .limit(1);
  return rows[0]?.value ?? null;
}

export async function getSuperWebhookSecret(): Promise<string | null> {
  return getSuperSetting("billing_mp_webhook_secret");
}

export async function setSuperSetting(key: string, value: string): Promise<void> {
  await db.insert(settingsTable)
    .values({ tenantId: SUPER_ADMIN_TENANT_ID, key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [settingsTable.tenantId, settingsTable.key],
      set: { value, updatedAt: new Date() },
    });
}

export async function getAllSuperSettings(): Promise<Record<string, string>> {
  const rows = await db.select({ key: settingsTable.key, value: settingsTable.value })
    .from(settingsTable)
    .where(eq(settingsTable.tenantId, SUPER_ADMIN_TENANT_ID));
  const map: Record<string, string> = {};
  for (const r of rows) { map[r.key] = r.value; }
  return map;
}

// ── Platform config ────────────────────────────────────────────────────────────

interface PlatformConfig {
  name: string;
  tagline: string;
  logoUrl: string | null;
}

function resolveAbsoluteUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (raw.startsWith("http")) return raw;
  const appUrl = (process.env.APP_URL ?? "").replace(/\/$/, "");
  if (raw.startsWith("/objects/")) return `${appUrl}/api/storage${raw}`; // legacy GCS
  if (raw.startsWith("/tenant-")) return `${appUrl}/api/uploads${raw}`; // local disk
  if (raw.startsWith("/api/")) return `${appUrl}${raw}`; // already full API path
  return raw;
}

async function getPlatformConfig(): Promise<PlatformConfig> {
  const [name, tagline, rawLogoUrl] = await Promise.all([
    getSuperSetting("platform_name"),
    getSuperSetting("platform_tagline"),
    getSuperSetting("platform_logo_url"),
  ]);
  return {
    name: name ?? "PlayHub",
    tagline: tagline ?? "Agendamentos, torneios e ranking em um só lugar",
    logoUrl: resolveAbsoluteUrl(rawLogoUrl),
  };
}

// ── SMTP helpers ───────────────────────────────────────────────────────────────

async function getSmtpConfig() {
  const host = await getSuperSetting("billing_smtp_host");
  const user = await getSuperSetting("billing_smtp_user");
  const pass = await getSuperSetting("billing_smtp_pass");
  if (!host || !user || !pass) return null;
  return {
    host,
    port: Number((await getSuperSetting("billing_smtp_port")) ?? 587),
    user,
    pass,
    fromEmail: (await getSuperSetting("billing_smtp_from")) ?? user,
  };
}

async function createTransport() {
  const cfg = await getSmtpConfig();
  if (!cfg) return null;
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    auth: { user: cfg.user, pass: cfg.pass },
  });
}

// ── Email template builder ─────────────────────────────────────────────────────

function buildEmailHtml(bodyHtml: string, platform: PlatformConfig): string {
  const logoSection = platform.logoUrl
    ? `<img src="${platform.logoUrl}" alt="${platform.name}" style="max-height:54px;max-width:200px;object-fit:contain;display:block;margin:0 auto;" />`
    : `<span style="color:#f0c040;font-size:26px;font-weight:800;letter-spacing:-0.5px;">${platform.name}</span>`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${platform.name}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f4f4f5;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" role="presentation"
        style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.10);">

        <!-- Header -->
        <tr>
          <td style="background:#111111;padding:28px 32px;text-align:center;">
            ${logoSection}
            <p style="margin:${platform.logoUrl ? "10px" : "4px"} 0 0;color:#aaaaaa;font-size:12px;">${platform.tagline}</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:32px 32px 24px;">
            ${bodyHtml}
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f8f8f8;padding:18px 32px;border-top:1px solid #eeeeee;text-align:center;">
            <p style="margin:0;font-size:11px;color:#aaaaaa;">
              ${platform.name} &mdash; ${platform.tagline}
            </p>
            <p style="margin:6px 0 0;font-size:11px;color:#cccccc;">
              Este é um e-mail automático, por favor não responda diretamente.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── Billing email (cobrança mensal) ───────────────────────────────────────────

export async function sendBillingEmail(
  to: string,
  tenantName: string,
  amount: number,
  pixCopyPaste: string,
  dueDate: Date,
  pixQrCodeBase64: string,
) {
  const [cfg, platform] = await Promise.all([getSmtpConfig(), getPlatformConfig()]);
  if (!cfg) {
    console.warn("[billingJob] SMTP não configurado no painel super admin, pulando e-mail");
    return;
  }

  const transporter = nodemailer.createTransport({
    host: cfg.host, port: cfg.port,
    auth: { user: cfg.user, pass: cfg.pass },
  });

  const formatted = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(amount);
  const dueFmt = dueDate.toLocaleDateString("pt-BR");

  const qrCodeUrl = pixCopyPaste
    ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&ecc=M&data=${encodeURIComponent(pixCopyPaste)}`
    : null;
  const qrCodeHtml = qrCodeUrl
    ? `<div style="text-align:center;margin:24px 0 20px;">
        <p style="margin:0 0 12px;font-size:13px;color:#555555;">Escaneie o QR Code com o app do seu banco:</p>
        <img src="${qrCodeUrl}" alt="QR Code PIX" width="200" height="200"
          style="border:1px solid #e0e0e0;border-radius:8px;padding:8px;background:#ffffff;display:inline-block;" />
      </div>`
    : "";

  const hasPix = !!pixCopyPaste;

  const pixBlock = hasPix ? `
    ${qrCodeHtml}
    <!-- PIX copia e cola -->
    <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#333333;">PIX Copia e Cola</p>
    <div style="background:#f4f4f5;border:1px solid #e0e0e0;border-radius:6px;padding:14px 16px;
      word-break:break-all;font-family:'Courier New',Courier,monospace;font-size:11px;color:#444444;
      line-height:1.6;margin-bottom:24px;">
      ${pixCopyPaste}
    </div>
    <p style="margin:0;font-size:12px;color:#999999;line-height:1.7;">
      Após o pagamento via PIX, a confirmação é automática e sua conta será mantida ativa.
      Em caso de dúvidas, entre em contato com o suporte.
    </p>
  ` : `
    <div style="background:#fff8e1;border:1px solid #ffe082;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
      <p style="margin:0;font-size:13px;color:#795548;line-height:1.6;">
        O código PIX ainda não foi gerado. Entre em contato com o suporte para receber as instruções de pagamento.
      </p>
    </div>
  `;

  const bodyHtml = `
    <p style="margin:0 0 6px;font-size:15px;color:#333333;">Olá, <strong>${tenantName}</strong>!</p>
    <p style="margin:0 0 24px;font-size:14px;color:#666666;line-height:1.6;">
      Sua mensalidade da plataforma <strong>${platform.name}</strong> está disponível para pagamento.
    </p>

    <!-- Valor card -->
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
      style="background:#f8f8f8;border-radius:8px;margin-bottom:24px;border:1px solid #eeeeee;">
      <tr>
        <td style="padding:20px 24px;">
          <p style="margin:0 0 4px;font-size:11px;color:#888888;text-transform:uppercase;letter-spacing:0.8px;">Valor a pagar</p>
          <p style="margin:0;font-size:34px;font-weight:800;color:#111111;letter-spacing:-1px;">${formatted}</p>
          <p style="margin:8px 0 0;font-size:13px;color:#888888;">Vencimento: <strong style="color:#333333;">${dueFmt}</strong></p>
        </td>
      </tr>
    </table>

    ${pixBlock}
  `;

  await transporter.sendMail({
    from: `"${platform.name}" <${cfg.fromEmail}>`,
    to,
    subject: `[${platform.name}] Cobrança de mensalidade — ${formatted} — vence ${dueFmt}`,
    html: buildEmailHtml(bodyHtml, platform),
  });
}

// ── Welcome email (boas-vindas ao novo cliente) ────────────────────────────────

export async function sendWelcomeEmail(
  to: string,
  tenantName: string,
  slug: string,
) {
  const [cfg, platform] = await Promise.all([getSmtpConfig(), getPlatformConfig()]);
  if (!cfg) {
    console.warn("[billingJob] SMTP não configurado — e-mail de boas-vindas não enviado");
    return;
  }

  const transporter = nodemailer.createTransport({
    host: cfg.host, port: cfg.port,
    auth: { user: cfg.user, pass: cfg.pass },
  });

  const bodyHtml = `
    <p style="margin:0 0 6px;font-size:15px;color:#333333;">Bem-vindo ao <strong>${platform.name}</strong>, <strong>${tenantName}</strong>! 🎉</p>
    <p style="margin:0 0 24px;font-size:14px;color:#666666;line-height:1.6;">
      Sua conta foi criada com sucesso na plataforma <strong>${platform.name}</strong>. Estamos muito felizes em ter você conosco!
    </p>

    <!-- Info card -->
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
      style="background:#f8f8f8;border-radius:8px;margin-bottom:24px;border:1px solid #eeeeee;">
      <tr>
        <td style="padding:20px 24px;">
          <p style="margin:0 0 4px;font-size:11px;color:#888888;text-transform:uppercase;letter-spacing:0.8px;">Seu identificador</p>
          <p style="margin:0;font-size:20px;font-weight:700;color:#111111;font-family:'Courier New',monospace;">${slug}</p>
          <p style="margin:8px 0 0;font-size:13px;color:#888888;">
            Use este identificador para acessar seu painel de administração.
          </p>
        </td>
      </tr>
    </table>

    <!-- O que esperar -->
    <p style="margin:0 0 12px;font-size:13px;font-weight:600;color:#333333;">O que está incluído:</p>
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:24px;">
      ${[
        ["📅", "Agendamentos de quadras e aulas"],
        ["🏆", "Gestão de torneios e chaves"],
        ["📊", "Ranking automático de jogadores"],
        ["👥", "Cadastro de clientes e duplas"],
      ].map(([icon, text]) => `
        <tr>
          <td style="padding:5px 0;vertical-align:top;width:28px;font-size:16px;">${icon}</td>
          <td style="padding:5px 0;font-size:14px;color:#555555;">${text}</td>
        </tr>
      `).join("")}
    </table>

    <p style="margin:0;font-size:12px;color:#999999;line-height:1.7;">
      Em breve você receberá as instruções de acesso e as cobranças mensais serão enviadas para este e-mail.
      Qualquer dúvida, estamos à disposição!
    </p>
  `;

  await transporter.sendMail({
    from: `"${platform.name}" <${cfg.fromEmail}>`,
    to,
    subject: `Bem-vindo ao ${platform.name}, ${tenantName}! 🎉`,
    html: buildEmailHtml(bodyHtml, platform),
  });
}

// ── Cancellation email ─────────────────────────────────────────────────────────

export async function sendCancellationEmail(
  to: string,
  tenantName: string,
) {
  const [cfg, platform] = await Promise.all([getSmtpConfig(), getPlatformConfig()]);
  if (!cfg) {
    console.warn("[billingJob] SMTP não configurado — e-mail de cancelamento não enviado");
    return;
  }

  const transporter = nodemailer.createTransport({
    host: cfg.host, port: cfg.port,
    auth: { user: cfg.user, pass: cfg.pass },
  });

  const bodyHtml = `
    <p style="margin:0 0 6px;font-size:15px;color:#333333;">Olá, <strong>${tenantName}</strong>.</p>
    <p style="margin:0 0 24px;font-size:14px;color:#666666;line-height:1.6;">
      Informamos que seu plano na plataforma <strong>${platform.name}</strong> foi cancelado.
      Sentimos muito em vê-los partir!
    </p>

    <!-- Status card -->
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
      style="background:#fff5f5;border-radius:8px;margin-bottom:24px;border:1px solid #fecaca;">
      <tr>
        <td style="padding:20px 24px;">
          <p style="margin:0 0 4px;font-size:11px;color:#888888;text-transform:uppercase;letter-spacing:0.8px;">Status da conta</p>
          <p style="margin:0;font-size:20px;font-weight:700;color:#dc2626;">Plano Cancelado</p>
          <p style="margin:8px 0 0;font-size:13px;color:#888888;">
            O acesso à plataforma foi encerrado conforme solicitado.
          </p>
        </td>
      </tr>
    </table>

    <p style="margin:0 0 16px;font-size:14px;color:#666666;line-height:1.6;">
      Se desejar reativar sua conta ou tiver alguma dúvida sobre o cancelamento, entre em contato com nossa equipe.
      Ficamos felizes em ajudar!
    </p>

    <p style="margin:0;font-size:12px;color:#999999;line-height:1.7;">
      Seus dados foram preservados por 30 dias. Após esse período, poderão ser removidos definitivamente.
    </p>
  `;

  await transporter.sendMail({
    from: `"${platform.name}" <${cfg.fromEmail}>`,
    to,
    subject: `[${platform.name}] Seu plano foi cancelado — ${tenantName}`,
    html: buildEmailHtml(bodyHtml, platform),
  });
}

// ── Generate PIX charge for a tenant ─────────────────────────────────────────

export async function generateTenantCharge(tenantId: number): Promise<{ billing: typeof tenantBillingsTable.$inferSelect; error?: string }> {
  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId)).limit(1);
  if (!tenant) throw new Error("Tenant não encontrado");

  const price = Number(tenant.monthlyPrice ?? 0);
  if (price <= 0) throw new Error("Valor mensal não configurado para este tenant");

  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 3);

  let pixQrCode = "";
  let pixCopyPaste = "";
  let mpPaymentId = "";
  let pixError: string | undefined;

  const platform = await getPlatformConfig();
  const billingProvider = await getSuperSetting("payment_provider");
  const usePicPay = billingProvider === "picpay";

  if (usePicPay) {
    const picpayToken = await getSuperSetting("billing_picpay_token");
    const picpayKey = await getSuperSetting("billing_picpay_key");
    const appUrl = (process.env.APP_URL ?? "").replace(/\/$/, "");

    if (picpayToken) {
      try {
        const callbackUrl = appUrl
          ? `${appUrl}/api/super/billing/picpay-webhook${picpayKey ? `?token=${encodeURIComponent(picpayKey)}` : ""}`
          : "";
        // Unique referenceId per billing attempt
        const billingRefId = `billing-${tenantId}-${Date.now()}`;
        const nameParts = tenant.name.trim().split(" ");
        const result = await generatePicPayPix({
          token: picpayToken,
          referenceId: billingRefId,
          callbackUrl,
          amount: price,
          buyer: {
            firstName: nameParts[0],
            lastName: nameParts.slice(1).join(" ") || "-",
            email: tenant.billingEmail ?? `billing@${tenant.slug}.placeholder`,
          },
          expiresAt: dueDate,
        });
        pixCopyPaste = result.pixQrCode;
        pixQrCode = result.pixQrCodeBase64;
        mpPaymentId = result.referenceId;
      } catch (err) {
        console.error("[billingJob] Erro ao gerar PIX PicPay:", err);
        pixError = "PIX não gerado (PicPay indisponível)";
      }
    } else {
      pixError = "Token PicPay não configurado no painel super admin";
    }
  } else {
    const mpToken = await getSuperSetting("billing_mp_token");
    if (mpToken) {
      try {
        const mp = new MercadoPagoConfig({ accessToken: mpToken });
        const paymentClient = new Payment(mp);

        const pixPayment = await paymentClient.create({
          body: {
            transaction_amount: price,
            payment_method_id: "pix",
            description: `${platform.name} – Mensalidade mensal – ${tenant.name}`,
            payer: {
              email: tenant.billingEmail ?? `billing@${tenant.slug}.placeholder`,
              first_name: tenant.name,
            },
            date_of_expiration: dueDate.toISOString(),
          },
        });

        const txData = (pixPayment as unknown as Record<string, unknown>)?.["point_of_interaction"] as Record<string, unknown> | undefined;
        const txDataInner = txData?.["transaction_data"] as Record<string, unknown> | undefined;
        pixCopyPaste = (txDataInner?.["qr_code"] as string) ?? "";
        pixQrCode = (txDataInner?.["qr_code_base64"] as string) ?? "";
        mpPaymentId = String(pixPayment.id ?? "");
      } catch (err) {
        console.error("[billingJob] Erro ao gerar PIX MP:", err);
        pixError = "PIX não gerado (Mercado Pago indisponível)";
      }
    } else {
      pixError = "Token Mercado Pago não configurado no painel super admin";
    }
  }

  const [billing] = await db.insert(tenantBillingsTable).values({
    tenantId,
    amount: String(price),
    status: "pending",
    dueDate,
    pixQrCode,
    pixCopyPaste,
    mpPaymentId: mpPaymentId || null,
    notes: pixError ?? null,
  }).returning();

  const next = new Date();
  next.setDate(next.getDate() + 30);
  await db.update(tenantsTable)
    .set({ nextBillingDate: next, updatedAt: new Date() })
    .where(eq(tenantsTable.id, tenantId));

  // Envia e-mail de cobrança (com PIX se disponível, sem PIX com aviso)
  const emailTarget = tenant.billingEmail;
  if (emailTarget) {
    try {
      await sendBillingEmail(emailTarget, tenant.name, price, pixCopyPaste, dueDate, pixQrCode);
    } catch (err) {
      console.error("[billingJob] Erro ao enviar e-mail de cobrança:", err);
    }
  }

  return { billing, error: pixError };
}

// ── Mark billing as paid ──────────────────────────────────────────────────────

export async function markBillingPaid(billingId: number): Promise<void> {
  const [billing] = await db.update(tenantBillingsTable)
    .set({ status: "paid", paidAt: new Date() })
    .where(eq(tenantBillingsTable.id, billingId))
    .returning();

  if (billing) {
    await db.update(tenantsTable)
      .set({ subscriptionStatus: "active", updatedAt: new Date() })
      .where(eq(tenantsTable.id, billing.tenantId));
  }
}

// ── Daily billing check ───────────────────────────────────────────────────────

async function runBillingCheck() {
  console.info("[billingJob] Verificando cobranças pendentes...");
  const now = new Date();

  const due = await db.select().from(tenantsTable).where(
    and(
      eq(tenantsTable.active, true),
      lte(tenantsTable.nextBillingDate, now),
      isNotNull(tenantsTable.monthlyPrice),
    )
  );

  console.info(`[billingJob] ${due.length} tenant(s) para cobrar`);

  for (const tenant of due) {
    if (!tenant.monthlyPrice || Number(tenant.monthlyPrice) <= 0) continue;
    try {
      const { error } = await generateTenantCharge(tenant.id);
      if (error) {
        console.warn(`[billingJob] Tenant ${tenant.id} (${tenant.name}): ${error}`);
      } else {
        console.info(`[billingJob] Cobrança gerada para tenant ${tenant.id} (${tenant.name})`);
      }
    } catch (err) {
      console.error(`[billingJob] Erro ao cobrar tenant ${tenant.id}:`, err);
    }
  }

  console.info("[billingJob] Verificação concluída");
}

const safeBillingCheck = () => runBillingCheck().catch(err => console.error("[billingJob] Erro inesperado:", err));

export function scheduleBillingJob(): NodeJS.Timeout {
  const INTERVAL_MS = 6 * 60 * 60 * 1000;
  const timer = setInterval(safeBillingCheck, INTERVAL_MS);
  console.info("[billingJob] Agendado para rodar a cada 6h");
  setTimeout(safeBillingCheck, 60 * 1000);
  return timer;
}
