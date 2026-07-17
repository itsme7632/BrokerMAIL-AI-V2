import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { leadsTable } from "./leads";
import { mailboxesTable } from "./mailboxes";
import { campaignsTable } from "./campaigns";

export const commConversationsTable = pgTable("comm_conversations", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  leadId: integer("lead_id").references(() => leadsTable.id, { onDelete: "set null" }),
  mailboxId: integer("mailbox_id").references(() => mailboxesTable.id, { onDelete: "set null" }),
  campaignId: integer("campaign_id").references(() => campaignsTable.id, { onDelete: "set null" }),
  subject: text("subject").notNull().default("(No subject)"),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email").notNull(),
  customerPhone: text("customer_phone"),
  // Status: unread | read | needs_reply | replied | archived | spam
  status: text("status").notNull().default("unread"),
  starred: boolean("starred").notNull().default(false),
  messageCount: integer("message_count").notNull().default(0),
  unreadCount: integer("unread_count").notNull().default(0),
  lastMessageAt: timestamp("last_message_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type CommConversation = typeof commConversationsTable.$inferSelect;
