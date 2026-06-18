import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const composerDraftsTable = pgTable("composer_drafts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  mailboxId: integer("mailbox_id"),
  mailboxType: text("mailbox_type").notNull().default("smtp"),
  toEmail: text("to_email").notNull().default(""),
  ccEmail: text("cc_email").default(""),
  bccEmail: text("bcc_email").default(""),
  subject: text("subject").notNull().default(""),
  body: text("body").notNull().default(""),
  trackOpen: boolean("track_open").notNull().default(true),
  trackClick: boolean("track_click").notNull().default(true),
  includeBranding: boolean("include_branding").notNull().default(true),
  status: text("status").notNull().default("draft"),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type ComposerDraft = typeof composerDraftsTable.$inferSelect;
