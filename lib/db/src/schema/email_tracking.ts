import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { draftsTable } from "./drafts";

export const emailTrackingEventsTable = pgTable("email_tracking_events", {
  id: serial("id").primaryKey(),
  draftId: integer("draft_id").references(() => draftsTable.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  linkUrl: text("link_url"),
  buttonLabel: text("button_label"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type EmailTrackingEvent = typeof emailTrackingEventsTable.$inferSelect;
