import { Router, type IRouter } from "express";
import multer from "multer";
import path from "path";
import { saveTenantUpload } from "../lib/uploadHelper.js";
import { db } from "@workspace/db";
import {
  tournamentsTable,
  categoriesTable,
  groupsTable,
  pairsTable,
  matchesTable,
  courtsTable,
  sponsorsTable,
  galleryPhotosTable,
  tournamentRegistrationsTable,
  tournamentRegistrationPlayersTable,
  couponsTable,
} from "@workspace/db/schema";
import { eq, and, asc, ne, desc, or, lt, isNull, inArray } from "drizzle-orm";
import { adminAuth } from "../middlewares/adminAuth.js";
import { sendTournamentRegistrationEmail } from "../lib/email.js";
import { MercadoPagoConfig, Payment } from "mercadopago";
import { getBaseUrl } from "../lib/baseUrl.js";
import { getSettingOrEnv, getSetting } from "./settings.js";
import { generatePicPayPix, verifyPicPayPayment, verifyPicPayWebhookToken } from "../lib/picpay.js";

const router: IRouter = Router();

async function createConfirmedPairFromRegistration(registrationId: number, tournamentId: number, tenantId: number, categoryName?: string | null): Promise<void> {
  const players = await db
    .select()
    .from(tournamentRegistrationPlayersTable)
    .where(eq(tournamentRegistrationPlayersTable.registrationId, registrationId))
    .orderBy(asc(tournamentRegistrationPlayersTable.isMainContact));

  if (players.length < 2) return;

  const p1 = players[0];
  const p2 = players[1];

  const categoryWhere = categoryName
    ? and(eq(categoriesTable.tournamentId, tournamentId), eq(categoriesTable.name, categoryName))
    : and(eq(categoriesTable.tournamentId, tournamentId), isNull(categoriesTable.name));
  const [category] = await db.select({ id: categoriesTable.id }).from(categoriesTable).where(categoryWhere).limit(1);

  if (!category) return;

  const [existingPair] = await db
    .select({ id: pairsTable.id })
    .from(pairsTable)
    .where(
      and(
        eq(pairsTable.tenantId, tenantId),
        eq(pairsTable.categoryId, category.id),
        eq(pairsTable.player1Name, p1.fullName),
        eq(pairsTable.player2Name, p2.fullName),
      ),
    )
    .limit(1);
  if (existingPair) return;

  await db.insert(pairsTable).values({
    tenantId,
    categoryId: category.id,
    player1Name: p1.fullName,
    player1School: p1.school ?? null,
    player2Name: p2.fullName,
    player2School: p2.school ?? null,
  });
}

const playerPhotoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [".jpg", ".jpeg", ".png", ".webp"];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error("Formato não suportado. Use JPG, PNG ou WebP."));
    }
  },
});

// POST /tournaments/player-upload - public, upload a player action photo
router.post("/player-upload", playerPhotoUpload.single("photo"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "Nenhum arquivo enviado" });
    return;
  }
  try {
    const { objectPath } = await saveTenantUpload(req.tenantId ?? 1, "tournaments", req.file.buffer, req.file.originalname, req.file.mimetype);
    const publicUrl = `/api/uploads${objectPath}`;
    res.json({ success: true, url: publicUrl });
  } catch (err) {
    console.error("Player photo upload failed:", err);
    res.status(500).json({ error: "Falha ao salvar foto. Tente novamente." });
  }
});

function formatTournament(t: typeof tournamentsTable.$inferSelect) {
  return {
    ...t,
    createdAt: t.createdAt.toISOString(),
  };
}

function formatCategory(c: typeof categoriesTable.$inferSelect) {
  return {
    ...c,
    createdAt: c.createdAt.toISOString(),
  };
}

function formatPair(p: typeof pairsTable.$inferSelect, groupName?: string | null) {
  return {
    ...p,
    createdAt: p.createdAt.toISOString(),
    groupName: groupName ?? null,
  };
}

function formatMatch(
  m: typeof matchesTable.$inferSelect,
  pair1Name?: string | null,
  pair2Name?: string | null,
  groupName?: string | null,
  pair1PhotoUrl?: string | null,
  pair2PhotoUrl?: string | null,
  pair1Player1PhotoUrl?: string | null,
  pair1Player2PhotoUrl?: string | null,
  pair2Player1PhotoUrl?: string | null,
  pair2Player2PhotoUrl?: string | null
) {
  return {
    id: m.id,
    categoryId: m.categoryId,
    groupId: m.groupId ?? null,
    groupName: groupName ?? null,
    phase: m.phase,
    pair1Id: m.pair1Id ?? null,
    pair2Id: m.pair2Id ?? null,
    pair1Name: pair1Name ?? null,
    pair2Name: pair2Name ?? null,
    pair1PhotoUrl: pair1PhotoUrl ?? null,
    pair2PhotoUrl: pair2PhotoUrl ?? null,
    pair1Player1PhotoUrl: pair1Player1PhotoUrl ?? null,
    pair1Player2PhotoUrl: pair1Player2PhotoUrl ?? null,
    pair2Player1PhotoUrl: pair2Player1PhotoUrl ?? null,
    pair2Player2PhotoUrl: pair2Player2PhotoUrl ?? null,
    pair1Sets: m.pair1Sets ?? null,
    pair2Sets: m.pair2Sets ?? null,
    pair1Games: m.pair1Games ?? null,
    pair2Games: m.pair2Games ?? null,
    winnerId: m.winnerId ?? null,
    notes: m.notes ?? null,
    court: m.court ?? null,
    matchOrder: m.matchOrder,
    completed: m.completed === 1,
    status: (m as any).status ?? "pending",
  };
}

// ── TOURNAMENTS ────────────────────────────────────────────────

// GET /tournaments
router.get("/", async (req, res) => {
  const tenantId = req.tenantId!;
  const tournaments = await db
    .select()
    .from(tournamentsTable)
    .where(eq(tournamentsTable.tenantId, tenantId))
    .orderBy(asc(tournamentsTable.startDate));

  res.json(tournaments.map(formatTournament));
});

// POST /tournaments
router.post("/", adminAuth, async (req, res) => {
  const { name, description, startDate, endDate, location, status, bannerUrl } = req.body;

  if (!name || !startDate) {
    res.status(400).json({ error: "name and startDate are required" });
    return;
  }

  const [t] = await db
    .insert(tournamentsTable)
    .values({ tenantId: req.tenantId!, name, description, startDate, endDate, location, status: status ?? "upcoming", bannerUrl })
    .returning();

  res.status(201).json(formatTournament(t));
});

// ── RANKING ────────────────────────────────────────────────────

// Points awarded per phase
const PHASE_POINTS: Record<string, number> = {
  group_stage: 10,
  eighthfinals: 25,
  quarterfinals: 35,
  semifinals: 50,
  third_place: 70,
  final: 80,
  champion: 100,
};

function normalizePairName(p1: string, p2: string): string {
  return `${p1.trim().toUpperCase()} E ${p2.trim().toUpperCase()}`;
}

// GET /tournaments/ranking - auto-computed ranking from match results
router.get("/ranking", async (req, res) => {
  try {
    const tenantId = req.tenantId!;
    const phaseOrder = ["group_stage", "eighthfinals", "quarterfinals", "semifinals", "third_place", "final", "champion"];

    const tournaments = await db.select().from(tournamentsTable).where(eq(tournamentsTable.tenantId, tenantId)).orderBy(asc(tournamentsTable.startDate));
    const allCategories = await db.select().from(categoriesTable).where(eq(categoriesTable.tenantId, tenantId));
    const allPairs = await db.select().from(pairsTable).where(eq(pairsTable.tenantId, tenantId));
    const allMatches = await db.select().from(matchesTable).where(and(eq(matchesTable.tenantId, tenantId), eq(matchesTable.completed, 1)));

    // categoryName → pairName → { total, byTournament }
    const byCategoryPair: Record<string, Record<string, { total: number; byTournament: Record<number, number> }>> = {};

    for (const tournament of tournaments) {
      const categories = allCategories.filter((c) => c.tournamentId === tournament.id);

      for (const cat of categories) {
        const pairs = allPairs.filter((p) => p.categoryId === cat.id);
        const matches = allMatches.filter((m) => m.categoryId === cat.id);
        if (pairs.length === 0 || matches.length === 0) continue;

        const pairMap = new Map(pairs.map((p) => [p.id, p]));
        const pairHighestPhase = new Map<number, string>();

        const getPhaseIdx = (ph: string) => phaseOrder.indexOf(ph);
        const raisePhase = (pairId: number, phase: string) => {
          const current = pairHighestPhase.get(pairId) ?? "group_stage";
          if (getPhaseIdx(phase) > getPhaseIdx(current)) {
            pairHighestPhase.set(pairId, phase);
          }
        };

        for (const m of matches) {
          const { pair1Id, pair2Id, phase, winnerId } = m;
          if (!pair1Id || !pair2Id) continue;

          if (phase === "group_stage") {
            raisePhase(pair1Id, "group_stage");
            raisePhase(pair2Id, "group_stage");
          } else if (phase === "final") {
            // Winner = champion, loser = runner-up (final = 80 pts)
            if (winnerId) {
              raisePhase(winnerId, "champion");
              const loserId = winnerId === pair1Id ? pair2Id : pair1Id;
              raisePhase(loserId, "final");
            } else {
              raisePhase(pair1Id, "final");
              raisePhase(pair2Id, "final");
            }
          } else if (phase === "third_place") {
            // Winner = 3rd place (70 pts), loser stays at semifinals (50 pts)
            if (winnerId) {
              raisePhase(winnerId, "third_place");
              const loserId = winnerId === pair1Id ? pair2Id : pair1Id;
              raisePhase(loserId, "semifinals");
            } else {
              raisePhase(pair1Id, "semifinals");
              raisePhase(pair2Id, "semifinals");
            }
          } else {
            // eighthfinals, quarterfinals, semifinals: both teams reached that phase
            raisePhase(pair1Id, phase);
            raisePhase(pair2Id, phase);
          }
        }

        // Any pair that appears in matches but not yet tracked → group_stage
        for (const m of matches) {
          if (m.pair1Id && !pairHighestPhase.has(m.pair1Id)) pairHighestPhase.set(m.pair1Id, "group_stage");
          if (m.pair2Id && !pairHighestPhase.has(m.pair2Id)) pairHighestPhase.set(m.pair2Id, "group_stage");
        }

        for (const [pairId, highestPhase] of pairHighestPhase.entries()) {
          const pair = pairMap.get(pairId);
          if (!pair) continue;

          const pairName = normalizePairName(pair.player1Name, pair.player2Name);
          const pts = PHASE_POINTS[highestPhase] ?? 10;
          const catName = cat.name;

          if (!byCategoryPair[catName]) byCategoryPair[catName] = {};
          if (!byCategoryPair[catName][pairName]) byCategoryPair[catName][pairName] = { total: 0, byTournament: {} };
          byCategoryPair[catName][pairName].total += pts;
          byCategoryPair[catName][pairName].byTournament[tournament.id] = pts;
        }
      }
    }

    const result: Array<{
      categoryName: string;
      tournaments: Array<{ id: number; name: string; startDate: string }>;
      rows: Array<{ rank: number; pairName: string; phase?: string; total: number; byTournament: Record<number, number> }>;
    }> = [];

    for (const [categoryName, pairs] of Object.entries(byCategoryPair)) {
      const tournamentIdsInCategory = new Set<number>();
      for (const pData of Object.values(pairs)) {
        for (const tid of Object.keys(pData.byTournament)) {
          tournamentIdsInCategory.add(Number(tid));
        }
      }

      const categoryTournaments = tournaments
        .filter((t) => tournamentIdsInCategory.has(t.id))
        .map((t) => ({ id: t.id, name: t.name, startDate: t.startDate }));

      const rows = Object.entries(pairs)
        .sort(([, a], [, b]) => b.total - a.total)
        .map(([pairName, data], idx) => ({
          rank: idx + 1,
          pairName,
          total: data.total,
          byTournament: data.byTournament,
        }));

      result.push({ categoryName, tournaments: categoryTournaments, rows });
    }

    result.sort((a, b) => a.categoryName.localeCompare(b.categoryName));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Erro ao buscar ranking" });
  }
});

// GET /tournaments/:id
router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const tenantId = req.tenantId!;
  const [t] = await db.select().from(tournamentsTable).where(and(eq(tournamentsTable.id, id), eq(tournamentsTable.tenantId, tenantId)));

  if (!t) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const categories = await db.select().from(categoriesTable).where(and(eq(categoriesTable.tournamentId, id), eq(categoriesTable.tenantId, tenantId)));
  const categoryIds = categories.map(c => c.id);
  const groups = categoryIds.length > 0 ? await db.select().from(groupsTable).where(and(inArray(groupsTable.categoryId, categoryIds), eq(groupsTable.tenantId, tenantId))) : [];
  const sponsors = await db.select().from(sponsorsTable).where(and(eq(sponsorsTable.tournamentId, id), eq(sponsorsTable.tenantId, tenantId)));

  const groupMap = new Map(groups.map((g) => [g.id, g.name]));

  // Build player-name → photoUrl map from confirmed registrations (for champion screen)
  const confirmedRegs = await db
    .select({ id: tournamentRegistrationsTable.id })
    .from(tournamentRegistrationsTable)
    .where(and(eq(tournamentRegistrationsTable.tournamentId, id), eq(tournamentRegistrationsTable.status, "confirmed")));
  const confirmedRegIds = confirmedRegs.map((r) => r.id);
  const regPlayerRows = confirmedRegIds.length > 0
    ? await db.select({ fullName: tournamentRegistrationPlayersTable.fullName, photoUrl: tournamentRegistrationPlayersTable.photoUrl })
        .from(tournamentRegistrationPlayersTable)
        .where(inArray(tournamentRegistrationPlayersTable.registrationId, confirmedRegIds))
    : [];
  const playerPhotoMap = new Map<string, string | null>();
  for (const rp of regPlayerRows) {
    if (rp.photoUrl && !playerPhotoMap.has(rp.fullName)) playerPhotoMap.set(rp.fullName, rp.photoUrl);
  }

  const categoriesWithData = await Promise.all(
    categories.map(async (cat) => {
      const catPairs = await db.select().from(pairsTable).where(eq(pairsTable.categoryId, cat.id));
      const catMatches = await db.select().from(matchesTable).where(eq(matchesTable.categoryId, cat.id));

      return {
        ...formatCategory(cat),
        pairs: catPairs.map((p) => formatPair(p, p.groupId ? groupMap.get(p.groupId) : null)),
        matches: catMatches.map((m) => {
          const p1 = catPairs.find((p) => p.id === m.pair1Id);
          const p2 = catPairs.find((p) => p.id === m.pair2Id);
          const grpName = m.groupId ? (groupMap.get(m.groupId) ?? null) : null;
          return formatMatch(
            m,
            p1 ? `${p1.player1Name} / ${p1.player2Name}` : null,
            p2 ? `${p2.player1Name} / ${p2.player2Name}` : null,
            grpName,
            p1?.photoUrl ?? null,
            p2?.photoUrl ?? null,
            p1 ? (playerPhotoMap.get(p1.player1Name) ?? null) : null,
            p1 ? (playerPhotoMap.get(p1.player2Name) ?? null) : null,
            p2 ? (playerPhotoMap.get(p2.player1Name) ?? null) : null,
            p2 ? (playerPhotoMap.get(p2.player2Name) ?? null) : null,
          );
        }),
      };
    })
  );

  res.json({
    ...formatTournament(t),
    categories: categoriesWithData,
    sponsors: sponsors.map((s) => ({ ...s, createdAt: s.createdAt.toISOString() })),
  });
});

// DELETE /tournaments/:id
router.delete("/:id", adminAuth, async (req, res) => {
  const id = Number(req.params.id);
  const tenantId = req.tenantId!;

  const [deleted] = await db
    .delete(tournamentsTable)
    .where(and(eq(tournamentsTable.id, id), eq(tournamentsTable.tenantId, tenantId)))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Tournament not found" });
    return;
  }

  res.json({ success: true, message: "Tournament deleted" });
});

// PUT /tournaments/:id
router.put("/:id", adminAuth, async (req, res) => {
  const id = Number(req.params.id);
  const tenantId = req.tenantId!;
  const { name, description, startDate, endDate, location, status, bannerUrl, photoUrl, registrationPrice, registrationInfo, registrationType } = req.body;

  const [t] = await db
    .update(tournamentsTable)
    .set({ name, description, startDate, endDate, location, status, bannerUrl, photoUrl, registrationPrice: registrationPrice ?? null, registrationInfo: registrationInfo ?? null, registrationType: registrationType ?? "dupla" })
    .where(and(eq(tournamentsTable.id, id), eq(tournamentsTable.tenantId, tenantId)))
    .returning();

  if (!t) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  res.json(formatTournament(t));
});

// ── CATEGORIES ─────────────────────────────────────────────────

// GET /tournaments/:id/categories
router.get("/:id/categories", async (req, res) => {
  const tournamentId = Number(req.params.id);
  const tenantId = req.tenantId!;
  const cats = await db.select().from(categoriesTable).where(and(eq(categoriesTable.tournamentId, tournamentId), eq(categoriesTable.tenantId, tenantId)));
  res.json(cats.map(formatCategory));
});

// POST /tournaments/:id/categories
router.post("/:id/categories", adminAuth, async (req, res) => {
  const tournamentId = Number(req.params.id);
  const { name, description, displayOrder, registrationPrice } = req.body;

  const [cat] = await db
    .insert(categoriesTable)
    .values({ tournamentId, name, description, displayOrder: displayOrder !== undefined ? Number(displayOrder) : 0, registrationPrice: registrationPrice || null, tenantId: req.tenantId! })
    .returning();

  res.status(201).json(formatCategory(cat));
});

// PATCH /tournaments/:id/categories/:categoryId - update name/displayOrder/registrationPrice (admin only)
router.patch("/:id/categories/:categoryId", adminAuth, async (req, res) => {
  const categoryId = Number(req.params.categoryId);
  const { name, displayOrder, registrationPrice } = req.body as { name?: string; displayOrder?: number; registrationPrice?: string | null };

  const updates: Partial<{ name: string; displayOrder: number; registrationPrice: string | null }> = {};
  if (name !== undefined && name.trim()) updates.name = name.trim();
  if (displayOrder !== undefined) updates.displayOrder = Number(displayOrder);
  if (registrationPrice !== undefined) updates.registrationPrice = registrationPrice || null;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  const [updated] = await db
    .update(categoriesTable)
    .set(updates)
    .where(eq(categoriesTable.id, categoryId))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Category not found" });
    return;
  }

  res.json(formatCategory(updated));
});

// DELETE /tournaments/:id/categories/:categoryId
router.delete("/:id/categories/:categoryId", adminAuth, async (req, res) => {
  const categoryId = Number(req.params.categoryId);
  await db.delete(categoriesTable).where(eq(categoriesTable.id, categoryId));
  res.json({ success: true, message: "Category deleted" });
});

// ── PAIRS ──────────────────────────────────────────────────────

// GET /tournaments/:id/categories/:categoryId/pairs
router.get("/:id/categories/:categoryId/pairs", async (req, res) => {
  const categoryId = Number(req.params.categoryId);
  const tenantId = req.tenantId!;
  const pairs = await db.select().from(pairsTable).where(and(eq(pairsTable.categoryId, categoryId), eq(pairsTable.tenantId, tenantId)));
  const groups = await db.select().from(groupsTable).where(and(eq(groupsTable.categoryId, categoryId), eq(groupsTable.tenantId, tenantId)));
  const groupMap = new Map(groups.map((g) => [g.id, g.name]));
  res.json(pairs.map((p) => formatPair(p, p.groupId ? groupMap.get(p.groupId) : null)));
});

// POST /tournaments/:id/categories/:categoryId/pairs
router.post("/:id/categories/:categoryId/pairs", adminAuth, async (req, res) => {
  const categoryId = Number(req.params.categoryId);
  const { player1Name, player1School, player2Name, player2School, photoUrl } = req.body;

  const [pair] = await db
    .insert(pairsTable)
    .values({ categoryId, player1Name, player1School: player1School || null, player2Name, player2School: player2School || null, photoUrl, tenantId: req.tenantId! })
    .returning();

  res.status(201).json(formatPair(pair));
});

// PATCH /tournaments/:id/categories/:categoryId/pairs/:pairId
router.patch("/:id/categories/:categoryId/pairs/:pairId", adminAuth, async (req, res) => {
  const pairId = Number(req.params.pairId);
  const categoryId = Number(req.params.categoryId);
  const { player1Name, player1School, player2Name, player2School, seed, groupId, groupName } = req.body as { player1Name?: string; player1School?: string | null; player2Name?: string; player2School?: string | null; seed?: number | null; groupId?: number | null; groupName?: string | null };

  const updates: Partial<typeof pairsTable.$inferInsert> = {};
  if (player1Name !== undefined) updates.player1Name = player1Name.trim();
  if (player1School !== undefined) updates.player1School = player1School?.trim() || null;
  if (player2Name !== undefined) updates.player2Name = player2Name.trim();
  if (player2School !== undefined) updates.player2School = player2School?.trim() || null;
  if (seed !== undefined) updates.seed = seed;
  
  // Resolve groupName to groupId if groupName is provided
  let resolvedGroupId = groupId;
  if (groupName !== undefined) {
    if (groupName === null) {
      resolvedGroupId = null;
    } else {
      const [existing] = await db
        .select()
        .from(groupsTable)
        .where(and(eq(groupsTable.categoryId, categoryId), eq(groupsTable.name, groupName)));
      if (existing) {
        resolvedGroupId = existing.id;
      } else {
        const [created] = await db
          .insert(groupsTable)
          .values({ categoryId, name: groupName, tenantId: req.tenantId! })
          .returning();
        resolvedGroupId = created.id;
      }
    }
  }
  
  if (resolvedGroupId !== undefined) updates.groupId = resolvedGroupId;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  const [pair] = await db.update(pairsTable).set(updates).where(eq(pairsTable.id, pairId)).returning();
  if (!pair) { res.status(404).json({ error: "Pair not found" }); return; }

  const groups = await db.select().from(groupsTable).where(eq(groupsTable.categoryId, categoryId));
  const groupMap = new Map(groups.map((g) => [g.id, g.name]));
  res.json(formatPair(pair, pair.groupId ? groupMap.get(pair.groupId) : null));
});

// DELETE /tournaments/:id/categories/:categoryId/pairs/:pairId
router.delete("/:id/categories/:categoryId/pairs/:pairId", adminAuth, async (req, res) => {
  const pairId = Number(req.params.pairId);
  await db.delete(pairsTable).where(eq(pairsTable.id, pairId));
  res.json({ success: true, message: "Pair removed" });
});

// PUT /pairs/:pairId/photo
router.put("/:id/categories/:categoryId/pairs/:pairId/photo", adminAuth, async (req, res) => {
  const pairId = Number(req.params.pairId);
  const { photoUrl } = req.body;

  const [pair] = await db
    .update(pairsTable)
    .set({ photoUrl })
    .where(eq(pairsTable.id, pairId))
    .returning();

  res.json(formatPair(pair));
});

// ── GENERATE GROUPS ─────────────────────────────────────────────

// Round-based scheduler: distributes matches across numCourts per round.
// Guarantees: (1) a pair doesn't play twice in the same round (same time);
//             (2) a pair gets at least one full round of rest before playing again.
function scheduleMatchesWithCourts(
  allMatches: { pair1Id: number; pair2Id: number; groupId: number | null }[],
  numCourts: number
): { pair1Id: number; pair2Id: number; groupId: number | null }[] {
  const remaining = [...allMatches];
  const rounds: (typeof allMatches)[] = [];

  while (remaining.length > 0) {
    const prevRound = rounds.length > 0 ? rounds[rounds.length - 1] : [];
    const busyFromPrev = new Set<number>(prevRound.flatMap((m) => [m.pair1Id, m.pair2Id]));

    const currentRoundPairs = new Set<number>();
    const roundMatches: typeof allMatches = [];
    const usedIndices: number[] = [];

    for (let i = 0; i < remaining.length && roundMatches.length < numCourts; i++) {
      const m = remaining[i];
      if (
        !busyFromPrev.has(m.pair1Id) && !busyFromPrev.has(m.pair2Id) &&
        !currentRoundPairs.has(m.pair1Id) && !currentRoundPairs.has(m.pair2Id)
      ) {
        roundMatches.push(m);
        currentRoundPairs.add(m.pair1Id);
        currentRoundPairs.add(m.pair2Id);
        usedIndices.push(i);
      }
    }

    // Fallback: relax the prev-round constraint if nothing fits
    if (roundMatches.length === 0) {
      const fallbackPairs = new Set<number>();
      for (let i = 0; i < remaining.length && roundMatches.length < numCourts; i++) {
        const m = remaining[i];
        if (!fallbackPairs.has(m.pair1Id) && !fallbackPairs.has(m.pair2Id)) {
          roundMatches.push(m);
          fallbackPairs.add(m.pair1Id);
          fallbackPairs.add(m.pair2Id);
          usedIndices.push(i);
        }
      }
      if (roundMatches.length === 0) {
        roundMatches.push(remaining[0]);
        usedIndices.push(0);
      }
    }

    // Remove used matches (reverse order to keep indices stable)
    for (const idx of [...usedIndices].sort((a, b) => b - a)) remaining.splice(idx, 1);
    rounds.push(roundMatches);
  }

  return rounds.flat();
}

// Legacy single-slot wrapper kept for compatibility
function scheduleMatchesNoBackToBack(
  allMatches: { pair1Id: number; pair2Id: number; groupId: number | null }[]
): { pair1Id: number; pair2Id: number; groupId: number | null }[] {
  return scheduleMatchesWithCourts(allMatches, 1);
}

// POST /tournaments/:id/categories/:categoryId/generate-groups
router.post("/:id/categories/:categoryId/generate-groups", adminAuth, async (req, res) => {
  const categoryId = Number(req.params.categoryId);

  const pairs = await db.select().from(pairsTable).where(eq(pairsTable.categoryId, categoryId));

  if (pairs.length < 2) {
    res.status(400).json({ error: "Need at least 2 pairs to generate groups" });
    return;
  }

  // Null out pairs.groupId first to satisfy FK constraint before deleting groups
  await db.update(pairsTable).set({ groupId: null }).where(eq(pairsTable.categoryId, categoryId));
  // Delete existing matches and groups
  await db.delete(matchesTable).where(eq(matchesTable.categoryId, categoryId));
  await db.delete(groupsTable).where(eq(groupsTable.categoryId, categoryId));

  // Shuffle pairs randomly
  const shuffled = [...pairs].sort(() => Math.random() - 0.5);

  // Distribute into sequential blocks of 4 (last group may have 3 or fewer)
  const groupSlots: (typeof pairsTable.$inferSelect)[][] = [];
  let cursor = 0;
  while (cursor < shuffled.length) {
    const remaining = shuffled.length - cursor;
    // If what's left after a full block of 4 would be < 2, absorb into this block
    const blockSize = remaining - 4 < 2 && remaining - 4 > 0 ? remaining : Math.min(4, remaining);
    groupSlots.push(shuffled.slice(cursor, cursor + blockSize));
    cursor += blockSize;
  }

  const createdGroups: { id: number; name: string; pairs: (typeof pairsTable.$inferSelect)[] }[] = [];

  for (let i = 0; i < groupSlots.length; i++) {
    const [grp] = await db
      .insert(groupsTable)
      .values({ categoryId, name: `Grupo ${i + 1}`, tenantId: req.tenantId! })
      .returning();

    createdGroups.push({ id: grp.id, name: grp.name, pairs: [] });

    for (const pair of groupSlots[i]) {
      await db.update(pairsTable).set({ groupId: grp.id }).where(eq(pairsTable.id, pair.id));
      createdGroups[i].pairs.push({ ...pair, groupId: grp.id });
    }
  }

  // Generate all round-robin matches per group
  const rawMatches: { pair1Id: number; pair2Id: number; groupId: number | null }[] = [];

  for (const group of createdGroups) {
    const gp = group.pairs;
    for (let i = 0; i < gp.length; i++) {
      for (let j = i + 1; j < gp.length; j++) {
        rawMatches.push({ pair1Id: gp[i].id, pair2Id: gp[j].id, groupId: group.id });
      }
    }
  }

  // Interleave matches across groups to avoid same pair playing back-to-back
  const orderedMatches = scheduleMatchesNoBackToBack(rawMatches);

  let matchOrder = 0;
  for (const m of orderedMatches) {
    await db.insert(matchesTable).values({
      categoryId,
      groupId: m.groupId,
      phase: "group_stage",
      pair1Id: m.pair1Id,
      pair2Id: m.pair2Id,
      matchOrder: matchOrder++,
      completed: 0,
      tenantId: req.tenantId!,
    });
  }

  // Update category phase
  await db.update(categoriesTable).set({ phase: "group_stage" }).where(eq(categoriesTable.id, categoryId));

  const responseGroups = createdGroups.map((g) => ({
    id: g.id,
    categoryId,
    name: g.name,
    pairs: g.pairs.map((p) => formatPair(p, g.name)),
  }));

  res.json({ groups: responseGroups, matchesCreated: orderedMatches.length });
});

// POST /tournaments/:id/categories/:categoryId/generate-groups-auto
router.post("/:id/categories/:categoryId/generate-groups-auto", adminAuth, async (req, res) => {
  const categoryId = Number(req.params.categoryId);
  const { groupMode, groups4, groups3 } = req.body as { groupMode?: "numeric" | "alphabetic"; groups4?: number; groups3?: number };

  const pairs = await db.select().from(pairsTable).where(eq(pairsTable.categoryId, categoryId));
  if (pairs.length < 2) {
    res.status(400).json({ error: "Need at least 2 pairs to generate groups" });
    return;
  }

  const count4 = Math.max(0, Number(groups4 ?? 0));
  const count3 = Math.max(0, Number(groups3 ?? 0));
  const totalSlots = count4 * 4 + count3 * 3;
  if (count4 + count3 <= 0) {
    res.status(400).json({ error: "Informe quantos grupos de 4 e de 3 serão gerados" });
    return;
  }
  if (totalSlots !== pairs.length) {
    res.status(400).json({ error: `A soma dos grupos precisa ser exatamente ${pairs.length} duplas` });
    return;
  }

  const names = groupMode === "alphabetic"
    ? Array.from({ length: 26 }, (_, i) => `Grupo ${String.fromCharCode(65 + i)}`)
    : Array.from({ length: 50 }, (_, i) => `Grupo ${i + 1}`);

  await db.update(pairsTable).set({ groupId: null }).where(eq(pairsTable.categoryId, categoryId));
  await db.delete(matchesTable).where(and(eq(matchesTable.categoryId, categoryId), eq(matchesTable.phase, "group_stage")));
  await db.delete(groupsTable).where(eq(groupsTable.categoryId, categoryId));

  const shuffled = [...pairs].sort(() => Math.random() - 0.5);
  const groupSlots: (typeof pairsTable.$inferSelect)[][] = [];
  let cursor = 0;
  for (let i = 0; i < count4; i++) {
    groupSlots.push(shuffled.slice(cursor, cursor + 4));
    cursor += 4;
  }
  for (let i = 0; i < count3; i++) {
    groupSlots.push(shuffled.slice(cursor, cursor + 3));
    cursor += 3;
  }

  const createdGroups: { id: number; name: string; pairs: (typeof pairsTable.$inferSelect)[] }[] = [];
  for (let i = 0; i < groupSlots.length; i++) {
    const [grp] = await db.insert(groupsTable).values({ categoryId, name: names[i] ?? `Grupo ${i + 1}`, tenantId: req.tenantId! }).returning();
    createdGroups.push({ id: grp.id, name: grp.name, pairs: [] });
    for (const pair of groupSlots[i]) {
      await db.update(pairsTable).set({ groupId: grp.id }).where(eq(pairsTable.id, pair.id));
      createdGroups[i].pairs.push({ ...pair, groupId: grp.id });
    }
  }

  const rawMatches: { pair1Id: number; pair2Id: number; groupId: number | null }[] = [];
  for (const group of createdGroups) {
    const gp = group.pairs;
    for (let i = 0; i < gp.length; i++) {
      for (let j = i + 1; j < gp.length; j++) {
        rawMatches.push({ pair1Id: gp[i].id, pair2Id: gp[j].id, groupId: group.id });
      }
    }
  }

  const courtRows = await db.select().from(courtsTable).where(and(eq(courtsTable.tenantId, req.tenantId!), eq(courtsTable.active, true))).orderBy(asc(courtsTable.number));
  const courtList = courtRows.length > 0 ? courtRows.map((court) => court.name) : ["Quadra 1"];
  const numCourts = courtList.length;

  const orderedMatches = scheduleMatchesWithCourts(rawMatches, numCourts);
  let matchOrder = 0;
  for (const m of orderedMatches) {
    const round = Math.floor(matchOrder / numCourts);
    const courtIndex = matchOrder % numCourts;
    await db.insert(matchesTable).values({
      categoryId,
      groupId: m.groupId,
      phase: "group_stage",
      pair1Id: m.pair1Id,
      pair2Id: m.pair2Id,
      court: courtList[courtIndex],
      matchOrder: round * numCourts + courtIndex,
      completed: 0,
      tenantId: req.tenantId!,
    });
    matchOrder++;
  }

  await db.update(categoriesTable).set({ phase: "group_stage" }).where(eq(categoriesTable.id, categoryId));
  res.json({ groups: createdGroups.map((g) => ({ id: g.id, name: g.name, pairs: g.pairs.map((p) => formatPair(p, g.name)) })), matchesCreated: orderedMatches.length });
});

// POST /tournaments/:id/copy-pairs-from-first
router.post("/:id/copy-pairs-from-first", adminAuth, async (req, res) => {
  const tenantId = req.tenantId!;
  const targetTournamentId = Number(req.params.id);

  const tournaments = await db.select().from(tournamentsTable).where(eq(tournamentsTable.tenantId, tenantId)).orderBy(asc(tournamentsTable.startDate));
  if (tournaments.length < 2) {
    res.status(400).json({ error: "É necessário ter pelo menos dois torneios no tenant" });
    return;
  }

  const sourceTournament = tournaments[0];
  const targetTournament = tournaments.find((t) => t.id === targetTournamentId);
  if (!targetTournament) {
    res.status(404).json({ error: "Torneio alvo não encontrado" });
    return;
  }
  if (sourceTournament.id === targetTournamentId) {
    res.status(400).json({ error: "O torneio de origem e destino precisam ser diferentes" });
    return;
  }

  const sourceCategories = await db.select().from(categoriesTable).where(eq(categoriesTable.tournamentId, sourceTournament.id));
  const targetCategories = await db.select().from(categoriesTable).where(eq(categoriesTable.tournamentId, targetTournament.id));
  const targetCategoryMap = new Map(targetCategories.map((c) => [c.name ?? "", c]));
  const sourcePairs = await db.select().from(pairsTable).where(eq(pairsTable.tenantId, tenantId));

  let copied = 0;
  for (const sourceCategory of sourceCategories) {
    if (!sourceCategory.name) continue;
    const targetCategory = targetCategoryMap.get(sourceCategory.name);
    if (!targetCategory) continue;

    const pairs = sourcePairs.filter((p) => p.categoryId === sourceCategory.id);
    await db.delete(pairsTable).where(eq(pairsTable.categoryId, targetCategory.id));

    for (const pair of pairs) {
      await db.insert(pairsTable).values({
        categoryId: targetCategory.id,
        player1Name: pair.player1Name,
        player1School: pair.player1School ?? null,
        player2Name: pair.player2Name,
        player2School: pair.player2School ?? null,
        photoUrl: pair.photoUrl ?? null,
        seed: pair.seed ?? null,
        groupId: null,
        tenantId,
      });
      copied++;
    }
  }

  res.json({ success: true, copied });
});

// ── GENERATE BRACKET ───────────────────────────────────────────

// POST /tournaments/:id/categories/:categoryId/generate-bracket
router.post("/:id/categories/:categoryId/generate-bracket", adminAuth, async (req, res) => {
  const categoryId = Number(req.params.categoryId);
  const bestThirds = Number(req.body.bestThirds ?? 0);

  // Get completed group stage matches to determine standings
  const groups = await db.select().from(groupsTable).where(eq(groupsTable.categoryId, categoryId));
  const pairs = await db.select().from(pairsTable).where(eq(pairsTable.categoryId, categoryId));
  const groupMatches = await db
    .select()
    .from(matchesTable)
    .where(and(eq(matchesTable.categoryId, categoryId), eq(matchesTable.phase, "group_stage")));

  // Calculate standings per group: wins, setsFor, setsAgainst
  const standingsMap = new Map<number, Map<number, { wins: number; setsFor: number; setsAgainst: number }>>();

  for (const g of groups) {
    standingsMap.set(g.id, new Map());
  }

  for (const pair of pairs) {
    if (!pair.groupId) continue;
    const groupStandings = standingsMap.get(pair.groupId);
    if (!groupStandings) continue;
    if (!groupStandings.has(pair.id)) {
      groupStandings.set(pair.id, { wins: 0, setsFor: 0, setsAgainst: 0 });
    }
  }

  for (const m of groupMatches) {
    if (!m.completed || !m.groupId) continue;
    const groupStandings = standingsMap.get(m.groupId);
    if (!groupStandings) continue;

    const p1Stats = groupStandings.get(m.pair1Id!) ?? { wins: 0, setsFor: 0, setsAgainst: 0 };
    const p2Stats = groupStandings.get(m.pair2Id!) ?? { wins: 0, setsFor: 0, setsAgainst: 0 };
    const p1Sets = m.pair1Sets ?? 0;
    const p2Sets = m.pair2Sets ?? 0;

    p1Stats.setsFor += p1Sets;
    p1Stats.setsAgainst += p2Sets;
    p2Stats.setsFor += p2Sets;
    p2Stats.setsAgainst += p1Sets;

    if (m.winnerId === m.pair1Id && m.pair1Id) {
      p1Stats.wins++;
    } else if (m.winnerId === m.pair2Id && m.pair2Id) {
      p2Stats.wins++;
    }

    if (m.pair1Id) groupStandings.set(m.pair1Id, p1Stats);
    if (m.pair2Id) groupStandings.set(m.pair2Id, p2Stats);
  }

  // Sort each group by wins, then set difference (setsFor - setsAgainst)
  const qualifiedPairs: (typeof pairsTable.$inferSelect)[] = [];
  const thirdPlacePairs: { pair: typeof pairsTable.$inferSelect; wins: number; setDiff: number; setsFor: number }[] = [];

  for (const group of groups) {
    const groupPairs = pairs.filter((p) => p.groupId === group.id);
    const standings = standingsMap.get(group.id) ?? new Map();

    const sorted = [...groupPairs].sort((a, b) => {
      const aStats = standings.get(a.id) ?? { wins: 0, setsFor: 0, setsAgainst: 0 };
      const bStats = standings.get(b.id) ?? { wins: 0, setsFor: 0, setsAgainst: 0 };
      const winDiff = bStats.wins - aStats.wins;
      if (winDiff !== 0) return winDiff;
      return (bStats.setsFor - bStats.setsAgainst) - (aStats.setsFor - aStats.setsAgainst);
    });

    // Top 2 from each group qualify automatically
    qualifiedPairs.push(...sorted.slice(0, Math.min(2, sorted.length)));

    // 3rd place (index 2) is a candidate for best thirds
    if (sorted.length >= 3) {
      const third = sorted[2];
      const stats = standings.get(third.id) ?? { wins: 0, setsFor: 0, setsAgainst: 0 };
      thirdPlacePairs.push({
        pair: third,
        wins: stats.wins,
        setDiff: stats.setsFor - stats.setsAgainst,
        setsFor: stats.setsFor,
      });
    }
  }

  // Sort third place pairs by wins desc, then setDiff desc, then setsFor desc
  thirdPlacePairs.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.setDiff !== a.setDiff) return b.setDiff - a.setDiff;
    return b.setsFor - a.setsFor;
  });

  // Add best thirds to qualified pairs
  const thirdsToAdd = Math.min(bestThirds, thirdPlacePairs.length);
  for (let i = 0; i < thirdsToAdd; i++) {
    qualifiedPairs.push(thirdPlacePairs[i].pair);
  }

  // Fallback: if no group stage completed, use all pairs
  const bracketPairs = qualifiedPairs.length >= 2 ? qualifiedPairs : pairs;

  // Determine bracket type
  let phase: "eighthfinals" | "quarterfinals" | "semifinals";
  if (bracketPairs.length > 8) phase = "eighthfinals";
  else if (bracketPairs.length > 4) phase = "quarterfinals";
  else phase = "semifinals";

  // Delete all existing knockout matches to ensure clean bracket state
  await db
    .delete(matchesTable)
    .where(and(eq(matchesTable.categoryId, categoryId), ne(matchesTable.phase, "group_stage")));

  // Fetch active courts for round-robin assignment
  const activeCourts = await db
    .select()
    .from(courtsTable)
    .where(and(eq(courtsTable.tenantId, req.tenantId!), eq(courtsTable.active, true)))
    .orderBy(asc(courtsTable.id));
  const courtNames = activeCourts.map((c) => c.name);

  // Generate bracket matches with round-robin court assignment
  const createdMatches = [];
  let matchOrder = 100;
  let courtIdx = 0;

  for (let i = 0; i < Math.floor(bracketPairs.length / 2); i++) {
    const assignedCourt = courtNames.length > 0 ? courtNames[courtIdx % courtNames.length] : null;
    courtIdx++;
    const [m] = await db
      .insert(matchesTable)
      .values({
        categoryId,
        phase,
        pair1Id: bracketPairs[i * 2]?.id ?? null,
        pair2Id: bracketPairs[i * 2 + 1]?.id ?? null,
        matchOrder: matchOrder++,
        completed: 0,
        court: assignedCourt,
        tenantId: req.tenantId!,
      })
      .returning();

    createdMatches.push(m);
  }

  // If odd number, add a bye for the last pair
  if (bracketPairs.length % 2 === 1) {
    await db.insert(matchesTable).values({
      categoryId,
      phase,
      pair1Id: bracketPairs[bracketPairs.length - 1]?.id ?? null,
      pair2Id: null,
      matchOrder: matchOrder++,
      completed: 0,
      court: courtNames.length > 0 ? courtNames[courtIdx % courtNames.length] : null,
      tenantId: req.tenantId!,
    });
  }

  // Update category phase
  await db.update(categoriesTable).set({ phase: "knockout" }).where(eq(categoriesTable.id, categoryId));

  const pairMap = new Map(pairs.map((p) => [p.id, p]));
  const formattedMatches = createdMatches.map((m) => {
    const p1 = m.pair1Id ? pairMap.get(m.pair1Id) : undefined;
    const p2 = m.pair2Id ? pairMap.get(m.pair2Id) : undefined;
    return formatMatch(
      m,
      p1 ? `${p1.player1Name} / ${p1.player2Name}` : null,
      p2 ? `${p2.player1Name} / ${p2.player2Name}` : null,
      null,
      p1?.photoUrl ?? null,
      p2?.photoUrl ?? null
    );
  });

  res.json({ bracketType: phase, matchesCreated: createdMatches.length, matches: formattedMatches });
});

// ── MATCHES ─────────────────────────────────────────────────────

// GET /tournaments/:id/categories/:categoryId/matches
router.get("/:id/categories/:categoryId/matches", async (req, res) => {
  const tournamentId = Number(req.params.id);
  const categoryId = Number(req.params.categoryId);
  const tenantId = req.tenantId!;
  const matches = await db
    .select()
    .from(matchesTable)
    .where(and(eq(matchesTable.categoryId, categoryId), eq(matchesTable.tenantId, tenantId)))
    .orderBy(asc(matchesTable.matchOrder));

  const pairs = await db.select().from(pairsTable).where(and(eq(pairsTable.categoryId, categoryId), eq(pairsTable.tenantId, tenantId)));
  const pairMap = new Map(pairs.map((p) => [p.id, p]));

  const groups = await db.select().from(groupsTable).where(and(eq(groupsTable.categoryId, categoryId), eq(groupsTable.tenantId, tenantId)));
  const groupMap = new Map(groups.map((g) => [g.id, g.name]));

  // Build player-name → photoUrl map from confirmed registrations
  const confirmedRegs = await db
    .select({ id: tournamentRegistrationsTable.id })
    .from(tournamentRegistrationsTable)
    .where(and(eq(tournamentRegistrationsTable.tournamentId, tournamentId), eq(tournamentRegistrationsTable.status, "confirmed")));
  const confirmedRegIds = confirmedRegs.map((r) => r.id);
  const regPlayerRows = confirmedRegIds.length > 0
    ? await db.select({ fullName: tournamentRegistrationPlayersTable.fullName, photoUrl: tournamentRegistrationPlayersTable.photoUrl })
        .from(tournamentRegistrationPlayersTable)
        .where(inArray(tournamentRegistrationPlayersTable.registrationId, confirmedRegIds))
    : [];
  const playerPhotoMap = new Map<string, string | null>();
  for (const rp of regPlayerRows) {
    if (rp.photoUrl && !playerPhotoMap.has(rp.fullName)) playerPhotoMap.set(rp.fullName, rp.photoUrl);
  }

  res.json(
    matches.map((m) => {
      const p1 = m.pair1Id ? pairMap.get(m.pair1Id) : undefined;
      const p2 = m.pair2Id ? pairMap.get(m.pair2Id) : undefined;
      const grpName = m.groupId ? (groupMap.get(m.groupId) ?? null) : null;
      return formatMatch(
        m,
        p1 ? `${p1.player1Name} / ${p1.player2Name}` : null,
        p2 ? `${p2.player1Name} / ${p2.player2Name}` : null,
        grpName,
        p1?.photoUrl ?? null,
        p2?.photoUrl ?? null,
        p1 ? (playerPhotoMap.get(p1.player1Name) ?? null) : null,
        p1 ? (playerPhotoMap.get(p1.player2Name) ?? null) : null,
        p2 ? (playerPhotoMap.get(p2.player1Name) ?? null) : null,
        p2 ? (playerPhotoMap.get(p2.player2Name) ?? null) : null,
      );
    })
  );
});

// POST /tournaments/:id/categories/:categoryId/matches - Create match
router.post("/:id/categories/:categoryId/matches", adminAuth, async (req, res) => {
  const categoryId = Number(req.params.categoryId);
  const { pair1Id, pair2Id, phase, groupName, matchOrder, pair1Sets, pair2Sets, court } = req.body;

  if (!pair1Id || !pair2Id) {
    res.status(400).json({ error: "pair1Id and pair2Id required" });
    return;
  }

  // Resolve groupId from groupName when in group_stage
  let resolvedGroupId: number | null = null;
  if (phase === "group_stage" && groupName) {
    const [existing] = await db
      .select()
      .from(groupsTable)
      .where(and(eq(groupsTable.categoryId, categoryId), eq(groupsTable.name, groupName)));
    if (existing) {
      resolvedGroupId = existing.id;
    } else {
      const [created] = await db
        .insert(groupsTable)
        .values({ categoryId, name: groupName, tenantId: req.tenantId! })
        .returning();
      resolvedGroupId = created.id;
    }
  }

  const [match] = await db
    .insert(matchesTable)
    .values({
      categoryId,
      pair1Id: Number(pair1Id),
      pair2Id: Number(pair2Id),
      phase: phase || "group_stage",
      groupId: resolvedGroupId,
      matchOrder: Number(matchOrder || 0),
      pair1Sets: pair1Sets ? Number(pair1Sets) : null,
      pair2Sets: pair2Sets ? Number(pair2Sets) : null,
      court: court || null,
      winnerId: null,
      completed: 0,
      tenantId: req.tenantId!,
    })
    .returning();

  res.json(match);
});

// DELETE /tournaments/:id/categories/:categoryId/matches/:matchId - Delete match
router.delete("/:id/categories/:categoryId/matches/:matchId", adminAuth, async (req, res) => {
  const matchId = Number(req.params.matchId);
  const categoryId = Number(req.params.categoryId);

  // Get match details before deleting
  const [matchToDelete] = await db.select().from(matchesTable).where(eq(matchesTable.id, matchId));
  if (!matchToDelete) {
    res.status(404).json({ error: "Match not found" });
    return;
  }

  const pair1Id = matchToDelete.pair1Id;
  const pair2Id = matchToDelete.pair2Id;

  // Delete the match
  await db.delete(matchesTable).where(eq(matchesTable.id, matchId));

  // Check if pair1 still has group_stage matches (as pair1 or pair2)
  if (pair1Id) {
    const groupMatches = await db
      .select()
      .from(matchesTable)
      .where(and(
        eq(matchesTable.categoryId, categoryId),
        eq(matchesTable.phase, "group_stage"),
        or(eq(matchesTable.pair1Id, pair1Id), eq(matchesTable.pair2Id, pair1Id))
      ));
    
    if (groupMatches.length === 0) {
      await db
        .update(pairsTable)
        .set({ groupId: null })
        .where(eq(pairsTable.id, pair1Id));
    }
  }

  // Check if pair2 still has group_stage matches (as pair1 or pair2)
  if (pair2Id) {
    const groupMatches = await db
      .select()
      .from(matchesTable)
      .where(and(
        eq(matchesTable.categoryId, categoryId),
        eq(matchesTable.phase, "group_stage"),
        or(eq(matchesTable.pair1Id, pair2Id), eq(matchesTable.pair2Id, pair2Id))
      ));
    
    if (groupMatches.length === 0) {
      await db
        .update(pairsTable)
        .set({ groupId: null })
        .where(eq(pairsTable.id, pair2Id));
    }
  }

  res.json({ success: true });
});

// PATCH /tournaments/:id/categories/:categoryId/matches/:matchId - Edit match fields
router.patch("/:id/categories/:categoryId/matches/:matchId", adminAuth, async (req, res) => {
  const matchId = Number(req.params.matchId);
  const categoryId = Number(req.params.categoryId);
  const { pair1Id, pair2Id, groupName, court, matchOrder, status } = req.body;

  const [existing] = await db.select().from(matchesTable).where(eq(matchesTable.id, matchId));
  if (!existing) {
    res.status(404).json({ error: "Match not found" });
    return;
  }

  let resolvedGroupId = existing.groupId;
  if (groupName !== undefined) {
    if (!groupName) {
      resolvedGroupId = null;
    } else {
      const groups = await db.select().from(groupsTable).where(eq(groupsTable.categoryId, categoryId));
      const found = groups.find(g => g.name === groupName);
      resolvedGroupId = found?.id ?? null;
    }
  }

  const updateData: Record<string, unknown> = {};
  if (pair1Id !== undefined) updateData.pair1Id = Number(pair1Id);
  if (pair2Id !== undefined) updateData.pair2Id = Number(pair2Id);
  if (groupName !== undefined) updateData.groupId = resolvedGroupId;
  if (court !== undefined) updateData.court = court || null;
  if (matchOrder !== undefined) updateData.matchOrder = Number(matchOrder);
  if (status !== undefined && ["pending", "in_progress", "completed"].includes(status)) {
    updateData.status = status;
    updateData.completed = status === "completed" ? 1 : 0;
  }

  const [match] = await db.update(matchesTable).set(updateData).where(eq(matchesTable.id, matchId)).returning();

  // Auto-advance bracket when a knockout match is marked as completed and has a winner
  if (
    status === "completed" &&
    match.winnerId &&
    (match.phase === "eighthfinals" || match.phase === "quarterfinals" || match.phase === "semifinals" || match.phase === "third_place")
  ) {
    await tryAdvanceBracket(categoryId, match.phase as "eighthfinals" | "quarterfinals" | "semifinals" | "third_place", req.tenantId!);
  }

  res.json(match);
});

// PUT /tournaments/:id/categories/:categoryId/matches/:matchId/result
router.put("/:id/categories/:categoryId/matches/:matchId/result", adminAuth, async (req, res) => {
  const matchId = Number(req.params.matchId);
  const categoryId = Number(req.params.categoryId);
  const { pair1Sets, pair2Sets, pair1Games, pair2Games, notes } = req.body;

  const [existingMatch] = await db.select().from(matchesTable).where(eq(matchesTable.id, matchId));
  if (!existingMatch) {
    res.status(404).json({ error: "Match not found" });
    return;
  }

  const winnerId = pair1Sets != null && pair2Sets != null
    ? (pair1Sets > pair2Sets ? existingMatch.pair1Id : existingMatch.pair2Id)
    : existingMatch.winnerId;

  const [match] = await db
    .update(matchesTable)
    .set({
      pair1Sets,
      pair2Sets,
      pair1Games: pair1Games ?? null,
      pair2Games: pair2Games ?? null,
      winnerId,
      notes: notes ?? null,
    })
    .where(eq(matchesTable.id, matchId))
    .returning();

  // After final match, update category phase to finished
  if (match.phase === "final") {
    await db.update(categoriesTable).set({ phase: "finished" }).where(eq(categoriesTable.id, categoryId));
  }

  // Auto-advance bracket for all knockout phases
  if (match.phase === "eighthfinals" || match.phase === "quarterfinals" || match.phase === "semifinals" || match.phase === "third_place") {
    await tryAdvanceBracket(categoryId, match.phase as "eighthfinals" | "quarterfinals" | "semifinals" | "third_place", req.tenantId!);
  }

  const pairs = await db.select().from(pairsTable).where(eq(pairsTable.categoryId, categoryId));
  const pairMap = new Map(pairs.map((p) => [p.id, p]));
  const p1 = match.pair1Id ? pairMap.get(match.pair1Id) : undefined;
  const p2 = match.pair2Id ? pairMap.get(match.pair2Id) : undefined;

  const groups = await db.select().from(groupsTable).where(eq(groupsTable.categoryId, categoryId));
  const groupMap = new Map(groups.map((g) => [g.id, g.name]));
  const grpName = match.groupId ? (groupMap.get(match.groupId) ?? null) : null;

  res.json(
    formatMatch(
      match,
      p1 ? `${p1.player1Name} / ${p1.player2Name}` : null,
      p2 ? `${p2.player1Name} / ${p2.player2Name}` : null,
      grpName,
      p1?.photoUrl ?? null,
      p2?.photoUrl ?? null
    )
  );
});

async function tryAdvanceBracket(
  categoryId: number,
  currentPhase: "eighthfinals" | "quarterfinals" | "semifinals" | "third_place",
  tenantId: number
) {
  // Fetch active courts for round-robin assignment
  const activeCourts = await db
    .select()
    .from(courtsTable)
    .where(and(eq(courtsTable.tenantId, tenantId), eq(courtsTable.active, true)))
    .orderBy(asc(courtsTable.id));
  const courtNames = activeCourts.map((c) => c.name);
  let courtIdx = 0;

  // ── third_place complete → create final using semifinal winners ──
  if (currentPhase === "third_place") {
    const thirdMatches = await db
      .select()
      .from(matchesTable)
      .where(and(eq(matchesTable.categoryId, categoryId), eq(matchesTable.phase, "third_place")));

    if (!thirdMatches.every((m) => m.completed === 1)) return;

    const existingFinal = await db
      .select()
      .from(matchesTable)
      .where(and(eq(matchesTable.categoryId, categoryId), eq(matchesTable.phase, "final")));

    if (existingFinal.length > 0) return;

    // Get semifinal winners for the final
    const semiMatches = await db
      .select()
      .from(matchesTable)
      .where(and(eq(matchesTable.categoryId, categoryId), eq(matchesTable.phase, "semifinals")))
      .orderBy(asc(matchesTable.matchOrder));

    const winner1 = semiMatches[0]?.winnerId ?? null;
    const winner2 = semiMatches[1]?.winnerId ?? null;
    if (!winner1 || !winner2) return;

    const baseOrder = (thirdMatches[0]?.matchOrder ?? 900) + 100;
    const finalCourt = courtNames.length > 0 ? courtNames[0] : null;
    await db.insert(matchesTable).values({
      categoryId,
      phase: "final",
      pair1Id: winner1,
      pair2Id: winner2,
      matchOrder: baseOrder,
      completed: 0,
      court: finalCourt,
      tenantId,
    });
    return;
  }

  // ── semifinals complete → create ONLY third_place (final comes after) ──
  if (currentPhase === "semifinals") {
    const currentMatches = await db
      .select()
      .from(matchesTable)
      .where(and(eq(matchesTable.categoryId, categoryId), eq(matchesTable.phase, "semifinals")))
      .orderBy(asc(matchesTable.matchOrder));

    if (!currentMatches.every((m) => m.completed === 1)) return;
    if (currentMatches.length < 2) return;

    const existingThird = await db
      .select()
      .from(matchesTable)
      .where(and(eq(matchesTable.categoryId, categoryId), eq(matchesTable.phase, "third_place")));

    if (existingThird.length > 0) return;

    const loser1Id = currentMatches[0].winnerId === currentMatches[0].pair1Id
      ? currentMatches[0].pair2Id
      : currentMatches[0].pair1Id;
    const loser2Id = currentMatches[1].winnerId === currentMatches[1].pair1Id
      ? currentMatches[1].pair2Id
      : currentMatches[1].pair1Id;

    if (!loser1Id || !loser2Id) return;

    const baseOrder = currentMatches[0].matchOrder + 200;
    const thirdCourt = courtNames.length > 0 ? courtNames[courtIdx % courtNames.length] : null;
    await db.insert(matchesTable).values({
      categoryId,
      phase: "third_place",
      pair1Id: loser1Id,
      pair2Id: loser2Id,
      matchOrder: baseOrder,
      completed: 0,
      court: thirdCourt,
      tenantId,
    });
    return;
  }

  // ── eighthfinals / quarterfinals → next knockout round ──
  const nextPhaseMap: Record<string, "quarterfinals" | "semifinals"> = {
    eighthfinals: "quarterfinals",
    quarterfinals: "semifinals",
  };

  const nextPhase = nextPhaseMap[currentPhase];
  if (!nextPhase) return;

  const currentMatches = await db
    .select()
    .from(matchesTable)
    .where(and(eq(matchesTable.categoryId, categoryId), eq(matchesTable.phase, currentPhase)))
    .orderBy(asc(matchesTable.matchOrder));

  if (!currentMatches.every((m) => m.completed === 1)) return;

  const existingNext = await db
    .select()
    .from(matchesTable)
    .where(and(eq(matchesTable.categoryId, categoryId), eq(matchesTable.phase, nextPhase)));

  if (existingNext.length > 0) return;

  const winners = currentMatches
    .map((m) => m.winnerId)
    .filter((id): id is number => id !== null);

  let matchOrder = currentMatches[0].matchOrder + 200;

  for (let i = 0; i < Math.floor(winners.length / 2); i++) {
    const assignedCourt = courtNames.length > 0 ? courtNames[courtIdx % courtNames.length] : null;
    courtIdx++;
    await db.insert(matchesTable).values({
      categoryId,
      phase: nextPhase,
      pair1Id: winners[i * 2] ?? null,
      pair2Id: winners[i * 2 + 1] ?? null,
      matchOrder: matchOrder++,
      completed: 0,
      court: assignedCourt,
      tenantId,
    });
  }

  if (winners.length % 2 === 1) {
    await db.insert(matchesTable).values({
      categoryId,
      phase: nextPhase,
      pair1Id: winners[winners.length - 1] ?? null,
      pair2Id: null,
      matchOrder: matchOrder++,
      completed: 0,
      court: courtNames.length > 0 ? courtNames[courtIdx % courtNames.length] : null,
      tenantId,
    });
  }
}

// ── STANDINGS ──────────────────────────────────────────────────

// GET /tournaments/:id/categories/:categoryId/standings
router.get("/:id/categories/:categoryId/standings", async (req, res) => {
  const categoryId = Number(req.params.categoryId);
  const tenantId = req.tenantId!;

  const groups = await db.select().from(groupsTable).where(and(eq(groupsTable.categoryId, categoryId), eq(groupsTable.tenantId, tenantId)));
  const pairs = await db.select().from(pairsTable).where(and(eq(pairsTable.categoryId, categoryId), eq(pairsTable.tenantId, tenantId)));
  const pairMap = new Map(pairs.map((p) => [p.id, p]));

  const matches = await db
    .select()
    .from(matchesTable)
    .where(and(eq(matchesTable.categoryId, categoryId), eq(matchesTable.phase, "group_stage"), eq(matchesTable.tenantId, tenantId)));

  // Only show groups that have at least one group_stage match
  const groupsWithMatches = groups.filter((g) => matches.some((m) => m.groupId === g.id));

  const groupsResponse = groupsWithMatches.map((g) => {
    // Collect all unique pair IDs that appear in matches of this group
    const groupMatches = matches.filter((m) => m.groupId === g.id);
    const pairIdsInGroup = new Set<number>();
    for (const m of groupMatches) {
      if (m.pair1Id) pairIdsInGroup.add(m.pair1Id);
      if (m.pair2Id) pairIdsInGroup.add(m.pair2Id);
    }

    const standingsMap = new Map<number, {
      pairId: number;
      player1Name: string;
      player2Name: string;
      groupName: string;
      played: number;
      won: number;
      lost: number;
      setsWon: number;
      setsLost: number;
      points: number;
    }>();

    // Initialize entries for every pair that participates in matches of this group
    for (const pairId of pairIdsInGroup) {
      const pair = pairMap.get(pairId);
      if (!pair) continue;
      standingsMap.set(pairId, {
        pairId: pair.id,
        player1Name: pair.player1Name,
        player2Name: pair.player2Name,
        groupName: g.name,
        played: 0,
        won: 0,
        lost: 0,
        setsWon: 0,
        setsLost: 0,
        points: 0,
      });
    }

    // Only count completed matches
    const completedGroupMatches = groupMatches.filter((m) => m.completed === 1 || (m.completed as unknown) === true);

    for (const m of completedGroupMatches) {
      if (!m.pair1Id || !m.pair2Id) continue;

      const s1 = standingsMap.get(m.pair1Id);
      const s2 = standingsMap.get(m.pair2Id);

      if (s1) {
        s1.played++;
        s1.setsWon += m.pair1Sets ?? 0;
        s1.setsLost += m.pair2Sets ?? 0;
        if (m.winnerId === m.pair1Id) { s1.won++; s1.points += 2; }
        else { s1.lost++; s1.points += 1; }
      }
      if (s2) {
        s2.played++;
        s2.setsWon += m.pair2Sets ?? 0;
        s2.setsLost += m.pair1Sets ?? 0;
        if (m.winnerId === m.pair2Id) { s2.won++; s2.points += 2; }
        else { s2.lost++; s2.points += 1; }
      }
    }

    const standings = Array.from(standingsMap.values()).sort((a, b) => {
      // First priority: more wins
      if (b.won !== a.won) return b.won - a.won;
      // Second priority: better point balance (sets won - sets lost)
      return (b.setsWon - b.setsLost) - (a.setsWon - a.setsLost);
    });

    return { groupName: g.name, standings };
  });

  res.json({ categoryId, groups: groupsResponse });
});

// ── CHAMPIONS ──────────────────────────────────────────────────

// GET /tournaments/:id/champions
router.get("/:id/champions", async (req, res) => {
  const tournamentId = Number(req.params.id);
  const [tournament] = await db.select().from(tournamentsTable).where(eq(tournamentsTable.id, tournamentId));
  if (!tournament) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const categories = await db.select().from(categoriesTable).where(eq(categoriesTable.tournamentId, tournamentId)).orderBy(asc(categoriesTable.displayOrder));
  const result = [];

  for (const cat of categories) {
    const pairs = await db.select().from(pairsTable).where(eq(pairsTable.categoryId, cat.id));
    const pairMap = new Map(pairs.map((p) => [p.id, p]));

    const finalMatch = await db
      .select()
      .from(matchesTable)
      .where(and(eq(matchesTable.categoryId, cat.id), eq(matchesTable.phase, "final")));

    const thirdMatch = await db
      .select()
      .from(matchesTable)
      .where(and(eq(matchesTable.categoryId, cat.id), eq(matchesTable.phase, "third_place")));

    let champion = null;
    let runnerUp = null;
    let thirdPlace = null;

    if (finalMatch.length > 0 && finalMatch[0].winnerId) {
      const winner = pairMap.get(finalMatch[0].winnerId);
      champion = winner ? formatPair(winner) : null;
      const loserIdInFinal = finalMatch[0].winnerId === finalMatch[0].pair1Id ? finalMatch[0].pair2Id : finalMatch[0].pair1Id;
      const loser = loserIdInFinal ? pairMap.get(loserIdInFinal) : undefined;
      runnerUp = loser ? formatPair(loser) : null;
    }

    if (thirdMatch.length > 0 && thirdMatch[0].winnerId) {
      const thirdWinner = pairMap.get(thirdMatch[0].winnerId);
      thirdPlace = thirdWinner ? formatPair(thirdWinner) : null;
    }

    result.push({
      tournamentId,
      tournamentName: tournament.name,
      categoryId: cat.id,
      categoryName: cat.name,
      champion,
      runnerUp,
      thirdPlace,
    });
  }

  res.json(result);
});

// ── SPONSORS ───────────────────────────────────────────────────

// GET /tournaments/:id/sponsors
router.get("/:id/sponsors", async (req, res) => {
  const tournamentId = Number(req.params.id);
  const sponsors = await db.select().from(sponsorsTable).where(eq(sponsorsTable.tournamentId, tournamentId));
  res.json(sponsors.map((s) => ({ ...s, createdAt: s.createdAt.toISOString() })));
});

// POST /tournaments/:id/sponsors
router.post("/:id/sponsors", adminAuth, async (req, res) => {
  const tournamentId = Number(req.params.id);
  const { name, logoUrl, websiteUrl, position } = req.body;

  const [sponsor] = await db
    .insert(sponsorsTable)
    .values({ tournamentId, name, logoUrl, websiteUrl, position: position ?? "left", tenantId: req.tenantId! })
    .returning();

  res.status(201).json({ ...sponsor, createdAt: sponsor.createdAt.toISOString() });
});

// ── TOURNAMENT REGISTRATIONS ─────────────────────────────────────────────────

async function getTournamentMpToken(tenantId = 1): Promise<string> {
  return getSettingOrEnv("mp_access_token", "MERCADOPAGO_ACCESS_TOKEN", tenantId);
}

async function getTournamentPaymentProvider(tenantId = 1): Promise<"mercadopago" | "picpay"> {
  const val = await getSetting("payment_provider", tenantId);
  return val === "picpay" ? "picpay" : "mercadopago";
}

async function getTournamentPicPayToken(tenantId = 1): Promise<string | null> {
  return getSetting("picpay_token", tenantId);
}

async function getTournamentPicPayKey(tenantId = 1): Promise<string | null> {
  return getSetting("picpay_key", tenantId);
}

function formatRegistration(r: typeof tournamentRegistrationsTable.$inferSelect, players: typeof tournamentRegistrationPlayersTable.$inferSelect[]) {
  return {
    ...r,
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
    players: players.map((p) => ({ ...p, createdAt: p.createdAt.toISOString() })),
  };
}

// Helper: auto-expire pending registrations whose PIX time has passed
async function autoExpireRegistrations(tournamentId: number) {
  await db
    .update(tournamentRegistrationsTable)
    .set({ status: "expired" })
    .where(
      and(
        eq(tournamentRegistrationsTable.tournamentId, tournamentId),
        eq(tournamentRegistrationsTable.status, "pending_payment"),
        lt(tournamentRegistrationsTable.expiresAt, new Date()),
      ),
    );
}

// GET /tournaments/:id/registrations (admin)
router.get("/:id/registrations", adminAuth, async (req, res) => {
  const tournamentId = Number(req.params.id);

  // Auto-expire pending registrations whose PIX time has lapsed
  await autoExpireRegistrations(tournamentId);

  const registrations = await db
    .select()
    .from(tournamentRegistrationsTable)
    .where(eq(tournamentRegistrationsTable.tournamentId, tournamentId))
    .orderBy(desc(tournamentRegistrationsTable.createdAt));

  const result = await Promise.all(
    registrations.map(async (r) => {
      const players = await db
        .select()
        .from(tournamentRegistrationPlayersTable)
        .where(eq(tournamentRegistrationPlayersTable.registrationId, r.id))
        .orderBy(asc(tournamentRegistrationPlayersTable.id));
      return formatRegistration(r, players);
    }),
  );

  res.json(result);
});

// ─── Coupon Validation (public) ──────────────────────────────────────────────

// POST /tournaments/:id/validate-coupon (public)
router.post("/:id/validate-coupon", async (req, res) => {
  const tournamentId = Number(req.params.id);
  const { code, categoryName } = req.body as { code: string; categoryName?: string };
  if (!code) { res.status(400).json({ error: "Código obrigatório" }); return; }

  const [tournament] = await db.select().from(tournamentsTable).where(eq(tournamentsTable.id, tournamentId)).limit(1);
  if (!tournament) { res.status(404).json({ error: "Torneio não encontrado" }); return; }

  // Resolve price: use category's registrationPrice if available, else fall back to tournament's
  let resolvedPrice = Number(tournament.registrationPrice ?? "0");
  if (categoryName) {
    const [cat] = await db.select().from(categoriesTable).where(and(
      eq(categoriesTable.tournamentId, tournamentId),
      eq(categoriesTable.name, categoryName),
    )).limit(1);
    if (cat?.registrationPrice) resolvedPrice = Number(cat.registrationPrice);
  }

  const [coupon] = await db
    .select()
    .from(couponsTable)
    .where(and(
      eq(couponsTable.code, code.toUpperCase().trim()),
      eq(couponsTable.scope, "tournament"),
      eq(couponsTable.tournamentId, tournamentId),
      eq(couponsTable.active, true),
    ))
    .limit(1);

  if (!coupon) { res.status(404).json({ error: "Cupom inválido para este torneio" }); return; }
  if (coupon.expiresAt && new Date() > coupon.expiresAt) { res.status(400).json({ error: "Cupom expirado" }); return; }
  if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) { res.status(400).json({ error: "Cupom esgotado" }); return; }

  const basePrice = resolvedPrice;
  let discount = 0;
  if (coupon.type === "percentage") {
    discount = Math.round((basePrice * Number(coupon.value)) / 100 * 100) / 100;
  } else {
    discount = Math.min(Number(coupon.value), basePrice);
  }
  const finalPrice = Math.max(0, basePrice - discount);

  res.json({
    id: coupon.id,
    code: coupon.code,
    discountType: coupon.type,
    discountValue: coupon.value,
    originalPrice: basePrice.toFixed(2),
    discountAmount: discount.toFixed(2),
    finalPrice: finalPrice.toFixed(2),
  });
});

// POST /tournaments/:id/registrations (public)
router.post("/:id/registrations", async (req, res) => {
  const tournamentId = Number(req.params.id);

  const [tournament] = await db.select().from(tournamentsTable).where(eq(tournamentsTable.id, tournamentId)).limit(1);
  if (!tournament) { res.status(404).json({ error: "Torneio não encontrado" }); return; }
  if (tournament.status !== "open_registration") {
    res.status(400).json({ error: "Este torneio não está com inscrições abertas" });
    return;
  }

  const { registrationType, categoryName, players, notes, couponCode } = req.body as {
    registrationType: "individual" | "dupla" | "trio";
    categoryName?: string;
    players: Array<{ fullName: string; nickname?: string; cpf: string; phone: string; email: string; age: number; shirtSize?: string; school?: string; instagram?: string; photoUrl?: string }>;
    notes?: string;
    couponCode?: string;
  };

  if (!registrationType || !players || players.length === 0) {
    res.status(400).json({ error: "Tipo de inscrição e jogadores são obrigatórios" });
    return;
  }

  const expectedPlayers = registrationType === "individual" ? 1 : registrationType === "dupla" ? 2 : 3;
  if (players.length !== expectedPlayers) {
    res.status(400).json({ error: `Modalidade ${registrationType} requer ${expectedPlayers} jogador(es)` });
    return;
  }

  // Resolve price: use category's registrationPrice if available, else fall back to tournament's
  let resolvedBasePrice = Number(tournament.registrationPrice ?? "0");
  if (categoryName) {
    const [cat] = await db.select().from(categoriesTable).where(and(
      eq(categoriesTable.tournamentId, tournamentId),
      eq(categoriesTable.name, categoryName),
    )).limit(1);
    if (cat?.registrationPrice) resolvedBasePrice = Number(cat.registrationPrice);
  }

  const originalPrice = resolvedBasePrice;
  let finalPrice = originalPrice;
  let appliedCouponCode: string | null = null;
  let discountAmount: string | null = null;

  if (couponCode) {
    const [coupon] = await db
      .select()
      .from(couponsTable)
      .where(and(
        eq(couponsTable.code, couponCode.toUpperCase().trim()),
        eq(couponsTable.scope, "tournament"),
        eq(couponsTable.tournamentId, tournamentId),
        eq(couponsTable.active, true),
      ))
      .limit(1);
    if (coupon && !(coupon.expiresAt && new Date() > coupon.expiresAt) && !(coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses)) {
      let discount = 0;
      if (coupon.type === "percentage") {
        discount = Math.round((originalPrice * Number(coupon.value)) / 100 * 100) / 100;
      } else {
        discount = Math.min(Number(coupon.value), originalPrice);
      }
      finalPrice = Math.max(0, originalPrice - discount);
      appliedCouponCode = coupon.code;
      discountAmount = discount.toFixed(2);
      await db.update(couponsTable).set({ usedCount: coupon.usedCount + 1 }).where(eq(couponsTable.id, coupon.id));
    }
  }

  const price = finalPrice.toFixed(2);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes from now

  // Create registration
  const [registration] = await db
    .insert(tournamentRegistrationsTable)
    .values({
      tournamentId,
      registrationType,
      categoryName: categoryName ?? null,
      price,
      originalPrice: originalPrice.toFixed(2),
      couponCode: appliedCouponCode,
      discountAmount,
      notes: notes ?? null,
      expiresAt,
      tenantId: req.tenantId!,
    })
    .returning();

  // Create players
  const createdPlayers = await Promise.all(
    players.map((p, idx) =>
      db
        .insert(tournamentRegistrationPlayersTable)
        .values({
          registrationId: registration.id,
          fullName: p.fullName,
          nickname: p.nickname ?? null,
          cpf: p.cpf,
          phone: p.phone,
          email: p.email,
          age: Number(p.age),
          shirtSize: p.shirtSize ?? null,
          school: p.school ?? null,
          instagram: p.instagram ?? null,
          photoUrl: p.photoUrl ?? null,
          isMainContact: idx === 0 ? 1 : 0,
          tenantId: req.tenantId!,
        })
        .returning()
        .then((rows) => rows[0]),
    ),
  );

  // Generate PIX QR code via configured payment provider
  let pixQrCodeBase64: string | null = null;
  let pixCopiaECola: string | null = null;
  let pixPaymentId: string | null = null;

  const regTenantId = tournament.tenantId ?? req.tenantId ?? 1;
  const provider = await getTournamentPaymentProvider(regTenantId);
  const totalAmount = Number(price);

  if (totalAmount > 0) {
    try {
      const appUrl = getBaseUrl();

      if (provider === "picpay") {
        const picpayToken = await getTournamentPicPayToken(regTenantId);
        const picpayKey = await getTournamentPicPayKey(regTenantId);
        if (picpayToken) {
          const referenceId = `tournament-reg-${registration.id}`;
          const callbackUrl = appUrl && picpayKey
            ? `${appUrl}/api/tournaments/registration-picpay-webhook?token=${encodeURIComponent(picpayKey)}`
            : undefined;
          const pix = await generatePicPayPix({
            picpayToken,
            referenceId,
            amount: totalAmount,
            description: `Inscrição Torneio ${tournament.name} – ${registrationType}`,
            buyerName: players[0].fullName,
            buyerEmail: players[0].email,
            callbackUrl,
          });
          pixQrCodeBase64 = pix.qrCodeBase64 ?? null;
          pixCopiaECola = pix.qrCode ?? null;
          pixPaymentId = referenceId;
          await db
            .update(tournamentRegistrationsTable)
            .set({ pixQrCodeBase64, pixCopiaECola, pixPaymentId })
            .where(eq(tournamentRegistrationsTable.id, registration.id));
        }
      } else {
        const mpToken = await getTournamentMpToken(regTenantId);
        if (mpToken) {
          const mpClient = new MercadoPagoConfig({ accessToken: mpToken });
          const paymentClient = new Payment(mpClient);
          const pixPayment = await paymentClient.create({
            body: {
              transaction_amount: totalAmount,
              payment_method_id: "pix",
              description: `Inscrição Torneio ${tournament.name} – ${registrationType}`,
              payer: {
                email: players[0].email,
                first_name: players[0].fullName.split(" ")[0],
                last_name: players[0].fullName.split(" ").slice(1).join(" ") || "-",
              },
              notification_url: appUrl ? `${appUrl}/api/tournaments/registration-webhook` : undefined,
              date_of_expiration: expiresAt.toISOString(),
            },
          });
          const txData = (pixPayment as unknown as Record<string, unknown>)?.["point_of_interaction"] as Record<string, unknown> | undefined;
          const txDataInner = txData?.["transaction_data"] as Record<string, unknown> | undefined;
          pixQrCodeBase64 = (txDataInner?.["qr_code_base64"] as string) ?? null;
          pixCopiaECola = (txDataInner?.["qr_code"] as string) ?? null;
          pixPaymentId = String(pixPayment.id ?? "");
          await db
            .update(tournamentRegistrationsTable)
            .set({ pixQrCodeBase64, pixCopiaECola, pixPaymentId })
            .where(eq(tournamentRegistrationsTable.id, registration.id));
        }
      }
    } catch (err) {
      req.log?.warn?.({ err }, "PIX generation failed for tournament registration");
    }
  }

  res.status(201).json(formatRegistration({ ...registration, pixQrCodeBase64, pixCopiaECola, pixPaymentId }, createdPlayers));
});

// PATCH /tournaments/:id/registrations/:regId (admin - edit manual/registration players)
router.patch("/:id/registrations/:regId", adminAuth, async (req, res) => {
  const regId = Number(req.params.regId);
  const { registrationType, categoryName, players, notes } = req.body as {
    registrationType: "individual" | "dupla" | "trio";
    categoryName?: string;
    players: Array<{ fullName: string; nickname?: string; cpf: string; phone: string; email: string; age: number; shirtSize?: string; school?: string; instagram?: string; photoUrl?: string }>;
    notes?: string;
  };

  if (!registrationType || !players || players.length === 0) {
    res.status(400).json({ error: "Tipo de inscrição e jogadores são obrigatórios" });
    return;
  }

  const expectedPlayers = registrationType === "individual" ? 1 : registrationType === "dupla" ? 2 : 3;
  if (players.length !== expectedPlayers) {
    res.status(400).json({ error: `Modalidade ${registrationType} requer ${expectedPlayers} jogador(es)` });
    return;
  }

  const [registration] = await db
    .update(tournamentRegistrationsTable)
    .set({
      registrationType,
      categoryName: categoryName ?? null,
      notes: notes ?? null,
    })
    .where(eq(tournamentRegistrationsTable.id, regId))
    .returning();

  if (!registration) {
    res.status(404).json({ error: "Inscrição não encontrada" });
    return;
  }

  await db.delete(tournamentRegistrationPlayersTable).where(eq(tournamentRegistrationPlayersTable.registrationId, regId));

  const createdPlayers = await Promise.all(
    players.map((p, idx) =>
      db
        .insert(tournamentRegistrationPlayersTable)
        .values({
          registrationId: regId,
          fullName: p.fullName,
          nickname: p.nickname ?? null,
          cpf: p.cpf,
          phone: p.phone,
          email: p.email,
          age: Number(p.age),
          shirtSize: p.shirtSize ?? null,
          school: p.school ?? null,
          instagram: p.instagram ?? null,
          photoUrl: p.photoUrl ?? null,
          isMainContact: idx === 0 ? 1 : 0,
          tenantId: req.tenantId!,
        })
        .returning()
        .then((rows) => rows[0]),
    ),
  );

  res.json(formatRegistration(registration, createdPlayers));
});

// PATCH /tournaments/:id/registrations/:regId/status (admin - confirm/cancel/expire)
router.patch("/:id/registrations/:regId/status", adminAuth, async (req, res) => {
  const regId = Number(req.params.regId);
  const { status } = req.body as { status: "pending_payment" | "confirmed" | "cancelled" | "expired" };

  if (!["pending_payment", "confirmed", "cancelled", "expired"].includes(status)) {
    res.status(400).json({ error: "Status inválido" });
    return;
  }

  // When manually setting back to pending_payment, clear expiresAt so auto-expire doesn't revert it immediately
  const updateData: { status: string; expiresAt?: null } = { status };
  if (status === "pending_payment") updateData.expiresAt = null;

  const [updated] = await db
    .update(tournamentRegistrationsTable)
    .set(updateData)
    .where(eq(tournamentRegistrationsTable.id, regId))
    .returning();

  if (!updated) { res.status(404).json({ error: "Inscrição não encontrada" }); return; }

  res.json({ ...updated, createdAt: updated.createdAt.toISOString(), expiresAt: updated.expiresAt ? updated.expiresAt.toISOString() : null });

  // Send email on confirmed or cancelled
  if (status === "confirmed" || status === "cancelled") {
    void (async () => {
      try {
        const [tournament] = await db.select().from(tournamentsTable).where(eq(tournamentsTable.id, updated.tournamentId)).limit(1);
        const players = await db.select().from(tournamentRegistrationPlayersTable).where(eq(tournamentRegistrationPlayersTable.registrationId, regId));
        if (status === "confirmed" && tournament) {
          await createConfirmedPairFromRegistration(regId, tournament.id, tournament.tenantId ?? req.tenantId ?? 1, updated.categoryName ?? null);
        }
        if (tournament && players.length > 0) {
          await sendTournamentRegistrationEmail({
            tournamentName: tournament.name,
            tournamentDate: tournament.startDate ?? undefined,
            tournamentLocation: tournament.location ?? undefined,
            registrationType: updated.registrationType,
            categoryName: updated.categoryName ?? undefined,
            price: updated.price,
            players: players.map((p) => ({ fullName: p.fullName, nickname: p.nickname, email: p.email })),
            isConfirmed: status === "confirmed",
            isCancelled: status === "cancelled",
            tenantId: tournament.tenantId ?? req.tenantId ?? 1,
          });
        }
      } catch {}
    })();
  }
});

// DELETE /tournaments/:id/registrations/:regId (admin)
router.delete("/:id/registrations/:regId", adminAuth, async (req, res) => {
  const regId = Number(req.params.regId);
  await db.delete(tournamentRegistrationsTable).where(eq(tournamentRegistrationsTable.id, regId));
  res.json({ ok: true });
});

// GET /tournaments/:id/registrations/:regId (get registration status for payment polling)
router.get("/:id/registrations/:regId", async (req, res) => {
  const regId = Number(req.params.regId);
  const [reg] = await db
    .select()
    .from(tournamentRegistrationsTable)
    .where(eq(tournamentRegistrationsTable.id, regId))
    .limit(1);
  
  if (!reg) {
    res.status(404).json({ error: "Registration not found" });
    return;
  }

  const players = await db
    .select()
    .from(tournamentRegistrationPlayersTable)
    .where(eq(tournamentRegistrationPlayersTable.registrationId, reg.id));

  res.json(formatRegistration(reg, players));
});

// ─── Admin Coupon CRUD ────────────────────────────────────────────────────────

// GET /tournaments/:id/coupons (admin)
router.get("/:id/coupons", adminAuth, async (req, res) => {
  const tournamentId = Number(req.params.id);
  const coupons = await db
    .select()
    .from(couponsTable)
    .where(and(eq(couponsTable.scope, "tournament"), eq(couponsTable.tournamentId, tournamentId)))
    .orderBy(couponsTable.createdAt);
  res.json(coupons);
});

// POST /tournaments/:id/coupons (admin)
router.post("/:id/coupons", adminAuth, async (req, res) => {
  const tournamentId = Number(req.params.id);
  const { code, discountType, discountValue, maxUses, expiresAt } = req.body as {
    code: string;
    discountType: "percentage" | "fixed";
    discountValue: number;
    maxUses?: number | null;
    expiresAt?: string | null;
  };
  if (!code || !discountType || discountValue == null) {
    res.status(400).json({ error: "Código, tipo e valor são obrigatórios" });
    return;
  }
  try {
    const [coupon] = await db
      .insert(couponsTable)
      .values({
        code: code.toUpperCase().trim(),
        type: discountType,
        value: String(discountValue),
        scope: "tournament",
        tournamentId,
        maxUses: maxUses ?? null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        active: true,
        tenantId: req.tenantId!,
      })
      .returning();
    res.status(201).json(coupon);
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === "23505") {
      res.status(409).json({ error: "Já existe um cupom com esse código" });
    } else {
      res.status(500).json({ error: "Erro ao criar cupom" });
    }
  }
});

// DELETE /tournaments/:id/coupons/:couponId (admin)
router.delete("/:id/coupons/:couponId", adminAuth, async (req, res) => {
  const couponId = Number(req.params.couponId);
  await db.delete(couponsTable).where(eq(couponsTable.id, couponId));
  res.json({ ok: true });
});

// POST /tournaments/registration-picpay-webhook — PicPay webhook for tournament registrations
router.post("/registration-picpay-webhook", async (req, res) => {
  res.status(200).json({ ok: true });

  const body = req.body as Record<string, unknown>;
  const referenceId = body["referenceId"] as string | undefined;
  const statusCode = (body["status"] as Record<string, unknown> | undefined)?.["code"] as number | undefined;

  if (!referenceId || (statusCode !== 103 && statusCode !== 104)) return;

  // referenceId format: tournament-reg-{registrationId}
  const match = referenceId.match(/^tournament-reg-(\d+)$/);
  if (!match) return;
  const regId = Number(match[1]);

  try {
    const [reg] = await db.select().from(tournamentRegistrationsTable).where(eq(tournamentRegistrationsTable.id, regId)).limit(1);
    if (!reg || reg.status === "confirmed") return;

    const [tournament] = await db.select().from(tournamentsTable).where(eq(tournamentsTable.id, reg.tournamentId)).limit(1);
    const resolvedTenantId = tournament?.tenantId ?? 1;

    // Verify webhook token
    const incomingToken = req.query["token"] as string | undefined;
    const expectedToken = await getTournamentPicPayKey(resolvedTenantId);
    if (!verifyPicPayWebhookToken(incomingToken, expectedToken)) return;

    // Verify payment via PicPay API
    const picpayToken = await getTournamentPicPayToken(resolvedTenantId);
    if (!picpayToken) return;
    const isPaid = await verifyPicPayPayment(picpayToken, referenceId);
    if (!isPaid) return;

    await db
      .update(tournamentRegistrationsTable)
      .set({ status: "confirmed" })
      .where(eq(tournamentRegistrationsTable.id, reg.id));

    const players = await db.select().from(tournamentRegistrationPlayersTable).where(eq(tournamentRegistrationPlayersTable.registrationId, reg.id));
    if (tournament && players.length > 0) {
      await sendTournamentRegistrationEmail({
        tournamentName: tournament.name,
        tournamentDate: tournament.startDate ?? undefined,
        tournamentLocation: tournament.location ?? undefined,
        registrationType: reg.registrationType,
        categoryName: reg.categoryName ?? undefined,
        price: reg.price,
        players: players.map((p) => ({ fullName: p.fullName, nickname: p.nickname, email: p.email })),
        isConfirmed: true,
        tenantId: resolvedTenantId,
      }).catch(() => {});
    }
  } catch (err) {
    console.error("[registration-picpay-webhook] Erro:", err);
  }
});

// POST /tournaments/registration-webhook (MercadoPago webhook for registrations)
router.post("/registration-webhook", async (req, res) => {
  res.status(200).json({ ok: true });
  const { type, data } = req.body as { type?: string; data?: { id?: string } };
  if (type !== "payment" || !data?.id) return;

  try {
    const fallbackTenantId = req.tenantId ?? 1;
    const paymentIdStr = String(data.id);

    const [reg] = await db
      .select()
      .from(tournamentRegistrationsTable)
      .where(eq(tournamentRegistrationsTable.pixPaymentId, paymentIdStr))
      .limit(1);
    if (!reg || reg.status === "confirmed") return;

    const [tournament] = await db.select().from(tournamentsTable).where(eq(tournamentsTable.id, reg.tournamentId)).limit(1);
    const resolvedTenantId = tournament?.tenantId ?? fallbackTenantId;

    const mpToken = await getTournamentMpToken(resolvedTenantId);
    if (!mpToken) return;
    const mpClient = new MercadoPagoConfig({ accessToken: mpToken });
    const paymentClient = new Payment(mpClient);
    const payment = await paymentClient.get({ id: data.id });
    if ((payment as unknown as Record<string, unknown>)?.["status"] !== "approved") return;

    await db
      .update(tournamentRegistrationsTable)
      .set({ status: "confirmed" })
      .where(eq(tournamentRegistrationsTable.id, reg.id));

    const players = await db.select().from(tournamentRegistrationPlayersTable).where(eq(tournamentRegistrationPlayersTable.registrationId, reg.id));
    if (tournament && players.length > 0) {
      await sendTournamentRegistrationEmail({
        tournamentName: tournament.name,
        tournamentDate: tournament.startDate ?? undefined,
        tournamentLocation: tournament.location ?? undefined,
        registrationType: reg.registrationType,
        categoryName: reg.categoryName ?? undefined,
        price: reg.price,
        players: players.map((p) => ({ fullName: p.fullName, nickname: p.nickname, email: p.email })),
        isConfirmed: true,
        tenantId: resolvedTenantId,
      }).catch(() => {});
    }
  } catch {}
});

export default router;
