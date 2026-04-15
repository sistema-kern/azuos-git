import { Router } from "express";
import { db } from "@workspace/db";
import { couponsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { adminAuth } from "../middlewares/adminAuth.js";
import { getPublicTenantId } from "./settings.js";

const router = Router();

// GET /coupons - list all coupons (admin)
router.get("/", adminAuth, async (req, res) => {
  try {
    const tenantId = req.tenantId!;
    const coupons = await db
      .select()
      .from(couponsTable)
      .where(eq(couponsTable.tenantId, tenantId))
      .orderBy(couponsTable.createdAt);
    res.json(coupons);
  } catch (err) {
    req.log.error({ err }, "Falha ao buscar cupons");
    res.status(500).json({ error: "Falha ao buscar cupons" });
  }
});

// POST /coupons - create coupon (admin)
router.post("/", adminAuth, async (req, res) => {
  const tenantId = req.tenantId!;
  const { code, type, value, maxUses, active, scope, tournamentId, expiresAt } = req.body as {
    code: string;
    type: "percentage" | "fixed";
    value: number;
    maxUses?: number;
    active?: boolean;
    scope?: "booking" | "tournament";
    tournamentId?: number;
    expiresAt?: string;
  };

  if (!code || !type || value == null) {
    res.status(400).json({ error: "Campos obrigatórios: code, type, value" });
    return;
  }
  if (!["percentage", "fixed"].includes(type)) {
    res.status(400).json({ error: "Tipo deve ser 'percentage' ou 'fixed'" });
    return;
  }
  if (type === "percentage" && (value <= 0 || value > 100)) {
    res.status(400).json({ error: "Percentual deve ser entre 1 e 100" });
    return;
  }
  if (value <= 0) {
    res.status(400).json({ error: "Valor deve ser maior que zero" });
    return;
  }

  const resolvedScope = scope ?? "booking";
  if (resolvedScope === "tournament" && !tournamentId) {
    res.status(400).json({ error: "Selecione o torneio ao qual este cupom pertence" });
    return;
  }

  try {
    const [coupon] = await db
      .insert(couponsTable)
      .values({
        tenantId,
        code: code.toUpperCase().trim(),
        type,
        value: String(value),
        maxUses: maxUses ?? null,
        active: active ?? true,
        scope: resolvedScope,
        tournamentId: resolvedScope === "tournament" ? (tournamentId ?? null) : null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      })
      .returning();
    res.status(201).json({ ...coupon, expiresAt: coupon.expiresAt ? coupon.expiresAt.toISOString() : null });
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "Código de cupom já existe" });
      return;
    }
    req.log.error({ err }, "Falha ao criar cupom");
    res.status(500).json({ error: "Falha ao criar cupom" });
  }
});

// PATCH /coupons/:id - toggle active or update (admin)
router.patch("/:id", adminAuth, async (req, res) => {
  const tenantId = req.tenantId!;
  const id = Number(req.params.id);
  const { active, value, maxUses } = req.body as {
    active?: boolean;
    value?: number;
    maxUses?: number | null;
  };

  const updates: Partial<typeof couponsTable.$inferInsert> = {};
  if (active !== undefined) updates.active = active;
  if (value !== undefined) updates.value = String(value);
  if (maxUses !== undefined) updates.maxUses = maxUses;

  try {
    const [updated] = await db
      .update(couponsTable)
      .set(updates)
      .where(and(eq(couponsTable.id, id), eq(couponsTable.tenantId, tenantId)))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Cupom não encontrado" });
      return;
    }
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Falha ao atualizar cupom");
    res.status(500).json({ error: "Falha ao atualizar cupom" });
  }
});

// DELETE /coupons/:id - delete coupon (admin)
router.delete("/:id", adminAuth, async (req, res) => {
  const tenantId = req.tenantId!;
  const id = Number(req.params.id);
  try {
    await db.delete(couponsTable).where(and(eq(couponsTable.id, id), eq(couponsTable.tenantId, tenantId)));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Falha ao deletar cupom");
    res.status(500).json({ error: "Falha ao deletar cupom" });
  }
});

// POST /coupons/validate - validate a coupon code (public)
router.post("/validate", async (req, res) => {
  const tenantId = getPublicTenantId(req);
  const { code } = req.body as { code: string };
  if (!code) {
    res.status(400).json({ error: "Código inválido" });
    return;
  }

  try {
    const [coupon] = await db
      .select()
      .from(couponsTable)
      .where(and(eq(couponsTable.code, code.toUpperCase().trim()), eq(couponsTable.tenantId, tenantId)));

    if (!coupon) {
      res.status(404).json({ error: "Cupom não encontrado" });
      return;
    }
    if (!coupon.active) {
      res.status(400).json({ error: "Cupom inativo" });
      return;
    }
    if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) {
      res.status(400).json({ error: "Cupom esgotado" });
      return;
    }

    res.json({
      id: coupon.id,
      code: coupon.code,
      type: coupon.type,
      value: Number(coupon.value),
    });
  } catch (err) {
    req.log.error({ err }, "Falha ao validar cupom");
    res.status(500).json({ error: "Falha ao validar cupom" });
  }
});

export default router;
