import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { leadsTable } from "./leads";
import { campaignsTable } from "./campaigns";

export const draftsTable = pgTable("drafts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  campaignId: integer("campaign_id").references(() => campaignsTable.id, { onDelete: "set null" }),
  leadId: integer("lead_id").references(() => leadsTable.id, { onDelete: "set null" }),
  gmailDraftId: text("gmail_draft_id"),
  email: text("email"),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  status: text("status").notNull().default("pending"),
  errorMessage: text("error_message"),
  trackingId: text("tracking_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertDraftSchema = createInsertSchema(draftsTable).omit({ id: true, createdAt: true });
export type InsertDraft = z.infer<typeof insertDraftSchema>;
export type Draft = typeof draftsTable.$inferSelect;
