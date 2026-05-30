import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { campaignsTable } from "./campaigns";

export const campaignBatchesTable = pgTable("campaign_batches", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").notNull().references(() => campaignsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  jobId: text("job_id"),
  sendMode: text("send_mode").notNull().default("smtp"),
  batchSize: integer("batch_size").notNull().default(0),
  sentCount: integer("sent_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  mailboxEmail: text("mailbox_email"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type CampaignBatch = typeof campaignBatchesTable.$inferSelect;
