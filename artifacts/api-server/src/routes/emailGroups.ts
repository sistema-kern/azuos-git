import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { emailGroupsTable, emailGroupMembersTable } from "@workspace/db/schema";
import { eq, sql, and } from "drizzle-orm";
import { adminAuth } from "../middlewares/adminAuth.js";

const router: IRouter = Router();

// GET / - list all groups with member count
router.get("/", adminAuth, async (req, res) => {
  const tenantId = req.tenantId!;
  const groups = await db
    .select({
      id: emailGroupsTable.id,
      name: emailGroupsTable.name,
      createdAt: emailGroupsTable.createdAt,
      memberCount: sql<number>`(select count(*) from email_group_members where group_id = ${emailGroupsTable.id})::int`,
    })
    .from(emailGroupsTable)
    .where(eq(emailGroupsTable.tenantId, tenantId))
    .orderBy(emailGroupsTable.createdAt);
  res.json(groups);
});

// POST / - create a group
router.post("/", adminAuth, async (req, res) => {
  const tenantId = req.tenantId!;
  const { name } = req.body as { name: string };
  if (!name?.trim()) {
    res.status(400).json({ error: "Nome do grupo é obrigatório" });
    return;
  }
  const [group] = await db.insert(emailGroupsTable).values({ tenantId, name: name.trim() }).returning();
  res.status(201).json(group);
});

// DELETE /:id - delete a group (cascades members)
router.delete("/:id", adminAuth, async (req, res) => {
  const tenantId = req.tenantId!;
  const id = Number(req.params.id);
  await db.delete(emailGroupsTable).where(and(eq(emailGroupsTable.id, id), eq(emailGroupsTable.tenantId, tenantId)));
  res.json({ ok: true });
});

// PATCH /:id - rename a group
router.patch("/:id", adminAuth, async (req, res) => {
  const tenantId = req.tenantId!;
  const id = Number(req.params.id);
  const { name } = req.body as { name: string };
  if (!name?.trim()) {
    res.status(400).json({ error: "Nome é obrigatório" });
    return;
  }
  const [group] = await db.update(emailGroupsTable).set({ name: name.trim() })
    .where(and(eq(emailGroupsTable.id, id), eq(emailGroupsTable.tenantId, tenantId)))
    .returning();
  res.json(group);
});

// GET /:id/members - list members of a group
router.get("/:id/members", adminAuth, async (req, res) => {
  const tenantId = req.tenantId!;
  const groupId = Number(req.params.id);
  const [group] = await db.select({ id: emailGroupsTable.id }).from(emailGroupsTable)
    .where(and(eq(emailGroupsTable.id, groupId), eq(emailGroupsTable.tenantId, tenantId)))
    .limit(1);
  if (!group) { res.status(404).json({ error: "Grupo não encontrado" }); return; }
  const members = await db
    .select()
    .from(emailGroupMembersTable)
    .where(eq(emailGroupMembersTable.groupId, groupId))
    .orderBy(emailGroupMembersTable.createdAt);
  res.json(members);
});

// POST /:id/members - add one or multiple members
router.post("/:id/members", adminAuth, async (req, res) => {
  const tenantId = req.tenantId!;
  const groupId = Number(req.params.id);
  const [group] = await db.select({ id: emailGroupsTable.id }).from(emailGroupsTable)
    .where(and(eq(emailGroupsTable.id, groupId), eq(emailGroupsTable.tenantId, tenantId)))
    .limit(1);
  if (!group) { res.status(404).json({ error: "Grupo não encontrado" }); return; }

  const { members } = req.body as { members: Array<{ name?: string; email: string }> };
  if (!members || !Array.isArray(members) || members.length === 0) {
    res.status(400).json({ error: "Lista de membros inválida" });
    return;
  }

  const valid = members.filter((m) => m.email && m.email.includes("@"));
  if (valid.length === 0) {
    res.status(400).json({ error: "Nenhum e-mail válido fornecido" });
    return;
  }

  const existing = await db
    .select({ email: emailGroupMembersTable.email })
    .from(emailGroupMembersTable)
    .where(eq(emailGroupMembersTable.groupId, groupId));
  const existingEmails = new Set(existing.map((e) => e.email.toLowerCase().trim()));

  const toInsert = valid
    .filter((m) => !existingEmails.has(m.email.toLowerCase().trim()))
    .map((m) => ({ groupId, name: m.name?.trim() || null, email: m.email.trim() }));

  const inserted = toInsert.length > 0
    ? await db.insert(emailGroupMembersTable).values(toInsert).returning()
    : [];

  res.status(201).json({ inserted: inserted.length, skipped: valid.length - toInsert.length });
});

// DELETE /:id/members/:memberId - remove a member
router.delete("/:id/members/:memberId", adminAuth, async (req, res) => {
  const memberId = Number(req.params.memberId);
  await db.delete(emailGroupMembersTable).where(eq(emailGroupMembersTable.id, memberId));
  res.json({ ok: true });
});

export default router;
