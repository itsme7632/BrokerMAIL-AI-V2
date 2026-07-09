import { pgTable, serial, text, boolean, timestamp, integer } from "drizzle-orm/pg-core";

export const announcementsTable = pgTable("announcements", {
  id:              serial("id").primaryKey(),
  message:         text("message").notNull(),
  backgroundColor: text("background_color").notNull().default("#3b82f6"),
  /** Higher priority = shown first when multiple are active */
  priority:        integer("priority").notNull().default(0),
  startDate:       timestamp("start_date"),
  endDate:         timestamp("end_date"),
  isDismissible:   boolean("is_dismissible").notNull().default(true),
  link:            text("link"),
  linkLabel:       text("link_label"),
  isActive:        boolean("is_active").notNull().default(true),
  createdAt:       timestamp("created_at").notNull().defaultNow(),
  updatedAt:       timestamp("updated_at").notNull().defaultNow(),
});
