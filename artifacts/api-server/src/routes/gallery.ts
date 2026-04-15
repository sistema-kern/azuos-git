import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { galleryPhotosTable } from "@workspace/db/schema";
import { eq, asc, and } from "drizzle-orm";
import { adminAuth } from "../middlewares/adminAuth.js";
import multer from "multer";
import path from "path";
import { saveTenantUpload } from "../lib/uploadHelper.js";

const router: IRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [".jpg", ".jpeg", ".png", ".webp", ".gif"];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error("Formato de arquivo não suportado. Use JPG, PNG, WEBP ou GIF."));
    }
  },
});

// GET /gallery
router.get("/", async (req, res) => {
  const tenantId = req.tenantId!;
  const photos = await db
    .select()
    .from(galleryPhotosTable)
    .where(eq(galleryPhotosTable.tenantId, tenantId))
    .orderBy(asc(galleryPhotosTable.createdAt));

  res.json(photos.map((p) => ({ ...p, createdAt: p.createdAt.toISOString() })));
});

// POST /gallery/upload - upload a photo file (admin only)
router.post("/upload", adminAuth, upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "Nenhum arquivo enviado" });
    return;
  }
  try {
    const { objectPath } = await saveTenantUpload(req.tenantId!, "gallery", req.file.buffer, req.file.originalname, req.file.mimetype);
    const fileUrl = `/api/uploads${objectPath}`;
    res.json({ url: fileUrl });
  } catch (err) {
    console.error("Gallery upload error:", err);
    res.status(500).json({ error: "Falha ao salvar imagem" });
  }
});

// POST /gallery - add a photo by URL (admin only)
router.post("/", adminAuth, async (req, res) => {
  const { url, caption, category } = req.body;

  if (!url) {
    res.status(400).json({ error: "url is required" });
    return;
  }

  const [photo] = await db
    .insert(galleryPhotosTable)
    .values({ tenantId: req.tenantId!, url, caption, category })
    .returning();

  res.status(201).json({ ...photo, createdAt: photo.createdAt.toISOString() });
});

// DELETE /gallery/:photoId (admin only)
router.delete("/:photoId", adminAuth, async (req, res) => {
  const photoId = Number(req.params.photoId);
  await db.delete(galleryPhotosTable).where(
    and(eq(galleryPhotosTable.id, photoId), eq(galleryPhotosTable.tenantId, req.tenantId!))
  );
  res.json({ success: true, message: "Photo deleted" });
});

export default router;
