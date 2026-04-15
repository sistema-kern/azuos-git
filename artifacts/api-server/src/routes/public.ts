import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  clientsTable,
  monthlyPlansTable,
  monthlyReservationsLogTable,
  courtBookingsTable,
  classBookingsTable,
} from "@workspace/db/schema";
import { eq, and, ne } from "drizzle-orm";
import { getMonthlyCourtPricing, getMonthlyPriceForSlot, getSettingOrEnv, getSetting } from "./settings.js";
import { MercadoPagoConfig, Payment } from "mercadopago";
import { generatePicPayPix } from "../lib/picpay.js";

const router: IRouter = Router();

// ── Helpers ────────────────────────────────────────────────────────────────────

function getNowBrasilia() {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const brasiliaMs = utcMs - 3 * 60 * 60 * 1000;
  const brt = new Date(brasiliaMs);
  return {
    year: brt.getFullYear(),
    month: brt.getMonth(),
    day: brt.getDate(),
    hour: brt.getHours(),
    minute: brt.getMinutes(),
  };
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dy = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dy}`;
}

function getDaysOfMonth(
  dayOfWeek: number,
  time: string,
  forNextMonth = false
): { dates: Date[]; targetMonth: string } {
  const [planHour, planMinute] = time.split(":").map(Number);
  const brt = getNowBrasilia();

  let year = brt.year;
  let month = brt.month;

  if (forNextMonth) {
    if (month === 11) {
      month = 0;
      year += 1;
    } else {
      month += 1;
    }
  }

  const dates: Date[] = [];
  const iterator = new Date(year, month, forNextMonth ? 1 : brt.day);

  while (iterator.getMonth() === month) {
    if (iterator.getDay() === dayOfWeek) {
      const d = iterator.getDate();
      if (!forNextMonth) {
        const planIsInFuture =
          d > brt.day ||
          (d === brt.day && (planHour > brt.hour || (planHour === brt.hour && planMinute > brt.minute)));
        if (planIsInFuture) {
          dates.push(new Date(year, month, d));
        }
      } else {
        dates.push(new Date(year, month, d));
      }
    }
    iterator.setDate(iterator.getDate() + 1);
  }

  const tm = `${year}-${String(month + 1).padStart(2, "0")}`;
  return { dates, targetMonth: tm };
}

async function hasCourtConflict(
  dateStr: string,
  courtNumber: number,
  time: string,
  durationHours: number,
  tenantId = 1
): Promise<boolean> {
  const [newH, newM] = time.split(":").map(Number);
  const newStartMin = newH * 60 + newM;
  const newEndMin = newStartMin + durationHours * 60;

  const existing = await db
    .select()
    .from(courtBookingsTable)
    .where(
      and(
        eq(courtBookingsTable.date, dateStr),
        eq(courtBookingsTable.courtNumber, courtNumber),
        eq(courtBookingsTable.tenantId, tenantId),
        ne(courtBookingsTable.status, "cancelled")
      )
    );

  for (const b of existing) {
    const [eH, eM] = b.time.split(":").map(Number);
    const eStartMin = eH * 60 + eM;
    const eDur = b.durationHours ?? 1;
    const eEndMin = eStartMin + eDur * 60;
    if (newStartMin < eEndMin && newEndMin > eStartMin) return true;
  }
  return false;
}

// ── GET /public/monthly-plan-preview ──────────────────────────────────────────
// Public endpoint: preview available dates and pricing for a monthly plan
router.get("/monthly-plan-preview", async (req, res) => {
  const {
    dayOfWeek: dowStr,
    time,
    courtNumber: courtNumberStr,
    durationHours: durStr,
    includeNextMonth,
  } = req.query as Record<string, string>;

  const dayOfWeek = parseInt(dowStr, 10);
  const durationHours = parseInt(durStr || "1", 10);
  const courtNumber = parseInt(courtNumberStr || "1", 10);

  if (isNaN(dayOfWeek) || !time) {
    res.status(400).json({ error: "Parâmetros obrigatórios: dayOfWeek, time" });
    return;
  }

  try {
    const { dates: currentDates, targetMonth } = getDaysOfMonth(dayOfWeek, time, false);
    const { dates: nextDates, targetMonth: nextMonth } = getDaysOfMonth(dayOfWeek, time, true);

    const shouldIncludeNext = includeNextMonth === "true";

    const pricing = await getMonthlyCourtPricing();

    const buildDateInfo = async (dates: Date[]) => {
      const result = [];
      for (const date of dates) {
        const dateStr = formatDate(date);
        const conflict = await hasCourtConflict(dateStr, courtNumber, time, durationHours, req.tenantId ?? 1);
        const hour = parseInt(time.split(":")[0], 10);
        const price = getMonthlyPriceForSlot(pricing, dateStr, hour);
        result.push({ date: dateStr, conflict, pricePerSession: price });
      }
      return result;
    };

    const currentDateInfo = await buildDateInfo(currentDates);
    const nextDateInfo = shouldIncludeNext ? await buildDateInfo(nextDates) : [];

    const allDates = [...currentDateInfo, ...nextDateInfo];
    const availableDates = allDates.filter(d => !d.conflict);
    const conflictDates = allDates.filter(d => d.conflict).map(d => d.date);

    const pricePerSession = availableDates.length > 0 ? availableDates[0].pricePerSession * durationHours : 0;
    const suggestedPrice = availableDates.reduce((sum, d) => sum + d.pricePerSession * durationHours, 0);

    res.json({
      dates: allDates.map(d => d.date),
      conflicts: conflictDates,
      availableCount: availableDates.length,
      pricePerSession,
      suggestedPrice,
      currentMonth: targetMonth,
      nextMonth,
    });
  } catch (err) {
    console.error("Falha no preview público de plano mensal", err);
    res.status(500).json({ error: "Falha ao calcular preview" });
  }
});

// ── POST /public/monthly-plan ─────────────────────────────────────────────────
// Public endpoint: create client + monthly plan + generate PIX payment
router.post("/monthly-plan", async (req, res) => {
  const {
    name,
    email,
    phone,
    cpf,
    notes,
    courtNumber,
    durationHours,
    dayOfWeek,
    time,
    monthlyPrice,
    excludedDates,
    includeNextMonth,
  } = req.body as {
    name: string;
    email: string;
    phone: string;
    cpf?: string;
    notes?: string;
    courtNumber: number;
    durationHours: number;
    dayOfWeek: number;
    time: string;
    monthlyPrice: number;
    excludedDates?: string[];
    includeNextMonth?: boolean;
  };

  if (!name || !email || !phone || !courtNumber || !time || dayOfWeek === undefined || !monthlyPrice) {
    res.status(400).json({ error: "Campos obrigatórios faltando" });
    return;
  }

  try {
    // Find or create client by email
    let client = await db.query.clientsTable.findFirst({
      where: eq(clientsTable.email, email),
    });

    if (!client) {
      const [newClient] = await db
        .insert(clientsTable)
        .values({ name, email, phone, cpf: cpf || null, notes: notes || null })
        .returning();
      client = newClient;
    } else {
      // Update existing client with latest info
      const [updated] = await db
        .update(clientsTable)
        .set({ name, phone, cpf: cpf || null, notes: notes || null })
        .where(eq(clientsTable.id, client.id))
        .returning();
      client = updated;
    }

    // Get dates for current month
    const { dates: currentDates, targetMonth } = getDaysOfMonth(dayOfWeek, time, false);
    // Get dates for next month if requested
    const { dates: nextDates } = includeNextMonth ? getDaysOfMonth(dayOfWeek, time, true) : { dates: [] };
    const allDates = [...currentDates, ...nextDates];

    if (allDates.length === 0) {
      res.status(400).json({ error: "Nenhuma data disponível para este dia/horário" });
      return;
    }

    const excludedSet = new Set(excludedDates || []);
    const durH = durationHours || 1;
    const courtN = courtNumber;

    // Check for conflicts on non-excluded dates
    const conflicts: string[] = [];
    for (const date of allDates) {
      const dateStr = formatDate(date);
      if (excludedSet.has(dateStr)) continue;
      const conflict = await hasCourtConflict(dateStr, courtN, time, durH, req.tenantId ?? 1);
      if (conflict) conflicts.push(dateStr);
    }

    if (conflicts.length > 0) {
      res.status(409).json({ error: "Conflito de horários detectado", conflictingDates: conflicts });
      return;
    }

    // Create the monthly plan (starts as pending_payment)
    const [plan] = await db
      .insert(monthlyPlansTable)
      .values({
        clientId: client.id,
        type: "court",
        courtNumber: courtN,
        durationHours: durH,
        dayOfWeek,
        time,
        monthlyPrice: String(monthlyPrice),
        status: "pending_payment",
      })
      .returning();

    // Create confirmed bookings for all non-excluded dates
    const bookingIds: number[] = [];
    for (const date of allDates) {
      const dateStr = formatDate(date);
      if (excludedSet.has(dateStr)) continue;

      const [booking] = await db
        .insert(courtBookingsTable)
        .values({
          courtNumber: courtN,
          date: dateStr,
          time,
          customerName: client.name,
          customerEmail: client.email,
          customerPhone: client.phone,
          durationHours: durH,
          amount: String(monthlyPrice),
          status: "confirmed",
          bookingType: "monthly_plan",
        })
        .returning();
      bookingIds.push(booking.id);
    }

    // Log reservation creation
    await db.insert(monthlyReservationsLogTable).values({
      monthlyPlanId: plan.id,
      bookingIds: JSON.stringify(bookingIds),
      month: targetMonth,
      status: "created",
    });

    // Generate PIX payment via configured provider
    try {
      const tenantId = req.tenantId ?? 1;
      const paymentProvider = (await getSetting("payment_provider", tenantId)) === "picpay" ? "picpay" : "mercadopago";
      const appUrl = await getSettingOrEnv("app_url", "APP_URL", tenantId);
      const referenceId = `plan-${plan.id}`;

      let pixQrCode = "";
      let pixQrCodeBase64 = "";
      let storedPaymentId = "";

      if (paymentProvider === "picpay") {
        const picpayToken = await getSetting("picpay_token", tenantId);
        const picpayKey = await getSetting("picpay_key", tenantId);
        if (!picpayToken) throw new Error("Token PicPay não configurado");
        const callbackUrl = appUrl && picpayKey
          ? `${appUrl}/api/bookings/picpay-webhook?token=${encodeURIComponent(picpayKey)}`
          : undefined;
        const pix = await generatePicPayPix({
          picpayToken,
          referenceId,
          amount: Number(monthlyPrice),
          description: `Plano Mensal - Quadra ${courtN}`,
          buyerName: client.name,
          buyerEmail: client.email,
          callbackUrl,
        });
        pixQrCode = pix.qrCode ?? "";
        pixQrCodeBase64 = pix.qrCodeBase64 ?? "";
        storedPaymentId = referenceId;
      } else {
        const token = await getSettingOrEnv("mp_access_token", "MERCADOPAGO_ACCESS_TOKEN", tenantId);
        const mpClient = new MercadoPagoConfig({ accessToken: token });
        const paymentClient = new Payment(mpClient);
        const nameParts = client.name.trim().split(" ");
        const firstDate = allDates.find(d => !excludedSet.has(formatDate(d)));
        const dateFormatted = firstDate ? new Date(firstDate).toLocaleDateString("pt-BR") : "";
        const pixPayment = await paymentClient.create({
          body: {
            transaction_amount: Number(monthlyPrice),
            payment_method_id: "pix",
            description: `Quadra ${courtN} - ${dateFormatted} - ${durH}h`,
            payer: {
              email: client.email,
              first_name: nameParts[0],
              last_name: nameParts.slice(1).join(" ") || "-",
            },
            notification_url: appUrl ? `${appUrl}/api/bookings/webhook` : undefined,
            external_reference: referenceId,
          },
        });
        const txData = (pixPayment as unknown as Record<string, unknown>)?.["point_of_interaction"] as Record<string, unknown> | undefined;
        const txDataInner = txData?.["transaction_data"] as Record<string, unknown> | undefined;
        pixQrCode = (txDataInner?.["qr_code"] as string) ?? "";
        pixQrCodeBase64 = (txDataInner?.["qr_code_base64"] as string) ?? "";
        storedPaymentId = String(pixPayment.id ?? "");
      }

      await db
        .update(monthlyPlansTable)
        .set({ mercadoPagoPreferenceId: storedPaymentId })
        .where(eq(monthlyPlansTable.id, plan.id));

      res.status(201).json({
        planId: plan.id,
        clientId: client.id,
        bookingCount: bookingIds.length,
        pixQrCode,
        qrCodeUrl: pixQrCodeBase64 ? `data:image/png;base64,${pixQrCodeBase64}` : undefined,
        amount: Number(monthlyPrice),
      });
    } catch (mpErr) {
      console.error("Erro ao gerar PIX:", mpErr);
      // Plan created but no PIX - return plan info so admin can generate manually
      res.status(201).json({
        planId: plan.id,
        clientId: client.id,
        bookingCount: bookingIds.length,
        pixQrCode: null,
        qrCodeUrl: null,
        amount: Number(monthlyPrice),
        warning: "Plano criado mas PIX não foi gerado. Um administrador irá entrar em contato.",
      });
    }
  } catch (err) {
    console.error("Falha ao criar plano mensal público", err);
    res.status(500).json({ error: "Falha ao criar plano mensal. Tente novamente." });
  }
});

export default router;
