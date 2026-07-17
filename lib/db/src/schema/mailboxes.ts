import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const mailboxesTable = pgTable("mailboxes", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" })
    .unique(),
  smtpHost: text("smtp_host").notNull(),
  smtpPort: integer("smtp_port").notNull().default(587),
  smtpUser: text("smtp_user").notNull(),
  smtpPassEncrypted: text("smtp_pass_encrypted").notNull(),
  smtpSecure: text("smtp_secure").notNull().default("tls"),
  imapHost: text("imap_host"),
  imapPort: integer("imap_port").default(993),
  imapUser: text("imap_user"),
  imapPassEncrypted: text("imap_pass_encrypted"),
  fromName: text("from_name"),
  replyTo: text("reply_to"),
  isActive: boolean("is_active").notNull().default(true),
  batchSize: integer("batch_size").notNull().default(10),
  delaySeconds: integer("delay_seconds").notNull().default(15),
  maxPerHour: integer("max_per_hour").notNull().default(50),
  // ── SMTP provider quota recovery state ──────────────────────────────────────
  // Set when the SMTP server rejects a send with a quota/rate-limit error.
  // Cleared automatically once a probe email sends successfully.
  quotaStatus:       text("quota_status"),           // null | 'quota_reached'
  quotaReachedAt:    timestamp("quota_reached_at"),  // first detection timestamp
  quotaCooldownUntil: timestamp("quota_cooldown_until"), // next probe attempt time
  quotaSmtpResponse: text("quota_smtp_response"),    // original SMTP error message
  quotaProbeCount:   integer("quota_probe_count").default(0), // consecutive failed probes
  // ── Per-mailbox quota recovery settings ─────────────────────────────────────
  cooldownMinutes:    integer("cooldown_minutes").notNull().default(60),  // initial cooldown on quota detection
  probeRetryMinutes:  integer("probe_retry_minutes").notNull().default(5), // extra wait on each failed probe
  // ── Communications inbox sync ────────────────────────────────────────────────
  // Timestamp of the last successful IMAP inbox sync for the Communications feature.
  // Used for incremental sync: only messages after this date are fetched on the next run.
  lastCommSyncAt: timestamp("last_comm_sync_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Mailbox = typeof mailboxesTable.$inferSelect;
