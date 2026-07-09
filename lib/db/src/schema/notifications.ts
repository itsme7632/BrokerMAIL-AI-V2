import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const notificationsTable = pgTable("notifications", {
  id:       serial("id").primaryKey(),
  userId:   integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  /** new_version | announcement | roadmap_update | feedback_reply | bug_reply | feature_reply */
  type:     text("type").notNull(),
  title:    text("title").notNull(),
  message:  text("message").notNull(),
  link:     text("link"),
  isRead:   boolean("is_read").notNull().default(false),
  /** ID of the related entity (release, feedback, bug report, etc.) */
  refId:    integer("ref_id"),
  /** release | announcement | roadmap_item | feedback | bug_report | feature_request */
  refType:  text("ref_type"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
