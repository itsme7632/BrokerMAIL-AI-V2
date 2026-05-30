import { pgTable, serial, text, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const campaignsTable = pgTable("campaigns", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  status: text("status").notNull().default("pending"),
  templateId: integer("template_id"),
  totalLeads: integer("total_leads").notNull().default(0),
  draftedCount: integer("drafted_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  // Persistent session fields
  fileName: text("file_name"),
  sendMode: text("send_mode").notNull().default("gmail"),
  sentCount: integer("sent_count").notNull().default(0),
  currentJobId: text("current_job_id"),
  emailStyle: text("email_style").notNull().default("clean"),
  useSignature: boolean("use_signature").notNull().default(false),
  cooldownUntil: timestamp("cooldown_until"),
  // CTA / campaign link URLs
  bookingUrl: text("booking_url"),
  quoteUrl: text("quote_url"),
  websiteUrl: text("website_url"),
  phoneNumber: text("phone_number"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertCampaignSchema = createInsertSchema(campaignsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCampaign = z.infer<typeof insertCampaignSchema>;
export type Campaign = typeof campaignsTable.$inferSelect;
