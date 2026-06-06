import { pgTable, serial, text, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * suppression_list — per-user email suppression registry.
 *
 * Emails are added automatically when the bounce scanner detects a permanent
 * 5xx failure (550 User Unknown, 554 Recipient Rejected, etc.).
 * They can also be managed manually via the /api/suppressions routes.
 *
 * Composite unique index on (user_id, email) so each user maintains their own
 * independent suppression list — one tenant's bounce doesn't block another's.
 */
export const suppressionListTable = pgTable("suppression_list", {
  id:         serial("id").primaryKey(),
  userId:     integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  email:      text("email").notNull(),
  reason:     text("reason").notNull(),
  bounceCode: text("bounce_code"),
  campaignId: integer("campaign_id"),
  createdAt:  timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  userEmailUniq: uniqueIndex("suppression_user_email_uniq").on(t.userId, t.email),
}));

export type SuppressionEntry = typeof suppressionListTable.$inferSelect;
