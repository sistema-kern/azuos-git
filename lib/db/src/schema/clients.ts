import { pgTable, serial, text, timestamp, integer, numeric, pgEnum, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const monthlyPlanTypeEnum = pgEnum("monthly_plan_type", ["court", "class"]);
export const monthlyPlanStatusEnum = pgEnum("monthly_plan_status", ["active", "inactive", "pending_payment"]);

export const clientsTable = pgTable("clients", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().default(1),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  cpf: text("cpf"),
  notes: text("notes"),
  address: jsonb("address"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertClientSchema = createInsertSchema(clientsTable).omit({ id: true, createdAt: true });
export type InsertClient = z.infer<typeof insertClientSchema>;
export type Client = typeof clientsTable.$inferSelect;

export const monthlyPlansTable = pgTable("monthly_plans", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().default(1),
  clientId: integer("client_id").notNull(),
  type: monthlyPlanTypeEnum("type").notNull(),

  courtNumber: integer("court_number"),
  durationHours: numeric("duration_hours", { precision: 4, scale: 2 }).default("1"),

  numberOfPeople: integer("number_of_people"),

  dayOfWeek: integer("day_of_week").notNull(),
  time: text("time").notNull(),

  monthlyPrice: numeric("monthly_price", { precision: 10, scale: 2 }).notNull(),

  status: monthlyPlanStatusEnum("status").notNull().default("active"),

  lastNotificationDate: text("last_notification_date"),

  mercadoPagoPreferenceId: text("mercado_pago_preference_id"),
  lastPaymentDate: text("last_payment_date"),
  paymentExpiresAt: timestamp("payment_expires_at"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertMonthlyPlanSchema = createInsertSchema(monthlyPlansTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMonthlyPlan = z.infer<typeof insertMonthlyPlanSchema>;
export type MonthlyPlan = typeof monthlyPlansTable.$inferSelect;

export const monthlyReservationsLogTable = pgTable("monthly_reservations_log", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().default(1),
  monthlyPlanId: integer("monthly_plan_id").notNull(),
  bookingIds: text("booking_ids").notNull(),
  month: text("month").notNull(),
  status: text("status").notNull().default("created"),
  paymentMethod: text("payment_method"),
  paidAt: text("paid_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertMonthlyReservationsLogSchema = createInsertSchema(monthlyReservationsLogTable).omit({ id: true, createdAt: true });
export type InsertMonthlyReservationsLog = z.infer<typeof insertMonthlyReservationsLogSchema>;
export type MonthlyReservationsLog = typeof monthlyReservationsLogTable.$inferSelect;
