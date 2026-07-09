import { pgTable, serial, text, boolean, timestamp, integer } from "drizzle-orm/pg-core";

export const roadmapItemsTable = pgTable("roadmap_items", {
  id:               serial("id").primaryKey(),
  title:            text("title").notNull(),
  description:      text("description").notNull(),
  /** in_development | planned | researching | future */
  status:           text("status").notNull().default("planned"),
  category:         text("category").notNull().default("general"),
  /** 0–100 */
  progress:         integer("progress").notNull().default(0),
  estimatedRelease: text("estimated_release"),
  voteCount:        integer("vote_count").notNull().default(0),
  sortOrder:        integer("sort_order").notNull().default(0),
  isPublished:      boolean("is_published").notNull().default(true),
  /** AI future use: embedding text for duplicate detection / ranking */
  embeddingText:    text("embedding_text"),
  createdAt:        timestamp("created_at").notNull().defaultNow(),
  updatedAt:        timestamp("updated_at").notNull().defaultNow(),
});
