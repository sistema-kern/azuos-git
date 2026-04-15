import app from "./app";
import { logger } from "./lib/logger";
import { cleanupExpiredPendingBookings } from "./routes/bookings.js";
import { cleanupExpiredPlans } from "./routes/clients.js";
import { scheduleReminderJob } from "./lib/reminderJob.js";
import { scheduleBillingJob } from "./lib/billingJob.js";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Warn on missing payment config so operators catch misconfiguration early
if (!process.env["MERCADOPAGO_ACCESS_TOKEN"]) {
  logger.warn("MERCADOPAGO_ACCESS_TOKEN is not set — tenant booking payment flows will be disabled");
}
if (!process.env["APP_URL"]) {
  logger.warn("APP_URL is not set — Mercado Pago webhook and back_url callbacks will be empty");
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Ensure DB indexes for clients search performance (fire-and-forget)
  Promise.all([
    db.execute(sql`CREATE INDEX IF NOT EXISTS idx_clients_tenant_id ON clients(tenant_id)`),
    db.execute(sql`CREATE INDEX IF NOT EXISTS idx_clients_tenant_name ON clients(tenant_id, name)`),
    db.execute(sql`CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients(tenant_id, phone)`),
    db.execute(sql`CREATE INDEX IF NOT EXISTS idx_clients_cpf ON clients(tenant_id, cpf)`),
  ]).then(() => logger.info("Índices de clients criados/verificados"))
    .catch((e) => logger.warn({ e }, "Não foi possível criar índices de clients"));

  // Start cleanup job: run every 2 minutes to cancel expired pending bookings and plans
  setInterval(async () => {
    await cleanupExpiredPendingBookings();
    await cleanupExpiredPlans();
  }, 2 * 60 * 1000);

  // Start daily reminder job: sends email reminders 1 day before bookings (8h Brasília)
  scheduleReminderJob(8);

  // Start billing job: checks for tenants due for monthly payment every 6h
  scheduleBillingJob();
});
