import { pgTable, serial, text, timestamp, integer, pgEnum, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tournamentStatusEnum = pgEnum("tournament_status", ["upcoming", "open_registration", "ongoing", "finished"]);
export const categoryPhaseEnum = pgEnum("category_phase", ["registration", "group_stage", "knockout", "finished"]);
export const matchPhaseEnum = pgEnum("match_phase", ["group_stage", "eighthfinals", "quarterfinals", "semifinals", "final", "third_place"]);
export const sponsorPositionEnum = pgEnum("sponsor_position", ["left", "right", "bottom"]);
export const registrationTypeEnum = pgEnum("tournament_registration_type", ["individual", "dupla", "trio"]);
export const registrationStatusEnum = pgEnum("tournament_registration_status", ["pending_payment", "confirmed", "cancelled", "expired"]);

export const tournamentsTable = pgTable("tournaments", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().default(1),
  name: text("name").notNull(),
  description: text("description"),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
  location: text("location"),
  status: tournamentStatusEnum("status").notNull().default("upcoming"),
  bannerUrl: text("banner_url"),
  photoUrl: text("photo_url"),
  registrationPrice: text("registration_price"),
  registrationInfo: text("registration_info"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertTournamentSchema = createInsertSchema(tournamentsTable).omit({ id: true, createdAt: true });
export type InsertTournament = z.infer<typeof insertTournamentSchema>;
export type Tournament = typeof tournamentsTable.$inferSelect;

export const categoriesTable = pgTable("categories", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().default(1),
  tournamentId: integer("tournament_id").notNull().references(() => tournamentsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  phase: categoryPhaseEnum("phase").notNull().default("registration"),
  displayOrder: integer("display_order").notNull().default(0),
  registrationPrice: text("registration_price"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertCategorySchema = createInsertSchema(categoriesTable).omit({ id: true, createdAt: true });
export type InsertCategory = z.infer<typeof insertCategorySchema>;
export type Category = typeof categoriesTable.$inferSelect;

export const groupsTable = pgTable("groups", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().default(1),
  categoryId: integer("category_id").notNull().references(() => categoriesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
});

export const insertGroupSchema = createInsertSchema(groupsTable).omit({ id: true });
export type InsertGroup = z.infer<typeof insertGroupSchema>;
export type Group = typeof groupsTable.$inferSelect;

export const pairsTable = pgTable("pairs", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().default(1),
  categoryId: integer("category_id").notNull().references(() => categoriesTable.id, { onDelete: "cascade" }),
  player1Name: text("player1_name").notNull(),
  player1School: text("player1_school"),
  player2Name: text("player2_name").notNull(),
  player2School: text("player2_school"),
  photoUrl: text("photo_url"),
  groupId: integer("group_id").references(() => groupsTable.id),
  seed: integer("seed"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertPairSchema = createInsertSchema(pairsTable).omit({ id: true, createdAt: true });
export type InsertPair = z.infer<typeof insertPairSchema>;
export type Pair = typeof pairsTable.$inferSelect;

export const matchesTable = pgTable("matches", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().default(1),
  categoryId: integer("category_id").notNull().references(() => categoriesTable.id, { onDelete: "cascade" }),
  groupId: integer("group_id").references(() => groupsTable.id),
  phase: matchPhaseEnum("phase").notNull(),
  pair1Id: integer("pair1_id").references(() => pairsTable.id),
  pair2Id: integer("pair2_id").references(() => pairsTable.id),
  pair1Sets: integer("pair1_sets"),
  pair2Sets: integer("pair2_sets"),
  pair1Games: integer("pair1_games"),
  pair2Games: integer("pair2_games"),
  winnerId: integer("winner_id").references(() => pairsTable.id),
  notes: text("notes"),
  court: text("court"),
  matchOrder: integer("match_order").notNull().default(0),
  completed: integer("completed").notNull().default(0),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertMatchSchema = createInsertSchema(matchesTable).omit({ id: true, createdAt: true });
export type InsertMatch = z.infer<typeof insertMatchSchema>;
export type Match = typeof matchesTable.$inferSelect;

export const sponsorsTable = pgTable("sponsors", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().default(1),
  tournamentId: integer("tournament_id").notNull().references(() => tournamentsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  logoUrl: text("logo_url"),
  websiteUrl: text("website_url"),
  position: sponsorPositionEnum("position").notNull().default("left"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertSponsorSchema = createInsertSchema(sponsorsTable).omit({ id: true, createdAt: true });
export type InsertSponsor = z.infer<typeof insertSponsorSchema>;
export type Sponsor = typeof sponsorsTable.$inferSelect;

export const galleryPhotosTable = pgTable("gallery_photos", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().default(1),
  url: text("url").notNull(),
  caption: text("caption"),
  category: text("category"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertGalleryPhotoSchema = createInsertSchema(galleryPhotosTable).omit({ id: true, createdAt: true });
export type InsertGalleryPhoto = z.infer<typeof insertGalleryPhotoSchema>;
export type GalleryPhoto = typeof galleryPhotosTable.$inferSelect;

export const pairTournamentPointsTable = pgTable("pair_tournament_points", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().default(1),
  tournamentId: integer("tournament_id").notNull().references(() => tournamentsTable.id, { onDelete: "cascade" }),
  categoryId: integer("category_id").notNull().references(() => categoriesTable.id, { onDelete: "cascade" }),
  pairId: integer("pair_id").references(() => pairsTable.id, { onDelete: "set null" }),
  pairName: text("pair_name").notNull(),
  categoryName: text("category_name").notNull(),
  points: integer("points").notNull().default(0),
  phase: text("phase"),
  source: text("source").notNull().default("manual"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertPairTournamentPointsSchema = createInsertSchema(pairTournamentPointsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPairTournamentPoints = z.infer<typeof insertPairTournamentPointsSchema>;
export type PairTournamentPoints = typeof pairTournamentPointsTable.$inferSelect;

export const tournamentRegistrationsTable = pgTable("tournament_registrations", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().default(1),
  tournamentId: integer("tournament_id").notNull().references(() => tournamentsTable.id, { onDelete: "cascade" }),
  registrationType: registrationTypeEnum("registration_type").notNull().default("dupla"),
  categoryName: text("category_name"),
  price: text("price").notNull().default("0"),
  originalPrice: text("original_price"),
  couponCode: text("coupon_code"),
  discountAmount: text("discount_amount"),
  status: registrationStatusEnum("status").notNull().default("pending_payment"),
  pixQrCodeBase64: text("pix_qr_code_base64"),
  pixCopiaECola: text("pix_copia_e_cola"),
  pixPaymentId: text("pix_payment_id"),
  notes: text("notes"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const tournamentCouponsTable = pgTable("tournament_coupons", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().default(1),
  tournamentId: integer("tournament_id").notNull().references(() => tournamentsTable.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  discountType: text("discount_type").notNull().default("percent"),
  discountValue: numeric("discount_value", { precision: 10, scale: 2 }).notNull(),
  expiresAt: timestamp("expires_at"),
  maxUses: integer("max_uses"),
  usedCount: integer("used_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertTournamentCouponSchema = createInsertSchema(tournamentCouponsTable).omit({ id: true, createdAt: true, usedCount: true });
export type InsertTournamentCoupon = z.infer<typeof insertTournamentCouponSchema>;
export type TournamentCoupon = typeof tournamentCouponsTable.$inferSelect;

export const insertTournamentRegistrationSchema = createInsertSchema(tournamentRegistrationsTable).omit({ id: true, createdAt: true });
export type InsertTournamentRegistration = z.infer<typeof insertTournamentRegistrationSchema>;
export type TournamentRegistration = typeof tournamentRegistrationsTable.$inferSelect;

export const tournamentRegistrationPlayersTable = pgTable("tournament_registration_players", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().default(1),
  registrationId: integer("registration_id").notNull().references(() => tournamentRegistrationsTable.id, { onDelete: "cascade" }),
  fullName: text("full_name").notNull(),
  nickname: text("nickname"),
  cpf: text("cpf").notNull(),
  phone: text("phone").default(""),
  email: text("email").notNull(),
  age: integer("age").notNull(),
  shirtSize: text("shirt_size"),
  school: text("school"),
  instagram: text("instagram"),
  photoUrl: text("photo_url"),
  isMainContact: integer("is_main_contact").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertTournamentRegistrationPlayerSchema = createInsertSchema(tournamentRegistrationPlayersTable).omit({ id: true, createdAt: true });
export type InsertTournamentRegistrationPlayer = z.infer<typeof insertTournamentRegistrationPlayerSchema>;
export type TournamentRegistrationPlayer = typeof tournamentRegistrationPlayersTable.$inferSelect;
