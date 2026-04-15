import { Router, type IRouter, type Request } from "express";
import { db } from "@workspace/db";
import {
  courtBookingsTable,
  classBookingsTable,
  courtsTable,
  courtSchedulesTable,
  clientsTable,
  couponsTable,
  monthlyPlansTable,
  tenantsTable,
} from "@workspace/db/schema";
import { eq, and, ne, sql, or, isNull, inArray } from "drizzle-orm";
import { getPublicTenantId } from "./settings.js";
import { sendCourtBookingConfirmation, sendClassBookingConfirmation, sendCourtBookingCancellation, sendClassBookingCancellation, sendAdminBookingNotification } from "../lib/email.js";

// Apply coupon to amount: validates, calculates discount, increments usedCount
async function applyCoupon(code: string, originalAmount: number): Promise<{ finalAmount: number; discount: number }> {
  const [coupon] = await db.select().from(couponsTable).where(
    and(eq(couponsTable.code, code.toUpperCase().trim()), or(eq(couponsTable.scope, "booking"), isNull(couponsTable.scope)))
  );
  if (!coupon || !coupon.active) return { finalAmount: originalAmount, discount: 0 };
  if (coupon.expiresAt && new Date() > coupon.expiresAt) return { finalAmount: originalAmount, discount: 0 };
  if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) return { finalAmount: originalAmount, discount: 0 };

  let discount = 0;
  const val = Number(coupon.value);
  if (coupon.type === "percentage") {
    discount = Math.round(originalAmount * val / 100 * 100) / 100;
  } else {
    discount = Math.min(val, originalAmount);
  }
  const finalAmount = Math.max(0, originalAmount - discount);

  // Increment usedCount
  await db.update(couponsTable).set({ usedCount: coupon.usedCount + 1 }).where(eq(couponsTable.id, coupon.id));

  return { finalAmount, discount };
}
// Auto-register customer as client after booking — checks email OR phone to avoid duplicates
async function upsertClientFromBooking(tenantId: number, name: string, email: string, phone: string): Promise<void> {
  try {
    const existing = await db.select({ id: clientsTable.id }).from(clientsTable).where(
      and(
        eq(clientsTable.tenantId, tenantId),
        or(eq(clientsTable.email, email), eq(clientsTable.phone, phone))
      )
    ).limit(1);
    if (existing.length > 0) return;
    await db.insert(clientsTable).values({ tenantId, name, email, phone });
  } catch (err) {
    console.warn("[upsertClientFromBooking] Failed to register client:", err);
  }
}

import { MercadoPagoConfig, Payment } from "mercadopago";
import { adminAuth } from "../middlewares/adminAuth.js";
import { createHmac } from "crypto";
import { getSettingOrEnv, getSetting, getPrices, getCourtPricingRules, getCourtPriceForSlot, getShiftTimes, isOpenOnSunday, getMonthlyCourtPricing, getMonthlyPriceForSlot } from "./settings.js";
import { generatePicPayPix, verifyPicPayPayment, verifyPicPayWebhookToken } from "../lib/picpay.js";

// Returns the price for a slot based on the per-court, per-day schedule.
// Returns null if no schedule is configured for this court+day (caller should fall back to global pricing).
async function getCourtPriceBySchedule(courtNumber: number, dateStr: string, hour: number, tenantId?: number): Promise<number | null> {
  const conditions = [eq(courtsTable.number, courtNumber)];
  if (tenantId) conditions.push(eq(courtsTable.tenantId, tenantId));
  const [court] = await db.select({ id: courtsTable.id }).from(courtsTable).where(and(...conditions));
  if (!court) return null;
  const dayOfWeek = new Date(`${dateStr}T12:00:00`).getDay();
  const [sched] = await db
    .select()
    .from(courtSchedulesTable)
    .where(and(eq(courtSchedulesTable.courtId, court.id), eq(courtSchedulesTable.dayOfWeek, dayOfWeek)));
  if (!sched) return null;
  // Use per-court shift boundaries stored in court_schedules
  const slotMin = hour * 60;
  const afternoonStartMin = sched.afternoonStartHour * 60 + sched.afternoonStartMinute;
  const eveningStartMin = sched.eveningStartHour * 60 + sched.eveningStartMinute;
  if (slotMin < afternoonStartMin) return Number(sched.morningPrice);
  if (slotMin < eveningStartMin) return Number(sched.afternoonPrice);
  return Number(sched.eveningPrice);
}

const router: IRouter = Router();

async function getMpToken(tenantId = 1): Promise<string> {
  return getSettingOrEnv("mp_access_token", "MERCADOPAGO_ACCESS_TOKEN", tenantId);
}

async function getMpWebhookSecret(tenantId = 1): Promise<string> {
  return getSettingOrEnv("mp_webhook_secret", "MERCADOPAGO_WEBHOOK_SECRET", tenantId);
}

async function getMpClient(tenantId = 1): Promise<MercadoPagoConfig> {
  const token = await getMpToken(tenantId);
  return new MercadoPagoConfig({ accessToken: token });
}

async function verifyMpWebhookSignature(req: Request, tenantId = 1): Promise<boolean> {
  const secret = await getMpWebhookSecret(tenantId);
  if (!secret) return true;
  
  const xSignature = req.headers["x-signature"] as string | undefined;
  
  // Accept webhooks without signature (test mode from Mercado Pago dashboard)
  if (!xSignature) return true;
  
  const xRequestId = (req.headers["x-request-id"] ?? "") as string;

  const parts: Record<string, string> = {};
  for (const chunk of xSignature.split(",")) {
    const idx = chunk.indexOf("=");
    if (idx > 0) parts[chunk.slice(0, idx).trim()] = chunk.slice(idx + 1).trim();
  }
  const ts = parts["ts"];
  const v1 = parts["v1"];
  if (!ts || !v1) return true; // Accept if parsing fails (test mode)

  const dataId =
    (req.body as Record<string, unknown>)?.["data"]
      ? ((req.body as Record<string, Record<string, unknown>>)["data"]["id"] ?? "")
      : ((req.query as Record<string, string>)["data.id"] ?? "");

  const message = `id:${dataId};request-id:${xRequestId};ts:${ts}`;
  const expected = createHmac("sha256", secret).update(message).digest("hex");
  
  // Accept if signature matches OR if validation fails (test mode tolerant)
  return expected === v1;
}

// ── PicPay helpers ────────────────────────────────────────────────────────────

async function getPaymentProvider(tenantId = 1): Promise<"mercadopago" | "picpay"> {
  const val = await getSetting("payment_provider", tenantId);
  return val === "picpay" ? "picpay" : "mercadopago";
}

async function getPicPayToken(tenantId = 1): Promise<string> {
  return (await getSetting("picpay_token", tenantId)) ?? "";
}

async function getPicPayKey(tenantId = 1): Promise<string> {
  return (await getSetting("picpay_key", tenantId)) ?? "";
}

/**
 * Unified PIX generator. Returns null if no payment provider is configured
 * (booking proceeds without PIX). Throws on provider API errors.
 */
async function createPixPayment(params: {
  tenantId: number;
  referenceId: string;
  amount: number;
  description: string;
  buyerEmail: string;
  buyerName: string;
  appUrl: string;
  expiresInMs?: number;
  externalReference?: string; // MP only — for plan payments
}): Promise<{ pixQrCode: string; pixQrCodeBase64: string; paymentId: string } | null> {
  const provider = await getPaymentProvider(params.tenantId);

  if (provider === "picpay") {
    const token = await getPicPayToken(params.tenantId);
    if (!token) return null;

    const key = await getPicPayKey(params.tenantId);
    const callbackUrl = params.appUrl
      ? `${params.appUrl}/api/bookings/picpay-webhook${key ? `?token=${encodeURIComponent(key)}` : ""}`
      : "";
    const expiresAt = params.expiresInMs ? new Date(Date.now() + params.expiresInMs) : undefined;
    const nameParts = params.buyerName.trim().split(" ");

    const result = await generatePicPayPix({
      token,
      referenceId: params.referenceId,
      callbackUrl,
      amount: params.amount,
      buyer: {
        firstName: nameParts[0],
        lastName: nameParts.slice(1).join(" ") || "-",
        email: params.buyerEmail,
      },
      expiresAt,
    });

    return {
      pixQrCode: result.pixQrCode,
      pixQrCodeBase64: result.pixQrCodeBase64,
      paymentId: result.referenceId,
    };
  }

  // Mercado Pago
  const mpToken = await getMpToken(params.tenantId);
  if (!mpToken) return null;

  const client = await getMpClient(params.tenantId);
  const paymentClient = new Payment(client);

  const body: Record<string, unknown> = {
    transaction_amount: params.amount,
    payment_method_id: "pix",
    description: params.description,
    payer: {
      email: params.buyerEmail,
      first_name: params.buyerName.split(" ")[0],
      last_name: params.buyerName.split(" ").slice(1).join(" ") || "-",
    },
    notification_url: params.appUrl ? `${params.appUrl}/api/bookings/webhook` : undefined,
  };

  if (params.expiresInMs) {
    body.date_of_expiration = new Date(Date.now() + params.expiresInMs).toISOString();
  }

  if (params.externalReference) {
    body.external_reference = params.externalReference;
  }

  const pixPayment = await paymentClient.create({ body });
  const txData = (pixPayment as unknown as Record<string, unknown>)?.["point_of_interaction"] as Record<string, unknown> | undefined;
  const txDataInner = txData?.["transaction_data"] as Record<string, unknown> | undefined;

  return {
    pixQrCode: (txDataInner?.["qr_code"] as string) ?? "",
    pixQrCodeBase64: (txDataInner?.["qr_code_base64"] as string) ?? "",
    paymentId: String(pixPayment.id ?? ""),
  };
}

const CLASS_OPEN_MIN = 8 * 60 + 30; // 8:30 AM
const CLASS_CLOSE_MIN = 20 * 60;   // 8:00 PM

// Helper to format date as DD/MM/YYYY
function formatDateBR(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}/${y}`;
}

// GET /bookings/availability
router.get("/availability", async (req, res) => {
  const { date, type, courtNumber, monthly } = req.query as { date: string; type: string; courtNumber?: string; monthly?: string };
  const availTenantId = getPublicTenantId(req);

  if (!date || !type) {
    res.status(400).json({ error: "date and type are required" });
    return;
  }

  // Helper to add N weeks to a yyyy-MM-dd string
  const addWeeksToDate = (dateStr: string, weeks: number): string => {
    const d = new Date(`${dateStr}T12:00:00`);
    d.setDate(d.getDate() + weeks * 7);
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const dy = String(d.getDate()).padStart(2, "0");
    return `${y}-${mo}-${dy}`;
  };

  // For monthly mode, check all 4 weekly dates
  const isMonthly = monthly === "true" && type === "futvolei";
  const allDates = isMonthly
    ? [date, addWeeksToDate(date, 1), addWeeksToDate(date, 2), addWeeksToDate(date, 3)]
    : [date];

  // Slot parameters — total minutes from midnight for open/close
  let openTotalMin: number;
  let closeTotalMin: number;

  if (type === "beach_tennis") {
    openTotalMin = CLASS_OPEN_MIN;
    closeTotalMin = CLASS_CLOSE_MIN;
  } else {
    const dayOfWeek = new Date(`${date}T12:00:00`).getDay();
    const courtNum = courtNumber ? Number(courtNumber) : null;

    const isSunday = dayOfWeek === 0;
    const isSaturday = dayOfWeek === 6;

    if (courtNum) {
      const [court] = await db.select({ id: courtsTable.id }).from(courtsTable).where(and(eq(courtsTable.number, courtNum), eq(courtsTable.tenantId, availTenantId)));
      if (!court) {
        // Court doesn't exist for this tenant
        res.json({ date, type, slots: [] });
        return;
      }
      const allScheds = await db
        .select()
        .from(courtSchedulesTable)
        .where(eq(courtSchedulesTable.courtId, court.id));

      if (allScheds.length === 0) {
        // No per-court schedule configured → fall back to global tenant shift times
        const openOnSunday = await isOpenOnSunday(availTenantId);
        if (isSunday && !openOnSunday) {
          res.json({ date, type, slots: [] });
          return;
        }
        const shiftTimes = await getShiftTimes(availTenantId);
        const isWeekend = isSunday || isSaturday;
        const dayShifts = isWeekend ? shiftTimes.weekend : shiftTimes.weekday;
        openTotalMin = dayShifts.morning.hour * 60 + (dayShifts.morning.minute ?? 0);
        closeTotalMin = dayShifts.night.endHour * 60 + (dayShifts.night.endMinute ?? 0);
      } else {
        const sched = allScheds.find(s => s.dayOfWeek === dayOfWeek);
        if (!sched || !sched.isOpen) {
          // No schedule for this day, or explicitly closed
          res.json({ date, type, slots: [] });
          return;
        }
        openTotalMin = sched.openHour * 60 + sched.openMinute;
        closeTotalMin = sched.closeHour * 60 + sched.closeMinute;
      }
    } else {
      // No specific court — use global tenant shift times
      const shiftTimes = await getShiftTimes(availTenantId);
      const openOnSunday = await isOpenOnSunday(availTenantId);

      if (isSunday && !openOnSunday) {
        res.json({ date, type, slots: [] });
        return;
      }

      const isWeekend = isSunday || isSaturday;
      const dayShifts = isWeekend ? shiftTimes.weekend : shiftTimes.weekday;
      openTotalMin = dayShifts.morning.hour * 60 + (dayShifts.morning.minute ?? 0);
      closeTotalMin = dayShifts.night.endHour * 60 + (dayShifts.night.endMinute ?? 0);
    }
  }

  const fmtSlot = (totalMin: number) => {
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  };

  // bookedTimes: union of booked slots across all dates to check
  const bookedTimes = new Set<string>();

  if (type === "futvolei") {
    const courtNum = courtNumber ? Number(courtNumber) : null;
    for (const d of allDates) {
      const conditions = courtNum
        ? and(eq(courtBookingsTable.date, d), eq(courtBookingsTable.courtNumber, courtNum), eq(courtBookingsTable.tenantId, availTenantId))
        : and(eq(courtBookingsTable.date, d), eq(courtBookingsTable.tenantId, availTenantId));

      const bookings = await db
        .select({ time: courtBookingsTable.time, duration: courtBookingsTable.durationHours, status: courtBookingsTable.status })
        .from(courtBookingsTable)
        .where(conditions);

      for (const b of bookings) {
        if (b.status === "cancelled") continue;
        const [bH, bM] = (b.time as string).split(":").map(Number);
        const startMin = bH * 60 + bM;
        for (let i = 0; i < (b.duration ?? 1); i++) {
          bookedTimes.add(fmtSlot(startMin + i * 60));
        }
      }
    }
  } else if (type === "beach_tennis") {
    const bookings = await db
      .select({ time: classBookingsTable.time, status: classBookingsTable.status })
      .from(classBookingsTable)
      .where(and(eq(classBookingsTable.date, date), eq(classBookingsTable.tenantId, availTenantId)));

    for (const b of bookings) {
      if (b.status !== "cancelled") bookedTimes.add(b.time as string);
    }
  }

  const { classPrices } = await getPrices(availTenantId);
  const courtRules = type === "futvolei" ? await getCourtPricingRules(availTenantId) : [];
  const slots = [];

  // Generate slots from openTotalMin stepping by 60 min each time.
  // Include any slot that starts at or before closeTotalMin.
  for (let t = openTotalMin; t <= closeTotalMin; t += 60) {
    const time = fmtSlot(t);
    const h = Math.floor(t / 60);
    let price: number;
    if (type === "beach_tennis") {
      price = classPrices[1];
    } else {
      const schedPrice = courtNumber ? await getCourtPriceBySchedule(Number(courtNumber), date, h, availTenantId) : null;
      price = schedPrice ?? getCourtPriceForSlot(courtRules, date, h);
    }
    slots.push({ time, available: !bookedTimes.has(time), price });
  }

  res.json({ date, type, slots });
});

// POST /bookings/courts
router.post("/courts", async (req, res) => {
  const { date, time, customerName, customerEmail, customerPhone, durationHours = 1, selectedTimes, courtNumber = 1, bookingType = "individual", includeNextMonth, cpf, notes, specificDates, couponCode } = req.body as Record<string, unknown>;

  if (!date || !time || !customerName || !customerEmail || !customerPhone) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }

  const court = Math.min(Math.max(Number(courtNumber) || 1, 1), 4);
  const duration = Number(durationHours) || 1;
  const startHour = Number((time as string).split(":")[0]);
  const tenantId = getPublicTenantId(req);

  // ── MONTHLY BOOKING ─────────────────────────────────────────────────────────
  if (bookingType === "monthly") {
    // Use specificDates from frontend if provided (calendar-month logic),
    // otherwise fall back to generating N consecutive weekly dates.
    let monthlyDates: string[];
    if (Array.isArray(specificDates) && specificDates.length > 0) {
      monthlyDates = specificDates as string[];
    } else {
      const weeksCount = includeNextMonth ? 8 : 4;
      monthlyDates = [];
      const firstDate = new Date((date as string) + "T12:00:00");
      for (let week = 0; week < weeksCount; week++) {
        const d = new Date(firstDate);
        d.setDate(d.getDate() + week * 7);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        monthlyDates.push(`${y}-${m}-${day}`);
      }
    }

    // Validate minimum 4 sessions for monthly booking
    if (monthlyDates.length < 4) {
      res.status(400).json({ error: "Plano mensal requer mínimo 4 sessões" });
      return;
    }

    // Calculate monthly price per session
    const monthlyPricing = await getMonthlyCourtPricing(tenantId);
    const pricePerSession = getMonthlyPriceForSlot(monthlyPricing, date as string, startHour);
    let totalAmount = pricePerSession * monthlyDates.length;

    // Apply coupon discount if provided
    if (couponCode && typeof couponCode === "string") {
      const { finalAmount } = await applyCoupon(couponCode, totalAmount);
      totalAmount = finalAmount;
    }

    // Auto-register customer as client (fire-and-forget, checked later after booking is confirmed)
    void upsertClientFromBooking(getPublicTenantId(req), customerName as string, customerEmail as string, customerPhone as string);
    const monthlyGroupId = `mth-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const appUrl = await getSettingOrEnv("app_url", "APP_URL", tenantId);
    const [tenantRowM] = await db.select({ name: tenantsTable.name }).from(tenantsTable).where(eq(tenantsTable.id, tenantId));
    const tenantNameM = tenantRowM?.name ?? "Arenix";
    let pixQrCode = "";
    let pixQrCodeBase64 = "";
    let mpPaymentId = "";

    try {
      const pix = await createPixPayment({
        tenantId,
        referenceId: monthlyGroupId,
        amount: totalAmount,
        description: `${tenantNameM} - Quadra ${court} - ${formatDateBR(monthlyDates[0])} - ${monthlyDates.length}x ${String(time)}`,
        buyerEmail: customerEmail as string,
        buyerName: customerName as string,
        appUrl,
        expiresInMs: 15 * 60 * 1000,
      });
      if (pix) { pixQrCode = pix.pixQrCode; pixQrCodeBase64 = pix.pixQrCodeBase64; mpPaymentId = pix.paymentId; }
    } catch (err) {
      req.log.error({ err }, "PIX creation failed for monthly booking");
      res.status(503).json({ error: "Serviço de pagamento indisponível. Por favor, tente novamente." });
      return;
    }

    // Insert all 4 bookings in a transaction
    let bookings: typeof courtBookingsTable.$inferSelect[] = [];
    try {
      bookings = await db.transaction(async (tx) => {
        // Check availability for all 4 dates
        for (const d of monthlyDates) {
          const dateNum = parseInt(d.replace(/-/g, ""), 10);
          const lockKey = court * 100000000 + dateNum;
          await tx.execute(sql`SELECT pg_advisory_xact_lock(1, ${lockKey})`);

          const existing = await tx
            .select({ time: courtBookingsTable.time, duration: courtBookingsTable.durationHours })
            .from(courtBookingsTable)
            .where(and(
              eq(courtBookingsTable.date, d),
              eq(courtBookingsTable.courtNumber, court),
              ne(courtBookingsTable.status, "cancelled"),
            ));

          const bookedHours = new Set<number>();
          for (const b of existing) {
            const bHour = Number((b.time as string).split(":")[0]);
            for (let i = 0; i < (b.duration ?? 1); i++) bookedHours.add(bHour + i);
          }
          if (bookedHours.has(startHour)) {
            const [y, mo, dy] = d.split("-");
            throw Object.assign(new Error(`O horário ${String(time)} já está ocupado no dia ${dy}/${mo}/${y}. Escolha outro horário ou data.`), { code: "CONFLICT" });
          }
        }

        const pubTenantId = getPublicTenantId(req);
        const inserted = await tx
          .insert(courtBookingsTable)
          .values(monthlyDates.map((d) => ({
            tenantId: pubTenantId,
            courtNumber: court,
            date: d,
            time: time as string,
            customerName: customerName as string,
            customerEmail: customerEmail as string,
            customerPhone: customerPhone as string,
            durationHours: 1,
            amount: String(pricePerSession),
            status: "pending" as const,
            mercadoPagoPreferenceId: mpPaymentId || null,
            bookingType: "monthly",
            monthlyGroupId,
          })))
          .returning();
        return inserted;
      });
    } catch (err) {
      const e = err as { code?: string; message?: string };
      if (e?.code === "CONFLICT") {
        res.status(409).json({ error: e.message ?? "Horário não disponível para o plano mensal." });
        return;
      }
      req.log.error({ err }, "Monthly court booking transaction failed");
      res.status(500).json({ error: "Erro ao processar agendamento mensal. Tente novamente." });
      return;
    }

    if (!bookings || bookings.length === 0) {
      res.status(409).json({ error: "Um ou mais horários já estão reservados. Por favor, escolha outro horário." });
      return;
    }

    res.status(201).json({
      bookingId: bookings[0].id,
      bookingIds: bookings.map((b) => b.id),
      monthlyGroupId,
      monthlyDates,
      pixQrCode,
      pixQrCodeBase64,
      amount: totalAmount,
      status: bookings[0].status,
    });
    return;
  }

  // ── INDIVIDUAL BOOKING ──────────────────────────────────────────────────────
  const courtRules = await getCourtPricingRules(tenantId);

  // Determine individual time slots sent by the frontend
  const timesToBook: string[] =
    Array.isArray(selectedTimes) && (selectedTimes as string[]).length > 0
      ? (selectedTimes as string[])
      : Array.from({ length: duration }, (_, i) => {
          const h = startHour + i;
          return `${String(h).padStart(2, "0")}:00`;
        });

  // Helper: convert "HH:MM" to total minutes
  const toMins = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + (m || 0);
  };

  // Calculate base price per individual slot (1h each)
  const slotPrices: { time: string; baseAmount: number }[] = [];
  for (const t of timesToBook) {
    const h = parseInt(t.split(":")[0], 10);
    const schedPrice = await getCourtPriceBySchedule(court, date as string, h, tenantId);
    slotPrices.push({ time: t, baseAmount: schedPrice ?? getCourtPriceForSlot(courtRules, date as string, h) });
  }

  // Group consecutive slots (exactly 60 min apart) into a single booking
  // e.g. [08:30, 09:30] → 1 booking of 2h; [08:30, 16:00] → 2 bookings of 1h each
  const sortedSlots = [...slotPrices].sort((a, b) => toMins(a.time) - toMins(b.time));
  const bookingGroups: { time: string; durationHours: number; baseAmount: number }[] = [];
  for (const slot of sortedSlots) {
    const last = bookingGroups[bookingGroups.length - 1];
    if (last && toMins(slot.time) - (toMins(last.time) + last.durationHours * 60) === 0) {
      last.durationHours += 1;
      last.baseAmount += slot.baseAmount;
    } else {
      bookingGroups.push({ time: slot.time, durationHours: 1, baseAmount: slot.baseAmount });
    }
  }

  const baseTotal = bookingGroups.reduce((s, g) => s + g.baseAmount, 0);

  let amount = baseTotal;
  // Apply coupon discount to total if provided
  if (couponCode && typeof couponCode === "string") {
    const { finalAmount } = await applyCoupon(couponCode as string, amount);
    amount = finalAmount;
  }
  // Proportional discount ratio to distribute across slots
  const discountRatio = baseTotal > 0 ? amount / baseTotal : 1;

  const appUrl = await getSettingOrEnv("app_url", "APP_URL", tenantId);
  const [tenantRowC] = await db.select({ name: tenantsTable.name }).from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  const tenantNameC = tenantRowC?.name ?? "Arenix";
  const courtRefId = `court-${tenantId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  let pixQrCode = "";
  let pixQrCodeBase64 = "";
  let mpPaymentId = "";

  try {
    const pix = await createPixPayment({
      tenantId,
      referenceId: courtRefId,
      amount,
      description: `${tenantNameC} - Quadra ${court} - ${formatDateBR(date as string)} - ${timesToBook.join(", ")}`,
      buyerEmail: customerEmail as string,
      buyerName: customerName as string,
      appUrl,
      expiresInMs: 15 * 60 * 1000,
    });
    if (pix) { pixQrCode = pix.pixQrCode; pixQrCodeBase64 = pix.pixQrCodeBase64; mpPaymentId = pix.paymentId; }
  } catch (err) {
    req.log.error({ err }, "PIX creation failed for court booking");
    res.status(503).json({ error: "Serviço de pagamento indisponível. Por favor, tente novamente." });
    return;
  }

  // Create ONE booking per time slot inside a single transaction
  let bookings: (typeof courtBookingsTable.$inferSelect)[] = [];
  try {
    bookings = await db.transaction(async (tx) => {
      const dateNum = parseInt((date as string).replace(/-/g, ""), 10);
      const lockKey = court * 100000000 + dateNum;
      await tx.execute(sql`SELECT pg_advisory_xact_lock(1, ${lockKey})`);

      const existing = await tx
        .select({ time: courtBookingsTable.time, duration: courtBookingsTable.durationHours })
        .from(courtBookingsTable)
        .where(and(
          eq(courtBookingsTable.date, date as string),
          eq(courtBookingsTable.courtNumber, court),
          ne(courtBookingsTable.status, "cancelled"),
        ));

      const bookedHours = new Set<number>();
      for (const b of existing) {
        const bHour = Number((b.time as string).split(":")[0]);
        for (let i = 0; i < (Number(b.duration) || 1); i++) bookedHours.add(bHour + i);
      }

      // Check every individual slot for conflicts (before grouping)
      for (const slot of sortedSlots) {
        const h = parseInt(slot.time.split(":")[0], 10);
        if (bookedHours.has(h)) {
          throw { code: "CONFLICT", time: slot.time };
        }
      }

      // Insert one booking per consecutive group
      const inserted: (typeof courtBookingsTable.$inferSelect)[] = [];
      for (const group of bookingGroups) {
        const groupAmount = Math.round(group.baseAmount * discountRatio * 100) / 100;
        const [ins] = await tx
          .insert(courtBookingsTable)
          .values({
            tenantId: getPublicTenantId(req),
            courtNumber: court,
            date: date as string,
            time: group.time,
            customerName: customerName as string,
            customerEmail: customerEmail as string,
            customerPhone: customerPhone as string,
            durationHours: group.durationHours,
            amount: String(groupAmount),
            status: "pending",
            mercadoPagoPreferenceId: mpPaymentId || null,
            bookingType: "individual",
          })
          .returning();
        inserted.push(ins);
      }
      return inserted;
    });
  } catch (err) {
    const e = err as { code?: string; time?: string };
    if (e?.code === "CONFLICT") {
      res.status(409).json({ error: `Horário ${e.time ?? ""} já reservado. Por favor, escolha outro horário.` });
      return;
    }
    req.log.error({ err }, "Court booking transaction failed");
    res.status(500).json({ error: "Erro ao processar agendamento. Tente novamente." });
    return;
  }

  if (bookings.length === 0) {
    res.status(409).json({ error: "Horário já reservado. Por favor, escolha outro horário." });
    return;
  }

  // Auto-register customer as client (fire-and-forget)
  void upsertClientFromBooking(getPublicTenantId(req), customerName as string, customerEmail as string, customerPhone as string);

  res.status(201).json({
    bookingId: bookings[0].id,
    bookingIds: bookings.map(b => b.id),
    pixQrCode,
    pixQrCodeBase64,
    amount,
    status: bookings[0].status,
  });
  // Email de confirmação enviado apenas após confirmação do pagamento (webhook ou admin)
});

// GET /bookings/courts (admin only)
router.get("/courts", adminAuth, async (req, res) => {
  const tenantId = req.tenantId!;
  const bookings = await db
    .select({
      ...courtBookingsTable,
      courtName: courtsTable.name,
    })
    .from(courtBookingsTable)
    .leftJoin(courtsTable, and(eq(courtBookingsTable.courtNumber, courtsTable.number), eq(courtsTable.tenantId, tenantId)))
    .where(eq(courtBookingsTable.tenantId, tenantId))
    .orderBy(courtBookingsTable.createdAt);

  res.json(
    bookings.map((b) => ({
      ...b,
      amount: Number(b.amount),
      createdAt: b.createdAt.toISOString(),
    }))
  );
});

// GET /bookings/courts/:id (admin only)
router.get("/courts/:id", adminAuth, async (req, res) => {
  const id = Number(req.params.id);
  const [booking] = await db
    .select()
    .from(courtBookingsTable)
    .where(and(eq(courtBookingsTable.id, id), eq(courtBookingsTable.tenantId, req.tenantId!)));

  if (!booking) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  res.json({ ...booking, amount: Number(booking.amount), createdAt: booking.createdAt.toISOString() });
});

// POST /bookings/classes
router.post("/classes", async (req, res) => {
  const { date, time, customerName, customerEmail, customerPhone, numberOfPeople, isMonthly, specificDates, cpf, notes, couponCode } = req.body as Record<string, unknown>;

  if (!date || !time || !customerName || !customerEmail || !customerPhone || !numberOfPeople) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }

  const n = Number(numberOfPeople);
  if (!Number.isInteger(n) || n < 1 || n > 4) {
    res.status(400).json({ error: "Número de pessoas deve ser entre 1 e 4." });
    return;
  }

  const tenantId = getPublicTenantId(req);

  // Monthly booking: validate specific dates
  let classBookingDates: string[] = [date as string];
  if (isMonthly && Array.isArray(specificDates) && specificDates.length > 0) {
    classBookingDates = specificDates as string[];
    if (classBookingDates.length < 4) {
      res.status(400).json({ error: "Plano mensal requer mínimo 4 sessões" });
      return;
    }
  }

  const { classPrices } = await getPrices(tenantId);
  const pricePerPerson = classPrices[n] ?? 65;
  let amount = pricePerPerson * n * classBookingDates.length;

  // Apply coupon discount if provided
  if (couponCode && typeof couponCode === "string") {
    const { finalAmount } = await applyCoupon(couponCode, amount);
    amount = finalAmount;
  }

  const appUrl = await getSettingOrEnv("app_url", "APP_URL", tenantId);
  const classRefId = `class-${tenantId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  let pixQrCode = "";
  let pixQrCodeBase64 = "";
  let mpPaymentId = "";

  try {
    const pix = await createPixPayment({
      tenantId,
      referenceId: classRefId,
      amount,
      description: `Beach Tennis${isMonthly ? ` - Plano ${classBookingDates.length}x` : ""} - ${String(time)} - ${n} pessoa${n > 1 ? "s" : ""}`,
      buyerEmail: customerEmail as string,
      buyerName: customerName as string,
      appUrl,
      expiresInMs: 15 * 60 * 1000,
    });
    if (pix) { pixQrCode = pix.pixQrCode; pixQrCodeBase64 = pix.pixQrCodeBase64; mpPaymentId = pix.paymentId; }
  } catch (err) {
    req.log.error({ err }, "PIX creation failed for class booking");
    res.status(503).json({ error: "Serviço de pagamento indisponível. Por favor, tente novamente." });
    return;
  }

  let classBooking: typeof classBookingsTable.$inferSelect | null = null;
  try {
    classBooking = await db.transaction(async (tx) => {
      // Lock all dates to avoid race conditions
      for (const d of classBookingDates) {
        const dateNum = parseInt(d.replace(/-/g, ""), 10);
        await tx.execute(sql`SELECT pg_advisory_xact_lock(2, ${dateNum})`);
      }

      // Check if any date/time combo is already booked
      for (const d of classBookingDates) {
        const existing = await tx
          .select({ time: classBookingsTable.time })
          .from(classBookingsTable)
          .where(and(eq(classBookingsTable.date, d), ne(classBookingsTable.status, "cancelled")));

        if (existing.some((b) => b.time === time)) return null;
      }

      // Create bookings for each date
      const bookings = [];
      for (const d of classBookingDates) {
        const [inserted] = await tx
          .insert(classBookingsTable)
          .values({
            tenantId: getPublicTenantId(req),
            date: d,
            time: time as string,
            customerName: customerName as string,
            customerEmail: customerEmail as string,
            customerPhone: customerPhone as string,
            numberOfPeople: n,
            amount: String(pricePerPerson * n),
            status: "pending",
            mercadoPagoPreferenceId: mpPaymentId || null,
          })
          .returning();
        bookings.push(inserted);
      }
      
      // Return the first booking as the "main" one
      return bookings[0] ?? null;
    });
  } catch (err) {
    req.log.error({ err }, "Class booking transaction failed");
    res.status(500).json({ error: "Erro ao processar agendamento. Tente novamente." });
    return;
  }

  if (!classBooking) {
    res.status(409).json({ error: "Horário já reservado. Por favor, escolha outro horário." });
    return;
  }

  // Auto-register customer as client (fire-and-forget)
  void upsertClientFromBooking(getPublicTenantId(req), customerName as string, customerEmail as string, customerPhone as string);

  res.status(201).json({
    bookingId: classBooking.id,
    pixQrCode,
    pixQrCodeBase64,
    amount,
    status: classBooking.status,
  });
  // Email de confirmação enviado apenas após confirmação do pagamento (webhook ou admin)
});

// GET /bookings/classes (admin only)
router.get("/classes", adminAuth, async (req, res) => {
  const tenantId = req.tenantId!;
  const bookings = await db
    .select()
    .from(classBookingsTable)
    .where(eq(classBookingsTable.tenantId, tenantId))
    .orderBy(classBookingsTable.createdAt);

  res.json(
    bookings.map((b) => ({
      ...b,
      amount: Number(b.amount),
      createdAt: b.createdAt.toISOString(),
    }))
  );
});

// GET /bookings/classes/:id (admin only)
router.get("/classes/:id", adminAuth, async (req, res) => {
  const id = Number(req.params.id);
  const [booking] = await db
    .select()
    .from(classBookingsTable)
    .where(and(eq(classBookingsTable.id, id), eq(classBookingsTable.tenantId, req.tenantId!)));

  if (!booking) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  res.json({ ...booking, amount: Number(booking.amount), createdAt: booking.createdAt.toISOString() });
});

// POST /bookings/webhook - Mercado Pago webhook
// Test webhook (no auth required) - for debugging
router.post("/webhook/test", async (req, res) => {
  req.log.info("Test webhook received", { body: req.body, headers: req.headers });
  res.json({ success: true, received: true });
});

// POST /bookings/picpay-webhook — PicPay payment notification
// PicPay sends: { referenceId, authorizationId, status: { code, message }, requesterName }
// Status codes: 103 = Paid, 104 = Completed
router.post("/picpay-webhook", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const referenceId = body["referenceId"] as string | undefined;
  const statusCode = (body["status"] as Record<string, unknown> | undefined)?.["code"] as number | undefined;

  req.log.info({ referenceId, statusCode }, "PicPay webhook received");

  // Always respond 200 to PicPay immediately
  res.status(200).json({ ok: true });

  if (!referenceId || (statusCode !== 103 && statusCode !== 104)) return;

  try {
    // Resolve tenant by looking up booking or plan
    let webhookTenantId = 1;
    const [courtMatch] = await db.select({ tenantId: courtBookingsTable.tenantId })
      .from(courtBookingsTable)
      .where(eq(courtBookingsTable.mercadoPagoPreferenceId, referenceId))
      .limit(1);
    if (courtMatch) {
      webhookTenantId = courtMatch.tenantId;
    } else {
      const [classMatch] = await db.select({ tenantId: classBookingsTable.tenantId })
        .from(classBookingsTable)
        .where(eq(classBookingsTable.mercadoPagoPreferenceId, referenceId))
        .limit(1);
      if (classMatch) {
        webhookTenantId = classMatch.tenantId;
      } else if (referenceId.startsWith("plan-")) {
        const planId = Number(referenceId.replace("plan-", ""));
        if (!isNaN(planId)) {
          const [plan] = await db.select({ tenantId: monthlyPlansTable.tenantId }).from(monthlyPlansTable).where(eq(monthlyPlansTable.id, planId)).limit(1);
          if (plan) webhookTenantId = plan.tenantId;
        }
      }
    }

    // Verify token
    const incomingToken = req.query["token"] as string | undefined;
    const expectedToken = await getPicPayKey(webhookTenantId);
    if (!verifyPicPayWebhookToken(incomingToken, expectedToken || null)) {
      req.log.warn({ referenceId, webhookTenantId }, "PicPay webhook token invalid — ignoring");
      return;
    }

    // Verify payment via PicPay API
    const picpayToken = await getPicPayToken(webhookTenantId);
    if (!picpayToken) {
      req.log.warn({ referenceId }, "PicPay webhook: no token configured");
      return;
    }
    const isPaid = await verifyPicPayPayment(picpayToken, referenceId);
    if (!isPaid) {
      req.log.warn({ referenceId }, "PicPay payment not confirmed by API");
      return;
    }

    // ── Plan payment ────────────────────────────────────────────────────────
    if (referenceId.startsWith("plan-")) {
      const planId = Number(referenceId.replace("plan-", ""));
      if (isNaN(planId)) return;

      const [plan] = await db.select().from(monthlyPlansTable).where(eq(monthlyPlansTable.id, planId));
      if (!plan || (plan.status !== "pending_payment" && plan.status !== "active")) return;

      const getNowBrasilia = () => {
        const brt = new Date(new Date().getTime() - 3 * 60 * 60 * 1000);
        return { year: brt.getUTCFullYear(), month: brt.getUTCMonth(), day: brt.getUTCDate(), hour: brt.getUTCHours(), minute: brt.getUTCMinutes() };
      };

      const brt = getNowBrasilia();

      if (plan.status === "pending_payment") {
        const targetMonth = `${brt.year}-${String(brt.month + 1).padStart(2, "0")}`;
        // Confirm all pre-created pending bookings for this plan
        const [createdLog] = await db.select().from(monthlyReservationsLogTable)
          .where(and(eq(monthlyReservationsLogTable.monthlyPlanId, planId), eq(monthlyReservationsLogTable.status, "created")))
          .orderBy(monthlyReservationsLogTable.id).limit(1);
        const allBookingIds: number[] = createdLog ? JSON.parse(createdLog.bookingIds as string) : [];
        if (allBookingIds.length > 0) {
          if (plan.type === "court") {
            await db.update(courtBookingsTable).set({ status: "confirmed" }).where(and(inArray(courtBookingsTable.id, allBookingIds), eq(courtBookingsTable.status, "pending")));
          } else {
            await db.update(classBookingsTable).set({ status: "confirmed" }).where(and(inArray(classBookingsTable.id, allBookingIds), eq(classBookingsTable.status, "pending")));
          }
        }
        await db.insert(monthlyReservationsLogTable).values({ monthlyPlanId: planId, bookingIds: JSON.stringify([]), month: targetMonth, status: "paid", paymentMethod: "pix", paidAt: new Date() });
        await db.update(monthlyPlansTable).set({ status: "active", paymentExpiresAt: null }).where(eq(monthlyPlansTable.id, planId));
        req.log.info({ planId, referenceId }, "Monthly plan activated via PicPay webhook");
      } else {
        const nextM = brt.month === 11 ? 0 : brt.month + 1;
        const nextY = brt.month === 11 ? brt.year + 1 : brt.year;
        const nextMonthKey = `${nextY}-${String(nextM + 1).padStart(2, "0")}`;
        const [existingLog] = await db.select({ id: monthlyReservationsLogTable.id }).from(monthlyReservationsLogTable).where(and(eq(monthlyReservationsLogTable.monthlyPlanId, planId), eq(monthlyReservationsLogTable.month, nextMonthKey)));
        if (!existingLog) {
          await db.insert(monthlyReservationsLogTable).values({ monthlyPlanId: planId, bookingIds: JSON.stringify([]), month: nextMonthKey, status: "paid", paymentMethod: "pix", paidAt: new Date() });
          await db.update(monthlyPlansTable).set({ paymentExpiresAt: null }).where(eq(monthlyPlansTable.id, planId));
          req.log.info({ planId, referenceId, nextMonthKey }, "Monthly plan renewed via PicPay webhook");
        }
      }
      return;
    }

    // ── Booking payment ─────────────────────────────────────────────────────
    const courtBookingGroup = await db.select().from(courtBookingsTable).where(eq(courtBookingsTable.mercadoPagoPreferenceId, referenceId));
    const courtBooking = courtBookingGroup[0] ?? null;

    if (courtBooking) {
      if (courtBooking.status !== "pending") return;
      if (courtBooking.monthlyGroupId) {
        await db.update(courtBookingsTable).set({ status: "confirmed", paymentId: referenceId }).where(eq(courtBookingsTable.monthlyGroupId, courtBooking.monthlyGroupId));
      } else {
        await db.update(courtBookingsTable).set({ status: "confirmed", paymentId: referenceId }).where(eq(courtBookingsTable.mercadoPagoPreferenceId, referenceId));
      }
      const courtEmail = courtBooking.customerEmail ?? "";
      if (courtEmail && !courtEmail.endsWith("@manual.azuos")) {
        const sortedGroup = [...courtBookingGroup].sort((a, b) => (a.time as string).localeCompare(b.time as string));
        void sendCourtBookingConfirmation({
          customerName: courtBooking.customerName,
          customerEmail: courtEmail,
          date: courtBooking.date,
          time: sortedGroup[0]?.time ?? courtBooking.time,
          durationHours: sortedGroup.reduce((s, b) => s + Number(b.durationHours ?? 1), 0),
          courtNumber: courtBooking.courtNumber ?? 1,
          amount: sortedGroup.reduce((s, b) => s + Number(b.amount ?? 0), 0),
          bookingId: courtBooking.id,
          tenantId: webhookTenantId,
          slots: sortedGroup.map(b => ({ time: b.time as string, durationHours: Number(b.durationHours ?? 1) })),
        });
      }
      void sendAdminBookingNotification({ tenantId: webhookTenantId, bookingId: courtBooking.id, type: "court", customerName: courtBooking.customerName, date: courtBooking.date, time: courtBooking.time, amount: Number(courtBooking.amount ?? 0), courtName: `Quadra ${courtBooking.courtNumber ?? 1}` });
      req.log.info({ referenceId, bookingId: courtBooking.id }, "Court booking confirmed via PicPay webhook");
      return;
    }

    const [classBooking] = await db.select().from(classBookingsTable).where(eq(classBookingsTable.mercadoPagoPreferenceId, referenceId));
    if (classBooking) {
      if (classBooking.status !== "pending") return;
      await db.update(classBookingsTable).set({ status: "confirmed", paymentId: referenceId }).where(eq(classBookingsTable.mercadoPagoPreferenceId, referenceId));
      const classEmail = classBooking.customerEmail ?? "";
      if (classEmail && !classEmail.endsWith("@manual.azuos")) {
        void sendClassBookingConfirmation({
          customerName: classBooking.customerName,
          customerEmail: classEmail,
          date: classBooking.date,
          time: classBooking.time,
          numberOfPeople: classBooking.numberOfPeople ?? 1,
          amount: Number(classBooking.amount ?? 0),
          bookingId: classBooking.id,
          tenantId: webhookTenantId,
        });
      }
      void sendAdminBookingNotification({ tenantId: webhookTenantId, bookingId: classBooking.id, type: "class", customerName: classBooking.customerName, date: classBooking.date, time: classBooking.time, amount: Number(classBooking.amount ?? 0), numberOfPeople: classBooking.numberOfPeople ?? 1 });
      req.log.info({ referenceId, bookingId: classBooking.id }, "Class booking confirmed via PicPay webhook");
    }
  } catch (err) {
    req.log.error({ err, referenceId }, "Error processing PicPay webhook");
  }
});

// Debug endpoint - check if config is loaded
router.get("/debug/config", async (req, res) => {
  const tid = getPublicTenantId(req);
  const token = await getMpToken(tid);
  const secret = await getMpWebhookSecret(tid);
  res.json({
    tenantId: tid,
    hasAccessToken: !!token,
    accessTokenLength: token.length,
    hasWebhookSecret: !!secret,
    webhookSecretLength: secret.length,
  });
});

router.post("/webhook", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const type = (body["type"] ?? body["topic"]) as string | undefined;
  const dataId = ((body["data"] as Record<string, unknown>)?.["id"] ?? body["id"]) as string | undefined;
  
  req.log.info({ type, dataId, hasSignature: !!req.headers["x-signature"] }, "MercadoPago webhook received");

  try {
    let webhookTenantId = req.tenantId ?? 1;
    if (dataId) {
      const [courtMatch] = await db.select({ tenantId: courtBookingsTable.tenantId })
        .from(courtBookingsTable)
        .where(eq(courtBookingsTable.mercadoPagoPreferenceId, String(dataId)))
        .limit(1);
      if (courtMatch) {
        webhookTenantId = courtMatch.tenantId;
      } else {
        const [classMatch] = await db.select({ tenantId: classBookingsTable.tenantId })
          .from(classBookingsTable)
          .where(eq(classBookingsTable.mercadoPagoPreferenceId, String(dataId)))
          .limit(1);
        if (classMatch) webhookTenantId = classMatch.tenantId;
      }
    }
    req.log.info({ webhookTenantId, dataId }, "Webhook resolved tenant");

    if (!(await verifyMpWebhookSignature(req, webhookTenantId))) {
      req.log.warn({ type, dataId, webhookTenantId }, "MercadoPago webhook signature invalid — but still processing");
    }

    const mpToken = await getMpToken(webhookTenantId);
    if ((type === "payment" || type === "payment_id") && dataId && mpToken) {
      const client = await getMpClient(webhookTenantId);
      const paymentClient = new Payment(client);
      const payment = await paymentClient.get({ id: dataId });

      if (payment.status === "approved") {
        const paymentIdStr = String(dataId);
        const externalRef = payment.external_reference as string | undefined;

        // Check if this is a monthly plan payment (external_reference: plan-${planId})
        if (externalRef && externalRef.startsWith("plan-")) {
          const planId = Number(externalRef.replace("plan-", ""));
          if (!isNaN(planId)) {
            const [plan] = await db
              .select()
              .from(monthlyPlansTable)
              .where(eq(monthlyPlansTable.id, planId));

            if (plan && (plan.status === "pending_payment" || plan.status === "active")) {
              const [client] = await db
                .select()
                .from(clientsTable)
                .where(eq(clientsTable.id, plan.clientId));

              if (client) {
                // Inline date helpers (copied from clients.ts)
                const formatDate = (date: Date): string => {
                  const y = date.getFullYear();
                  const m = String(date.getMonth() + 1).padStart(2, "0");
                  const d = String(date.getDate()).padStart(2, "0");
                  return `${y}-${m}-${d}`;
                };

                const getNowBrasilia = () => {
                  const BRASILIA_OFFSET_MS = 3 * 60 * 60 * 1000;
                  const nowUTC = new Date();
                  const brt = new Date(nowUTC.getTime() - BRASILIA_OFFSET_MS);
                  return {
                    year: brt.getUTCFullYear(),
                    month: brt.getUTCMonth(),
                    day: brt.getUTCDate(),
                    hour: brt.getUTCHours(),
                    minute: brt.getUTCMinutes(),
                  };
                };

                const getRemainingDaysOfMonth = (): { dates: Date[]; targetMonth: string } => {
                  const [planHour, planMinute] = (plan.time as string).split(":").map(Number);
                  const brt = getNowBrasilia();
                  const currentMonth = brt.month;
                  const currentYear = brt.year;
                  const currentDates: Date[] = [];
                  const dateIterator = new Date(currentYear, currentMonth, brt.day);

                  while (dateIterator.getMonth() === currentMonth) {
                    if (dateIterator.getDay() === plan.dayOfWeek) {
                      const d = dateIterator.getDate();
                      const planIsInFuture = d > brt.day || (d === brt.day && (planHour > brt.hour || (planHour === brt.hour && planMinute > brt.minute)));
                      if (planIsInFuture) {
                        currentDates.push(new Date(currentYear, currentMonth, d));
                      }
                    }
                    dateIterator.setDate(dateIterator.getDate() + 1);
                  }

                  if (currentDates.length > 0) {
                    const tm = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}`;
                    return { dates: currentDates, targetMonth: tm };
                  }

                  const nextMonth = currentMonth === 11 ? 0 : currentMonth + 1;
                  const nextYear = currentMonth === 11 ? currentYear + 1 : currentYear;
                  const nextDates: Date[] = [];
                  const nextDateIterator = new Date(nextYear, nextMonth, 1);

                  while (nextDateIterator.getMonth() === nextMonth) {
                    if (nextDateIterator.getDay() === plan.dayOfWeek) {
                      nextDates.push(new Date(nextYear, nextMonth, nextDateIterator.getDate()));
                    }
                    nextDateIterator.setDate(nextDateIterator.getDate() + 1);
                  }

                  const tm = `${nextYear}-${String(nextMonth + 1).padStart(2, "0")}`;
                  return { dates: nextDates, targetMonth: tm };
                };

                const hasCourtConflict = async (dateStr: string, courtNumber: number, time: string, durationHours: number): Promise<boolean> => {
                  const [newH, newM] = time.split(":").map(Number);
                  const newStartMin = newH * 60 + newM;
                  const newEndMin = newStartMin + durationHours * 60;
                  const existing = await db.select().from(courtBookingsTable).where(and(eq(courtBookingsTable.date, dateStr), eq(courtBookingsTable.courtNumber, courtNumber), eq(courtBookingsTable.tenantId, webhookTenantId), ne(courtBookingsTable.status, "cancelled")));
                  for (const b of existing) {
                    const [eH, eM] = b.time.split(":").map(Number);
                    const eStartMin = eH * 60 + eM;
                    const eDur = b.durationHours ?? 1;
                    const eEndMin = eStartMin + eDur * 60;
                    if (newStartMin < eEndMin && newEndMin > eStartMin) {
                      return true;
                    }
                  }
                  return false;
                };

                const hasClassConflict = async (dateStr: string, time: string): Promise<boolean> => {
                  const existing = await db.select().from(classBookingsTable).where(and(eq(classBookingsTable.date, dateStr), eq(classBookingsTable.time, time), eq(classBookingsTable.tenantId, webhookTenantId), ne(classBookingsTable.status, "cancelled")));
                  return existing.length > 0;
                };

                // All year bookings were pre-created at plan creation (status: "pending").
                // Payment just confirms the target month's bookings and logs the payment.
                const [createdLog] = await db
                  .select()
                  .from(monthlyReservationsLogTable)
                  .where(and(
                    eq(monthlyReservationsLogTable.monthlyPlanId, planId),
                    eq(monthlyReservationsLogTable.status, "created")
                  ))
                  .orderBy(monthlyReservationsLogTable.id)
                  .limit(1);

                const allBookingIds: number[] = createdLog
                  ? JSON.parse(createdLog.bookingIds as string)
                  : [];

                // Helper: confirm ALL pre-created pending bookings (entire year) on first activation
                const confirmAllBookings = async (): Promise<number> => {
                  if (allBookingIds.length === 0) return 0;
                  if (plan.type === "court") {
                    const result = await db
                      .update(courtBookingsTable)
                      .set({ status: "confirmed" })
                      .where(and(
                        inArray(courtBookingsTable.id, allBookingIds),
                        eq(courtBookingsTable.status, "pending")
                      ))
                      .returning();
                    return result.length;
                  } else {
                    const result = await db
                      .update(classBookingsTable)
                      .set({ status: "confirmed" })
                      .where(and(
                        inArray(classBookingsTable.id, allBookingIds),
                        eq(classBookingsTable.status, "pending")
                      ))
                      .returning();
                    return result.length;
                  }
                };

                const brt = getNowBrasilia();

                if (plan.status === "pending_payment") {
                  // ── CASE A: First-time activation ── confirm ALL year bookings at once
                  const targetMonth = `${brt.year}-${String(brt.month + 1).padStart(2, "0")}`;
                  const confirmedCount = await confirmAllBookings();

                  await db.insert(monthlyReservationsLogTable).values({
                    monthlyPlanId: planId,
                    bookingIds: JSON.stringify([]),
                    month: targetMonth,
                    status: "paid",
                    paymentMethod: "pix",
                    paidAt: new Date(),
                  });

                  await db
                    .update(monthlyPlansTable)
                    .set({ status: "active", paymentExpiresAt: null })
                    .where(eq(monthlyPlansTable.id, planId));

                  req.log.info({ planId, paymentId: paymentIdStr, confirmedCount }, "Monthly plan activated via PIX webhook");

                } else if (plan.status === "active") {
                  // ── CASE B: Renewal ── bookings already confirmed; just log the payment
                  const nextM = brt.month === 11 ? 0 : brt.month + 1;
                  const nextY = brt.month === 11 ? brt.year + 1 : brt.year;
                  const nextMonthKey = `${nextY}-${String(nextM + 1).padStart(2, "0")}`;

                  // Idempotency: skip if already logged for next month
                  const [existingLog] = await db
                    .select({ id: monthlyReservationsLogTable.id })
                    .from(monthlyReservationsLogTable)
                    .where(and(
                      eq(monthlyReservationsLogTable.monthlyPlanId, planId),
                      eq(monthlyReservationsLogTable.month, nextMonthKey)
                    ));

                  if (!existingLog) {
                    await db.insert(monthlyReservationsLogTable).values({
                      monthlyPlanId: planId,
                      bookingIds: JSON.stringify([]),
                      month: nextMonthKey,
                      status: "paid",
                      paymentMethod: "pix",
                      paidAt: new Date(),
                    });

                    await db
                      .update(monthlyPlansTable)
                      .set({ paymentExpiresAt: null })
                      .where(eq(monthlyPlansTable.id, planId));

                    req.log.info({ planId, paymentId: paymentIdStr, nextMonthKey }, "Monthly plan renewed via PIX webhook");
                  } else {
                    req.log.info({ planId, nextMonthKey }, "Next month already logged — skipping duplicate PIX webhook");
                  }
                }
              }

              res.json({ success: true });
              return;
            }
          }
        }

        const [alreadyCourtBooking] = await db
          .select({ id: courtBookingsTable.id })
          .from(courtBookingsTable)
          .where(eq(courtBookingsTable.paymentId, paymentIdStr));

        const [alreadyClassBooking] = alreadyCourtBooking
          ? [undefined]
          : await db
            .select({ id: classBookingsTable.id })
            .from(classBookingsTable)
            .where(eq(classBookingsTable.paymentId, paymentIdStr));

        if (alreadyCourtBooking || alreadyClassBooking) {
          req.log.info({ paymentId: paymentIdStr }, "Payment already processed — skipping");
          res.json({ success: true });
          return;
        }

        // Match by MP payment ID stored in mercadoPagoPreferenceId (now stores PIX payment IDs)
        // Fetch ALL bookings sharing the same PIX payment (multi-slot individual bookings)
        const courtBookingGroup = await db
          .select()
          .from(courtBookingsTable)
          .where(eq(courtBookingsTable.mercadoPagoPreferenceId, paymentIdStr));

        const courtBooking = courtBookingGroup[0] ?? null;

        if (courtBooking) {
          // Reject payment if booking is no longer pending (expired or already confirmed)
          if (courtBooking.status !== "pending") {
            req.log.warn({ paymentId: paymentIdStr, bookingStatus: courtBooking.status }, "Payment received for non-pending booking — rejecting");
            res.json({ success: false, message: "Booking no longer valid (expired or already confirmed)" });
            return;
          }
          
          // If it's a monthly booking, confirm all bookings in the same group
          if (courtBooking.monthlyGroupId) {
            await db
              .update(courtBookingsTable)
              .set({ status: "confirmed", paymentId: paymentIdStr })
              .where(eq(courtBookingsTable.monthlyGroupId, courtBooking.monthlyGroupId));
          } else {
            // Confirm ALL bookings sharing this PIX payment (handles multi-slot individual bookings)
            await db
              .update(courtBookingsTable)
              .set({ status: "confirmed", paymentId: paymentIdStr })
              .where(eq(courtBookingsTable.mercadoPagoPreferenceId, paymentIdStr));
          }

          // Send ONE confirmation email listing all booked slots with correct durations
          const courtEmail = courtBooking.customerEmail ?? "";
          const sortedGroup = [...courtBookingGroup].sort((a, b) =>
            (a.time as string).localeCompare(b.time as string)
          );
          const totalAmount = sortedGroup.reduce((s, b) => s + Number(b.amount ?? 0), 0);
          if (courtEmail && !courtEmail.endsWith("@manual.azuos")) {
            void sendCourtBookingConfirmation({
              customerName: courtBooking.customerName,
              customerEmail: courtEmail,
              date: courtBooking.date,
              time: sortedGroup[0]?.time ?? courtBooking.time,
              durationHours: sortedGroup.reduce((s, b) => s + Number(b.durationHours ?? 1), 0),
              courtNumber: courtBooking.courtNumber ?? 1,
              amount: totalAmount,
              bookingId: courtBooking.id,
              tenantId: webhookTenantId,
              slots: sortedGroup.map(b => ({ time: b.time as string, durationHours: Number(b.durationHours ?? 1) })),
            });
          }
          // Notify admins who opted in
          void sendAdminBookingNotification({
            tenantId: webhookTenantId,
            bookingId: courtBooking.id,
            type: "court",
            customerName: courtBooking.customerName,
            date: courtBooking.date,
            time: sortedGroup[0]?.time ?? courtBooking.time,
            amount: totalAmount,
            courtName: `Quadra ${courtBooking.courtNumber ?? 1}`,
          });
        } else {
          const [classBooking] = await db
            .select()
            .from(classBookingsTable)
            .where(eq(classBookingsTable.mercadoPagoPreferenceId, paymentIdStr));

          if (classBooking) {
            // Reject payment if booking is no longer pending (expired or already confirmed)
            if (classBooking.status !== "pending") {
              req.log.warn({ paymentId: paymentIdStr, bookingStatus: classBooking.status }, "Payment received for non-pending booking — rejecting");
              res.json({ success: false, message: "Booking no longer valid (expired or already confirmed)" });
              return;
            }
            
            await db
              .update(classBookingsTable)
              .set({ status: "confirmed", paymentId: paymentIdStr })
              .where(eq(classBookingsTable.id, classBooking.id));

            // Send confirmation email after payment confirmed via webhook
            const classEmail = classBooking.customerEmail ?? "";
            if (classEmail && !classEmail.endsWith("@manual.azuos")) {
              void sendClassBookingConfirmation({
                customerName: classBooking.customerName,
                customerEmail: classEmail,
                date: classBooking.date,
                time: classBooking.time,
                numberOfPeople: classBooking.numberOfPeople ?? 1,
                amount: Number(classBooking.amount ?? 0),
                bookingId: classBooking.id,
                tenantId: webhookTenantId,
              });
            }
            // Notify admins who opted in
            void sendAdminBookingNotification({
              tenantId: webhookTenantId,
              bookingId: classBooking.id,
              type: "class",
              customerName: classBooking.customerName,
              date: classBooking.date,
              time: classBooking.time,
              amount: Number(classBooking.amount ?? 0),
              numberOfPeople: classBooking.numberOfPeople ?? 1,
            });
          }
        }
      }
    }

    res.json({ success: true });
  } catch (err) {
    const mpErr = err as Record<string, unknown>;
    // Payment not found in MP = normal for test payloads, don't return 500
    if (mpErr["error"] === "not_found" || mpErr["status"] === 404) {
      req.log.info({ dataId: (req.body as Record<string, unknown>)?.["data"] }, "Webhook payment not found in MP — ignoring");
      res.json({ success: true });
      return;
    }
    req.log.error({ err }, "Webhook processing error");
    res.status(500).json({ error: "Processing failed" });
  }
});

// GET /bookings/notifications/expiring-monthly — admin: monthly plans expiring in next 3 days
router.get("/notifications/expiring-monthly", adminAuth, async (req, res) => {
  try {
    const today = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    const future = new Date(today);
    future.setDate(future.getDate() + 3); // 3 dias antes do mês acabar
    const futureStr = `${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(future.getDate())}`;

    const rows = await db.execute(sql`
      SELECT
        monthly_group_id,
        SUBSTRING(MAX(date), 1, 10) AS last_date,
        customer_name,
        customer_phone,
        court_number,
        time
      FROM court_bookings
      WHERE booking_type = 'monthly'
        AND status != 'cancelled'
        AND monthly_group_id IS NOT NULL
      GROUP BY monthly_group_id, customer_name, customer_phone, court_number, time
      HAVING MAX(date) BETWEEN ${todayStr} AND ${futureStr}
      ORDER BY MAX(date) ASC
    `);

    res.json({ notifications: rows.rows });
  } catch (err) {
    req.log.error({ err }, "Error fetching expiring monthly notifications");
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

// Check booking status (for payment confirmation polling)
router.get("/:bookingId/status", async (req, res) => {
  try {
    const bookingId = parseInt(req.params.bookingId, 10);
    if (isNaN(bookingId)) {
      res.status(400).json({ error: "Invalid booking ID" });
      return;
    }

    // Check court booking
    const [courtBooking] = await db
      .select({ id: courtBookingsTable.id, status: courtBookingsTable.status })
      .from(courtBookingsTable)
      .where(eq(courtBookingsTable.id, bookingId));

    if (courtBooking) {
      res.json({ status: courtBooking.status });
      return;
    }

    // Check class booking
    const [classBooking] = await db
      .select({ id: classBookingsTable.id, status: classBookingsTable.status })
      .from(classBookingsTable)
      .where(eq(classBookingsTable.id, bookingId));

    if (classBooking) {
      res.json({ status: classBooking.status });
      return;
    }

    res.status(404).json({ error: "Booking not found" });
  } catch (err) {
    req.log.error({ err }, "Error checking booking status");
    res.status(500).json({ error: "Failed to check status" });
  }
});

// POST /bookings/courts/manual — admin creates a manual/blocked court booking
router.post("/courts/manual", adminAuth, async (req, res) => {
  try {
    const { date, times, customerName, customerPhone, customerEmail, durationHours = 1, extraMinutes = 0, courtNumber = 1, monthlyPlan } = req.body as {
      date?: string;
      times?: string[];
      customerName?: string;
      customerPhone?: string;
      customerEmail?: string;
      durationHours?: number;
      extraMinutes?: number;
      courtNumber?: number;
      monthlyPlan?: boolean;
    };

    if (!date || !times || !Array.isArray(times) || times.length === 0) {
      res.status(400).json({ error: "date and times[] are required" });
      return;
    }

    const court = Math.min(Math.max(Number(courtNumber) || 1, 1), 4);
    const name = (customerName ?? "").trim() || "MANUAL";
    const phone = (customerPhone ?? "").trim() || "-";
    const rawEmail = (customerEmail ?? "").trim();
    const email = rawEmail || `${name.toLowerCase().replace(/\s+/g, ".")}@manual.azuos`;

    // ── PLANO MENSAL (admin) ─────────────────────────────────────────────────
    if (monthlyPlan) {
      const time = times[0];
      if (!time) { res.status(400).json({ error: "Selecione 1 horário para o plano mensal" }); return; }
      const startHour = parseInt(time.split(":")[0], 10);

      const addWeeksStr = (dateStr: string, weeks: number): string => {
        const d = new Date(`${dateStr}T12:00:00`);
        d.setDate(d.getDate() + weeks * 7);
        const y = d.getFullYear();
        const mo = String(d.getMonth() + 1).padStart(2, "0");
        const dy = String(d.getDate()).padStart(2, "0");
        return `${y}-${mo}-${dy}`;
      };
      const monthlyDates = [date, addWeeksStr(date, 1), addWeeksStr(date, 2), addWeeksStr(date, 3)];
      const monthlyGroupId = `mth-manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const monthlyPricing = await getMonthlyCourtPricing(req.tenantId!);
      const pricePerSession = getMonthlyPriceForSlot(monthlyPricing, date as string, startHour);

      let created: typeof courtBookingsTable.$inferSelect[] = [];
      try {
        created = await db.transaction(async (tx) => {
          for (const d of monthlyDates) {
            const existing = await tx
              .select({ time: courtBookingsTable.time, duration: courtBookingsTable.durationHours })
              .from(courtBookingsTable)
              .where(and(
                eq(courtBookingsTable.date, d),
                eq(courtBookingsTable.courtNumber, court),
                ne(courtBookingsTable.status, "cancelled"),
              ));
            const bookedHours = new Set<number>();
            for (const b of existing) {
              const bHour = Number((b.time as string).split(":")[0]);
              for (let i = 0; i < (b.duration ?? 1); i++) bookedHours.add(bHour + i);
            }
            if (bookedHours.has(startHour)) {
              const [y, mo, dy] = d.split("-");
              throw Object.assign(new Error(`O horário ${time} já está ocupado no dia ${dy}/${mo}/${y}. Escolha outro horário.`), { code: "CONFLICT" });
            }
          }
          const inserted = await tx
            .insert(courtBookingsTable)
            .values(monthlyDates.map((d) => ({
              tenantId: req.tenantId!,
              courtNumber: court,
              date: d,
              time,
              customerName: name,
              customerEmail: email,
              customerPhone: phone,
              durationHours: 1,
              amount: String(pricePerSession),
              status: "confirmed" as const,
              bookingType: "monthly",
              monthlyGroupId,
            })))
            .returning();
          return inserted;
        });
      } catch (err) {
        const e = err as { code?: string; message?: string };
        if (e?.code === "CONFLICT") {
          res.status(409).json({ error: e.message });
          return;
        }
        throw err;
      }
      res.status(201).json({ success: true, bookings: created, monthlyGroupId, monthlyDates });
      return;
    }

    // ── INDIVIDUAL / BLOCK ───────────────────────────────────────────────────
    const isBlock = name === "BLOQUEADO";
    const blockEmail = isBlock ? "bloqueado@azuos.com.br" : email;
    const courtRules = await getCourtPricingRules(req.tenantId!);
    const created = [];
    const extraMin = Number(extraMinutes) || 0;

    for (const time of times) {
      const h = parseInt(time.split(":")[0], 10);
      const baseDuration = Number(durationHours) || 1;
      const totalDuration = baseDuration + extraMin / 60;
      const schedPrice = await getCourtPriceBySchedule(court, date, h, req.tenantId!);
      const pricePerHour = schedPrice ?? getCourtPriceForSlot(courtRules, date, h);
      // Proportional pricing: price-per-hour × total duration
      const amount = Math.round(pricePerHour * totalDuration * 100) / 100;

      const [booking] = await db
        .insert(courtBookingsTable)
        .values({
          tenantId: req.tenantId!,
          courtNumber: court,
          date,
          time,
          customerName: name,
          customerEmail: blockEmail,
          customerPhone: phone,
          durationHours: String(totalDuration),
          amount: String(amount),
          status: isBlock ? "confirmed" : "pending",
        })
        .returning();
      created.push(booking);
    }

    res.status(201).json({ success: true, bookings: created });
  } catch (err) {
    req.log.error({ err }, "Error creating manual court booking");
    res.status(500).json({ error: "Failed to create booking" });
  }
});

// POST /bookings/classes/manual — admin creates a manual/blocked class booking
router.post("/classes/manual", adminAuth, async (req, res) => {
  try {
    const { date, times, customerName, customerPhone, numberOfPeople = 1 } = req.body as {
      date?: string;
      times?: string[];
      customerName?: string;
      customerPhone?: string;
      numberOfPeople?: number;
    };

    if (!date || !times || !Array.isArray(times) || times.length === 0) {
      res.status(400).json({ error: "date and times[] are required" });
      return;
    }

    const name = (customerName ?? "").trim() || "BLOQUEADO";
    const phone = (customerPhone ?? "").trim() || "-";
    const isBlock = name === "BLOQUEADO";
    const email = isBlock ? "bloqueado@azuos.com.br" : `${name.toLowerCase().replace(/\s+/g, ".")}@manual.azuos`;

    const { classPrices } = await getPrices(req.tenantId!);
    const people = Math.min(Math.max(Number(numberOfPeople) || 1, 1), 4);
    const amount = classPrices[people] ?? classPrices[1] ?? 0;

    const created = [];
    for (const time of times) {
      const [booking] = await db
        .insert(classBookingsTable)
        .values({
          tenantId: req.tenantId!,
          date,
          time,
          customerName: name,
          customerEmail: email,
          customerPhone: phone,
          numberOfPeople: people,
          amount: String(amount),
          status: isBlock ? "confirmed" : "pending",
        })
        .returning();
      created.push(booking);
    }

    res.status(201).json({ success: true, bookings: created });
  } catch (err) {
    req.log.error({ err }, "Error creating manual class booking");
    res.status(500).json({ error: "Failed to create booking" });
  }
});

// Cancel booking and free up slots
router.put("/:bookingId/cancel", adminAuth, async (req, res) => {
  try {
    const bookingId = parseInt(req.params.bookingId, 10);
    const { type } = req.body as { type?: string };

    if (isNaN(bookingId)) {
      res.status(400).json({ error: "Invalid booking ID" });
      return;
    }

    if (!type || (type !== "court" && type !== "class")) {
      res.status(400).json({ error: "Invalid type" });
      return;
    }

    if (type === "court") {
      const [booking] = await db
        .select()
        .from(courtBookingsTable)
        .where(eq(courtBookingsTable.id, bookingId));

      if (!booking) {
        res.status(404).json({ error: "Court booking not found" });
        return;
      }

      if (booking.status === "cancelled") {
        res.status(400).json({ error: "Booking already cancelled" });
        return;
      }

      // Mark as cancelled
      await db
        .update(courtBookingsTable)
        .set({ status: "cancelled" })
        .where(eq(courtBookingsTable.id, bookingId));

      req.log.info({ bookingId }, "Court booking cancelled");
      res.json({ success: true });

      // Fire-and-forget: notify client of cancellation (skip fake @manual.azuos emails)
      const courtEmail = booking.customerEmail ?? "";
      if (courtEmail && !courtEmail.endsWith("@manual.azuos")) {
        void sendCourtBookingCancellation({
          customerName: booking.customerName,
          customerEmail: courtEmail,
          date: booking.date,
          time: booking.time,
          durationHours: Number(booking.durationHours ?? 1),
          courtNumber: booking.courtNumber ?? 1,
          bookingId: booking.id,
          tenantId: req.tenantId!,
        });
      }
    } else {
      const [booking] = await db
        .select()
        .from(classBookingsTable)
        .where(eq(classBookingsTable.id, bookingId));

      if (!booking) {
        res.status(404).json({ error: "Class booking not found" });
        return;
      }

      if (booking.status === "cancelled") {
        res.status(400).json({ error: "Booking already cancelled" });
        return;
      }

      // Mark as cancelled
      await db
        .update(classBookingsTable)
        .set({ status: "cancelled" })
        .where(eq(classBookingsTable.id, bookingId));

      req.log.info({ bookingId }, "Class booking cancelled");
      res.json({ success: true });

      // Fire-and-forget: notify client of cancellation
      const classEmail = booking.customerEmail ?? "";
      if (classEmail && !classEmail.endsWith("@manual.azuos")) {
        void sendClassBookingCancellation({
          customerName: booking.customerName,
          customerEmail: classEmail,
          date: booking.date,
          time: booking.time,
          numberOfPeople: booking.numberOfPeople ?? 1,
          bookingId: booking.id,
          tenantId: req.tenantId!,
        });
      }
    }
  } catch (err) {
    req.log.error({ err }, "Error cancelling booking");
    res.status(500).json({ error: "Failed to cancel booking" });
  }
});

// POST /bookings/:bookingId/generate-pix — admin generates PIX for a pending manual booking
router.post("/:bookingId/generate-pix", adminAuth, async (req, res) => {
  try {
    const bookingId = parseInt(req.params.bookingId, 10);
    const { type } = req.body as { type?: string };
    if (isNaN(bookingId) || (type !== "court" && type !== "class")) {
      res.status(400).json({ error: "Invalid booking ID or type" });
      return;
    }

    // Fetch the booking
    let booking: { id: number; status: string; amount: string; customerName: string; customerEmail?: string | null; date: string; time: string } | undefined;
    if (type === "court") {
      const [b] = await db.select().from(courtBookingsTable).where(eq(courtBookingsTable.id, bookingId));
      booking = b ? { ...b, customerEmail: null } : undefined;
    } else {
      const [b] = await db.select().from(classBookingsTable).where(eq(classBookingsTable.id, bookingId));
      booking = b ?? undefined;
    }

    if (!booking) { res.status(404).json({ error: "Reserva não encontrada" }); return; }
    if (booking.status !== "pending") { res.status(400).json({ error: "Reserva não está pendente" }); return; }

    const tenantId = req.tenantId!;
    const appUrl = await getSettingOrEnv("app_url", "APP_URL", tenantId);
    const amount = parseFloat(booking.amount);
    const adminRefId = `${type}-admin-${bookingId}-${Date.now()}`;

    const pix = await createPixPayment({
      tenantId,
      referenceId: adminRefId,
      amount,
      description: `Reserva #${bookingId} - ${booking.date} ${booking.time} - ${booking.customerName}`,
      buyerEmail: booking.customerEmail ?? `admin_${bookingId}@placeholder.com`,
      buyerName: booking.customerName,
      appUrl,
      // No expiration for admin-generated PIX
    });

    if (!pix) { res.status(503).json({ error: "Integração PIX não configurada" }); return; }

    const { pixQrCode, pixQrCodeBase64, paymentId: mpPaymentId } = pix;

    // Store the payment ID on the booking
    if (type === "court") {
      await db.update(courtBookingsTable).set({ mercadoPagoPreferenceId: mpPaymentId }).where(eq(courtBookingsTable.id, bookingId));
    } else {
      await db.update(classBookingsTable).set({ mercadoPagoPreferenceId: mpPaymentId }).where(eq(classBookingsTable.id, bookingId));
    }

    res.json({ pixQrCode, pixQrCodeBase64, amount, bookingId });
  } catch (err) {
    req.log.error({ err }, "Error generating PIX for manual booking");
    res.status(500).json({ error: "Erro ao gerar PIX" });
  }
});

// POST /bookings/:bookingId/mark-paid — admin manually confirms payment
router.post("/:bookingId/mark-paid", adminAuth, async (req, res) => {
  try {
    const bookingId = parseInt(req.params.bookingId, 10);
    const { type } = req.body as { type?: string };
    if (isNaN(bookingId) || (type !== "court" && type !== "class")) {
      res.status(400).json({ error: "Invalid booking ID or type" });
      return;
    }

    if (type === "court") {
      const [b] = await db.select().from(courtBookingsTable).where(eq(courtBookingsTable.id, bookingId));
      if (!b) { res.status(404).json({ error: "Reserva não encontrada" }); return; }
      if (b.status === "confirmed") { res.json({ success: true, message: "Já confirmada" }); return; }
      await db.update(courtBookingsTable).set({ status: "confirmed" }).where(eq(courtBookingsTable.id, bookingId));
      req.log.info({ bookingId, type }, "Booking manually marked as paid");
      res.json({ success: true });
      const tenantId = req.tenantId!;
      // Fire-and-forget: send confirmation email to customer (skip fake @manual.azuos emails)
      const email = b.customerEmail ?? "";
      if (email && !email.endsWith("@manual.azuos")) {
        void sendCourtBookingConfirmation({
          customerName: b.customerName,
          customerEmail: email,
          date: b.date,
          time: b.time,
          durationHours: Number(b.durationHours ?? 1),
          courtNumber: b.courtNumber ?? 1,
          amount: Number(b.amount ?? 0),
          bookingId: b.id,
          tenantId,
        });
      }
      // Fire-and-forget: notify admins who opted in
      void sendAdminBookingNotification({
        tenantId,
        bookingId: b.id,
        type: "court",
        customerName: b.customerName,
        date: b.date,
        time: b.time,
        amount: Number(b.amount ?? 0),
        courtName: (b as Record<string, unknown>)["courtName"] as string | undefined ?? `Quadra ${b.courtNumber ?? 1}`,
      });
    } else {
      const [b] = await db.select().from(classBookingsTable).where(eq(classBookingsTable.id, bookingId));
      if (!b) { res.status(404).json({ error: "Reserva não encontrada" }); return; }
      if (b.status === "confirmed") { res.json({ success: true, message: "Já confirmada" }); return; }
      await db.update(classBookingsTable).set({ status: "confirmed" }).where(eq(classBookingsTable.id, bookingId));
      req.log.info({ bookingId, type }, "Booking manually marked as paid");
      res.json({ success: true });
      const tenantId = req.tenantId!;
      // Fire-and-forget: send confirmation email to customer
      const email = b.customerEmail ?? "";
      if (email && !email.endsWith("@manual.azuos")) {
        void sendClassBookingConfirmation({
          customerName: b.customerName,
          customerEmail: email,
          date: b.date,
          time: b.time,
          numberOfPeople: b.numberOfPeople ?? 1,
          amount: Number(b.amount ?? 0),
          bookingId: b.id,
          tenantId,
        });
      }
      // Fire-and-forget: notify admins who opted in
      void sendAdminBookingNotification({
        tenantId,
        bookingId: b.id,
        type: "class",
        customerName: b.customerName,
        date: b.date,
        time: b.time,
        amount: Number(b.amount ?? 0),
        numberOfPeople: b.numberOfPeople ?? 1,
      });
    }
  } catch (err) {
    req.log.error({ err }, "Error marking booking as paid");
    res.status(500).json({ error: "Erro ao confirmar pagamento" });
  }
});

// Cleanup job: cancel pending bookings after 15 minutes
export async function cleanupExpiredPendingBookings() {
  try {
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    
    // Cancel expired pending court bookings
    const expiredCourtBookings = await db
      .select({ id: courtBookingsTable.id })
      .from(courtBookingsTable)
      .where(
        and(
          eq(courtBookingsTable.status, "pending"),
          sql`${courtBookingsTable.createdAt} < ${fifteenMinutesAgo}`
        )
      );

    for (const booking of expiredCourtBookings) {
      await db
        .update(courtBookingsTable)
        .set({ status: "cancelled" })
        .where(eq(courtBookingsTable.id, booking.id));
    }

    // Cancel expired pending class bookings
    const expiredClassBookings = await db
      .select({ id: classBookingsTable.id })
      .from(classBookingsTable)
      .where(
        and(
          eq(classBookingsTable.status, "pending"),
          sql`${classBookingsTable.createdAt} < ${fifteenMinutesAgo}`
        )
      );

    for (const booking of expiredClassBookings) {
      await db
        .update(classBookingsTable)
        .set({ status: "cancelled" })
        .where(eq(classBookingsTable.id, booking.id));
    }

    if (expiredCourtBookings.length > 0 || expiredClassBookings.length > 0) {
      console.log(`Cleaned up ${expiredCourtBookings.length} court and ${expiredClassBookings.length} class bookings`);
    }
  } catch (err) {
    console.error("Error cleaning up expired bookings:", err);
  }
}

export default router;
