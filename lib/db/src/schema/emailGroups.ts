import { pgTable, serial, text, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const emailGroupsTable = pgTable("email_groups", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().default(1),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const emailGroupMembersTable = pgTable("email_group_members", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().default(1),
  groupId: integer("group_id").notNull().references(() => emailGroupsTable.id, { onDelete: "cascade" }),
  name: text("name"),
  email: text("email").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertEmailGroupSchema = createInsertSchema(emailGroupsTable).omit({ id: true, createdAt: true });
export type InsertEmailGroup = z.infer<typeof insertEmailGroupSchema>;
export type EmailGroup = typeof emailGroupsTable.$inferSelect;

export const insertEmailGroupMemberSchema = createInsertSchema(emailGroupMembersTable).omit({ id: true, createdAt: true });
export type InsertEmailGroupMember = z.infer<typeof insertEmailGroupMemberSchema>;
export type EmailGroupMember = typeof emailGroupMembersTable.$inferSelect;
