import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const feedbackTable = pgTable("feedback", {
  id:              serial("id").primaryKey(),
  userId:          integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  /** feature_request | improvement | general */
  type:            text("type").notNull(),
  title:           text("title").notNull(),
  description:     text("description").notNull(),
  category:        text("category").notNull(),
  /** low | medium | high | critical */
  priority:        text("priority").notNull().default("medium"),
  /** open | planned | completed | closed */
  status:          text("status").notNull().default("open"),
  // Automatically captured context
  currentPage:     text("current_page"),
  browser:         text("browser"),
  os:              text("os"),
  platformVersion: text("platform_version"),
  // Admin
  adminReply:      text("admin_reply"),
  adminReplyAt:    timestamp("admin_reply_at"),
  /** AI future use: grouping, ranking, summarization */
  embeddingText:   text("embedding_text"),
  createdAt:       timestamp("created_at").notNull().defaultNow(),
  updatedAt:       timestamp("updated_at").notNull().defaultNow(),
});
