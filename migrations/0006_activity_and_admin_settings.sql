-- =============================================================================
-- Migration: activity + admin_settings — missing CREATE TABLE statements
-- Generated: 2026-07-27
--
-- Audit findings:
--   Two tables exported from lib/db/src/schema/index.ts have no corresponding
--   CREATE TABLE statement in any migration file:
--
--   1. activity
--      Defined in:  lib/db/src/schema/activity.ts (activityTable)
--      Used by:     API server activity/audit log writes (POST /api/campaigns,
--                   lead status changes, admin actions, etc.)
--      Columns:     id, user_id, type, description, metadata, created_at
--
--   2. admin_settings
--      Defined in:  lib/db/src/schema/admin_settings.ts (adminSettingsTable)
--      Used by:     /api/admin/settings — stores key/value pairs for
--                   tracking URL, system config, feature flags, etc.
--      Columns:     id, key (UNIQUE), value, updated_at
--
--   Both tables are believed to have existed in the original production
--   database before the migration-file regime began (production-auth-
--   migration.sql, 2026-07-07).  However, no migration has ever documented
--   their creation, meaning:
--     a) a fresh environment (dev clone, staging, new deploy) would not
--        have these tables;
--     b) any schema drift would go undetected.
--
--   Note: system_logs (also in activity.ts) WAS included in production-auth-
--   migration.sql at line 148 and is therefore already covered.
--
-- Safe to re-run: both statements use CREATE TABLE IF NOT EXISTS.
-- Apply against any PostgreSQL database running the Drizzle schema.
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. activity — user/system event log
--    activityTable in lib/db/src/schema/activity.ts
--    user_id is nullable (SET NULL on cascade) to preserve log entries when
--    a user account is deleted.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activity (
    id          serial    PRIMARY KEY,
    user_id     integer   REFERENCES users(id) ON DELETE SET NULL,
    type        text      NOT NULL,
    description text      NOT NULL,
    metadata    jsonb,
    created_at  timestamp NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. admin_settings — key/value configuration store
--    adminSettingsTable in lib/db/src/schema/admin_settings.ts
--    key must be unique; the application upserts on key conflict.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_settings (
    id         serial    PRIMARY KEY,
    key        text      NOT NULL,
    value      text      NOT NULL,
    updated_at timestamp NOT NULL DEFAULT now(),
    CONSTRAINT admin_settings_key_unique UNIQUE (key)
);

COMMIT;
