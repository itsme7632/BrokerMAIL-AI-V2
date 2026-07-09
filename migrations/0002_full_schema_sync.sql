-- =============================================================================
-- Migration: full schema sync — production (DigitalOcean) → Drizzle schema
-- Generated: 2026-07-09
--
-- Source of comparison: full introspection of information_schema.columns,
-- pg_constraint, and pg_indexes on both the dev database and the DigitalOcean
-- production database, diffed against lib/db/src/schema/*.
--
-- Findings:
--   1. Nine tables that exist in the Drizzle schema (and in dev) are entirely
--      missing from production: announcements, bug_reports, feature_requests,
--      feature_votes, feedback, notifications, product_releases,
--      roadmap_items, user_release_reads.
--      These are unrelated features (in-app notifications, announcements,
--      bug/feature/feedback forms, product roadmap) that were added to the
--      schema after the last production sync and never migrated over.
--   2. mailboxes.max_per_hour has a stale default of 100 in production;
--      the current schema (lib/db/src/schema/mailboxes.ts) defines it as 50.
--      Existing rows are untouched — this only changes the column default
--      applied to future inserts that omit the value.
--   3. Two FK constraints exist in both databases but with legacy
--      auto-generated names in production (email_verification_codes_user_id_fkey,
--      password_reset_tokens_user_id_fkey) vs. Drizzle's naming convention
--      (..._users_id_fk). Functionally identical (same columns, same
--      ON DELETE behavior) — renamed here only for exact parity with the
--      schema/dev naming convention, matching the "exact match" requirement.
--   4. All other tables/columns/indexes/constraints already match.
--
-- Safe to re-run: every statement is idempotent (IF NOT EXISTS / guarded).
-- Apply against the production PostgreSQL database.
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1a. announcements
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS announcements (
    id               serial PRIMARY KEY,
    message          text NOT NULL,
    background_color text NOT NULL DEFAULT '#3b82f6',
    priority         integer NOT NULL DEFAULT 0,
    start_date       timestamp,
    end_date         timestamp,
    is_dismissible   boolean NOT NULL DEFAULT true,
    link             text,
    link_label       text,
    is_active        boolean NOT NULL DEFAULT true,
    created_at       timestamp NOT NULL DEFAULT now(),
    updated_at       timestamp NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- 1b. bug_reports
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bug_reports (
    id                 serial PRIMARY KEY,
    user_id            integer REFERENCES users(id) ON DELETE SET NULL,
    title              text NOT NULL,
    description        text NOT NULL,
    steps_to_reproduce text NOT NULL,
    expected_result    text NOT NULL,
    actual_result      text NOT NULL,
    severity           text NOT NULL DEFAULT 'medium',
    status             text NOT NULL DEFAULT 'open',
    current_url        text,
    browser            text,
    os                 text,
    screen_resolution  text,
    platform_version   text,
    screenshot_url     text,
    video_url          text,
    assigned_to        text,
    admin_reply        text,
    admin_reply_at     timestamp,
    embedding_text     text,
    created_at         timestamp NOT NULL DEFAULT now(),
    updated_at         timestamp NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- 1c. feature_requests
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS feature_requests (
    id               serial PRIMARY KEY,
    user_id          integer REFERENCES users(id) ON DELETE SET NULL,
    title            text NOT NULL,
    description      text NOT NULL,
    category         text NOT NULL DEFAULT 'general',
    business_impact  text,
    screenshot_url   text,
    current_page     text,
    browser          text,
    os               text,
    status           text NOT NULL DEFAULT 'open',
    admin_reply      text,
    admin_reply_at   timestamp,
    embedding_text   text,
    created_at       timestamp NOT NULL DEFAULT now(),
    updated_at       timestamp NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- 1d. roadmap_items (must exist before feature_votes FK)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS roadmap_items (
    id                serial PRIMARY KEY,
    title             text NOT NULL,
    description       text NOT NULL,
    status            text NOT NULL DEFAULT 'planned',
    category          text NOT NULL DEFAULT 'general',
    progress          integer NOT NULL DEFAULT 0,
    estimated_release text,
    vote_count        integer NOT NULL DEFAULT 0,
    sort_order        integer NOT NULL DEFAULT 0,
    is_published      boolean NOT NULL DEFAULT true,
    embedding_text    text,
    created_at        timestamp NOT NULL DEFAULT now(),
    updated_at        timestamp NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- 1e. feature_votes (depends on roadmap_items, users)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS feature_votes (
    id              serial PRIMARY KEY,
    roadmap_item_id integer NOT NULL REFERENCES roadmap_items(id) ON DELETE CASCADE,
    user_id         integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at      timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS feature_votes_unique ON feature_votes (roadmap_item_id, user_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 1f. feedback
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS feedback (
    id               serial PRIMARY KEY,
    user_id          integer REFERENCES users(id) ON DELETE SET NULL,
    type             text NOT NULL,
    title            text NOT NULL,
    description      text NOT NULL,
    category         text NOT NULL,
    priority         text NOT NULL DEFAULT 'medium',
    status           text NOT NULL DEFAULT 'open',
    current_page     text,
    browser          text,
    os               text,
    platform_version text,
    admin_reply      text,
    admin_reply_at   timestamp,
    embedding_text   text,
    created_at       timestamp NOT NULL DEFAULT now(),
    updated_at       timestamp NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- 1g. notifications
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
    id         serial PRIMARY KEY,
    user_id    integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type       text NOT NULL,
    title      text NOT NULL,
    message    text NOT NULL,
    link       text,
    is_read    boolean NOT NULL DEFAULT false,
    ref_id     integer,
    ref_type   text,
    created_at timestamp NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- 1h. product_releases (must exist before user_release_reads FK)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_releases (
    id           serial PRIMARY KEY,
    version      text NOT NULL,
    release_date timestamp NOT NULL,
    category     text NOT NULL,
    title        text NOT NULL,
    description  text NOT NULL,
    image_url    text,
    video_url    text,
    doc_url      text,
    highlights   jsonb,
    is_major     boolean NOT NULL DEFAULT false,
    is_published boolean NOT NULL DEFAULT false,
    created_at   timestamp NOT NULL DEFAULT now(),
    updated_at   timestamp NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- 1i. user_release_reads (depends on users, product_releases)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_release_reads (
    id         serial PRIMARY KEY,
    user_id    integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    release_id integer NOT NULL REFERENCES product_releases(id) ON DELETE CASCADE,
    read_at    timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS user_release_reads_unique ON user_release_reads (user_id, release_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. mailboxes.max_per_hour — stale default (prod: 100, schema: 50)
--    Existing rows are NOT modified, only the column default going forward.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE mailboxes ALTER COLUMN max_per_hour SET DEFAULT 50;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Cosmetic constraint-name parity with Drizzle's naming convention.
--    Functionally identical FKs (same column, same ON DELETE CASCADE) —
--    renamed only so \d output matches dev/schema exactly.
-- ─────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'email_verification_codes_user_id_fkey'
  ) THEN
    ALTER TABLE email_verification_codes
      RENAME CONSTRAINT email_verification_codes_user_id_fkey
      TO email_verification_codes_user_id_users_id_fk;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'password_reset_tokens_user_id_fkey'
  ) THEN
    ALTER TABLE password_reset_tokens
      RENAME CONSTRAINT password_reset_tokens_user_id_fkey
      TO password_reset_tokens_user_id_users_id_fk;
  END IF;
END $$;

COMMIT;
