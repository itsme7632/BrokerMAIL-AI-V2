import { pgTable, serial, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * processed_bounces — deduplication registry for the bounce scanner.
 *
 * Records every IMAP message that has been successfully processed by the
 * bounce scanner, keyed by (mailbox_id, message_id).  The scanner checks
 * this table before processing a message and inserts a row after successful
 * processing.  This replaces the previous "mark as \Seen" approach, which
 * was fragile: any mail client opening the mailbox could mark bounce NDRs
 * as Seen before the scanner ran, causing permanent misses.
 *
 * message_id is the RFC 2822 Message-ID header value of the NDR email.
 * recipient is stored for observability only — it is not part of any unique
 * constraint and may be NULL if extraction failed (skipped messages are not
 * recorded here; only successfully-processed ones are).
 */
export const processedBouncesTable = pgTable("processed_bounces", {
  id:          serial("id").primaryKey(),
  mailboxId:   integer("mailbox_id").notNull(),
  messageId:   text("message_id").notNull(),
  recipient:   text("recipient"),
  processedAt: timestamp("processed_at").notNull().defaultNow(),
}, (t) => ({
  mailboxMessageUniq: uniqueIndex("processed_bounces_mailbox_message_uniq").on(t.mailboxId, t.messageId),
}));

export type ProcessedBounce = typeof processedBouncesTable.$inferSelect;
