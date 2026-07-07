import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * One row per user — stores the currently-active verification code (hashed).
 * On resend: the existing row is updated in place (upsert), invalidating the old code.
 * resendCount tracks total resends for rate-limiting.
 */
export const emailVerificationCodesTable = pgTable("email_verification_codes", {
  id:           serial("id").primaryKey(),
  userId:       integer("user_id").notNull().unique().references(() => usersTable.id, { onDelete: "cascade" }),
  codeHash:     text("code_hash").notNull(),
  expiresAt:    timestamp("expires_at").notNull(),
  usedAt:       timestamp("used_at"),
  createdAt:    timestamp("created_at").notNull().defaultNow(),
  resendCount:  integer("resend_count").notNull().default(0),
  lastSentAt:   timestamp("last_sent_at").notNull().defaultNow(),
});

export type EmailVerificationCode = typeof emailVerificationCodesTable.$inferSelect;
