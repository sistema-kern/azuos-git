import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { adminAuth } from "../middlewares/adminAuth.js";

const router: IRouter = Router();
router.use(adminAuth);

// ── helpers ──────────────────────────────────────────────────────────────────

function parseRange(from?: string, to?: string) {
  const now = new Date();
  const f = from
    ? new Date(from + "T00:00:00Z")
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const t = to
    ? new Date(to + "T23:59:59Z")
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59));
  return { from: f, to: t };
}

// ── Bookings summary ─────────────────────────────────────────────────────────
router.get("/bookings-summary", async (req, res) => {
  const tenantId = req.tenantId!;
  const { from, to } = parseRange(req.query.from as string, req.query.to as string);

  const [court, cls] = await Promise.all([
    db.execute(sql`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status='confirmed' AND date >= CURRENT_DATE::text THEN 1 ELSE 0 END) as confirmed,
        SUM(CASE WHEN status='confirmed' AND date < CURRENT_DATE::text THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) as cancelled,
        COALESCE(SUM(amount::numeric),0) as revenue
      FROM court_bookings
      WHERE tenant_id=${tenantId}
        AND (booking_type IS NULL OR booking_type != 'monthly_plan')
        AND created_at>=${from} AND created_at<=${to}
    `),
    db.execute(sql`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status='confirmed' AND date >= CURRENT_DATE::text THEN 1 ELSE 0 END) as confirmed,
        SUM(CASE WHEN status='confirmed' AND date < CURRENT_DATE::text THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) as cancelled,
        COALESCE(SUM(amount::numeric),0) as revenue
      FROM class_bookings
      WHERE tenant_id=${tenantId} AND created_at>=${from} AND created_at<=${to}
    `),
  ]);

  const c = court.rows[0] as any;
  const cl = cls.rows[0] as any;
  res.json({
    total: Number(c.total) + Number(cl.total),
    confirmed: Number(c.confirmed) + Number(cl.confirmed),
    completed: Number(c.completed) + Number(cl.completed),
    pending: Number(c.pending) + Number(cl.pending),
    cancelled: Number(c.cancelled) + Number(cl.cancelled),
    revenue: Number(c.revenue) + Number(cl.revenue),
  });
});

// ── Bookings list ────────────────────────────────────────────────────────────
router.get("/bookings-list", async (req, res) => {
  const tenantId = req.tenantId!;
  const { from, to } = parseRange(req.query.from as string, req.query.to as string);
  const limit = Math.min(Number(req.query.limit ?? 50), 200);

  const [court, cls] = await Promise.all([
    db.execute(sql`
      SELECT id, 'quadra' as type, customer_name, customer_email, customer_phone, date, time, amount::numeric as amount, status, created_at
      FROM court_bookings
      WHERE tenant_id=${tenantId} AND (booking_type IS NULL OR booking_type != 'monthly_plan')
        AND created_at>=${from} AND created_at<=${to}
      ORDER BY date DESC, time DESC LIMIT ${limit}
    `),
    db.execute(sql`
      SELECT id, 'aula' as type, customer_name, customer_email, customer_phone, date, time, amount::numeric as amount, status, created_at
      FROM class_bookings
      WHERE tenant_id=${tenantId} AND created_at>=${from} AND created_at<=${to}
      ORDER BY date DESC, time DESC LIMIT ${limit}
    `),
  ]);

  const rows = [...court.rows, ...cls.rows]
    .sort((a: any, b: any) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0))
    .slice(0, limit);

  res.json(rows);
});

// ── Monthly plans ────────────────────────────────────────────────────────────
router.get("/monthly-plans", async (req, res) => {
  const tenantId = req.tenantId!;
  const status = String(req.query.status ?? "active");

  const rows = await db.execute(sql`
    SELECT mp.id, mp.status, mp.type, mp.day_of_week, mp.time, mp.monthly_price::numeric as monthly_price,
           mp.created_at, mp.last_payment_date,
           c.name as client_name, c.email as client_email, c.phone as client_phone
    FROM monthly_plans mp
    JOIN clients c ON c.id = mp.client_id
    WHERE mp.tenant_id=${tenantId} AND mp.status=${status}
    ORDER BY c.name ASC
  `);

  res.json(rows.rows);
});

// ── Clients without active plan ───────────────────────────────────────────────
router.get("/clients-no-plan", async (req, res) => {
  const tenantId = req.tenantId!;

  const rows = await db.execute(sql`
    SELECT c.id, c.name, c.email, c.phone, c.created_at
    FROM clients c
    WHERE c.tenant_id=${tenantId}
      AND NOT EXISTS (
        SELECT 1 FROM monthly_plans mp
        WHERE mp.client_id = c.id AND mp.tenant_id=${tenantId} AND mp.status='active'
      )
    ORDER BY c.name ASC
  `);

  res.json(rows.rows);
});

// ── Top clients by individual bookings ────────────────────────────────────────
router.get("/top-clients", async (req, res) => {
  const tenantId = req.tenantId!;
  const limit = Math.min(Number(req.query.limit ?? 10), 50);
  const { from, to } = parseRange(req.query.from as string, req.query.to as string);

  const rows = await db.execute(sql`
    SELECT customer_name as name, customer_email as email, customer_phone as phone,
           COUNT(*) as total_bookings,
           SUM(CASE WHEN status='confirmed' OR status='pending' THEN 1 ELSE 0 END) as active_bookings,
           COALESCE(SUM(amount::numeric),0) as total_spent
    FROM court_bookings
    WHERE tenant_id=${tenantId}
      AND (booking_type IS NULL OR booking_type != 'monthly_plan')
      AND created_at>=${from} AND created_at<=${to}
    GROUP BY customer_name, customer_email, customer_phone
    ORDER BY total_bookings DESC
    LIMIT ${limit}
  `);

  res.json(rows.rows);
});

// ── Oldest active plan client ────────────────────────────────────────────────
router.get("/oldest-plans", async (req, res) => {
  const tenantId = req.tenantId!;
  const limit = Math.min(Number(req.query.limit ?? 10), 50);

  const rows = await db.execute(sql`
    SELECT c.name as client_name, c.email as client_email, c.phone as client_phone,
           mp.type, mp.monthly_price::numeric as monthly_price,
           mp.day_of_week, mp.time, mp.created_at,
           NOW() - mp.created_at as tenure
    FROM monthly_plans mp
    JOIN clients c ON c.id = mp.client_id
    WHERE mp.tenant_id=${tenantId} AND mp.status='active'
    ORDER BY mp.created_at ASC
    LIMIT ${limit}
  `);

  res.json(rows.rows);
});

// ── Revenue summary ───────────────────────────────────────────────────────────
router.get("/revenue-summary", async (req, res) => {
  const tenantId = req.tenantId!;
  const { from, to } = parseRange(req.query.from as string, req.query.to as string);

  // Mensalistas: filter by billing month (month of session date), not by exact date range
  const fromMonth = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  const toMonth = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));

  const [courtRev, classRev, monthlyRev, tournRev] = await Promise.all([
    db.execute(sql`SELECT COALESCE(SUM(amount::numeric),0) as total FROM court_bookings WHERE tenant_id=${tenantId} AND status!='cancelled' AND (booking_type IS NULL OR booking_type!='monthly_plan') AND created_at>=${from} AND created_at<=${to}`),
    db.execute(sql`SELECT COALESCE(SUM(amount::numeric),0) as total FROM class_bookings WHERE tenant_id=${tenantId} AND status!='cancelled' AND created_at>=${from} AND created_at<=${to}`),
    db.execute(sql`SELECT COALESCE(SUM(amount::numeric),0) as total FROM court_bookings WHERE tenant_id=${tenantId} AND booking_type='monthly_plan' AND status!='cancelled' AND date_trunc('month', date::date) >= ${fromMonth} AND date_trunc('month', date::date) <= ${toMonth}`),
    db.execute(sql`SELECT COALESCE(SUM(price::numeric),0) as total FROM tournament_registrations WHERE tenant_id=${tenantId} AND status='confirmed' AND created_at>=${from} AND created_at<=${to}`),
  ]);

  const court = Number((courtRev.rows[0] as any).total);
  const cls = Number((classRev.rows[0] as any).total);
  const monthly = Number((monthlyRev.rows[0] as any).total);
  const tourn = Number((tournRev.rows[0] as any).total);

  res.json({
    agendamentos_individuais: court,
    aulas: cls,
    mensalistas: monthly,
    torneios: tourn,
    total: court + cls + monthly + tourn,
  });
});

// ── All clients ───────────────────────────────────────────────────────────────
router.get("/all-clients", async (req, res) => {
  const tenantId = req.tenantId!;

  const rows = await db.execute(sql`
    SELECT c.id, c.name, c.email, c.phone, c.created_at,
           COUNT(DISTINCT mp.id) FILTER (WHERE mp.status='active') as active_plans,
           COUNT(DISTINCT cb.id) FILTER (WHERE cb.booking_type IS NULL OR cb.booking_type!='monthly_plan') as individual_bookings
    FROM clients c
    LEFT JOIN monthly_plans mp ON mp.client_id=c.id AND mp.tenant_id=${tenantId}
    LEFT JOIN court_bookings cb ON cb.customer_email=c.email AND cb.tenant_id=${tenantId}
    WHERE c.tenant_id=${tenantId}
    GROUP BY c.id, c.name, c.email, c.phone, c.created_at
    ORDER BY c.name ASC
  `);

  res.json(rows.rows);
});

export default router;
