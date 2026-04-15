import { pgTable, serial, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";

export const homeSlides = pgTable("home_slides", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().default(1),
  title: text("title").notNull(),
  subtitle: text("subtitle").default(""),
  cta1Label: text("cta1_label").default(""),
  cta1Href: text("cta1_href").default(""),
  cta1Icon: text("cta1_icon").default("calendar"),
  cta2Label: text("cta2_label").default(""),
  cta2Href: text("cta2_href").default(""),
  cta2Icon: text("cta2_icon").default("trophy"),
  bgImageUrl: text("bg_image_url").default(""),
  gradient: text("gradient").default("from-background via-background/65 to-transparent"),
  displayOrder: integer("display_order").default(0),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const homeCards = pgTable("home_cards", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().default(1),
  title: text("title").notNull(),
  description: text("description").default(""),
  icon: text("icon").default("star"),
  linkHref: text("link_href").default(""),
  linkLabel: text("link_label").default("Saiba mais"),
  highlight: boolean("highlight").default(false),
  displayOrder: integer("display_order").default(0),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});
