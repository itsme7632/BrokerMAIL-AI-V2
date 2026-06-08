import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * backup_history — stores every backup created via the Backup Center.
 *
 * zip_data holds the base64-encoded ZIP file so backups can be re-downloaded
 * without external file storage. Retained up to 15 records; oldest is
 * auto-purged when a new one is created.
 *
 * manifest_summary is a compact JSON string (not full manifest) with row
 * counts for display in the history table.
 */
export const backupHistoryTable = pgTable("backup_history", {
  id:              serial("id").primaryKey(),
  name:            text("name").notNull(),
  createdById:     integer("created_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdByEmail:  text("created_by_email").notNull(),
  sizeBytes:       integer("size_bytes").notNull().default(0),
  zipData:         text("zip_data").notNull(),
  manifestSummary: text("manifest_summary").notNull().default("{}"),
  createdAt:       timestamp("created_at").notNull().defaultNow(),
});

export type BackupHistory = typeof backupHistoryTable.$inferSelect;
