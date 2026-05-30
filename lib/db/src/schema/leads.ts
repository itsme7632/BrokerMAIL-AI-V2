import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { campaignsTable } from "./campaigns";

export const leadsTable = pgTable("leads", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  campaignId: integer("campaign_id").references(() => campaignsTable.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  email: text("email").notNull(),
  vehicle: text("vehicle"),
  route: text("route"),
  pickup: text("pickup"),
  delivery: text("delivery"),
  price: text("price"),
  notes: text("notes"),
  quoteId: text("quote_id"),
  status: text("status").notNull().default("new"),
  gmailDraftId: text("gmail_draft_id"),
  errorMessage: text("error_message"),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertLeadSchema = createInsertSchema(leadsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertLead = z.infer<typeof insertLeadSchema>;
export type Lead = typeof leadsTable.$inferSelect;
