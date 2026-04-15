import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { emailCampaignsTable, clientsTable, monthlyPlansTable, newsletterSubscribersTable, courtBookingsTable, classBookingsTable, emailGroupMembersTable, emailGroupsTable } from "@workspace/db/schema";
import { eq, and, inArray, ne } from "drizzle-orm";
import { adminAuth } from "../middlewares/adminAuth.js";
import { sendEmail, buildCampaignEmail } from "../lib/email.js";

const router: IRouter = Router();

type CampaignFilter = "newsletter" | "monthly_any" | "no_plan" | "bookings" | "all" | "monthly_court" | "monthly_class" | `group_${number}`;

async function getRecipientsForFilter(filter: string, tenantId: number): Promise<Array<{ id: number; name: string; email: string }>> {
  if (filter === "newsletter") {
    const subs = await db
      .select({ id: newsletterSubscribersTable.id, name: newsletterSubscribersTable.name, email: newsletterSubscribersTable.email })
      .from(newsletterSubscribersTable)
      .where(and(eq(newsletterSubscribersTable.active, "true"), eq(newsletterSubscribersTable.tenantId, tenantId)));
    return subs.map((s) => ({ id: s.id, name: s.name ?? s.email, email: s.email }));
  }

  if (filter.startsWith("group_")) {
    const groupId = Number(filter.replace("group_", ""));
    // Verify the group belongs to this tenant before fetching members
    const [group] = await db
      .select({ id: emailGroupsTable.id })
      .from(emailGroupsTable)
      .where(and(eq(emailGroupsTable.id, groupId), eq(emailGroupsTable.tenantId, tenantId)))
      .limit(1);
    if (!group) return [];
    const members = await db
      .select({ id: emailGroupMembersTable.id, name: emailGroupMembersTable.name, email: emailGroupMembersTable.email })
      .from(emailGroupMembersTable)
      .where(eq(emailGroupMembersTable.groupId, groupId));
    return members.map((m) => ({ id: m.id, name: m.name ?? m.email, email: m.email }));
  }

  if (filter === "bookings") {
    const [courtRows, classRows] = await Promise.all([
      db
        .select({ name: courtBookingsTable.customerName, email: courtBookingsTable.customerEmail })
        .from(courtBookingsTable)
        .where(and(eq(courtBookingsTable.status, "confirmed"), eq(courtBookingsTable.tenantId, tenantId))),
      db
        .select({ name: classBookingsTable.customerName, email: classBookingsTable.customerEmail })
        .from(classBookingsTable)
        .where(and(eq(classBookingsTable.status, "confirmed"), eq(classBookingsTable.tenantId, tenantId))),
    ]);
    const seen = new Map<string, string>();
    for (const r of [...courtRows, ...classRows]) {
      const email = r.email?.trim().toLowerCase();
      if (email && !seen.has(email)) seen.set(email, r.name ?? email);
    }
    return Array.from(seen.entries()).map(([email, name], idx) => ({ id: idx, name, email }));
  }

  if (filter === "all") {
    // "Todos os clientes" = clientes cadastrados + newsletter + pessoas com reservas (sem duplicatas)
    const seen = new Map<string, { id: number; name: string; email: string }>();
    let nextId = 1;

    // 1. Todos os clientes cadastrados (ativos e inativos)
    const allClients = await db
      .select({ id: clientsTable.id, name: clientsTable.name, email: clientsTable.email })
      .from(clientsTable)
      .where(eq(clientsTable.tenantId, tenantId));
    
    for (const c of allClients) {
      const email = c.email?.trim().toLowerCase();
      if (email) {
        seen.set(email, { id: c.id, name: c.name, email: c.email });
      }
    }

    // 2. Newsletter subscribers
    const newsletters = await db
      .select({ id: newsletterSubscribersTable.id, name: newsletterSubscribersTable.name, email: newsletterSubscribersTable.email })
      .from(newsletterSubscribersTable)
      .where(and(eq(newsletterSubscribersTable.active, "true"), eq(newsletterSubscribersTable.tenantId, tenantId)));
    
    for (const n of newsletters) {
      const email = n.email?.trim().toLowerCase();
      if (email && !seen.has(email)) {
        seen.set(email, { id: nextId++, name: n.name ?? email, email: n.email });
      }
    }

    // 3. Pessoas com reservas confirmadas
    const [courtRows, classRows] = await Promise.all([
      db
        .select({ name: courtBookingsTable.customerName, email: courtBookingsTable.customerEmail })
        .from(courtBookingsTable)
        .where(and(eq(courtBookingsTable.status, "confirmed"), eq(courtBookingsTable.tenantId, tenantId))),
      db
        .select({ name: classBookingsTable.customerName, email: classBookingsTable.customerEmail })
        .from(classBookingsTable)
        .where(and(eq(classBookingsTable.status, "confirmed"), eq(classBookingsTable.tenantId, tenantId))),
    ]);
    
    for (const r of [...courtRows, ...classRows]) {
      const email = r.email?.trim().toLowerCase();
      if (email && !seen.has(email)) {
        seen.set(email, { id: nextId++, name: r.name ?? email, email: r.email });
      }
    }

    return Array.from(seen.values()).filter((c) => c.email && c.email.trim() !== "");
  }

  // Para outros filtros: buscar clientes ativos para comparação
  const allClients = await db
    .select({ id: clientsTable.id, name: clientsTable.name, email: clientsTable.email })
    .from(clientsTable)
    .where(and(eq(clientsTable.active, true), eq(clientsTable.tenantId, tenantId)));

  const clientsWithEmail = allClients.filter((c) => c.email && c.email.trim() !== "");

  const activePlans = await db
    .select({ clientId: monthlyPlansTable.clientId, type: monthlyPlansTable.type })
    .from(monthlyPlansTable)
    .where(and(eq(monthlyPlansTable.status, "active"), eq(monthlyPlansTable.tenantId, tenantId)));

  const courtClientIds = new Set(activePlans.filter((p) => p.type === "court").map((p) => p.clientId));
  const classClientIds = new Set(activePlans.filter((p) => p.type === "class").map((p) => p.clientId));
  const anyPlanClientIds = new Set(activePlans.map((p) => p.clientId));

  if (filter === "monthly_court") return clientsWithEmail.filter((c) => courtClientIds.has(c.id));
  if (filter === "monthly_class") return clientsWithEmail.filter((c) => classClientIds.has(c.id));
  if (filter === "monthly_any") return clientsWithEmail.filter((c) => anyPlanClientIds.has(c.id));
  if (filter === "no_plan") return clientsWithEmail.filter((c) => !anyPlanClientIds.has(c.id));

  return clientsWithEmail;
}

// GET / - list all campaigns
router.get("/", adminAuth, async (req, res) => {
  const tenantId = req.tenantId!;
  const campaigns = await db
    .select()
    .from(emailCampaignsTable)
    .where(eq(emailCampaignsTable.tenantId, tenantId))
    .orderBy(emailCampaignsTable.createdAt);
  res.json(campaigns.map((c) => ({
    ...c,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    sentAt: c.sentAt?.toISOString() ?? null,
  })));
});

// POST / - create campaign
router.post("/", adminAuth, async (req, res) => {
  const tenantId = req.tenantId!;
  const { name, subject, content, bgColor = "#ffffff", filter = "all" } = req.body;
  if (!name || !subject || !content) {
    res.status(400).json({ error: "name, subject e content são obrigatórios" });
    return;
  }
  const [campaign] = await db
    .insert(emailCampaignsTable)
    .values({ tenantId, name, subject, content, bgColor, filter, status: "draft" })
    .returning();
  res.json({ ...campaign, createdAt: campaign.createdAt.toISOString(), updatedAt: campaign.updatedAt.toISOString(), sentAt: null });
});

// GET /recipients/count - get count for a filter
router.get("/recipients/count", adminAuth, async (req, res) => {
  const tenantId = req.tenantId!;
  const filter = (req.query.filter as CampaignFilter) || "all";
  const recipients = await getRecipientsForFilter(filter, tenantId);
  res.json({ count: recipients.length });
});

// GET /recipients/list - get full recipient list for a filter
router.get("/recipients/list", adminAuth, async (req, res) => {
  const tenantId = req.tenantId!;
  const filter = (req.query.filter as CampaignFilter) || "all";
  const recipients = await getRecipientsForFilter(filter, tenantId);
  res.json(recipients);
});

// GET /:id - get single campaign
router.get("/:id", adminAuth, async (req, res) => {
  const tenantId = req.tenantId!;
  const id = Number(req.params.id);
  const [campaign] = await db.select().from(emailCampaignsTable).where(
    and(eq(emailCampaignsTable.id, id), eq(emailCampaignsTable.tenantId, tenantId))
  ).limit(1);
  if (!campaign) { res.status(404).json({ error: "Campanha não encontrada" }); return; }
  res.json({ ...campaign, createdAt: campaign.createdAt.toISOString(), updatedAt: campaign.updatedAt.toISOString(), sentAt: campaign.sentAt?.toISOString() ?? null });
});

// PUT /:id - update campaign
router.put("/:id", adminAuth, async (req, res) => {
  const tenantId = req.tenantId!;
  const id = Number(req.params.id);
  const { name, subject, content, bgColor, filter } = req.body;
  const [campaign] = await db
    .update(emailCampaignsTable)
    .set({ name, subject, content, ...(bgColor !== undefined && { bgColor }), filter, updatedAt: new Date() })
    .where(and(eq(emailCampaignsTable.id, id), eq(emailCampaignsTable.tenantId, tenantId)))
    .returning();
  if (!campaign) { res.status(404).json({ error: "Campanha não encontrada" }); return; }
  res.json({ ...campaign, createdAt: campaign.createdAt.toISOString(), updatedAt: campaign.updatedAt.toISOString(), sentAt: campaign.sentAt?.toISOString() ?? null });
});

// DELETE /:id - delete campaign
router.delete("/:id", adminAuth, async (req, res) => {
  const tenantId = req.tenantId!;
  const id = Number(req.params.id);
  await db.delete(emailCampaignsTable).where(
    and(eq(emailCampaignsTable.id, id), eq(emailCampaignsTable.tenantId, tenantId))
  );
  res.json({ success: true });
});

// POST /:id/preview - send preview to a specific email
router.post("/:id/preview", adminAuth, async (req, res) => {
  const tenantId = req.tenantId!;
  const id = Number(req.params.id);
  const { email } = req.body;
  if (!email) { res.status(400).json({ error: "email é obrigatório" }); return; }

  const [campaign] = await db.select().from(emailCampaignsTable).where(
    and(eq(emailCampaignsTable.id, id), eq(emailCampaignsTable.tenantId, tenantId))
  ).limit(1);
  if (!campaign) { res.status(404).json({ error: "Campanha não encontrada" }); return; }

  const previewSubject = `[PREVIEW] ${campaign.subject}`;
  const html = await buildCampaignEmail(campaign.content, campaign.bgColor ?? "#111111", tenantId);
  const ok = await sendEmail(email, previewSubject, html);
  res.json({ success: ok });
});

// POST /:id/send - send campaign (to filter recipients or custom list)
router.post("/:id/send", adminAuth, async (req, res) => {
  const tenantId = req.tenantId!;
  const id = Number(req.params.id);
  const { recipients: customRecipients } = req.body as {
    recipients?: Array<{ email: string; name: string }>;
  };

  const [campaign] = await db.select().from(emailCampaignsTable).where(
    and(eq(emailCampaignsTable.id, id), eq(emailCampaignsTable.tenantId, tenantId))
  ).limit(1);
  if (!campaign) { res.status(404).json({ error: "Campanha não encontrada" }); return; }

  // Mark as sending immediately
  await db.update(emailCampaignsTable).set({ status: "sending" }).where(
    and(eq(emailCampaignsTable.id, id), eq(emailCampaignsTable.tenantId, tenantId))
  );
  res.json({ success: true, message: "Envio iniciado" });

  // Send in background
  (async () => {
    const recipients: Array<{ id?: number; name: string; email: string }> =
      Array.isArray(customRecipients) && customRecipients.length > 0
        ? customRecipients
        : await getRecipientsForFilter(campaign.filter as CampaignFilter, tenantId);

    let sent = 0;
    let failed = 0;
    for (const recipient of recipients) {
      const personalizedContent = campaign.content
        .replace(/\{\{nome\}\}/gi, recipient.name)
        .replace(/\{\{name\}\}/gi, recipient.name);
      const html = await buildCampaignEmail(personalizedContent, campaign.bgColor ?? "#111111", tenantId);
      const ok = await sendEmail(recipient.email, campaign.subject, html);
      if (ok) sent++; else failed++;
      await new Promise((r) => setTimeout(r, 200));
    }
    await db
      .update(emailCampaignsTable)
      .set({ status: "sent", sentAt: new Date(), sentCount: sent, failedCount: failed, updatedAt: new Date() })
      .where(and(eq(emailCampaignsTable.id, id), eq(emailCampaignsTable.tenantId, tenantId)));
    console.info(`[emailCampaign] Campanha ${id} enviada: ${sent} ok, ${failed} falhas`);
  })();
});

export default router;
