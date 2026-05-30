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
  maxPerHour: integer("max_per_hour").notNull().default(100),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Mailbox = typeof mailboxesTable.$inferSelect;
