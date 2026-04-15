import { pgTable, serial, text, timestamp, boolean, integer, numeric, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tenantsTable = pgTable("tenants", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  customDomain: text("custom_domain"),
  active: boolean("active").notNull().default(true),
  // Billing
  monthlyPrice: numeric("monthly_price", { precision: 10, scale: 2 }),
  subscriptionStatus: text("subscription_status").notNull().default("active"),
  nextBillingDate: timestamp("next_billing_date"),
  billingEmail: text("billing_email"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertTenantSchema = createInsertSchema(tenantsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTenant = z.infer<typeof insertTenantSchema>;
export type Tenant = typeof tenantsTable.$inferSelect;

export const tenantAdminsTable = pgTable("tenant_admins", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  active: boolean("active").notNull().default(true),
  notifyBookings: boolean("notify_bookings").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  unique("tenant_admins_email_tenant_unique").on(table.email, table.tenantId),
]);

export const insertTenantAdminSchema = createInsertSchema(tenantAdminsTable).omit({ id: true, createdAt: true });
export type InsertTenantAdmin = z.infer<typeof insertTenantAdminSchema>;
export type TenantAdmin = typeof tenantAdminsTable.$inferSelect;

export const tenantBillingsTable = pgTable("tenant_billings", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  status: text("status").notNull().default("pending"),
  dueDate: timestamp("due_date").notNull(),
  paidAt: timestamp("paid_at"),
  pixQrCode: text("pix_qr_code"),
  pixCopyPaste: text("pix_copy_paste"),
  mpPaymentId: text("mp_payment_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type TenantBilling = typeof tenantBillingsTable.$inferSelect;

export const pushSubscriptionsTable = pgTable("push_subscriptions", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type PushSubscription = typeof pushSubscriptionsTable.$inferSelect;
