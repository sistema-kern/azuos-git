import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { newsletterSubscribersTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { adminAuth } from "../middlewares/adminAuth.js";
import { getPublicTenantId } from "./settings.js";

const router: IRouter = Router();

// POST /newsletter/subscribe - public
router.post("/subscribe", async (req, res) => {
  const { email, name } = req.body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: "E-mail inválido" });
    return;
  }
  const tenantId = getPublicTenantId(req);
  try {
    await db
      .insert(newsletterSubscribersTable)
      .values({ tenantId, email: email.trim().toLowerCase(), name: name?.trim() ?? null })
      .onConflictDoUpdate({
        target: [newsletterSubscribersTable.tenantId, newsletterSubscribersTable.email],
        set: { active: "true", name: name?.trim() ?? undefined },
      });
    res.json({ success: true, message: "Inscrito com sucesso!" });
  } catch (err) {
    console.error("[newsletter] Erro ao inscrever:", err);
    res.status(500).json({ error: "Erro ao salvar inscrição" });
  }
});

// GET / - admin: list subscribers for this tenant
router.get("/", adminAuth, async (req, res) => {
  const tenantId = req.tenantId!;
  const rows = await db
    .select()
    .from(newsletterSubscribersTable)
    .where(eq(newsletterSubscribersTable.tenantId, tenantId))
    .orderBy(newsletterSubscribersTable.createdAt);
  res.json(rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })));
});

// DELETE /:id - admin: remove subscriber (scoped to tenant)
router.delete("/:id", adminAuth, async (req, res) => {
  const id = Number(req.params.id);
  const tenantId = req.tenantId!;
  await db.delete(newsletterSubscribersTable)
    .where(and(eq(newsletterSubscribersTable.id, id), eq(newsletterSubscribersTable.tenantId, tenantId)));
  res.json({ success: true });
});

export default router;
