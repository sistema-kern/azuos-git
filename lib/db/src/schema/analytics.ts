import { pgTable, serial, text, timestamp, integer, numeric } from "drizzle-orm/pg-core";

export const pageViewsTable = pgTable("page_views", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().default(1),
  sessionId: text("session_id").notNull(),
  path: text("path").notNull(),
  referrer: text("referrer"),
  deviceType: text("device_type"),
  durationSeconds: numeric("duration_seconds", { precision: 10, scale: 2 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
