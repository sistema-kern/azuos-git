import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  clientsTable,
  monthlyPlansTable,
  monthlyReservationsLogTable,
  courtBookingsTable,
  classBookingsTable,
  courtsTable,
  courtSchedulesTable,
} from "@workspace/db/schema";
import { eq, and, ne, sql, inArray, gt, lt, desc, ilike, or, count as drizzleCount } from "drizzle-orm";
import { adminAuth } from "../middlewares/adminAuth.js";
import { getMonthlyCourtPricing, getMonthlyPriceForSlot, getMonthlyClassPricingPerPerson, getSettingOrEnv, getSetting, getShiftTimes, isOpenOnSunday } from "./settings.js";
import { MercadoPagoConfig, Payment } from "mercadopago";
import { sendPlanWelcomeEmail } from "../lib/email.js";
import { generatePicPayPix, verifyPicPayPayment } from "../lib/picpay.js";

const router: IRouter = Router();

async function getMpClient(tenantId = 1): Promise<MercadoPagoConfig> {
  const token = await getSettingOrEnv("mp_access_token", "MERCADOPAGO_ACCESS_TOKEN", tenantId);
  return new MercadoPagoConfig({ accessToken: token });
}

async function getPaymentProvider(tenantId = 1): Promise<"mercadopago" | "picpay"> {
  const val = await getSetting("payment_provider", tenantId);
  return val === "picpay" ? "picpay" : "mercadopago";
}

// ==================== HELPERS ====================

const getDayOfWeekName = (day: number): string => {
  const days = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
  return days[day];
};

const formatDate = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

/**
 * Get remaining dates of the current month for a given dayOfWeek and time.
 * 
 * Rules:
 * - If today matches dayOfWeek AND the plan time hasn't passed yet today → include today
 * - If today matches dayOfWeek AND the plan time has already passed today → start next week
 * - Otherwise, find the next occurrence of dayOfWeek from tomorrow onward
 * - Continue through all remaining occurrences in this month
 */
/**
 * Get dates for a given dayOfWeek and time.
 * 
 * First tries the current month (future slots only).
 * If no slots remain this month, falls back to the full next month.
 * Returns { dates, targetMonth } where targetMonth is "YYYY-MM" of the chosen month.
 */
const BRASILIA_OFFSET_MS = 3 * 60 * 60 * 1000; // UTC-3

/** Get current date/time expressed in Brasilia local time (UTC-3), using UTC component accessors */
function getNowBrasilia() {
  const nowUTC = new Date();
  const brt = new Date(nowUTC.getTime() - BRASILIA_OFFSET_MS);
  return {
    year: brt.getUTCFullYear(),
    month: brt.getUTCMonth(),   // 0-indexed
    day: brt.getUTCDate(),
    hour: brt.getUTCHours(),
    minute: brt.getUTCMinutes(),
  };
}

const getRemainingDaysOfMonth = (
  dayOfWeek: number,
  time: string
): { dates: Date[]; targetMonth: string } => {
  const [planHour, planMinute] = time.split(":").map(Number);
  const brt = getNowBrasilia();

  const currentMonth = brt.month;
  const currentYear = brt.year;
  const currentDates: Date[] = [];

  // Loop through all days of the current month starting from today (in BRT)
  const dateIterator = new Date(currentYear, currentMonth, brt.day);

  while (dateIterator.getMonth() === currentMonth) {
    if (dateIterator.getDay() === dayOfWeek) {
      const d = dateIterator.getDate();
      // Compare plan time vs current BRT time on the same day
      const planIsInFuture =
        d > brt.day ||
        (d === brt.day && (planHour > brt.hour || (planHour === brt.hour && planMinute > brt.minute)));

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

  // --- Fallback: all occurrences in next month ---
  const nextMonth = currentMonth === 11 ? 0 : currentMonth + 1;
  const nextYear = currentMonth === 11 ? currentYear + 1 : currentYear;
  const nextDates: Date[] = [];

  const nextDateIterator = new Date(nextYear, nextMonth, 1);

  while (nextDateIterator.getMonth() === nextMonth) {
    if (nextDateIterator.getDay() === dayOfWeek) {
      nextDates.push(new Date(nextYear, nextMonth, nextDateIterator.getDate()));
    }
    nextDateIterator.setDate(nextDateIterator.getDate() + 1);
  }

  const tm = `${nextYear}-${String(nextMonth + 1).padStart(2, "0")}`;
  return { dates: nextDates, targetMonth: tm };
};

/**
 * Returns all occurrences of `dayOfWeek` (0=Sun..6=Sat) from tomorrow (or today if plan time is still future)
 * through the end of the current year. Used when creating annual plans.
 */
const getAllWeekdayDatesInYear = (dayOfWeek: number, time: string): Date[] => {
  const [planHour, planMinute] = time.split(":").map(Number);
  const brt = getNowBrasilia();
  const year = brt.year;
  const dates: Date[] = [];

  // Iterate every day from today through Dec 31 of the current year
  const iter = new Date(year, brt.month, brt.day);
  const yearEnd = new Date(year, 11, 31);

  while (iter <= yearEnd) {
    if (iter.getDay() === dayOfWeek) {
      const d = iter.getDate();
      const m = iter.getMonth();
      const y = iter.getFullYear();
      const sameDay = y === brt.year && m === brt.month && d === brt.day;
      const planIsInFuture =
        !sameDay ||
        planHour > brt.hour ||
        (planHour === brt.hour && planMinute > brt.minute);

      if (planIsInFuture) {
        dates.push(new Date(y, m, d));
      }
    }
    iter.setDate(iter.getDate() + 1);
  }

  return dates;
};

/**
 * Check if a court booking at (date, courtNumber, time, durationHours) conflicts with existing bookings.
 * Considers time overlap: existing booking [existStart, existStart+existDur) vs new [newStart, newStart+newDur)
 */
const hasCourtConflict = async (
  dateStr: string,
  courtNumber: number,
  time: string,
  durationHours: number,
  tenantId = 1
): Promise<boolean> => {
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

    // Overlap check: new starts before existing ends AND new ends after existing starts
    if (newStartMin < eEndMin && newEndMin > eStartMin) {
      return true;
    }
  }

  return false;
};

/**
 * Check if a class booking at (date, time) conflicts with existing bookings.
 */
const hasClassConflict = async (dateStr: string, time: string): Promise<boolean> => {
  const existing = await db
    .select()
    .from(classBookingsTable)
    .where(
      and(
        eq(classBookingsTable.date, dateStr),
        eq(classBookingsTable.time, time),
        ne(classBookingsTable.status, "cancelled")
      )
    );
  return existing.length > 0;
};

// ── Helper: get all dates of a given month matching a dayOfWeek ──
function getAllDatesForMonth(year: number, month: number, dayOfWeek: number): string[] {
  const dates: string[] = [];
  const d = new Date(year, month, 1);
  while (d.getMonth() === month) {
    if (d.getDay() === dayOfWeek) {
      dates.push(formatDate(d));
    }
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

// ==================== CLIENTS ====================

// GET /clients - list all clients
router.get("/", adminAuth, async (req, res) => {
  try {
    const tenantId = req.tenantId!;
    const q = ((req.query.q as string) || "").trim();
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 50));
    const offset = (page - 1) * limit;

    const planStatus = (req.query.planStatus as string | undefined)?.trim();
    const planDayOfWeek = req.query.planDayOfWeek as string | undefined;
    const planTime = (req.query.planTime as string | undefined)?.trim();

    let baseWhere = q
      ? and(
          eq(clientsTable.tenantId, tenantId),
          or(
            ilike(clientsTable.name, `%${q}%`),
            ilike(clientsTable.phone, `%${q}%`),
            ilike(clientsTable.cpf, `%${q}%`)
          )
        )
      : eq(clientsTable.tenantId, tenantId);

    if (planStatus) {
      const resolvedStatus =
        planStatus === "active_awaiting" ? "active" : planStatus;
      const planConditions: Parameters<typeof and>[0][] = [
        eq(monthlyPlansTable.tenantId, tenantId),
        eq(monthlyPlansTable.status, resolvedStatus),
      ];
      if (planStatus === "active_awaiting") {
        const nearEndParam = req.query.nearEnd === "true";
        if (!nearEndParam) {
          return res.json({ clients: [], total: 0, page: 1, totalPages: 0, limit });
        }
        const now = new Date();
        const nextM = now.getMonth() === 11 ? 0 : now.getMonth() + 1;
        const nextY = now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear();
        const nextMonthKey = `${nextY}-${String(nextM + 1).padStart(2, "0")}`;
        planConditions.push(
          sql`NOT EXISTS (
            SELECT 1 FROM ${monthlyReservationsLogTable}
            WHERE ${monthlyReservationsLogTable.monthlyPlanId} = ${monthlyPlansTable.id}
              AND ${monthlyReservationsLogTable.month} = ${nextMonthKey}
              AND ${monthlyReservationsLogTable.status} = 'paid'
          )`
        );
      }
      if (planDayOfWeek && planDayOfWeek !== "all") {
        planConditions.push(eq(monthlyPlansTable.dayOfWeek, Number(planDayOfWeek)));
      }
      if (planTime) {
        planConditions.push(sql`${monthlyPlansTable.time} LIKE ${planTime + '%'}`);
      }
      const matchingClientIds = db
        .selectDistinct({ clientId: monthlyPlansTable.clientId })
        .from(monthlyPlansTable)
        .where(and(...planConditions));
      baseWhere = and(baseWhere, inArray(clientsTable.id, matchingClientIds));
    }

    const [{ total }] = await db
      .select({ total: drizzleCount() })
      .from(clientsTable)
      .where(baseWhere);

    const clients = await db
      .select()
      .from(clientsTable)
      .where(baseWhere)
      .orderBy(clientsTable.name)
      .limit(limit)
      .offset(offset);

    res.json({ clients, total, page, totalPages: Math.ceil(total / limit), limit });
  } catch (err) {
    req.log.error({ err }, "Falha ao buscar clientes");
    res.status(500).json({ error: "Falha ao buscar clientes" });
  }
});

// POST /clients - create new client
router.post("/", adminAuth, async (req, res) => {
  const { name, email, phone, notes, cpf, address } = req.body as {
    name: string;
    email: string;
    phone: string;
    notes?: string;
    cpf: string;
    address: { cep: string; street: string; number: string; complement?: string; neighborhood: string; state: string };
  };

  if (!name) {
    res.status(400).json({ error: "Campo obrigatório: nome" });
    return;
  }

  try {
    const [client] = await db
      .insert(clientsTable)
      .values({ tenantId: req.tenantId!, name, email, phone, notes: notes || null, cpf, address })
      .returning();

    res.status(201).json(client);
  } catch (err) {
    req.log.error({ err }, "Falha ao criar cliente");
    res.status(500).json({ error: "Falha ao criar cliente" });
  }
});

// GET /clients/court-hours - all configured time slots for a court + dayOfWeek (no booking filter)
// MUST be registered BEFORE /:id to avoid param capture
router.get("/court-hours", adminAuth, async (req, res) => {
  const tenantId = req.tenantId!;
  const { courtNumber, dayOfWeek } = req.query as { courtNumber?: string; dayOfWeek?: string };
  const dayNum = dayOfWeek !== undefined ? Number(dayOfWeek) : -1;

  const fmtSlot = (totalMin: number) => {
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  };

  try {
    let openTotalMin = 8 * 60;
    let closeTotalMin = 22 * 60;

    if (courtNumber) {
      const courtNum = Number(courtNumber);
      // Filter by tenant to avoid cross-tenant data leakage
      const [court] = await db.select({ id: courtsTable.id }).from(courtsTable)
        .where(and(eq(courtsTable.number, courtNum), eq(courtsTable.tenantId, tenantId)));
      if (court) {
        const [sched] = await db
          .select()
          .from(courtSchedulesTable)
          .where(and(eq(courtSchedulesTable.courtId, court.id), eq(courtSchedulesTable.dayOfWeek, dayNum)));
        if (sched) {
          if (!sched.isOpen) {
            res.json({ slots: [] });
            return;
          }
          openTotalMin = sched.openHour * 60 + sched.openMinute;
          closeTotalMin = sched.closeHour * 60 + sched.closeMinute;
          const slots: string[] = [];
          for (let t = openTotalMin; t < closeTotalMin; t += 60) slots.push(fmtSlot(t));
          res.json({ slots });
          return;
        }
      }
    }

    // Fallback: global shift times for this tenant
    const shiftTimes = await getShiftTimes(tenantId);
    const isSunday = dayNum === 0;
    const openSun = await isOpenOnSunday(tenantId);
    if (isSunday && !openSun) { res.json({ slots: [] }); return; }
    const isWeekend = isSunday || dayNum === 6;
    const dayShifts = isWeekend ? shiftTimes.weekend : shiftTimes.weekday;
    openTotalMin = dayShifts.morning.hour * 60 + (dayShifts.morning.minute ?? 0);
    closeTotalMin = dayShifts.night.endHour * 60 + (dayShifts.night.endMinute ?? 0);
    const slots: string[] = [];
    for (let t = openTotalMin; t < closeTotalMin; t += 60) slots.push(fmtSlot(t));
    res.json({ slots });
  } catch (err) {
    req.log.error({ err }, "Falha ao buscar horários da quadra");
    res.status(500).json({ error: "Falha ao buscar horários" });
  }
});

// GET /clients/:id - get client details
router.get("/:id", adminAuth, async (req, res) => {
  const id = Number(req.params.id);
  const tenantId = req.tenantId!;
  try {
    const [client] = await db
      .select()
      .from(clientsTable)
      .where(and(eq(clientsTable.id, id), eq(clientsTable.tenantId, tenantId)));

    if (!client) {
      res.status(404).json({ error: "Cliente não encontrado" });
      return;
    }

    res.json(client);
  } catch (err) {
    req.log.error({ err }, "Falha ao buscar cliente");
    res.status(500).json({ error: "Falha ao buscar cliente" });
  }
});

// PUT /clients/:id - update client
router.put("/:id", adminAuth, async (req, res) => {
  const id = Number(req.params.id);
  const { name, email, phone, notes, active, cpf } = req.body as {
    name?: string;
    email?: string;
    phone?: string;
    notes?: string;
    active?: boolean;
    cpf?: string | null;
  };

  try {
    const updates: Record<string, any> = {};
    if (name !== undefined) updates.name = name;
    if (email !== undefined) updates.email = email;
    if (phone !== undefined) updates.phone = phone;
    if (notes !== undefined) updates.notes = notes;
    if (active !== undefined) updates.active = active;
    if (cpf !== undefined) updates.cpf = cpf || null;

    const [updated] = await db
      .update(clientsTable)
      .set(updates)
      .where(and(eq(clientsTable.id, id), eq(clientsTable.tenantId, req.tenantId!)))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Cliente não encontrado" });
      return;
    }

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Falha ao atualizar cliente");
    res.status(500).json({ error: "Falha ao atualizar cliente" });
  }
});

// DELETE /clients/:id - delete client
router.delete("/:id", adminAuth, async (req, res) => {
  const id = Number(req.params.id);

  try {
    const [deleted] = await db
      .delete(clientsTable)
      .where(and(eq(clientsTable.id, id), eq(clientsTable.tenantId, req.tenantId!)))
      .returning();

    if (!deleted) {
      res.status(404).json({ error: "Cliente não encontrado" });
      return;
    }

    res.json({ message: "Cliente deletado com sucesso" });
  } catch (err) {
    req.log.error({ err }, "Falha ao deletar cliente");
    res.status(500).json({ error: "Falha ao deletar cliente" });
  }
});

// ==================== MONTHLY PLANS ====================

// GET /clients/plans/near-expiry — count active plans when near month end (last 7 days)
// Must be registered BEFORE /:clientId routes to avoid param capture
router.get("/plans/near-expiry", adminAuth, async (req, res) => {
  try {
    const debug = (req.query.debug as string) === "true";
    const today = new Date();
    const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const daysLeft = lastDay - today.getDate();

    if (!debug && daysLeft > 7) {
      res.json({ count: 0, near_month_end: false });
      return;
    }

    // Calculate next month key (YYYY-MM) — plans already paid for next month are excluded
    const brt = getNowBrasilia();
    const nextM = brt.month === 11 ? 0 : brt.month + 1;
    const nextY = brt.month === 11 ? brt.year + 1 : brt.year;
    const nextMonthKey = `${nextY}-${String(nextM + 1).padStart(2, "0")}`;

    const tenantId = req.tenantId!;
    const result = await db.execute(sql`
      SELECT count(*)::int AS count
      FROM monthly_plans mp
      WHERE mp.tenant_id = ${tenantId}
      AND mp.status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM monthly_reservations_log mrl
        WHERE mrl.monthly_plan_id = mp.id
        AND mrl.month = ${nextMonthKey}
        AND mrl.status = 'paid'
      )
    `);

    const count = (result.rows[0] as { count: number })?.count ?? 0;
    res.json({ count, near_month_end: true });
  } catch (err) {
    console.error("[plans/near-expiry]", err);
    res.status(500).json({ error: "Falha ao buscar planos" });
  }
});

// GET /clients/plans/all - returns all plans (status, dayOfWeek, time) grouped by client_id for client-side filtering
// Must be before /:clientId routes to avoid param capture
router.get("/plans/all", adminAuth, async (req, res) => {
  try {
    const tenantId = req.tenantId!;
    const rows = await db
      .select({
        id: monthlyPlansTable.id,
        clientId: monthlyPlansTable.clientId,
        status: monthlyPlansTable.status,
        dayOfWeek: monthlyPlansTable.dayOfWeek,
        time: monthlyPlansTable.time,
      })
      .from(monthlyPlansTable)
      .where(eq(monthlyPlansTable.tenantId, tenantId));

    // Group by clientId
    const map: Record<number, typeof rows> = {};
    for (const row of rows) {
      if (!map[row.clientId]) map[row.clientId] = [];
      map[row.clientId].push(row);
    }
    console.info(`[plans/all] tenantId=${tenantId} rows=${rows.length} clients=${Object.keys(map).length}`);
    res.setHeader("Cache-Control", "no-store");
    res.json(map);
  } catch (err) {
    console.error("[plans/all]", err);
    res.status(500).json({ error: "Falha ao buscar planos" });
  }
});

// POST /clients/auto-renew - auto-generate reservations for active plans missing current month
// Must be registered BEFORE /:clientId routes to avoid param capture
router.post("/auto-renew", adminAuth, async (req, res) => {
  try {
    const brt = getNowBrasilia();
    const currentMonth = `${brt.year}-${String(brt.month + 1).padStart(2, "0")}`;

    const activePlans = await db
      .select()
      .from(monthlyPlansTable)
      .where(eq(monthlyPlansTable.status, "active"));

    const renewed: number[] = [];
    const skipped: number[] = [];

    for (const plan of activePlans) {
      // Check if log already exists for current month
      const existingLog = await db
        .select()
        .from(monthlyReservationsLogTable)
        .where(
          and(
            eq(monthlyReservationsLogTable.monthlyPlanId, plan.id),
            eq(monthlyReservationsLogTable.month, currentMonth)
          )
        );

      if (existingLog.length > 0) {
        skipped.push(plan.id);
        continue;
      }

      const [client] = await db
        .select()
        .from(clientsTable)
        .where(eq(clientsTable.id, plan.clientId));

      if (!client) {
        skipped.push(plan.id);
        continue;
      }

      const datesForMonth = getAllDatesForMonth(brt.year, brt.month, plan.dayOfWeek);
      if (datesForMonth.length === 0) {
        skipped.push(plan.id);
        continue;
      }

      const durH = Number(plan.durationHours) || 1;
      const courtN = plan.courtNumber || 1;
      const bookingIds: number[] = [];

      for (const dateStr of datesForMonth) {
        if (plan.type === "court") {
          const [booking] = await db
            .insert(courtBookingsTable)
            .values({
              courtNumber: courtN,
              date: dateStr,
              time: plan.time as string,
              customerName: client.name,
              customerEmail: client.email,
              customerPhone: client.phone,
              durationHours: durH,
              amount: String(plan.monthlyPrice),
              status: "pending",
              bookingType: "monthly_plan",
            })
            .returning();
          bookingIds.push(booking.id);
        } else {
          const [booking] = await db
            .insert(classBookingsTable)
            .values({
              date: dateStr,
              time: plan.time as string,
              customerName: client.name,
              customerEmail: client.email,
              customerPhone: client.phone,
              numberOfPeople: plan.numberOfPeople || 1,
              amount: String(plan.monthlyPrice),
              status: "pending",
            })
            .returning();
          bookingIds.push(booking.id);
        }
      }

      await db.insert(monthlyReservationsLogTable).values({
        monthlyPlanId: plan.id,
        bookingIds: JSON.stringify(bookingIds),
        month: currentMonth,
        status: "created",
      });

      renewed.push(plan.id);
    }

    res.json({
      currentMonth,
      renewed: renewed.length,
      skipped: skipped.length,
      renewedPlanIds: renewed,
    });
  } catch (err) {
    req.log.error({ err }, "Falha na renovação automática de planos");
    res.status(500).json({ error: "Falha na renovação automática" });
  }
});

// PATCH /clients/plan-log/:logId - mark a monthly charge as paid
// Must be registered BEFORE /:clientId routes to avoid param capture
router.patch("/plan-log/:logId", adminAuth, async (req, res) => {
  const logId = Number(req.params.logId);
  const { paymentMethod, status } = req.body as { paymentMethod?: string; status?: string };

  try {
    const brt = getNowBrasilia();
    const today = `${brt.year}-${String(brt.month + 1).padStart(2, "0")}-${String(brt.day).padStart(2, "0")}`;

    const updates: Record<string, any> = {};
    if (status) updates.status = status;
    if (paymentMethod) updates.paymentMethod = paymentMethod;
    if (status === "paid" && !updates.paidAt) updates.paidAt = today;

    const [updated] = await db
      .update(monthlyReservationsLogTable)
      .set(updates)
      .where(eq(monthlyReservationsLogTable.id, logId))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Cobrança não encontrada" });
      return;
    }

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Falha ao atualizar cobrança");
    res.status(500).json({ error: "Falha ao atualizar cobrança" });
  }
});

// GET /clients/:clientId/plans - list client's monthly plans
router.get("/:clientId/plans", adminAuth, async (req, res) => {
  const clientId = Number(req.params.clientId);

  try {
    const plans = await db
      .select()
      .from(monthlyPlansTable)
      .where(eq(monthlyPlansTable.clientId, clientId))
      .orderBy(monthlyPlansTable.dayOfWeek);

    // Compute today info (Brasília time) for paymentDueSoon check
    const brt = getNowBrasilia();
    const currentMonthStr = `${brt.year}-${String(brt.month + 1).padStart(2, "0")}`;
    const todayStr = `${brt.year}-${String(brt.month + 1).padStart(2, "0")}-${String(brt.day).padStart(2, "0")}`;

    // Get months + paymentDueSoon for each plan by reading booking dates from reservation logs
    const plansWithMonths = await Promise.all(
      plans.map(async (plan) => {
        // Fetch reservation logs to get booking IDs
        const logs = await db
          .select()
          .from(monthlyReservationsLogTable)
          .where(eq(monthlyReservationsLogTable.monthlyPlanId, plan.id));

        let months: string[] = [];
        let allBookingDates: string[] = [];

        if (logs.length > 0) {
          // Collect all booking IDs from all logs
          const allBookingIds: number[] = [];
          for (const log of logs) {
            try {
              const ids = JSON.parse(log.bookingIds) as number[];
              allBookingIds.push(...ids);
            } catch { /* ignore parse errors */ }
          }

          // Fetch actual booking dates
          if (allBookingIds.length > 0) {
            if (plan.type === "court") {
              const rows = await db
                .select({ date: courtBookingsTable.date })
                .from(courtBookingsTable)
                .where(inArray(courtBookingsTable.id, allBookingIds));
              allBookingDates = rows.map((r) => r.date);
            } else {
              const rows = await db
                .select({ date: classBookingsTable.date })
                .from(classBookingsTable)
                .where(inArray(classBookingsTable.id, allBookingIds));
              allBookingDates = rows.map((r) => r.date);
            }
            // Extract unique YYYY-MM months from YYYY-MM-DD dates
            months = Array.from(new Set(allBookingDates.map((d) => d.substring(0, 7)))).sort();
          }
        }

        // Fallback: derive month from plan's createdAt
        if (months.length === 0) {
          const d = new Date(plan.createdAt);
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, "0");
          months = [`${y}-${m}`];
        }

        // paymentDueSoon: last booking of current month is within 7 days from today
        const currentMonthDates = allBookingDates.filter((d) => d.startsWith(currentMonthStr)).sort();
        const lastBookingOfMonth = currentMonthDates.length > 0 ? currentMonthDates[currentMonthDates.length - 1] : null;
        let paymentDueSoon = false;
        if (lastBookingOfMonth && plan.status === "active") {
          const lastDate = new Date(lastBookingOfMonth + "T12:00:00");
          const todayDate = new Date(todayStr + "T12:00:00");
          const diffDays = Math.floor((lastDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24));
          paymentDueSoon = diffDays >= 0 && diffDays <= 7;
        }

        const sessionsThisMonth = currentMonthDates.length;
        return { ...plan, months, paymentDueSoon, lastBookingOfMonth, sessionsThisMonth };
      })
    );

    res.json(plansWithMonths);
  } catch (err) {
    req.log.error({ err }, "Falha ao buscar planos");
    res.status(500).json({ error: "Falha ao buscar planos" });
  }
});

// GET /clients/:clientId/plans/:planId/bookings - get all bookings for a monthly plan
router.get("/:clientId/plans/:planId/bookings", adminAuth, async (req, res) => {
  const clientId = Number(req.params.clientId);
  const planId = Number(req.params.planId);

  try {
    const [plan] = await db
      .select()
      .from(monthlyPlansTable)
      .where(
        and(
          eq(monthlyPlansTable.id, planId),
          eq(monthlyPlansTable.clientId, clientId)
        )
      );

    if (!plan) {
      res.status(404).json({ error: "Plano não encontrado" });
      return;
    }

    // Get reservation logs for this plan
    const reservationLogs = await db
      .select()
      .from(monthlyReservationsLogTable)
      .where(eq(monthlyReservationsLogTable.monthlyPlanId, planId));

    // Collect all booking IDs from all reservation logs
    const allBookingIds: number[] = [];
    for (const log of reservationLogs) {
      const bookingIds = JSON.parse(log.bookingIds) as number[];
      allBookingIds.push(...bookingIds);
    }

    const allBookings: any[] = [];

    if (allBookingIds.length > 0) {
      if (plan.type === "court") {
        const courtBookings = await db
          .select()
          .from(courtBookingsTable)
          .where(inArray(courtBookingsTable.id, allBookingIds));
        allBookings.push(...courtBookings);
      } else {
        const classBookings = await db
          .select()
          .from(classBookingsTable)
          .where(inArray(classBookingsTable.id, allBookingIds));
        allBookings.push(...classBookings);
      }
    }

    // Sort by date
    allBookings.sort((a, b) => a.date.localeCompare(b.date));

    res.json(allBookings);
  } catch (err) {
    req.log.error({ err }, "Falha ao buscar reservas do plano");
    res.status(500).json({ error: "Falha ao buscar reservas do plano" });
  }
});

// GET /clients/:clientId/plans/:planId/logs - get monthly billing logs for a plan
router.get("/:clientId/plans/:planId/logs", adminAuth, async (req, res) => {
  const planId = Number(req.params.planId);
  try {
    const logs = await db
      .select()
      .from(monthlyReservationsLogTable)
      .where(eq(monthlyReservationsLogTable.monthlyPlanId, planId))
      .orderBy(desc(monthlyReservationsLogTable.month));
    res.json(logs);
  } catch (err) {
    req.log.error({ err }, "Falha ao buscar logs do plano");
    res.status(500).json({ error: "Falha ao buscar logs do plano" });
  }
});

// GET /clients/:clientId/plans/preview - preview dates + suggested price before creating a plan
router.get("/:clientId/plans/preview", adminAuth, async (req, res) => {
  const {
    type,
    dayOfWeek: dayOfWeekStr,
    time,
    courtNumber: courtNumberStr,
    durationHours: durationHoursStr,
    extraMinutes: extraMinutesStr,
    numberOfPeople: numberOfPeopleStr,
    includeNextMonth: includeNextMonthStr,
  } = req.query as {
    type?: string;
    dayOfWeek?: string;
    time?: string;
    courtNumber?: string;
    durationHours?: string;
    extraMinutes?: string;
    numberOfPeople?: string;
    includeNextMonth?: string;
  };

  if (!type || dayOfWeekStr === undefined || !time) {
    res.status(400).json({ error: "Parâmetros obrigatórios: type, dayOfWeek, time" });
    return;
  }

  const dayOfWeek = Number(dayOfWeekStr);
  const courtNumber = courtNumberStr ? Number(courtNumberStr) : 1;
  const durationHours = durationHoursStr ? Number(durationHoursStr) : 1;
  const extraMinutes = extraMinutesStr ? Number(extraMinutesStr) : 0;
  const totalDurationHours = durationHours + extraMinutes / 60;
  const numberOfPeople = numberOfPeopleStr ? Number(numberOfPeopleStr) : 1;
  const includeNextMonth = includeNextMonthStr === "true";

  try {
    let { dates, targetMonth } = getRemainingDaysOfMonth(dayOfWeek, time);
    
    // If includeNextMonth is true and we have dates from this month, also get next month dates
    if (includeNextMonth && dates.length > 0) {
      const nextMonthStart = new Date(dates[dates.length - 1]);
      nextMonthStart.setDate(1);
      nextMonthStart.setMonth(nextMonthStart.getMonth() + 1);
      const nextMonth = nextMonthStart.getMonth();
      const nextYear = nextMonthStart.getFullYear();
      const nextDates: Date[] = [];
      let cur = new Date(nextMonthStart);

      while (cur.getMonth() === nextMonth) {
        if (cur.getDay() === dayOfWeek) {
          nextDates.push(new Date(cur));
          cur.setDate(cur.getDate() + 7);
        } else {
          cur.setDate(cur.getDate() + 1);
        }
      }
      
      dates = [...dates, ...nextDates];
    }

    if (dates.length === 0) {
      res.json({
        dates: [],
        count: 0,
        pricePerSession: 0,
        suggestedPrice: 0,
        conflicts: [],
        dayName: getDayOfWeekName(dayOfWeek),
        targetMonth: null,
      });
      return;
    }

    // Detect conflicts for each date
    const conflicts: string[] = [];
    const [hour] = time.split(":").map(Number);

    for (const date of dates) {
      const dateStr = formatDate(date);
      let conflict = false;

      if (type === "court") {
        conflict = await hasCourtConflict(dateStr, courtNumber, time, durationHours, req.tenantId ?? 1);
      } else if (type === "class") {
        conflict = await hasClassConflict(dateStr, time);
      }

      if (conflict) conflicts.push(dateStr);
    }

    // Calculate suggested price based on court schedule (per-day pricing) or fallback to global setting
    let suggestedPrice = 0;
    let pricePerSession = 0;
    const tenantId = req.tenantId ?? 1;

    if (type === "court") {
      // Try to get price from the court's weekly schedule for this day
      const [courtRow] = await db.select({ id: courtsTable.id }).from(courtsTable)
        .where(and(eq(courtsTable.number, courtNumber), eq(courtsTable.tenantId, tenantId)));

      let schedPrice: number | null = null;
      if (courtRow) {
        const [sched] = await db.select().from(courtSchedulesTable)
          .where(and(eq(courtSchedulesTable.courtId, courtRow.id), eq(courtSchedulesTable.dayOfWeek, dayOfWeek)));
        if (sched && sched.isOpen) {
          // Determine shift based on hour and the actual configured shift boundaries
          const afternoonStart = sched.afternoonStartHour * 60 + sched.afternoonStartMinute;
          const eveningStart = sched.eveningStartHour * 60 + sched.eveningStartMinute;
          const slotMin = hour * 60;
          if (slotMin < afternoonStart) schedPrice = Number(sched.morningPrice);
          else if (slotMin < eveningStart) schedPrice = Number(sched.afternoonPrice);
          else schedPrice = Number(sched.eveningPrice);
        }
      }

      if (schedPrice !== null) {
        pricePerSession = schedPrice;
      } else {
        // Fallback: global monthly pricing for this tenant
        const pricing = await getMonthlyCourtPricing(tenantId);
        const firstDateStr = formatDate(dates[0]);
        pricePerSession = getMonthlyPriceForSlot(pricing, firstDateStr, hour);
      }
      suggestedPrice = pricePerSession * totalDurationHours * dates.length;
    } else if (type === "class") {
      const pricePerPerson = await getMonthlyClassPricingPerPerson(tenantId);
      // For classes: price = pricePerPerson × numberOfPeople × numberOfDays
      pricePerSession = pricePerPerson;
      suggestedPrice = pricePerPerson * (numberOfPeople || 1) * dates.length;
    }

    res.json({
      dates: dates.map(formatDate),
      count: dates.length,
      pricePerSession,
      suggestedPrice,
      conflicts,
      dayName: getDayOfWeekName(dayOfWeek),
      targetMonth,
    });
  } catch (err) {
    req.log.error({ err }, "Falha ao calcular preview do plano");
    res.status(500).json({ error: "Falha ao calcular preview do plano" });
  }
});

// POST /clients/:clientId/plans - create monthly plan and generate reservations
router.post("/:clientId/plans", adminAuth, async (req, res) => {
  const clientId = Number(req.params.clientId);
  const {
    type,
    courtNumber,
    durationHours,
    extraMinutes: rawExtraMinutes,
    numberOfPeople,
    dayOfWeek,
    time,
    monthlyPrice,
    checkOnly,
  } = req.body as {
    type: "court" | "class";
    courtNumber?: number;
    durationHours?: number;
    extraMinutes?: number;
    numberOfPeople?: number;
    dayOfWeek: number;
    time: string;
    monthlyPrice: string | number;
    checkOnly?: boolean;
  };

  if (!type || dayOfWeek === undefined || !time) {
    res.status(400).json({ error: "Campos obrigatórios faltando" });
    return;
  }
  if (!checkOnly && !monthlyPrice) {
    res.status(400).json({ error: "Valor por sessão é obrigatório" });
    return;
  }

  const tenantId = req.tenantId!;
  try {
    const [client] = await db
      .select()
      .from(clientsTable)
      .where(and(eq(clientsTable.id, clientId), eq(clientsTable.tenantId, tenantId)));

    if (!client) {
      res.status(404).json({ error: "Cliente não encontrado" });
      return;
    }

    const extraMin = Number(rawExtraMinutes) || 0;
    const durH = (durationHours || 1) + extraMin / 60;
    const courtN = courtNumber || 1;

    // Create bookings for ALL occurrences of this weekday in the current year
    const allYearDates = getAllWeekdayDatesInYear(dayOfWeek, time);

    if (allYearDates.length === 0) {
      res.status(400).json({
        error: `Nenhuma data disponível para ${getDayOfWeekName(dayOfWeek)} até o final do ano`,
      });
      return;
    }

    // Skip conflicting dates (don't reject; plan covers the whole year)
    const datesToCreate: string[] = [];
    const skippedDates: string[] = [];

    for (const date of allYearDates) {
      const dateStr = formatDate(date);
      let conflict = false;
      if (type === "court") {
        conflict = await hasCourtConflict(dateStr, courtN, time, durH, req.tenantId ?? 1);
      } else if (type === "class") {
        conflict = await hasClassConflict(dateStr, time);
      }
      if (conflict) {
        skippedDates.push(dateStr);
      } else {
        datesToCreate.push(dateStr);
      }
    }

    if (datesToCreate.length === 0) {
      res.status(409).json({
        error: "Conflito de horários em todas as datas do ano para este slot",
        conflictingDates: skippedDates,
      });
      return;
    }

    // If only checking conflicts, return info without creating
    if (checkOnly) {
      res.json({
        checkOnly: true,
        totalDates: datesToCreate.length + skippedDates.length,
        conflictCount: skippedDates.length,
        availableCount: datesToCreate.length,
        conflictingDates: skippedDates, // Include actual conflicting dates
      });
      return;
    }

    const targetMonth = datesToCreate[0].substring(0, 7);

    // Create the monthly plan — PIX payment does not expire
    const [monthlyPlan] = await db
      .insert(monthlyPlansTable)
      .values({
        tenantId,
        clientId,
        type,
        courtNumber: type === "court" ? courtN : null,
        durationHours: type === "court" ? durH : null,
        numberOfPeople: type === "class" ? (numberOfPeople || 1) : null,
        dayOfWeek,
        time,
        monthlyPrice: String(monthlyPrice),
        status: "pending_payment",
        paymentExpiresAt: null,
      })
      .returning();

    // Generate reservations for all target dates
    const bookingIds: number[] = [];

    for (const dateStr of datesToCreate) {
      if (type === "court") {
        const [booking] = await db
          .insert(courtBookingsTable)
          .values({
            tenantId,
            courtNumber: courtN,
            date: dateStr,
            time,
            customerName: client.name,
            customerEmail: client.email,
            customerPhone: client.phone,
            durationHours: durH,
            amount: String(monthlyPrice),
            status: "pending",
            bookingType: "monthly_plan",
          })
          .returning();
        bookingIds.push(booking.id);
      } else if (type === "class") {
        const [booking] = await db
          .insert(classBookingsTable)
          .values({
            tenantId,
            date: dateStr,
            time,
            customerName: client.name,
            customerEmail: client.email,
            customerPhone: client.phone,
            numberOfPeople: numberOfPeople || 1,
            amount: String(monthlyPrice),
            status: "pending",
          })
          .returning();
        bookingIds.push(booking.id);
      }
    }

    // Log reservation creation
    await db.insert(monthlyReservationsLogTable).values({
      monthlyPlanId: monthlyPlan.id,
      bookingIds: JSON.stringify(bookingIds),
      month: targetMonth,
      status: "created",
    });

    res.status(201).json({
      plan: monthlyPlan,
      bookingIds,
      createdDates: datesToCreate,
      skippedDates,
      message: `Plano anual criado com ${bookingIds.length} reserva(s)${skippedDates.length > 0 ? ` (${skippedDates.length} data(s) pulada(s) por conflito)` : ""}`,
    });
  } catch (err) {
    req.log.error({ err }, "Falha ao criar plano mensal");
    res.status(500).json({ error: "Falha ao criar plano mensal" });
  }
});

// PUT /clients/:clientId/plans/:planId - update monthly plan
router.put("/:clientId/plans/:planId", adminAuth, async (req, res) => {
  const clientId = Number(req.params.clientId);
  const planId = Number(req.params.planId);
  const { status, monthlyPrice } = req.body as {
    status?: string;
    monthlyPrice?: string | number;
  };

  try {
    const updates: Record<string, any> = {};
    if (status) updates.status = status;
    if (monthlyPrice) updates.monthlyPrice = String(monthlyPrice);

    const [updated] = await db
      .update(monthlyPlansTable)
      .set(updates)
      .where(
        and(
          eq(monthlyPlansTable.id, planId),
          eq(monthlyPlansTable.clientId, clientId)
        )
      )
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Plano não encontrado" });
      return;
    }

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Falha ao atualizar plano mensal");
    res.status(500).json({ error: "Falha ao atualizar plano mensal" });
  }
});

// PATCH /clients/:clientId/plans/:planId - toggle monthly plan status
// Deactivating cancels future bookings; activating recreates them
router.patch("/:clientId/plans/:planId", adminAuth, async (req, res) => {
  const clientId = Number(req.params.clientId);
  const planId = Number(req.params.planId);
  const { status } = req.body as { status?: string };

  if (!status || !["active", "inactive", "pending_payment"].includes(status)) {
    res.status(400).json({ error: "Status inválido" });
    return;
  }

  try {
    // Fetch the plan
    const [plan] = await db
      .select()
      .from(monthlyPlansTable)
      .where(and(eq(monthlyPlansTable.id, planId), eq(monthlyPlansTable.clientId, clientId)));

    if (!plan) {
      res.status(404).json({ error: "Plano não encontrado" });
      return;
    }

    const brt = getNowBrasilia();
    const todayStr = `${brt.year}-${String(brt.month + 1).padStart(2, "0")}-${String(brt.day).padStart(2, "0")}`;

    if (status === "inactive") {
      // ── Cancel all FUTURE bookings associated with this plan ──
      const reservationLogs = await db.query.monthlyReservationsLogTable.findMany({
        where: eq(monthlyReservationsLogTable.monthlyPlanId, planId),
      });

      for (const log of reservationLogs) {
        const bookingIds = JSON.parse(log.bookingIds) as number[];
        if (bookingIds.length > 0) {
          // Cancel future court bookings
          await db
            .update(courtBookingsTable)
            .set({ status: "cancelled" })
            .where(
              and(
                inArray(courtBookingsTable.id, bookingIds),
                gt(courtBookingsTable.date, todayStr)
              )
            );
          // Cancel future class bookings
          await db
            .update(classBookingsTable)
            .set({ status: "cancelled" })
            .where(
              and(
                inArray(classBookingsTable.id, bookingIds),
                gt(classBookingsTable.date, todayStr)
              )
            );
        }
      }

    } else if (status === "active") {
      // ── Confirm all pending bookings already created for this plan ──
      // Plan creation pre-creates all year bookings as "pending"; activating confirms them.
      const reservationLogs = await db.query.monthlyReservationsLogTable.findMany({
        where: eq(monthlyReservationsLogTable.monthlyPlanId, planId),
      });

      for (const log of reservationLogs) {
        let bookingIds: number[] = [];
        try {
          bookingIds = JSON.parse(log.bookingIds) as number[];
          if (!Array.isArray(bookingIds)) bookingIds = [];
        } catch { continue; }

        if (bookingIds.length === 0) continue;

        if (plan.type === "court") {
          await db
            .update(courtBookingsTable)
            .set({ status: "confirmed" })
            .where(and(
              inArray(courtBookingsTable.id, bookingIds),
              eq(courtBookingsTable.status, "pending")
            ));
        } else if (plan.type === "class") {
          await db
            .update(classBookingsTable)
            .set({ status: "confirmed" })
            .where(and(
              inArray(classBookingsTable.id, bookingIds),
              eq(classBookingsTable.status, "pending")
            ));
        }
      }
    }

    // Update the plan status
    const [updated] = await db
      .update(monthlyPlansTable)
      .set({ status })
      .where(and(eq(monthlyPlansTable.id, planId), eq(monthlyPlansTable.clientId, clientId)))
      .returning();

    res.json(updated);

    // Fire-and-forget: send welcome email when plan is activated
    if (status === "active") {
      try {
        const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId));
        if (client?.email) {
          void sendPlanWelcomeEmail({
            customerName: client.name,
            customerEmail: client.email,
            planType: plan.type as "court" | "class",
            dayOfWeek: plan.dayOfWeek ?? 1,
            time: plan.time ?? "",
            durationHours: plan.durationHours ? Number(plan.durationHours) : undefined,
            courtNumber: plan.courtNumber ?? undefined,
            numberOfPeople: plan.numberOfPeople ?? undefined,
          });
        }
      } catch (emailErr) {
        req.log.warn({ emailErr }, "Falha ao enviar email de boas-vindas ao plano");
      }
    }
  } catch (err) {
    req.log.error({ err }, "Falha ao atualizar status do plano");
    res.status(500).json({ error: "Falha ao atualizar status do plano" });
  }
});

// DELETE /clients/:clientId/plans/:planId - delete monthly plan and cancel associated bookings
router.delete("/:clientId/plans/:planId", adminAuth, async (req, res) => {
  const clientId = Number(req.params.clientId);
  const planId = Number(req.params.planId);

  try {
    const now = getNowBrasilia();
    const todayStr = `${now.year}-${String(now.month + 1).padStart(2, "0")}-${String(now.day).padStart(2, "0")}`;

    // Get reservation logs for this plan (contains booking IDs)
    const reservationLogs = await db.query.monthlyReservationsLogTable.findMany({
      where: eq(monthlyReservationsLogTable.monthlyPlanId, planId),
    });

    // Cancel only FUTURE bookings from all reservation logs (past bookings stay as-is)
    for (const log of reservationLogs) {
      let bookingIds: number[] = [];
      try {
        bookingIds = JSON.parse(log.bookingIds) as number[];
        if (!Array.isArray(bookingIds)) bookingIds = [];
      } catch {
        // Invalid JSON, skip this log
        continue;
      }
      
      if (bookingIds.length > 0) {
        // Cancel court bookings that are in the future
        await db
          .update(courtBookingsTable)
          .set({ status: "cancelled" })
          .where(
            and(
              inArray(courtBookingsTable.id, bookingIds),
              gt(courtBookingsTable.date, todayStr)
            )
          );

        // Also try to cancel class bookings that are in the future
        await db
          .update(classBookingsTable)
          .set({ status: "cancelled" })
          .where(
            and(
              inArray(classBookingsTable.id, bookingIds),
              gt(classBookingsTable.date, todayStr)
            )
          );
      }
    }

    // Delete the plan
    const [deleted] = await db
      .delete(monthlyPlansTable)
      .where(
        and(
          eq(monthlyPlansTable.id, planId),
          eq(monthlyPlansTable.clientId, clientId)
        )
      )
      .returning();

    if (!deleted) {
      res.status(404).json({ error: "Plano não encontrado" });
      return;
    }

    // Delete reservation logs
    await db
      .delete(monthlyReservationsLogTable)
      .where(eq(monthlyReservationsLogTable.monthlyPlanId, planId));

    res.json({ message: "Plano deletado com sucesso. Reservas passadas foram preservadas." });
  } catch (err) {
    req.log.error({ err }, "Falha ao deletar plano mensal");
    res.status(500).json({ error: "Falha ao deletar plano mensal" });
  }
});

// POST /clients/:clientId/plans/:planId/generate-payment - generate PIX payment for plan
router.post("/:clientId/plans/:planId/generate-payment", adminAuth, async (req, res) => {
  const clientId = Number(req.params.clientId);
  const planId = Number(req.params.planId);

  try {
    const plan = await db.query.monthlyPlansTable.findFirst({
      where: and(
        eq(monthlyPlansTable.id, planId),
        eq(monthlyPlansTable.clientId, clientId)
      ),
    });

    if (!plan) {
      res.status(404).json({ error: "Plano não encontrado" });
      return;
    }

    const client = await db.query.clientsTable.findFirst({
      where: eq(clientsTable.id, clientId),
    });

    if (!client) {
      res.status(404).json({ error: "Cliente não encontrado" });
      return;
    }

    // Determine which month to bill:
    // - pending_payment → current month (first-time payment)
    // - active → next month (renewal billing near month end)
    const nowBr = getNowBrasilia();
    let billingYear = nowBr.year;
    let billingMonth = nowBr.month; // 0-indexed
    if (plan.status === "active") {
      // Bill for next month
      if (billingMonth === 11) { billingYear += 1; billingMonth = 0; }
      else { billingMonth += 1; }
    }

    // Count how many times the plan's weekday occurs in the billing month
    const daysInBillingMonth = new Date(billingYear, billingMonth + 1, 0).getDate();
    let weekdayCount = 0;
    for (let d = 1; d <= daysInBillingMonth; d++) {
      if (new Date(billingYear, billingMonth, d).getDay() === plan.dayOfWeek) weekdayCount++;
    }
    const pricePerSession = Number(plan.monthlyPrice);
    const totalAmount = pricePerSession * weekdayCount;

    const tenantId = req.tenantId!;
    const appUrl = await getSettingOrEnv("app_url", "APP_URL", tenantId);
    const provider = await getPaymentProvider(tenantId);

    const tenantName = await getSetting("company_name", tenantId) ?? "Arenix";
    const planDescription = plan.type === "court"
      ? `${tenantName} - Quadra ${plan.courtNumber} - ${plan.durationHours}h`
      : `${tenantName} - Aula Beach Tennis`;

    const payerEmail = (client.email && !client.email.endsWith("@manual.azuos"))
      ? client.email
      : "pagamento@arenix.com.br";

    const pixExpiresAt = new Date(Date.now() + 15 * 60 * 1000);

    let pixQrCode = "";
    let pixQrCodeBase64 = "";
    let paymentId = "";

    if (provider === "picpay") {
      const picpayToken = await getSetting("picpay_token", tenantId);
      if (!picpayToken) {
        res.status(503).json({ error: "PicPay não configurado. Verifique o token nas configurações." });
        return;
      }
      const picpayKey = await getSetting("picpay_key", tenantId) ?? "";
      const callbackUrl = appUrl
        ? `${appUrl}/api/bookings/picpay-webhook${picpayKey ? `?token=${encodeURIComponent(picpayKey)}` : ""}`
        : "";
      const nameParts = client.name.trim().split(" ");
      const result = await generatePicPayPix({
        token: picpayToken,
        referenceId: `plan-${planId}`,
        callbackUrl,
        amount: totalAmount,
        buyer: { firstName: nameParts[0], lastName: nameParts.slice(1).join(" ") || "-", email: payerEmail },
        expiresAt: pixExpiresAt,
      });
      pixQrCode = result.pixQrCode;
      pixQrCodeBase64 = result.pixQrCodeBase64;
      paymentId = result.referenceId;
    } else {
      // Mercado Pago
      const mpClient = await getMpClient(tenantId);
      const paymentClient = new Payment(mpClient);
      const nameParts = client.name.trim().split(" ");
      const pixPayment = await paymentClient.create({
        body: {
          transaction_amount: totalAmount,
          payment_method_id: "pix",
          description: planDescription,
          payer: { email: payerEmail, first_name: nameParts[0], last_name: nameParts.slice(1).join(" ") || "-" },
          notification_url: appUrl ? `${appUrl}/api/bookings/webhook` : undefined,
          external_reference: `plan-${planId}`,
          date_of_expiration: pixExpiresAt.toISOString(),
        },
      });
      const txData = (pixPayment as unknown as Record<string, unknown>)?.["point_of_interaction"] as Record<string, unknown> | undefined;
      const txDataInner = txData?.["transaction_data"] as Record<string, unknown> | undefined;
      pixQrCode = (txDataInner?.["qr_code"] as string) ?? "";
      pixQrCodeBase64 = (txDataInner?.["qr_code_base64"] as string) ?? "";
      paymentId = String(pixPayment.id ?? "");
    }

    // Update plan with payment ID and reset expiry timer
    await db
      .update(monthlyPlansTable)
      .set({ mercadoPagoPreferenceId: paymentId, paymentExpiresAt: pixExpiresAt })
      .where(eq(monthlyPlansTable.id, planId));

    res.json({
      preferenceId: paymentId,
      pixQrCode,
      qrCodeUrl: pixQrCodeBase64 ? `data:image/png;base64,${pixQrCodeBase64}` : undefined,
      paymentExpiresAt: pixExpiresAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Falha ao gerar pagamento do plano");
    res.status(500).json({ error: "Falha ao gerar pagamento. Verifique as configurações de pagamento." });
  }
});

// POST /clients/:clientId/plans/:planId/mark-paid - manually mark plan as paid (for cash payments)
router.post("/:clientId/plans/:planId/mark-paid", adminAuth, async (req, res) => {
  const clientId = Number(req.params.clientId);
  const planId = Number(req.params.planId);

  try {
    const [plan] = await db
      .select()
      .from(monthlyPlansTable)
      .where(and(eq(monthlyPlansTable.id, planId), eq(monthlyPlansTable.clientId, clientId)));

    if (!plan) {
      res.status(404).json({ error: "Plano não encontrado" });
      return;
    }

    const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId));
    if (!client) {
      res.status(404).json({ error: "Cliente não encontrado" });
      return;
    }

    // All year bookings were pre-created at plan creation (status: "pending").
    // Payment just confirms the target month's bookings and logs the payment.
    // Find the "created" log that holds all year booking IDs.
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

    // Helper: confirm ALL pre-created pending bookings for this plan (entire year)
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

    // ── CASE A: Plan already "active" → renewal billing for NEXT month ──
    // Bookings are already confirmed; just log the payment.
    if (plan.status === "active") {
      const nextMonth = brt.month === 11 ? 0 : brt.month + 1;
      const nextYear = brt.month === 11 ? brt.year + 1 : brt.year;
      const targetMonth = `${nextYear}-${String(nextMonth + 1).padStart(2, "0")}`;

      // Idempotency: already logged → return as-is
      const [existingLog] = await db
        .select({ id: monthlyReservationsLogTable.id })
        .from(monthlyReservationsLogTable)
        .where(and(
          eq(monthlyReservationsLogTable.monthlyPlanId, planId),
          eq(monthlyReservationsLogTable.month, targetMonth)
        ));

      if (existingLog) {
        const [current] = await db.select().from(monthlyPlansTable).where(eq(monthlyPlansTable.id, planId));
        res.json(current);
        return;
      }

      await db.insert(monthlyReservationsLogTable).values({
        monthlyPlanId: planId,
        bookingIds: JSON.stringify([]),
        month: targetMonth,
        status: "paid",
        paymentMethod: "cash",
        paidAt: new Date(),
      });

      const [updated] = await db
        .update(monthlyPlansTable)
        .set({ paymentExpiresAt: null })
        .where(eq(monthlyPlansTable.id, planId))
        .returning();

      res.json({ ...updated, confirmedCount: 0 });
      return;
    }

    // ── CASE B: First activation (pending_payment) ──
    // Confirm ALL year bookings at once and log current month as paid.
    const brtMonth = `${brt.year}-${String(brt.month + 1).padStart(2, "0")}`;
    const confirmedCount = await confirmAllBookings();

    await db.insert(monthlyReservationsLogTable).values({
      monthlyPlanId: planId,
      bookingIds: JSON.stringify([]),
      month: brtMonth,
      status: "paid",
      paymentMethod: "cash",
      paidAt: new Date(),
    });

    const [updated] = await db
      .update(monthlyPlansTable)
      .set({ status: "active", paymentExpiresAt: null })
      .where(eq(monthlyPlansTable.id, planId))
      .returning();

    res.json({ ...updated, confirmedCount });

    // Fire-and-forget: welcome email on first activation
    if (client.email) {
      void sendPlanWelcomeEmail({
        customerName: client.name,
        customerEmail: client.email,
        planType: plan.type as "court" | "class",
        dayOfWeek: plan.dayOfWeek ?? 1,
        time: plan.time ?? "",
        durationHours: plan.durationHours ? Number(plan.durationHours) : undefined,
        courtNumber: plan.courtNumber ?? undefined,
        numberOfPeople: plan.numberOfPeople ?? undefined,
      });
    }
  } catch (err) {
    req.log.error({ err }, "Falha ao marcar plano como pago");
    res.status(500).json({ error: "Falha ao marcar plano como pago" });
  }
});

// ==================== BACKGROUND JOB: CLEANUP EXPIRED PLANS ====================

export async function cleanupExpiredPlans(): Promise<void> {
  try {
    const now = new Date();

    // Find expired pending_payment plans
    const expiredPlans = await db
      .select()
      .from(monthlyPlansTable)
      .where(
        and(
          eq(monthlyPlansTable.status, "pending_payment"),
          lt(monthlyPlansTable.paymentExpiresAt, now),
        )
      );

    if (expiredPlans.length === 0) return;

    for (const plan of expiredPlans) {
      // Get booking IDs from the latest log
      const [latestLog] = await db
        .select()
        .from(monthlyReservationsLogTable)
        .where(eq(monthlyReservationsLogTable.monthlyPlanId, plan.id))
        .orderBy(sql`created_at DESC`)
        .limit(1);

      if (latestLog) {
        const loggedIds: number[] = JSON.parse(latestLog.bookingIds as string);

        if (plan.type === "court" && loggedIds.length > 0) {
          await db
            .update(courtBookingsTable)
            .set({ status: "cancelled" })
            .where(and(inArray(courtBookingsTable.id, loggedIds), eq(courtBookingsTable.status, "pending")));
        } else if (plan.type === "class" && loggedIds.length > 0) {
          await db
            .update(classBookingsTable)
            .set({ status: "cancelled" })
            .where(and(inArray(classBookingsTable.id, loggedIds), eq(classBookingsTable.status, "pending")));
        }
      }

      // Mark plan as inactive
      await db
        .update(monthlyPlansTable)
        .set({ status: "inactive" })
        .where(eq(monthlyPlansTable.id, plan.id));
    }

    if (expiredPlans.length > 0) {
      console.log(`[cleanup] Cancelled ${expiredPlans.length} expired pending plan(s)`);
    }
  } catch (err) {
    console.error("[cleanup] Error cleaning up expired plans:", err);
  }
}

export default router;
