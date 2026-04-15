import { Router, type IRouter, type Request } from "express";
import { db } from "@workspace/db";
import { settingsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { adminAuth } from "../middlewares/adminAuth.js";
import { testSmtpConnection } from "../lib/email.js";

const router: IRouter = Router();

const ALLOWED_KEYS = [
  "payment_provider",
  "mp_access_token",
  "mp_webhook_secret",
  "picpay_token",
  "picpay_key",
  "app_url",
  "pix_key",
  "court_price_per_hour",
  "class_price_1p",
  "class_price_2p",
  "class_price_3p",
  "class_price_4p",
  "court_pricing_rules",
  "shift_times",
  "open_on_sunday",
  "monthly_court_pricing",
  "monthly_class_pricing",
  "smtp_host",
  "smtp_port",
  "smtp_user",
  "smtp_pass",
  "smtp_from_name",
  "smtp_from_email",
] as const;
type SettingKey = (typeof ALLOWED_KEYS)[number];

export interface CourtPricingRule {
  dayType: "weekday" | "weekend";
  label: string;
  startHour: number;
  endHour: number;
  price: number;
}

export interface ShiftTime {
  hour: number;
  minute: number;
  endHour: number;
  endMinute: number;
}

export interface ShiftTimes {
  weekday: {
    morning: ShiftTime;
    afternoon: ShiftTime;
    night: ShiftTime;
  };
  weekend: {
    morning: ShiftTime;
    afternoon: ShiftTime;
    night: ShiftTime;
  };
}

const DEFAULT_SHIFT_TIMES: ShiftTimes = {
  weekday: {
    morning: { hour: 8, minute: 30, endHour: 12, endMinute: 0 },
    afternoon: { hour: 12, minute: 0, endHour: 18, endMinute: 0 },
    night: { hour: 18, minute: 0, endHour: 22, endMinute: 0 },
  },
  weekend: {
    morning: { hour: 8, minute: 30, endHour: 12, endMinute: 0 },
    afternoon: { hour: 12, minute: 0, endHour: 18, endMinute: 0 },
    night: { hour: 18, minute: 0, endHour: 22, endMinute: 0 },
  },
};

const DEFAULT_COURT_PRICING: CourtPricingRule[] = [
  { dayType: "weekday", label: "Manhã (Seg-Sex)", startHour: 8, endHour: 12, price: 80 },
  { dayType: "weekday", label: "Tarde (Seg-Sex)", startHour: 12, endHour: 18, price: 80 },
  { dayType: "weekday", label: "Noite (Seg-Sex)", startHour: 18, endHour: 22, price: 100 },
  { dayType: "weekend", label: "Manhã (Sáb-Dom)", startHour: 8, endHour: 12, price: 100 },
  { dayType: "weekend", label: "Tarde (Sáb-Dom)", startHour: 12, endHour: 18, price: 100 },
  { dayType: "weekend", label: "Noite (Sáb-Dom)", startHour: 18, endHour: 22, price: 120 },
];

export interface MonthlyCourtPricing {
  weekday: { morning: number; afternoon: number; night: number };
  weekend: { morning: number; afternoon: number; night: number };
}

const DEFAULT_MONTHLY_PRICING: MonthlyCourtPricing = {
  weekday: { morning: 80, afternoon: 80, night: 100 },
  weekend: { morning: 100, afternoon: 100, night: 120 },
};

const DEFAULT_CLASS_PRICING = 60;

// ── Helper: public tenant resolution ─────────────────────────────────────────

export function getPublicTenantId(req: Request): number {
  const h = req.headers["x-tenant-id"] as string | undefined;
  if (h && !isNaN(parseInt(h, 10))) return parseInt(h, 10);
  const q = req.query.tenantId as string | undefined;
  if (q && !isNaN(parseInt(q, 10))) return parseInt(q, 10);
  return req.tenantId ?? 1;
}

// ── Core getters / setters ────────────────────────────────────────────────────

export async function getSetting(key: SettingKey, tenantId = 1): Promise<string | null> {
  const rows = await db.select().from(settingsTable)
    .where(and(eq(settingsTable.tenantId, tenantId), eq(settingsTable.key, key)))
    .limit(1);
  return rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string, tenantId = 1): Promise<void> {
  await db
    .insert(settingsTable)
    .values({ tenantId, key, value })
    .onConflictDoUpdate({
      target: [settingsTable.tenantId, settingsTable.key],
      set: { value, updatedAt: new Date() },
    });
}

async function getSettingNumber(key: SettingKey, defaultValue: number, tenantId = 1): Promise<number> {
  const val = await getSetting(key, tenantId);
  if (!val) return defaultValue;
  const n = parseFloat(val);
  return isNaN(n) ? defaultValue : n;
}

export async function getSettingOrEnv(key: SettingKey, envVar: string, tenantId = 1): Promise<string> {
  const dbValue = await getSetting(key, tenantId);
  if (dbValue) return dbValue;
  if (tenantId <= 1) return process.env[envVar] || "";
  return "";
}

export async function getCourtPricingRules(tenantId = 1): Promise<CourtPricingRule[]> {
  const val = await getSetting("court_pricing_rules", tenantId);
  if (!val) return DEFAULT_COURT_PRICING;
  try {
    const parsed = JSON.parse(val) as CourtPricingRule[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_COURT_PRICING;
  } catch {
    return DEFAULT_COURT_PRICING;
  }
}

export async function isOpenOnSunday(tenantId = 1): Promise<boolean> {
  const val = await getSetting("open_on_sunday", tenantId);
  if (!val) return true;
  return val.toLowerCase() === "true";
}

export async function getMonthlyCourtPricing(tenantId = 1): Promise<MonthlyCourtPricing> {
  const val = await getSetting("monthly_court_pricing", tenantId);
  if (!val) return DEFAULT_MONTHLY_PRICING;
  try {
    return JSON.parse(val) as MonthlyCourtPricing;
  } catch {
    return DEFAULT_MONTHLY_PRICING;
  }
}

export async function getMonthlyClassPricingPerPerson(tenantId = 1): Promise<number> {
  const val = await getSetting("monthly_class_pricing", tenantId);
  if (!val) return DEFAULT_CLASS_PRICING;
  try {
    const n = parseFloat(val);
    return isNaN(n) ? DEFAULT_CLASS_PRICING : n;
  } catch {
    return DEFAULT_CLASS_PRICING;
  }
}

export function getMonthlyPriceForSlot(pricing: MonthlyCourtPricing, dateStr: string, hour: number): number {
  const dow = new Date(dateStr + "T12:00:00").getDay();
  const isWeekend = dow === 0 || dow === 6;
  const dayPricing = isWeekend ? pricing.weekend : pricing.weekday;
  if (hour < 12) return dayPricing.morning;
  if (hour < 18) return dayPricing.afternoon;
  return dayPricing.night;
}

export async function getShiftTimes(tenantId = 1): Promise<ShiftTimes> {
  const val = await getSetting("shift_times", tenantId);
  if (!val) return DEFAULT_SHIFT_TIMES;
  try {
    const parsed = JSON.parse(val) as any;
    if (parsed.morning && !parsed.weekday) {
      return {
        weekday: { morning: parsed.morning, afternoon: parsed.afternoon, night: parsed.night },
        weekend: { morning: parsed.morning, afternoon: parsed.afternoon, night: parsed.night },
      };
    }
    return parsed as ShiftTimes;
  } catch {
    return DEFAULT_SHIFT_TIMES;
  }
}

export function getCourtPriceForSlot(rules: CourtPricingRule[], dateStr: string, hour: number): number {
  const dayOfWeek = new Date(`${dateStr}T12:00:00`).getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const dayType = isWeekend ? "weekend" : "weekday";
  const rule = rules.find((r) => r.dayType === dayType && hour >= r.startHour && hour < r.endHour);
  if (rule) return rule.price;
  const fallback = rules.find((r) => r.dayType === dayType);
  return fallback?.price ?? rules[0]?.price ?? 80;
}

export async function getPrices(tenantId = 1) {
  const [courtPricePerHour, price1p, price2p, price3p, price4p] = await Promise.all([
    getSettingNumber("court_price_per_hour", 80, tenantId),
    getSettingNumber("class_price_1p", 65, tenantId),
    getSettingNumber("class_price_2p", 55, tenantId),
    getSettingNumber("class_price_3p", 50, tenantId),
    getSettingNumber("class_price_4p", 45, tenantId),
  ]);
  return {
    courtPricePerHour,
    classPrices: { 1: price1p, 2: price2p, 3: price3p, 4: price4p } as Record<number, number>,
  };
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /settings/prices — public, no auth
router.get("/prices", async (req, res) => {
  const tenantId = getPublicTenantId(req);
  const prices = await getPrices(tenantId);
  res.json(prices);
});

// GET /settings/court-pricing — public
router.get("/court-pricing", async (req, res) => {
  const tenantId = getPublicTenantId(req);
  const rules = await getCourtPricingRules(tenantId);
  res.json(rules);
});

// PUT /settings/court-pricing — admin only
router.put("/court-pricing", adminAuth, async (req, res) => {
  const tenantId = req.tenantId!;
  const rules = req.body as CourtPricingRule[];
  if (!Array.isArray(rules)) {
    res.status(400).json({ error: "Expected an array of pricing rules" });
    return;
  }
  await setSetting("court_pricing_rules", JSON.stringify(rules), tenantId);
  res.json({ success: true });
});

// GET /settings/shift-times — public
router.get("/shift-times", async (req, res) => {
  const tenantId = getPublicTenantId(req);
  const times = await getShiftTimes(tenantId);
  res.json(times);
});

// PUT /settings/shift-times — admin only
router.put("/shift-times", adminAuth, async (req, res) => {
  const tenantId = req.tenantId!;
  const times = req.body as ShiftTimes;
  if (!times.weekday || !times.weekend) {
    res.status(400).json({ error: "Missing weekday or weekend times" });
    return;
  }
  const validateShift = (shift: any) =>
    typeof shift.hour === "number" && typeof shift.minute === "number" &&
    typeof shift.endHour === "number" && typeof shift.endMinute === "number";
  const validateDayType = (dt: any) =>
    dt.morning && dt.afternoon && dt.night &&
    validateShift(dt.morning) && validateShift(dt.afternoon) && validateShift(dt.night);
  if (!validateDayType(times.weekday) || !validateDayType(times.weekend)) {
    res.status(400).json({ error: "Invalid shift times" });
    return;
  }
  await setSetting("shift_times", JSON.stringify(times), tenantId);

  const existingRules = await getCourtPricingRules(tenantId);
  const periods: Array<"morning" | "afternoon" | "night"> = ["morning", "afternoon", "night"];
  let weekdayIdx = 0;
  let weekendIdx = 0;
  const updatedRules = existingRules.map((rule) => {
    if (rule.dayType === "weekday" && weekdayIdx < periods.length) {
      const period = periods[weekdayIdx++];
      return { ...rule, startHour: times.weekday[period].hour, endHour: times.weekday[period].endHour };
    } else if (rule.dayType === "weekend" && weekendIdx < periods.length) {
      const period = periods[weekendIdx++];
      return { ...rule, startHour: times.weekend[period].hour, endHour: times.weekend[period].endHour };
    }
    return rule;
  });
  await setSetting("court_pricing_rules", JSON.stringify(updatedRules), tenantId);
  res.json({ success: true });
});

// GET /settings (admin only)
router.get("/", adminAuth, async (req, res) => {
  const tenantId = req.tenantId!;
  const rows = await db.select().from(settingsTable).where(eq(settingsTable.tenantId, tenantId));
  const result: Record<string, string> = {};
  const MASKED_KEYS = ["mp_access_token", "mp_webhook_secret", "picpay_token", "picpay_key", "smtp_pass"];
  for (const row of rows) {
    if ((ALLOWED_KEYS as readonly string[]).includes(row.key)) {
      if (row.key === "court_pricing_rules") continue;
      result[row.key] = MASKED_KEYS.includes(row.key)
        ? (row.value ? "●".repeat(8) : "")
        : row.value;
    }
  }
  res.json(result);
});

// PUT /settings (admin only)
router.put("/", adminAuth, async (req, res) => {
  const tenantId = req.tenantId!;
  const body = req.body as Record<string, string>;

  for (const key of ALLOWED_KEYS) {
    if (key === "court_pricing_rules") continue;
    if (key in body && typeof body[key] === "string") {
      const val = body[key].trim();
      if (!val) continue;
      await setSetting(key, val, tenantId);
    }
  }
  res.json({ success: true });
});

// GET /settings/pix-key — public endpoint
router.get("/pix-key", async (req, res) => {
  const tenantId = getPublicTenantId(req);
  const val = await getSetting("pix_key", tenantId);
  res.json({ pix_key: val ?? "" });
});

// GET /settings/smtp-from — public
router.get("/smtp-from", async (req, res) => {
  const tenantId = getPublicTenantId(req);
  const [name, email] = await Promise.all([
    getSetting("smtp_from_name", tenantId),
    getSetting("smtp_from_email", tenantId),
  ]);
  res.json({ smtp_from_name: name ?? "", smtp_from_email: email ?? "" });
});

// GET /settings/open-on-sunday — public
router.get("/open-on-sunday", async (req, res) => {
  const tenantId = getPublicTenantId(req);
  const val = await getSetting("open_on_sunday", tenantId);
  const isOpen = !val || val.toLowerCase() === "true";
  res.json({ open_on_sunday: isOpen });
});

// GET /settings/monthly-court-pricing — public
router.get("/monthly-court-pricing", async (req, res) => {
  const tenantId = getPublicTenantId(req);
  res.json(await getMonthlyCourtPricing(tenantId));
});

// PUT /settings/monthly-court-pricing — admin only
router.put("/monthly-court-pricing", adminAuth, async (req, res) => {
  const tenantId = req.tenantId!;
  await setSetting("monthly_court_pricing", JSON.stringify(req.body), tenantId);
  res.json({ success: true });
});

// GET /settings/smtp — admin only
router.get("/smtp", adminAuth, async (req, res) => {
  const tenantId = req.tenantId!;
  const keys: SettingKey[] = ["smtp_host", "smtp_port", "smtp_user", "smtp_pass", "smtp_from_name", "smtp_from_email"];
  const rows = await db.select().from(settingsTable)
    .where(and(eq(settingsTable.tenantId, tenantId)))
    .then((rs) => rs.filter((r) => keys.includes(r.key as SettingKey)));
  const result: Record<string, string> = {};
  for (const r of rows) {
    result[r.key] = r.key === "smtp_pass" ? (r.value ? "●".repeat(8) : "") : r.value;
  }
  res.json(result);
});

// POST /settings/smtp/test — admin only
router.post("/smtp/test", adminAuth, async (_req, res) => {
  const result = await testSmtpConnection();
  res.json(result);
});

// GET /settings/check — admin only
router.get("/check", adminAuth, async (req, res) => {
  const tenantId = req.tenantId!;
  const rows = await db.select().from(settingsTable).where(eq(settingsTable.tenantId, tenantId));
  const set = new Set(rows.map((r) => r.key));
  const result: Record<string, any> = {};

  const openOnSundayRow = rows.find((r) => r.key === "open_on_sunday");

  for (const key of ALLOWED_KEYS) {
    if (key === "court_pricing_rules") continue;
    if (key === "open_on_sunday") {
      result[key] = openOnSundayRow?.value ?? "true";
      continue;
    }
    result[key] = set.has(key);
  }
  res.json(result);
});

// POST /settings/verify-mp — admin only: validates MP token with a real API call
router.post("/verify-mp", adminAuth, async (req, res) => {
  const tenantId = req.tenantId!;
  const token = await getSetting("mp_access_token", tenantId);
  if (!token) {
    res.json({ valid: false, error: "Token de acesso não configurado" });
    return;
  }
  try {
    const response = await fetch("https://api.mercadopago.com/v1/payment_methods", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.ok) {
      res.json({ valid: true });
    } else {
      const errorBody = await response.text().catch(() => "");
      res.json({ valid: false, error: `Token inválido (HTTP ${response.status})`, details: errorBody.slice(0, 200) });
    }
  } catch (err) {
    res.json({ valid: false, error: "Erro ao conectar com Mercado Pago" });
  }
});

// POST /settings/verify-picpay — admin only: validates PicPay token with a real API call
// Calls the PicPay status API with a dummy referenceId:
//   404 → token valid (payment not found, but auth worked)
//   401/403 → token invalid
router.post("/verify-picpay", adminAuth, async (req, res) => {
  const tenantId = req.tenantId!;
  const token = await getSetting("picpay_token", tenantId);
  if (!token) {
    res.json({ valid: false, error: "Token PicPay não configurado" });
    return;
  }
  try {
    const response = await fetch("https://appws.picpay.com/ecommerce/public/v2/payments/_verify-token-check/status", {
      headers: { "x-picpay-token": token },
    });
    // 404 = token valid, payment simply not found
    // 401/403 = invalid token
    if (response.status === 404 || response.ok) {
      res.json({ valid: true });
    } else if (response.status === 401 || response.status === 403) {
      res.json({ valid: false, error: "Token PicPay inválido ou sem permissão" });
    } else {
      res.json({ valid: false, error: `Resposta inesperada da API PicPay (HTTP ${response.status})` });
    }
  } catch (err) {
    res.json({ valid: false, error: "Erro ao conectar com PicPay" });
  }
});

export default router;
