import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { emailTemplatesTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { adminAuth } from "../middlewares/adminAuth.js";
import multer from "multer";
import path from "path";
import { saveTenantUpload } from "../lib/uploadHelper.js";
import { getBaseUrl } from "../lib/baseUrl.js";

const router: IRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".mp4", ".webm"];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error("Formato não suportado. Use JPG, PNG, GIF, WEBP, MP4 ou WEBM."));
    }
  },
});

// GET / - list all templates
router.get("/", adminAuth, async (_req, res) => {
  const templates = await db
    .select()
    .from(emailTemplatesTable)
    .orderBy(emailTemplatesTable.createdAt);
  res.json(templates.map((t) => ({
    ...t,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  })));
});

// POST / - create template
router.post("/", adminAuth, async (req, res) => {
  const { name, subject, content, bgColor } = req.body;
  if (!name || !content) {
    res.status(400).json({ error: "name e content são obrigatórios" });
    return;
  }
  const [template] = await db
    .insert(emailTemplatesTable)
    .values({ name, subject: subject ?? null, content, bgColor: bgColor ?? "#ffffff" })
    .returning();
  res.json({ ...template, createdAt: template.createdAt.toISOString(), updatedAt: template.updatedAt.toISOString() });
});

// PUT /:id - update template
router.put("/:id", adminAuth, async (req, res) => {
  const id = Number(req.params.id);
  const { name, subject, content, bgColor } = req.body;
  const [template] = await db
    .update(emailTemplatesTable)
    .set({ name, subject, content, bgColor, updatedAt: new Date() })
    .where(eq(emailTemplatesTable.id, id))
    .returning();
  if (!template) { res.status(404).json({ error: "Template não encontrado" }); return; }
  res.json({ ...template, createdAt: template.createdAt.toISOString(), updatedAt: template.updatedAt.toISOString() });
});

// DELETE /:id - delete template
router.delete("/:id", adminAuth, async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(emailTemplatesTable).where(eq(emailTemplatesTable.id, id));
  res.json({ success: true });
});

// POST /upload-media - upload image or video for use in emails
router.post("/upload-media", adminAuth, upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "Nenhum arquivo enviado" });
    return;
  }
  try {
    const { objectPath } = await saveTenantUpload(req.tenantId!, "email-templates", req.file.buffer, req.file.originalname, req.file.mimetype);
    const fileUrl = `/api/uploads${objectPath}`;
    res.json({ url: fileUrl, type: req.file.mimetype.startsWith("video/") ? "video" : "image" });
  } catch (err) {
    console.error("Email media upload error:", err);
    res.status(500).json({ error: "Falha ao fazer upload" });
  }
});

export default router;
