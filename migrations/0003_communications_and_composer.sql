-- =============================================================================
-- Migration: communications system + composer tables + mailbox quota columns
-- Generated: 2026-07-17
--
-- Context:
--   Migration 0002 (2026-07-09) synced production up to the schema at that
--   date.  The following objects were added to the Drizzle schema after 0002
--   and are entirely absent from production:
--
--   New tables:
--     comm_conversations   — communications inbox conversations
--     comm_messages        — per-message records (inbound + outbound)
--     comm_notes           — internal broker notes on a conversation
--     composer_drafts      — standalone composer draft/sent tracking
--     design_templates     — user HTML email layout templates
--     composer_email_templates — saved templates for the composer
--
--   New columns on users:
--     gmail_comm_sync_at   — incremental Gmail inbox sync anchor
--
--   New columns on mailboxes:
--     last_comm_sync_at    — incremental IMAP inbox sync anchor
--     quota_status         — quota recovery state
--     quota_reached_at     — first quota detection timestamp
--     quota_cooldown_until — next probe attempt time
--     quota_smtp_response  — original SMTP error message
--     quota_probe_count    — consecutive failed probe count
--     cooldown_minutes     — initial cooldown on quota detection
--     probe_retry_minutes  — extra wait per failed probe
--
--   New columns on drafts:
--     sent_at              — timestamp when the draft was sent (if not yet present)
--
-- Safe to re-run: every statement uses IF NOT EXISTS or ADD COLUMN IF NOT EXISTS.
-- Existing production data is never modified or dropped.
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. New columns on existing tables
-- ─────────────────────────────────────────────────────────────────────────────

-- users.gmail_comm_sync_at
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS gmail_comm_sync_at timestamp;

-- mailboxes: IMAP sync anchor
ALTER TABLE mailboxes
  ADD COLUMN IF NOT EXISTS last_comm_sync_at timestamp;

-- mailboxes: SMTP quota recovery state
ALTER TABLE mailboxes
  ADD COLUMN IF NOT EXISTS quota_status         text,
  ADD COLUMN IF NOT EXISTS quota_reached_at     timestamp,
  ADD COLUMN IF NOT EXISTS quota_cooldown_until timestamp,
  ADD COLUMN IF NOT EXISTS quota_smtp_response  text,
  ADD COLUMN IF NOT EXISTS quota_probe_count    integer DEFAULT 0;

-- mailboxes: per-mailbox quota recovery settings (NOT NULL with DEFAULT so
-- existing rows get the default value automatically)
ALTER TABLE mailboxes
  ADD COLUMN IF NOT EXISTS cooldown_minutes    integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS probe_retry_minutes integer NOT NULL DEFAULT 5;

-- drafts.sent_at (added to schema after initial production deploy; safe no-op
-- if it was already applied manually)
ALTER TABLE drafts
  ADD COLUMN IF NOT EXISTS sent_at timestamp;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. comm_conversations
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS comm_conversations (
    id             serial PRIMARY KEY,
    user_id        integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lead_id        integer REFERENCES leads(id) ON DELETE SET NULL,
    mailbox_id     integer REFERENCES mailboxes(id) ON DELETE SET NULL,
    campaign_id    integer REFERENCES campaigns(id) ON DELETE SET NULL,
    subject        text NOT NULL DEFAULT '(No subject)',
    customer_name  text NOT NULL,
    customer_email text NOT NULL,
    customer_phone text,
    -- Status: unread | read | needs_reply | replied | archived | spam
    status         text NOT NULL DEFAULT 'unread',
    starred        boolean NOT NULL DEFAULT false,
    message_count  integer NOT NULL DEFAULT 0,
    unread_count   integer NOT NULL DEFAULT 0,
    last_message_at timestamp NOT NULL DEFAULT now(),
    created_at     timestamp NOT NULL DEFAULT now(),
    updated_at     timestamp NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. comm_messages
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS comm_messages (
    id              serial PRIMARY KEY,
    conversation_id integer NOT NULL REFERENCES comm_conversations(id) ON DELETE CASCADE,
    user_id         integer REFERENCES users(id) ON DELETE SET NULL,
    -- "outbound" = broker sent, "inbound" = customer replied
    direction       text NOT NULL DEFAULT 'outbound',
    from_email      text NOT NULL,
    from_name       text,
    to_email        text NOT NULL,
    subject         text,
    body            text NOT NULL,
    html_body       text,
    snippet         text,
    is_read         boolean NOT NULL DEFAULT false,
    -- Link to existing drafts table entry (for outbound)
    draft_id        integer REFERENCES drafts(id) ON DELETE SET NULL,
    -- Deduplication key — Gmail internal ID ("gmail:<id>") or IMAP Message-ID
    -- header value. Null for manually created messages.
    external_id     text,
    -- JSON array of attachment metadata: [{ name, size, mimeType, partId? }]
    attachments_meta text,
    sent_at         timestamp,
    created_at      timestamp NOT NULL DEFAULT now()
);

-- Index for deduplication lookups (WHERE external_id = ?)
CREATE INDEX IF NOT EXISTS comm_messages_external_id_idx
    ON comm_messages (external_id)
    WHERE external_id IS NOT NULL;

-- Index for fetching all messages in a conversation
CREATE INDEX IF NOT EXISTS comm_messages_conversation_id_idx
    ON comm_messages (conversation_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. comm_notes
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS comm_notes (
    id              serial PRIMARY KEY,
    conversation_id integer NOT NULL REFERENCES comm_conversations(id) ON DELETE CASCADE,
    user_id         integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content         text NOT NULL,
    created_at      timestamp NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. composer_drafts
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS composer_drafts (
    id               serial PRIMARY KEY,
    user_id          integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mailbox_id       integer,
    mailbox_type     text NOT NULL DEFAULT 'smtp',
    to_email         text NOT NULL DEFAULT '',
    cc_email         text DEFAULT '',
    bcc_email        text DEFAULT '',
    subject          text NOT NULL DEFAULT '',
    body             text NOT NULL DEFAULT '',
    track_open       boolean NOT NULL DEFAULT true,
    track_click      boolean NOT NULL DEFAULT true,
    include_branding boolean NOT NULL DEFAULT true,
    status           text NOT NULL DEFAULT 'draft',
    -- JSON array of attachment metadata
    attachments_meta text NOT NULL DEFAULT '[]',
    sent_at          timestamp,
    created_at       timestamp NOT NULL DEFAULT now(),
    updated_at       timestamp NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. design_templates
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS design_templates (
    id          serial PRIMARY KEY,
    user_id     integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        text NOT NULL,
    description text,
    html_layout text NOT NULL,
    created_at  timestamp NOT NULL DEFAULT now(),
    updated_at  timestamp NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. composer_email_templates
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS composer_email_templates (
    id               serial PRIMARY KEY,
    user_id          integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name             text NOT NULL,
    subject          text NOT NULL DEFAULT '',
    body             text NOT NULL DEFAULT '',
    design_id        text NOT NULL DEFAULT 'professional',
    include_branding boolean NOT NULL DEFAULT true,
    created_at       timestamp NOT NULL DEFAULT now(),
    updated_at       timestamp NOT NULL DEFAULT now()
);

COMMIT;
