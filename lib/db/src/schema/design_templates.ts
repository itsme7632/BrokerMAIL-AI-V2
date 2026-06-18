import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const designTemplatesTable = pgTable("design_templates", {
  id:          serial("id").primaryKey(),
  userId:      integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  name:        text("name").notNull(),
  description: text("description"),
  htmlLayout:  text("html_layout").notNull(),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
  updatedAt:   timestamp("updated_at").notNull().defaultNow(),
});

export type DesignTemplate = typeof designTemplatesTable.$inferSelect;
