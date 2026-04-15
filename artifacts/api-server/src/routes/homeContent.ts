import { Router, type IRouter, type Request } from "express";
import { db } from "@workspace/db";
import { homeSlides, homeCards } from "@workspace/db/schema";
import { eq, asc, and } from "drizzle-orm";
import { adminAuth } from "../middlewares/adminAuth.js";
import multer from "multer";
import path from "path";
import { saveTenantUpload } from "../lib/uploadHelper.js";
import { getPublicTenantId } from "./settings.js";

const router: IRouter = Router();

const slideImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [".jpg", ".jpeg", ".png", ".webp", ".gif"];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error("Formato não suportado. Use JPG, PNG ou WEBP."));
  },
});

function resolveSlideImageUrl(url: string | null): string | null {
  if (!url) return url;
  if (url.startsWith("http")) return url;
  if (url.startsWith("/objects/")) return `/api/storage${url}`; // legacy GCS
  if (url.startsWith("/tenant-")) return `/api/uploads${url}`; // local disk
  if (url.startsWith("/api/")) return url; // already full API path
  return url;
}

// ── SLIDES ──────────────────────────────────────────────────────────────────

// GET /home/slides - public
router.get("/slides", async (req, res) => {
  const tenantId = getPublicTenantId(req);
  const slides = await db.select().from(homeSlides)
    .where(and(eq(homeSlides.tenantId, tenantId), eq(homeSlides.active, true)))
    .orderBy(asc(homeSlides.displayOrder));
  res.json(slides.map((s) => ({ ...s, bgImageUrl: resolveSlideImageUrl(s.bgImageUrl) })));
});

// GET /home/slides/all - admin only (includes inactive)
router.get("/slides/all", adminAuth, async (req, res) => {
  const tenantId = req.tenantId!;
  const slides = await db.select().from(homeSlides)
    .where(eq(homeSlides.tenantId, tenantId))
    .orderBy(asc(homeSlides.displayOrder));
  res.json(slides.map((s) => ({ ...s, bgImageUrl: resolveSlideImageUrl(s.bgImageUrl) })));
});

// POST /home/slides - create
router.post("/slides", adminAuth, async (req, res) => {
  const tenantId = req.tenantId!;
  const body = req.body;
  const maxOrder = await db.select({ o: homeSlides.displayOrder }).from(homeSlides)
    .where(eq(homeSlides.tenantId, tenantId))
    .orderBy(asc(homeSlides.displayOrder));
  const nextOrder = maxOrder.length > 0 ? Math.max(...maxOrder.map((r) => r.o ?? 0)) + 1 : 0;
  const [slide] = await db.insert(homeSlides).values({
    tenantId,
    title: body.title ?? "Novo Banner",
    subtitle: body.subtitle ?? null,
    cta1Label: body.cta1Label ?? null,
    cta1Href: body.cta1Href ?? null,
    cta1Icon: body.cta1Icon ?? null,
    cta2Label: body.cta2Label ?? null,
    cta2Href: body.cta2Href ?? null,
    cta2Icon: body.cta2Icon ?? null,
    bgImageUrl: body.bgImageUrl ?? null,
    gradient: body.gradient ?? null,
    displayOrder: nextOrder,
    active: body.active ?? true,
  }).returning();
  res.json(slide);
});

// PUT /home/slides/:id - update slide
router.put("/slides/:id", adminAuth, async (req, res) => {
  const tenantId = req.tenantId!;
  const id = Number(req.params.id);
  const body = req.body;
  const updateData: Partial<typeof homeSlides.$inferInsert> = {};
  if ("title" in body) updateData.title = body.title;
  if ("subtitle" in body) updateData.subtitle = body.subtitle;
  if ("cta1Label" in body) updateData.cta1Label = body.cta1Label;
  if ("cta1Href" in body) updateData.cta1Href = body.cta1Href;
  if ("cta1Icon" in body) updateData.cta1Icon = body.cta1Icon;
  if ("cta2Label" in body) updateData.cta2Label = body.cta2Label;
  if ("cta2Href" in body) updateData.cta2Href = body.cta2Href;
  if ("cta2Icon" in body) updateData.cta2Icon = body.cta2Icon;
  if ("bgImageUrl" in body) updateData.bgImageUrl = body.bgImageUrl;
  if ("gradient" in body) updateData.gradient = body.gradient;
  if ("displayOrder" in body) updateData.displayOrder = body.displayOrder;
  if ("active" in body) updateData.active = body.active;
  const [slide] = await db.update(homeSlides).set(updateData)
    .where(and(eq(homeSlides.id, id), eq(homeSlides.tenantId, tenantId)))
    .returning();
  if (!slide) { res.status(404).json({ error: "Banner não encontrado" }); return; }
  res.json(slide);
});

// DELETE /home/slides/:id
router.delete("/slides/:id", adminAuth, async (req, res) => {
  const tenantId = req.tenantId!;
  const id = Number(req.params.id);
  await db.delete(homeSlides).where(and(eq(homeSlides.id, id), eq(homeSlides.tenantId, tenantId)));
  res.json({ success: true });
});

// POST /home/slides/:id/image - upload background image to GCS
router.post("/slides/:id/image", adminAuth, slideImageUpload.single("image"), async (req, res) => {
  const tenantId = req.tenantId!;
  const id = Number(req.params.id);
  if (!req.file) { res.status(400).json({ error: "Nenhum arquivo enviado" }); return; }
  try {
    const { objectPath } = await saveTenantUpload(req.tenantId!, "home", req.file.buffer, req.file.originalname, req.file.mimetype);
    const [slide] = await db.update(homeSlides).set({ bgImageUrl: objectPath })
      .where(and(eq(homeSlides.id, id), eq(homeSlides.tenantId, tenantId)))
      .returning();
    if (!slide) { res.status(404).json({ error: "Banner não encontrado" }); return; }
    res.json({ success: true, url: `/api/uploads${objectPath}` });
  } catch (err) {
    console.error("Slide image GCS upload failed:", err);
    res.status(500).json({ error: "Falha ao salvar imagem. Tente novamente." });
  }
});

// ── CARDS ────────────────────────────────────────────────────────────────────

// GET /home/cards - public
router.get("/cards", async (req, res) => {
  const tenantId = getPublicTenantId(req);
  const cards = await db.select().from(homeCards)
    .where(and(eq(homeCards.tenantId, tenantId), eq(homeCards.active, true)))
    .orderBy(asc(homeCards.displayOrder));
  res.json(cards);
});

// GET /home/cards/all - admin only
router.get("/cards/all", adminAuth, async (req, res) => {
  const tenantId = req.tenantId!;
  const cards = await db.select().from(homeCards)
    .where(eq(homeCards.tenantId, tenantId))
    .orderBy(asc(homeCards.displayOrder));
  res.json(cards);
});

// POST /home/cards - create
router.post("/cards", adminAuth, async (req, res) => {
  const tenantId = req.tenantId!;
  const body = req.body;
  const maxOrder = await db.select({ o: homeCards.displayOrder }).from(homeCards)
    .where(eq(homeCards.tenantId, tenantId))
    .orderBy(asc(homeCards.displayOrder));
  const nextOrder = maxOrder.length > 0 ? Math.max(...maxOrder.map((r) => r.o ?? 0)) + 1 : 0;
  const [card] = await db.insert(homeCards).values({
    tenantId,
    title: body.title ?? "Novo Card",
    description: body.description ?? "",
    icon: body.icon ?? "star",
    linkHref: body.linkHref ?? null,
    linkLabel: body.linkLabel ?? null,
    highlight: body.highlight ?? false,
    displayOrder: nextOrder,
    active: body.active ?? true,
  }).returning();
  res.json(card);
});

// PUT /home/cards/:id - update card
router.put("/cards/:id", adminAuth, async (req, res) => {
  const tenantId = req.tenantId!;
  const id = Number(req.params.id);
  const body = req.body;
  const updateData: Partial<typeof homeCards.$inferInsert> = {};
  if ("title" in body) updateData.title = body.title;
  if ("description" in body) updateData.description = body.description;
  if ("icon" in body) updateData.icon = body.icon;
  if ("linkHref" in body) updateData.linkHref = body.linkHref;
  if ("linkLabel" in body) updateData.linkLabel = body.linkLabel;
  if ("highlight" in body) updateData.highlight = body.highlight;
  if ("displayOrder" in body) updateData.displayOrder = body.displayOrder;
  if ("active" in body) updateData.active = body.active;
  const [card] = await db.update(homeCards).set(updateData)
    .where(and(eq(homeCards.id, id), eq(homeCards.tenantId, tenantId)))
    .returning();
  if (!card) { res.status(404).json({ error: "Card não encontrado" }); return; }
  res.json(card);
});

// DELETE /home/cards/:id
router.delete("/cards/:id", adminAuth, async (req, res) => {
  const tenantId = req.tenantId!;
  const id = Number(req.params.id);
  await db.delete(homeCards).where(and(eq(homeCards.id, id), eq(homeCards.tenantId, tenantId)));
  res.json({ success: true });
});

export default router;
