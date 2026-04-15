import { pgTable, serial, text, timestamp, integer, uniqueIndex } from "drizzle-orm/pg-core";

export const settingsTable = pgTable("settings", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().default(1),
  key: text("key").notNull(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("settings_tenant_key_idx").on(t.tenantId, t.key),
]);

export const newsletterSubscribersTable = pgTable("newsletter_subscribers", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().default(1),
  email: text("email").notNull(),
  name: text("name"),
  active: text("active").notNull().default("true"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("newsletter_tenant_email_idx").on(t.tenantId, t.email),
]);

export const emailTemplatesTable = pgTable("email_templates", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().default(1),
  name: text("name").notNull(),
  subject: text("subject"),
  content: text("content").notNull(),
  bgColor: text("bg_color").default("#ffffff"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const emailCampaignsTable = pgTable("email_campaigns", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().default(1),
  name: text("name").notNull(),
  subject: text("subject").notNull(),
  content: text("content").notNull(),
  bgColor: text("bg_color").default("#ffffff"),
  filter: text("filter").notNull().default("all"),
  status: text("status").notNull().default("draft"),
  sentAt: timestamp("sent_at"),
  sentCount: integer("sent_count").default(0),
  failedCount: integer("failed_count").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
