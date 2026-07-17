import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { commConversationsTable } from "./comm_conversations";
import { draftsTable } from "./drafts";

export const commMessagesTable = pgTable("comm_messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id")
    .notNull()
    .references(() => commConversationsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  // "outbound" = broker sent, "inbound" = customer replied
  direction: text("direction").notNull().default("outbound"),
  fromEmail: text("from_email").notNull(),
  fromName: text("from_name"),
  toEmail: text("to_email").notNull(),
  subject: text("subject"),
  body: text("body").notNull(),
  htmlBody: text("html_body"),
  snippet: text("snippet"),
  isRead: boolean("is_read").notNull().default(false),
  // Link to existing drafts table entry (for outbound)
  draftId: integer("draft_id").references(() => draftsTable.id, { onDelete: "set null" }),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type CommMessage = typeof commMessagesTable.$inferSelect;
