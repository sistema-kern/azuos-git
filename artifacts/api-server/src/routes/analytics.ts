import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { pageViewsTable } from "@workspace/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { adminAuth } from "../middlewares/adminAuth.js";

const router: IRouter = Router();

// ── IP exclusion cache ──────────────────────────────────────────────────────
const excludedIpsCache = new Map<number, { ips: Set<string>; expiresAt: number }>();
const IP_CACHE_TTL_MS = 5 * 60 * 1000;

async function isExcludedIp(tenantId: number, ip: string): Promise<boolean> {
  const cached = excludedIpsCache.get(tenantId);
  if (cached && Date.now() < cached.expiresAt) return cached.ips.has(ip);
  const rows = await db.execute(sql`SELECT ip FROM analytics_excluded_ips WHERE tenant_id = ${tenantId}`);
  const ips = new Set(rows.rows.map((r: any) => r.ip as string));
  excludedIpsCache.set(tenantId, { ips, expiresAt: Date.now() + IP_CACHE_TTL_MS });
  return ips.has(ip);
}

function getClientIp(req: import("express").Request): string | null {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(",")[0];
    return first.trim();
  }
  return req.socket?.remoteAddress ?? null;
}

// ── Public: track page view ────────────────────────────────────────────────
router.post("/track", async (req, res) => {
  try {
    const { sessionId, path, referrer, deviceType, durationSeconds } = req.body;
    if (!sessionId || !path) return res.status(400).json({ error: "Missing required fields" });
    const tenantId = req.tenantId ?? 1;

    const clientIp = getClientIp(req);
    if (clientIp && await isExcludedIp(tenantId, clientIp)) {
      return res.json({ ok: true, skipped: true });
    }

    const existing = await db
      .select({ id: pageViewsTable.id })
      .from(pageViewsTable)
      .where(and(eq(pageViewsTable.sessionId, sessionId), eq(pageViewsTable.path, path), eq(pageViewsTable.tenantId, tenantId)))
      .limit(1);

    if (existing.length > 0 && durationSeconds != null) {
      await db.update(pageViewsTable).set({ durationSeconds: String(durationSeconds) }).where(eq(pageViewsTable.id, existing[0].id));
    } else if (existing.length === 0) {
      await db.insert(pageViewsTable).values({ tenantId, sessionId, path, referrer: referrer ?? null, deviceType: deviceType ?? null, durationSeconds: durationSeconds != null ? String(durationSeconds) : null });
    }
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to track" });
  }
});

// ── Admin: Revenue ─────────────────────────────────────────────────────────
router.get("/revenue", adminAuth, async (req, res) => {
  const tenantId = req.tenantId!;
  const period = String(req.query.period || "month");
  const { from, to } = getDateRange(period, req.query.from as string, req.query.to as string);
  const fmt = pgTrunc(period);

  // Mensalistas: always group by billing month (session date month), filter by months overlapping the range
  const fromMonth = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  const toMonth = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));

  const [courtRev, classRev, tournRev, monthlyRev] = await Promise.all([
    db.execute(sql`SELECT date_trunc(${fmt}, created_at AT TIME ZONE 'UTC') as bucket, COALESCE(SUM(amount::numeric),0) as total FROM court_bookings WHERE tenant_id=${tenantId} AND status!='cancelled' AND (booking_type IS NULL OR booking_type != 'monthly_plan') AND created_at>=${from} AND created_at<=${to} GROUP BY bucket ORDER BY bucket`),
    db.execute(sql`SELECT date_trunc(${fmt}, created_at AT TIME ZONE 'UTC') as bucket, COALESCE(SUM(amount::numeric),0) as total FROM class_bookings WHERE tenant_id=${tenantId} AND status!='cancelled' AND created_at>=${from} AND created_at<=${to} GROUP BY bucket ORDER BY bucket`),
    db.execute(sql`SELECT date_trunc(${fmt}, created_at AT TIME ZONE 'UTC') as bucket, COALESCE(SUM(price::numeric),0) as total FROM tournament_registrations WHERE tenant_id=${tenantId} AND status='confirmed' AND created_at>=${from} AND created_at<=${to} GROUP BY bucket ORDER BY bucket`),
    db.execute(sql`SELECT date_trunc('month', date::date) as bucket, COALESCE(SUM(amount::numeric),0) as total FROM court_bookings WHERE tenant_id=${tenantId} AND booking_type='monthly_plan' AND status!='cancelled' AND date_trunc('month', date::date) >= ${fromMonth} AND date_trunc('month', date::date) <= ${toMonth} GROUP BY bucket ORDER BY bucket`),
  ]);

  const buckets = generateBuckets(from, to, period);
  const map: Record<string, { court: number; class: number; tournament: number; monthly: number; total: number }> = {};
  for (const b of buckets) map[b.key] = { court: 0, class: 0, tournament: 0, monthly: 0, total: 0 };

  const addRev = (rows: any[], key: "court" | "class" | "tournament" | "monthly") => {
    for (const row of rows) {
      const k = toKey(new Date(row.bucket), period);
      if (map[k]) { map[k][key] += Number(row.total); map[k].total += Number(row.total); }
    }
  };
  addRev(courtRev.rows, "court");
  addRev(classRev.rows, "class");
  addRev(tournRev.rows, "tournament");

  // Mensalistas: map each billing month to the first chart bucket in that same month
  for (const row of monthlyRev.rows) {
    const monthDate = new Date(row.bucket);
    const monthYear = monthDate.getUTCFullYear();
    const monthNum = monthDate.getUTCMonth();
    const firstBucket = buckets.find(b => {
      const parts = b.key.split("-").map(Number);
      return parts[0] === monthYear && parts[1] === monthNum;
    });
    if (firstBucket) {
      map[firstBucket.key].monthly += Number(row.total);
      map[firstBucket.key].total += Number(row.total);
    }
  }

  res.json(buckets.map(b => ({ label: b.label, ...map[b.key] })));
});

// ── Admin: Bookings ────────────────────────────────────────────────────────
router.get("/bookings", adminAuth, async (req, res) => {
  const tenantId = req.tenantId!;
  const period = String(req.query.period || "month");
  const { from, to } = getDateRange(period, req.query.from as string, req.query.to as string);
  const fmt = pgTrunc(period);

  const [courtR, classR] = await Promise.all([
    db.execute(sql`SELECT date_trunc(${fmt}, created_at AT TIME ZONE 'UTC') as bucket, COUNT(*) as count, SUM(CASE WHEN status='confirmed' AND date >= CURRENT_DATE::text THEN 1 ELSE 0 END) as confirmed, SUM(CASE WHEN status='confirmed' AND date < CURRENT_DATE::text THEN 1 ELSE 0 END) as completed, SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) as pending, SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) as cancelled FROM court_bookings WHERE tenant_id=${tenantId} AND (booking_type IS NULL OR booking_type != 'monthly_plan') AND created_at>=${from} AND created_at<=${to} GROUP BY bucket ORDER BY bucket`),
    db.execute(sql`SELECT date_trunc(${fmt}, created_at AT TIME ZONE 'UTC') as bucket, COUNT(*) as count, SUM(CASE WHEN status='confirmed' AND date >= CURRENT_DATE::text THEN 1 ELSE 0 END) as confirmed, SUM(CASE WHEN status='confirmed' AND date < CURRENT_DATE::text THEN 1 ELSE 0 END) as completed, SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) as pending, SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) as cancelled FROM class_bookings WHERE tenant_id=${tenantId} AND created_at>=${from} AND created_at<=${to} GROUP BY bucket ORDER BY bucket`),
  ]);

  const buckets = generateBuckets(from, to, period);
  const map: Record<string, { total: number; confirmed: number; completed: number; pending: number; cancelled: number }> = {};
  for (const b of buckets) map[b.key] = { total: 0, confirmed: 0, completed: 0, pending: 0, cancelled: 0 };

  const addBook = (rows: any[]) => {
    for (const row of rows) {
      const k = toKey(new Date(row.bucket), period);
      if (map[k]) {
        map[k].total += Number(row.count);
        map[k].confirmed += Number(row.confirmed);
        map[k].completed += Number(row.completed);
        map[k].pending += Number(row.pending);
        map[k].cancelled += Number(row.cancelled);
      }
    }
  };
  addBook(courtR.rows);
  addBook(classR.rows);

  res.json(buckets.map(b => ({ label: b.label, ...map[b.key] })));
});

// ── Admin: Page views ──────────────────────────────────────────────────────
router.get("/pageviews", adminAuth, async (req, res) => {
  const tenantId = req.tenantId!;
  const period = String(req.query.period || "month");
  const { from, to } = getDateRange(period, req.query.from as string, req.query.to as string);
  const fmt = pgTrunc(period);

  const rows = await db.execute(sql`SELECT date_trunc(${fmt}, created_at AT TIME ZONE 'UTC') as bucket, COUNT(*) as views, COUNT(DISTINCT session_id) as sessions FROM page_views WHERE tenant_id=${tenantId} AND created_at>=${from} AND created_at<=${to} GROUP BY bucket ORDER BY bucket`);

  const buckets = generateBuckets(from, to, period);
  const map: Record<string, { views: number; sessions: number }> = {};
  for (const b of buckets) map[b.key] = { views: 0, sessions: 0 };
  for (const row of rows.rows) {
    const k = toKey(new Date(row.bucket), period);
    if (map[k]) { map[k].views = Number(row.views); map[k].sessions = Number(row.sessions); }
  }
  res.json(buckets.map(b => ({ label: b.label, ...map[b.key] })));
});

// ── Admin: Avg session duration ────────────────────────────────────────────
router.get("/duration", adminAuth, async (req, res) => {
  const tenantId = req.tenantId!;
  const period = String(req.query.period || "month");
  const { from, to } = getDateRange(period, req.query.from as string, req.query.to as string);
  const fmt = pgTrunc(period);

  const rows = await db.execute(sql`SELECT date_trunc(${fmt}, created_at AT TIME ZONE 'UTC') as bucket, ROUND(AVG(duration_seconds::numeric)) as avg_duration, COUNT(DISTINCT session_id) as sessions FROM page_views WHERE tenant_id=${tenantId} AND duration_seconds IS NOT NULL AND created_at>=${from} AND created_at<=${to} GROUP BY bucket ORDER BY bucket`);

  const buckets = generateBuckets(from, to, period);
  const map: Record<string, { avg_duration: number; sessions: number }> = {};
  for (const b of buckets) map[b.key] = { avg_duration: 0, sessions: 0 };
  for (const row of rows.rows) {
    const k = toKey(new Date(row.bucket), period);
    if (map[k]) { map[k].avg_duration = Number(row.avg_duration); map[k].sessions = Number(row.sessions); }
  }
  res.json(buckets.map(b => ({ label: b.label, ...map[b.key] })));
});

// ── Helpers ────────────────────────────────────────────────────────────────

function pgTrunc(period: string): string {
  if (period === "day") return "hour";
  if (period === "year") return "month";
  return "day"; // week and month → per day
}

function getDateRange(period: string, fromQ?: string, toQ?: string) {
  if (fromQ && toQ) return { from: new Date(fromQ + "T00:00:00Z"), to: new Date(toQ + "T23:59:59Z") };
  const now = new Date();
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
  let from: Date;
  if (period === "day") {
    from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  } else if (period === "week") {
    from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 6, 0, 0, 0, 0));
  } else if (period === "month") {
    from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  } else {
    from = new Date(Date.UTC(now.getUTCFullYear(), 0, 1, 0, 0, 0, 0));
  }
  return { from, to };
}

function toKey(d: Date, period: string): string {
  if (period === "day") return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}-${d.getUTCHours()}`;
  if (period === "year") return `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

const PT_MONTHS = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

function bucketLabel(d: Date, period: string): string {
  if (period === "day") return `${String(d.getUTCHours()).padStart(2, "0")}h`;
  if (period === "year") return PT_MONTHS[d.getUTCMonth()];
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function generateBuckets(from: Date, to: Date, period: string): { key: string; label: string }[] {
  const buckets: { key: string; label: string }[] = [];
  const cursor = new Date(from);

  if (period === "day") {
    // hourly from 00h to 23h
    while (cursor <= to) {
      buckets.push({ key: toKey(cursor, period), label: bucketLabel(cursor, period) });
      cursor.setUTCHours(cursor.getUTCHours() + 1);
    }
  } else if (period === "year") {
    // monthly
    while (cursor <= to) {
      buckets.push({ key: toKey(cursor, period), label: bucketLabel(cursor, period) });
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
  } else {
    // daily (week = 7 days, month = up to 31 days)
    while (cursor <= to) {
      buckets.push({ key: toKey(cursor, period), label: bucketLabel(cursor, period) });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }
  return buckets;
}

export default router;
