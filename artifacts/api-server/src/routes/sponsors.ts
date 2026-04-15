import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sponsorsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { adminAuth } from "../middlewares/adminAuth.js";
import multer from "multer";
import path from "path";
import { saveTenantUpload } from "../lib/uploadHelper.js";

const router: IRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [".jpg", ".jpeg", ".png", ".webp", ".gif"];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error("Formato não suportado. Use JPG, PNG, WEBP ou GIF."));
    }
  },
});

// POST /sponsors/upload — upload logo file (admin only)
router.post("/upload", adminAuth, upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "Nenhum arquivo enviado" });
    return;
  }
  try {
    const { objectPath } = await saveTenantUpload(req.tenantId!, "sponsors", req.file.buffer, req.file.originalname, req.file.mimetype);
    const fileUrl = `/api/uploads${objectPath}`;
    res.json({ url: fileUrl });
  } catch (err) {
    console.error("Sponsor upload error:", err);
    res.status(500).json({ error: "Falha ao salvar imagem" });
  }
});

// GET /sponsors/:sponsorId (admin only)
router.get("/:sponsorId", adminAuth, async (req, res) => {
  const sponsorId = Number(req.params.sponsorId);
  const [sponsor] = await db.select().from(sponsorsTable).where(eq(sponsorsTable.id, sponsorId));
  if (!sponsor) {
    res.status(404).json({ error: "Sponsor not found" });
    return;
  }
  res.json({ ...sponsor, createdAt: sponsor.createdAt.toISOString() });
});

// PUT /sponsors/:sponsorId — update sponsor (admin only)
router.put("/:sponsorId", adminAuth, async (req, res) => {
  const sponsorId = Number(req.params.sponsorId);
  const { name, logoUrl, websiteUrl, position } = req.body as {
    name?: string;
    logoUrl?: string;
    websiteUrl?: string;
    position?: "left" | "right" | "bottom";
  };

  const updates: Partial<{ name: string; logoUrl: string | null; websiteUrl: string | null; position: "left" | "right" | "bottom" }> = {};
  if (name !== undefined) updates.name = name;
  if (logoUrl !== undefined) updates.logoUrl = logoUrl || null;
  if (websiteUrl !== undefined) updates.websiteUrl = websiteUrl || null;
  if (position !== undefined) updates.position = position;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  const [updated] = await db
    .update(sponsorsTable)
    .set(updates)
    .where(eq(sponsorsTable.id, sponsorId))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Sponsor not found" });
    return;
  }

  res.json({ ...updated, createdAt: updated.createdAt.toISOString() });
});

// DELETE /sponsors/:sponsorId (admin only)
router.delete("/:sponsorId", adminAuth, async (req, res) => {
  const sponsorId = Number(req.params.sponsorId);
  await db.delete(sponsorsTable).where(eq(sponsorsTable.id, sponsorId));
  res.json({ success: true, message: "Sponsor removed" });
});

export default router;
