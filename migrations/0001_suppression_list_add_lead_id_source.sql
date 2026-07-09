-- =============================================================================
-- Migration: suppression_list — add missing lead_id and source columns
-- Generated: 2026-07-09
--
-- Root cause: production-auth-migration.sql's CREATE TABLE IF NOT EXISTS for
-- suppression_list predates the lead_id/source columns that were added to the
-- Drizzle schema (lib/db/src/schema/suppressions.ts). Because the table
-- already existed in production, `CREATE TABLE IF NOT EXISTS` was a no-op and
-- never added the new columns — causing:
--   error: column "lead_id" of relation "suppression_list" does not exist
--
-- Safe to re-run: uses ADD COLUMN IF NOT EXISTS.
-- Apply against the production PostgreSQL database.
-- =============================================================================

BEGIN;

ALTER TABLE suppression_list ADD COLUMN IF NOT EXISTS lead_id integer;
ALTER TABLE suppression_list ADD COLUMN IF NOT EXISTS source  text;

COMMIT;
