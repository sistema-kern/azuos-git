import { pgTable, serial, text, timestamp, integer, numeric, pgEnum, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const bookingStatusEnum = pgEnum("booking_status", ["pending", "confirmed", "cancelled"]);

export const courtBookingsTable = pgTable("court_bookings", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().default(1),
  courtNumber: integer("court_number").notNull().default(1),
  date: text("date").notNull(),
  time: text("time").notNull(),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email").notNull(),
  customerPhone: text("customer_phone").notNull(),
  durationHours: numeric("duration_hours", { precision: 4, scale: 2 }).notNull().default("1"),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  status: bookingStatusEnum("status").notNull().default("pending"),
  paymentId: text("payment_id"),
  mercadoPagoPreferenceId: text("mercado_pago_preference_id"),
  bookingType: text("booking_type").notNull().default("individual"),
  monthlyGroupId: text("monthly_group_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertCourtBookingSchema = createInsertSchema(courtBookingsTable).omit({ id: true, createdAt: true });
export type InsertCourtBooking = z.infer<typeof insertCourtBookingSchema>;
export type CourtBooking = typeof courtBookingsTable.$inferSelect;

export const classBookingsTable = pgTable("class_bookings", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().default(1),
  date: text("date").notNull(),
  time: text("time").notNull(),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email").notNull(),
  customerPhone: text("customer_phone").notNull(),
  numberOfPeople: integer("number_of_people").notNull(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  status: bookingStatusEnum("status").notNull().default("pending"),
  paymentId: text("payment_id"),
  mercadoPagoPreferenceId: text("mercado_pago_preference_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertClassBookingSchema = createInsertSchema(classBookingsTable).omit({ id: true, createdAt: true });
export type InsertClassBooking = z.infer<typeof insertClassBookingSchema>;
export type ClassBooking = typeof classBookingsTable.$inferSelect;

export const courtsTable = pgTable("courts", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().default(1),
  name: text("name").notNull(),
  number: integer("number").notNull(),
  description: text("description"),
  photoUrl: text("photo_url"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertCourtSchema = createInsertSchema(courtsTable).omit({ id: true, createdAt: true });
export type InsertCourt = z.infer<typeof insertCourtSchema>;
export type Court = typeof courtsTable.$inferSelect;

export const courtSchedulesTable = pgTable("court_schedules", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().default(1),
  courtId: integer("court_id").notNull(),
  dayOfWeek: integer("day_of_week").notNull(),
  openHour: integer("open_hour").notNull().default(8),
  openMinute: integer("open_minute").notNull().default(0),
  afternoonStartHour: integer("afternoon_start_hour").notNull().default(12),
  afternoonStartMinute: integer("afternoon_start_minute").notNull().default(0),
  eveningStartHour: integer("evening_start_hour").notNull().default(17),
  eveningStartMinute: integer("evening_start_minute").notNull().default(0),
  closeHour: integer("close_hour").notNull().default(22),
  closeMinute: integer("close_minute").notNull().default(0),
  isOpen: boolean("is_open").notNull().default(true),
  morningPrice: numeric("morning_price", { precision: 8, scale: 2 }).notNull().default("60.00"),
  afternoonPrice: numeric("afternoon_price", { precision: 8, scale: 2 }).notNull().default("70.00"),
  eveningPrice: numeric("evening_price", { precision: 8, scale: 2 }).notNull().default("80.00"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type CourtSchedule = typeof courtSchedulesTable.$inferSelect;
