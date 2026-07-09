import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Feature requests submitted via the global "Suggest a Feature" floating button.
 * Separate from feedback so they can be ranked, merged, and prioritized independently.
 */
export const featureRequestsTable = pgTable("feature_requests", {
  id:             serial("id").primaryKey(),
  userId:         integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  title:          text("title").notNull(),
  description:    text("description").notNull(),
  category:       text("category").notNull().default("general"),
  businessImpact: text("business_impact"),
  screenshotUrl:  text("screenshot_url"),
  currentPage:    text("current_page"),
  browser:        text("browser"),
  os:             text("os"),
  /** open | planned | in_progress | completed | declined */
  status:         text("status").notNull().default("open"),
  adminReply:     text("admin_reply"),
  adminReplyAt:   timestamp("admin_reply_at"),
  /** AI future use: merge duplicates, rank by business impact */
  embeddingText:  text("embedding_text"),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
  updatedAt:      timestamp("updated_at").notNull().defaultNow(),
});
