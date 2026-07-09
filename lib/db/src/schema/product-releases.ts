import { pgTable, serial, text, boolean, timestamp, integer, jsonb } from "drizzle-orm/pg-core";

export const productReleasesTable = pgTable("product_releases", {
  id:           serial("id").primaryKey(),
  version:      text("version").notNull(),
  releaseDate:  timestamp("release_date").notNull(),
  category:     text("category").notNull(), // new_feature | improvement | bug_fix | security
  title:        text("title").notNull(),
  description:  text("description").notNull(),
  imageUrl:     text("image_url"),
  videoUrl:     text("video_url"),
  docUrl:       text("doc_url"),
  /** Bullet-point highlights shown in the version popup (JSON string[]). */
  highlights:   jsonb("highlights").$type<string[]>(),
  /** Whether this release triggers a version popup on next login. */
  isMajor:      boolean("is_major").notNull().default(false),
  isPublished:  boolean("is_published").notNull().default(false),
  createdAt:    timestamp("created_at").notNull().defaultNow(),
  updatedAt:    timestamp("updated_at").notNull().defaultNow(),
});
