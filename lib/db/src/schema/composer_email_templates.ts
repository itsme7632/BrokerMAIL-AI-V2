import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const composerEmailTemplatesTable = pgTable("composer_email_templates", {
  id:              serial("id").primaryKey(),
  userId:          integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  name:            text("name").notNull(),
  subject:         text("subject").notNull().default(""),
  body:            text("body").notNull().default(""),
  designId:        text("design_id").notNull().default("professional"),
  includeBranding: boolean("include_branding").notNull().default(true),
  createdAt:       timestamp("created_at").notNull().defaultNow(),
  updatedAt:       timestamp("updated_at").notNull().defaultNow(),
});

export type ComposerEmailTemplate = typeof composerEmailTemplatesTable.$inferSelect;
