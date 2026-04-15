import { Router } from "express";
import { db } from "@workspace/db";
import { courtsTable, courtSchedulesTable } from "@workspace/db/schema";
import { eq, asc, and } from "drizzle-orm";
import { adminAuth } from "../middlewares/adminAuth.js";
import multer from "multer";
import path from "path";
import { saveTenantUpload } from "../lib/uploadHelper.js";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [".jpg", ".jpeg", ".png", ".webp"];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error("Formato inválido. Use JPG, PNG ou WEBP."));
    }
  },
});

// GET /courts — list courts for this tenant (public)
router.get("/", async (req, res) => {
  try {
    const tenantId = req.tenantId!;
    const courts = await db
      .select()
      .from(courtsTable)
      .where(eq(courtsTable.tenantId, tenantId))
      .orderBy(asc(courtsTable.number));
    res.json(courts);
  } catch {
    res.status(500).json({ error: "Falha ao buscar quadras" });
  }
});

// GET /courts/:id/schedule — get weekly schedule for a court (public)
router.get("/:id/schedule", async (req, res) => {
  try {
    const tenantId = req.tenantId!;
    const courtId = Number(req.params.id);
    // Verify court belongs to this tenant
    const [court] = await db
      .select({ id: courtsTable.id })
      .from(courtsTable)
      .where(and(eq(courtsTable.id, courtId), eq(courtsTable.tenantId, tenantId)))
      .limit(1);
    if (!court) {
      res.status(404).json({ error: "Quadra não encontrada" });
      return;
    }
    const rows = await db
      .select()
      .from(courtSchedulesTable)
      .where(and(eq(courtSchedulesTable.courtId, courtId), eq(courtSchedulesTable.tenantId, tenantId)))
      .orderBy(asc(courtSchedulesTable.dayOfWeek));
    res.json(rows);
  } catch {
    res.status(500).json({ error: "Falha ao buscar horários" });
  }
});

// PUT /courts/:id/schedule — upsert full weekly schedule (admin)
router.put("/:id/schedule", adminAuth, async (req, res) => {
  try {
    const tenantId = req.tenantId!;
    const courtId = Number(req.params.id);
    const { schedule } = req.body as {
      schedule: Array<{
        dayOfWeek: number;
        openHour: number;
        openMinute: number;
        afternoonStartHour?: number;
        afternoonStartMinute?: number;
        eveningStartHour?: number;
        eveningStartMinute?: number;
        closeHour: number;
        closeMinute: number;
        isOpen: boolean;
        morningPrice?: number;
        afternoonPrice?: number;
        eveningPrice?: number;
      }>;
    };

    if (!Array.isArray(schedule) || schedule.length === 0) {
      res.status(400).json({ error: "schedule deve ser um array" });
      return;
    }

    // Verify court belongs to this tenant
    const [court] = await db
      .select({ id: courtsTable.id })
      .from(courtsTable)
      .where(and(eq(courtsTable.id, courtId), eq(courtsTable.tenantId, tenantId)))
      .limit(1);
    if (!court) {
      res.status(404).json({ error: "Quadra não encontrada" });
      return;
    }

    await db.delete(courtSchedulesTable).where(
      and(eq(courtSchedulesTable.courtId, courtId), eq(courtSchedulesTable.tenantId, tenantId))
    );

    const rows = schedule.map((s) => ({
      tenantId,
      courtId,
      dayOfWeek: s.dayOfWeek,
      openHour: Number(s.openHour),
      openMinute: Number(s.openMinute),
      afternoonStartHour: Number(s.afternoonStartHour ?? 12),
      afternoonStartMinute: Number(s.afternoonStartMinute ?? 0),
      eveningStartHour: Number(s.eveningStartHour ?? 17),
      eveningStartMinute: Number(s.eveningStartMinute ?? 0),
      closeHour: Number(s.closeHour),
      closeMinute: Number(s.closeMinute),
      isOpen: s.isOpen !== false,
      morningPrice: String(Number(s.morningPrice ?? 60)),
      afternoonPrice: String(Number(s.afternoonPrice ?? 70)),
      eveningPrice: String(Number(s.eveningPrice ?? 80)),
    }));

    await db.insert(courtSchedulesTable).values(rows);

    res.json({ success: true });
  } catch (err) {
    console.error("Error saving schedule:", err);
    res.status(500).json({ error: "Falha ao salvar horários" });
  }
});

// POST /courts — create a new court (admin)
router.post("/", adminAuth, async (req, res) => {
  try {
    const tenantId = req.tenantId!;
    const { name, number, description, active = true } = req.body as {
      name?: string;
      number?: number;
      description?: string;
      active?: boolean;
    };

    if (!name || !number) {
      res.status(400).json({ error: "name e number são obrigatórios" });
      return;
    }

    const [court] = await db
      .insert(courtsTable)
      .values({
        tenantId,
        name: name.trim(),
        number: Number(number),
        description: description?.trim() ?? null,
        active: active !== false,
      })
      .returning();

    res.status(201).json(court);
  } catch {
    res.status(500).json({ error: "Falha ao criar quadra" });
  }
});

// PATCH /courts/:id — update a court (admin)
router.patch("/:id", adminAuth, async (req, res) => {
  try {
    const tenantId = req.tenantId!;
    const id = Number(req.params.id);
    const { name, number, description, active } = req.body as {
      name?: string;
      number?: number;
      description?: string;
      active?: boolean;
    };

    const updates: Partial<typeof courtsTable.$inferInsert> = {};
    if (name !== undefined) updates.name = name.trim();
    if (number !== undefined) updates.number = Number(number);
    if (description !== undefined) updates.description = description.trim() || null;
    if (active !== undefined) updates.active = active;

    const [court] = await db
      .update(courtsTable)
      .set(updates)
      .where(and(eq(courtsTable.id, id), eq(courtsTable.tenantId, tenantId)))
      .returning();

    if (!court) {
      res.status(404).json({ error: "Quadra não encontrada" });
      return;
    }

    res.json(court);
  } catch {
    res.status(500).json({ error: "Falha ao atualizar quadra" });
  }
});

// DELETE /courts/:id — delete a court (admin)
router.delete("/:id", adminAuth, async (req, res) => {
  try {
    const tenantId = req.tenantId!;
    const id = Number(req.params.id);

    // Verify ownership before deleting schedules
    const [court] = await db
      .select({ id: courtsTable.id })
      .from(courtsTable)
      .where(and(eq(courtsTable.id, id), eq(courtsTable.tenantId, tenantId)))
      .limit(1);

    if (!court) {
      res.status(404).json({ error: "Quadra não encontrada" });
      return;
    }

    await db.delete(courtSchedulesTable).where(
      and(eq(courtSchedulesTable.courtId, id), eq(courtSchedulesTable.tenantId, tenantId))
    );
    await db.delete(courtsTable).where(
      and(eq(courtsTable.id, id), eq(courtsTable.tenantId, tenantId))
    );

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Falha ao excluir quadra" });
  }
});

// PUT /courts/:id/photo — upload court photo (admin)
router.put("/:id/photo", adminAuth, upload.single("file"), async (req, res) => {
  try {
    const tenantId = req.tenantId!;
    const id = Number(req.params.id);
    if (!req.file) {
      res.status(400).json({ error: "Nenhum arquivo enviado" });
      return;
    }

    const { objectPath } = await saveTenantUpload(req.tenantId!, "courts", req.file.buffer, req.file.originalname, req.file.mimetype);
    const photoUrl = `/api/uploads${objectPath}`;

    const [court] = await db
      .update(courtsTable)
      .set({ photoUrl })
      .where(and(eq(courtsTable.id, id), eq(courtsTable.tenantId, tenantId)))
      .returning();

    if (!court) {
      res.status(404).json({ error: "Quadra não encontrada" });
      return;
    }

    res.json(court);
  } catch (err) {
    console.error("Court photo upload error:", err);
    res.status(500).json({ error: "Falha ao salvar imagem" });
  }
});

export default router;
