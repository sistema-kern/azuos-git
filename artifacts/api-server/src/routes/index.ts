import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import bookingsRouter from "./bookings.js";
import tournamentsRouter from "./tournaments.js";
import galleryRouter from "./gallery.js";
import sponsorsRouter from "./sponsors.js";
import adminRouter from "./admin.js";
import settingsRouter from "./settings.js";
import storageRouter from "./storage.js";
import courtsRouter from "./courts.js";
import clientsRouter from "./clients.js";
import publicRouter from "./public.js";
import couponsRouter from "./coupons.js";
import profileRouter from "./profile.js";
import emailCampaignsRouter from "./emailCampaigns.js";
import emailTemplatesRouter from "./emailTemplates.js";
import newsletterRouter from "./newsletter.js";
import emailGroupsRouter from "./emailGroups.js";
import homeContentRouter from "./homeContent.js";
import screenshotsRouter from "./screenshots.js";
import authRouter from "./auth.js";
import superRouter from "./super.js";
import contactRouter from "./contact.js";
import { pushRouter } from "./push.js";
import analyticsRouter from "./analytics.js";
import reportsRouter from "./reports.js";
import { db } from "@workspace/db";
import { tournamentsTable, categoriesTable, pairsTable, matchesTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { adminAuth } from "../middlewares/adminAuth.js";
import multer from "multer";
import path from "path";
import { saveTenantUpload } from "../lib/uploadHelper.js";
import { getBaseUrl } from "../lib/baseUrl.js";

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

router.use(healthRouter);
router.use(storageRouter);
router.use("/auth", authRouter);
router.use("/super", superRouter);
router.use("/bookings", bookingsRouter);
router.use("/tournaments", tournamentsRouter);
router.use("/gallery", galleryRouter);
router.use("/sponsors", sponsorsRouter);
router.use("/admin", adminRouter);
router.use("/settings", settingsRouter);
router.use("/courts", courtsRouter);
router.use("/clients", clientsRouter);
router.use("/public", publicRouter);
router.use("/coupons", couponsRouter);
router.use("/profile", profileRouter);
router.use("/email-campaigns", emailCampaignsRouter);
router.use("/email-templates", emailTemplatesRouter);
router.use("/newsletter", newsletterRouter);
router.use("/email-groups", emailGroupsRouter);
router.use("/home", homeContentRouter);
router.use("/screenshots", screenshotsRouter);
router.use("/contact", contactRouter);
router.use("/push", pushRouter);
router.use("/analytics", analyticsRouter);
router.use("/reports", reportsRouter);

// POST /pairs/upload - upload a photo file for a pair (admin only)
router.post("/pairs/upload", adminAuth, upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "Nenhum arquivo enviado" });
    return;
  }
  try {
    const { objectPath } = await saveTenantUpload(req.tenantId!, "pairs", req.file.buffer, req.file.originalname, req.file.mimetype);
    const fileUrl = `/api/uploads${objectPath}`;
    res.json({ url: fileUrl });
  } catch (err) {
    console.error("Pair upload error:", err);
    res.status(500).json({ error: "Falha ao salvar imagem" });
  }
});

// PUT /pairs/:pairId/photo (convenience route, admin only)
router.put("/pairs/:pairId/photo", adminAuth, async (req, res) => {
  const pairId = Number(req.params.pairId);
  const { photoUrl } = req.body;
  const [pair] = await db.update(pairsTable).set({ photoUrl }).where(eq(pairsTable.id, pairId)).returning();
  res.json(pair);
});

// GET /champions - champions across this tenant's tournaments
router.get("/champions", async (req, res) => {
  const tenantId = req.tenantId!;
  const tournaments = await db.select().from(tournamentsTable).where(eq(tournamentsTable.tenantId, tenantId));
  const result = [];

  for (const t of tournaments) {
    const categories = await db.select().from(categoriesTable).where(eq(categoriesTable.tournamentId, t.id));

    for (const cat of categories) {
      const pairs = await db.select().from(pairsTable).where(eq(pairsTable.categoryId, cat.id));
      const pairMap = new Map(pairs.map((p) => [p.id, p]));

      const finalMatches = await db
        .select()
        .from(matchesTable)
        .where(and(eq(matchesTable.categoryId, cat.id), eq(matchesTable.phase, "final")));

      const thirdMatches = await db
        .select()
        .from(matchesTable)
        .where(and(eq(matchesTable.categoryId, cat.id), eq(matchesTable.phase, "third_place")));

      let champion = null;
      let runnerUp = null;
      let thirdPlace = null;

      if (finalMatches.length > 0 && finalMatches[0].winnerId) {
        const winner = pairMap.get(finalMatches[0].winnerId);
        champion = winner ? { ...winner, createdAt: winner.createdAt.toISOString() } : null;
        const loserId = finalMatches[0].winnerId === finalMatches[0].pair1Id
          ? finalMatches[0].pair2Id
          : finalMatches[0].pair1Id;
        const loser = loserId ? pairMap.get(loserId) : undefined;
        runnerUp = loser ? { ...loser, createdAt: loser.createdAt.toISOString() } : null;
      }

      if (thirdMatches.length > 0 && thirdMatches[0].winnerId) {
        const third = pairMap.get(thirdMatches[0].winnerId);
        thirdPlace = third ? { ...third, createdAt: third.createdAt.toISOString() } : null;
      }

      if (champion || runnerUp || thirdPlace) {
        result.push({
          tournamentId: t.id,
          tournamentName: t.name,
          startDate: t.startDate,
          categoryId: cat.id,
          categoryName: cat.name,
          champion,
          runnerUp,
          thirdPlace,
        });
      }
    }
  }

  res.json(result);
});

export default router;
