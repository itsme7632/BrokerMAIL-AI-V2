-- =============================================================================
-- Migration: mailboxes — add IMAP Sent-Items sync columns
-- Generated: 2026-07-22
--
-- Context:
--   Adds five nullable columns to the mailboxes table to store per-user IMAP
--   credentials used exclusively for appending sent messages to the Sent
--   folder after every SMTP send (Sent Items sync feature).
--
--   No inbox sync, no email reading, no background IMAP polling.
--
-- Columns added:
--   imap_host           — IMAP server hostname (e.g. imap.hostinger.com)
--   imap_port           — TCP port (typically 993 for SSL, 143 for STARTTLS)
--   imap_user           — IMAP login username (usually same as SMTP user)
--   imap_pass_encrypted — AES-encrypted IMAP password (same scheme as smtp_pass_encrypted)
--   imap_secure         — Encryption mode: 'ssl' | 'tls' | 'none'
--
-- All columns are nullable. Rows with imap_host IS NULL are silently skipped
-- by the application — no backfill or default values are needed.
--
-- Safe to re-run: every statement uses ADD COLUMN IF NOT EXISTS.
-- Apply against the production PostgreSQL database.
-- =============================================================================

BEGIN;

ALTER TABLE mailboxes ADD COLUMN IF NOT EXISTS imap_host          text;
ALTER TABLE mailboxes ADD COLUMN IF NOT EXISTS imap_port          integer;
ALTER TABLE mailboxes ADD COLUMN IF NOT EXISTS imap_user          text;
ALTER TABLE mailboxes ADD COLUMN IF NOT EXISTS imap_pass_encrypted text;
ALTER TABLE mailboxes ADD COLUMN IF NOT EXISTS imap_secure        text;

COMMIT;
