import { pgTable, serial, integer, text, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const notificationsTable = pgTable("notifications", {
  id:       serial("id").primaryKey(),
  userId:   integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  /** new_version | announcement | roadmap_update | feedback_reply | bug_reply | feature_reply | unsubscribe */
  type:     text("type").notNull(),
  title:    text("title").notNull(),
  message:  text("message").notNull(),
  link:     text("link"),
  isRead:   boolean("is_read").notNull().default(false),
  /** ID of the related entity (release, feedback, bug report, suppression, etc.) */
  refId:    integer("ref_id"),
  /** release | announcement | roadmap_item | feedback | bug_report | feature_request | suppression */
  refType:  text("ref_type"),
  /** Rich metadata payload for structured notification types (e.g. unsubscribe) */
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
