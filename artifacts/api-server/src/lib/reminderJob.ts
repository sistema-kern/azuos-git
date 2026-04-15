import { db } from "@workspace/db";
import { courtBookingsTable, classBookingsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { sendBookingReminderEmail } from "./email.js";

function getBrasiliaDateStr(date: Date): string {
  // Brazil is UTC-3
  const brt = new Date(date.getTime() - 3 * 60 * 60 * 1000);
  const y = brt.getUTCFullYear();
  const m = String(brt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(brt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getTomorrowBrasilia(): string {
  const now = new Date();
  const tomorrow = new Date(now.getTime() - 3 * 60 * 60 * 1000); // shift to BRT
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const y = tomorrow.getUTCFullYear();
  const m = String(tomorrow.getUTCMonth() + 1).padStart(2, "0");
  const d = String(tomorrow.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getTodayBrasilia(): string {
  return getBrasiliaDateStr(new Date());
}

export async function sendDailyReminders(): Promise<void> {
  const tomorrowStr = getTomorrowBrasilia();
  const todayStr = getTodayBrasilia();
  console.info(`[reminderJob] Verificando reservas para ${tomorrowStr} (hoje: ${todayStr})...`);

  let sent = 0;
  let skipped = 0;

  try {
    // Court bookings for tomorrow (confirmed status)
    const courtBookings = await db
      .select()
      .from(courtBookingsTable)
      .where(
        and(
          eq(courtBookingsTable.date, tomorrowStr),
          eq(courtBookingsTable.status, "confirmed"),
        )
      );

    for (const booking of courtBookings) {
      if (!booking.customerEmail) continue;

      // Only remind if booking was created BEFORE today (i.e., more than 1 day before)
      const createdAtDate = getBrasiliaDateStr(new Date(booking.createdAt));
      if (createdAtDate >= todayStr) {
        console.info(`[reminderJob] Pulando quadra #${booking.id} — criada em ${createdAtDate}, muito recente`);
        skipped++;
        continue;
      }

      await sendBookingReminderEmail({
        customerName: booking.customerName,
        customerEmail: booking.customerEmail,
        date: booking.date,
        time: booking.time,
        durationHours: Number(booking.durationHours ?? 1),
        bookingType: "court",
        courtNumber: booking.courtNumber ?? 1,
      });
      sent++;
    }

    // Class bookings for tomorrow (confirmed status)
    const classBookings = await db
      .select()
      .from(classBookingsTable)
      .where(
        and(
          eq(classBookingsTable.date, tomorrowStr),
          eq(classBookingsTable.status, "confirmed"),
        )
      );

    for (const booking of classBookings) {
      if (!booking.customerEmail) continue;

      // Only remind if booking was created BEFORE today
      const createdAtDate = getBrasiliaDateStr(new Date(booking.createdAt));
      if (createdAtDate >= todayStr) {
        console.info(`[reminderJob] Pulando aula #${booking.id} — criada em ${createdAtDate}, muito recente`);
        skipped++;
        continue;
      }

      await sendBookingReminderEmail({
        customerName: booking.customerName,
        customerEmail: booking.customerEmail,
        date: booking.date,
        time: booking.time,
        bookingType: "class",
        numberOfPeople: booking.numberOfPeople ?? 1,
      });
      sent++;
    }

    console.info(`[reminderJob] Concluído: ${sent} lembrete(s) enviado(s), ${skipped} pulado(s) (criado no dia ou depois)`);
  } catch (err) {
    console.error("[reminderJob] Erro ao enviar lembretes:", err);
  }
}

// Schedules the reminder job to run once daily at the specified hour (Brasilia time)
export function scheduleReminderJob(hourBrasilia = 8): NodeJS.Timeout {
  function msUntilNextRun(): number {
    const now = new Date(Date.now() - 3 * 60 * 60 * 1000); // shift to Brasilia
    const target = new Date(now);
    target.setUTCHours(hourBrasilia, 0, 0, 0);
    if (target <= now) target.setUTCDate(target.getUTCDate() + 1);
    return target.getTime() - now.getTime();
  }

  const run = () => {
    void sendDailyReminders();
    setTimeout(run, 24 * 60 * 60 * 1000); // re-schedule every 24h
  };

  const initialDelay = msUntilNextRun();
  const hoursUntil = Math.round(initialDelay / 1000 / 60 / 60 * 10) / 10;
  console.info(`[reminderJob] Agendado para ${hoursUntil}h (${hourBrasilia}h Brasília)`);
  return setTimeout(run, initialDelay);
}
