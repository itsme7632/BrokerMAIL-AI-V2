import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const adminSettingsTable = pgTable("admin_settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type AdminSetting = typeof adminSettingsTable.$inferSelect;
