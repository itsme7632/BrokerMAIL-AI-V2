-- =============================================================================
-- BrokerMAIL AI — Production Schema Migration
-- Generated: 2026-07-07
-- Source of truth: lib/db/src/schema/ (index.ts exports)
--
-- Safe to re-run: every statement uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
-- Apply in a single transaction against the production PostgreSQL database.
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 1 — COLUMN ADDITIONS ON EXISTING TABLES
-- ─────────────────────────────────────────────────────────────────────────────

-- ── users ─────────────────────────────────────────────────────────────────────
-- Company branding (added for signature builder / campaign personalisation)
ALTER TABLE users ADD COLUMN IF NOT EXISTS company_name    text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS company_tagline text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS company_website text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS company_phone   text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS usdot           text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mc_number       text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS accent_color    text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS agent_name      text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS use_signature   boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS logo_url        text;
-- Account management
ALTER TABLE users ADD COLUMN IF NOT EXISTS status         text    NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at timestamp;
-- Email verification (confirmed already added manually; IF NOT EXISTS = no-op)
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false;

-- ── mailboxes ─────────────────────────────────────────────────────────────────
-- SMTP quota-recovery state (set when provider rejects with quota/rate error)
ALTER TABLE mailboxes ADD COLUMN IF NOT EXISTS quota_status         text;
ALTER TABLE mailboxes ADD COLUMN IF NOT EXISTS quota_reached_at     timestamp;
ALTER TABLE mailboxes ADD COLUMN IF NOT EXISTS quota_cooldown_until timestamp;
ALTER TABLE mailboxes ADD COLUMN IF NOT EXISTS quota_smtp_response  text;
ALTER TABLE mailboxes ADD COLUMN IF NOT EXISTS quota_probe_count    integer DEFAULT 0;
-- Per-mailbox cooldown/probe timing knobs
ALTER TABLE mailboxes ADD COLUMN IF NOT EXISTS cooldown_minutes     integer NOT NULL DEFAULT 60;
ALTER TABLE mailboxes ADD COLUMN IF NOT EXISTS probe_retry_minutes  integer NOT NULL DEFAULT 5;

-- ── campaigns ─────────────────────────────────────────────────────────────────
-- Quota-pause system
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS cooldown_until timestamp;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS pause_reason   text;
-- CTA / campaign link columns
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS booking_url  text;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS quote_url    text;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS website_url  text;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS phone_number text;

-- ── email_queue ───────────────────────────────────────────────────────────────
ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS deferred_count integer NOT NULL DEFAULT 0;
ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS quote_id       text;
ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS tracking_id    text;
ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS bounce_at      timestamp;
ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS is_test        boolean NOT NULL DEFAULT false;

-- ── drafts ────────────────────────────────────────────────────────────────────
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS email       text;
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS tracking_id text;
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS sent_at     timestamp;

-- ── leads ─────────────────────────────────────────────────────────────────────
ALTER TABLE leads ADD COLUMN IF NOT EXISTS sent_at timestamp;

-- ── templates ─────────────────────────────────────────────────────────────────
ALTER TABLE templates ADD COLUMN IF NOT EXISTS cta_buttons_json text;
ALTER TABLE templates ADD COLUMN IF NOT EXISTS is_default       boolean NOT NULL DEFAULT false;


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 2 — NEW TABLES  (in foreign-key dependency order)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── plans ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS plans (
    id                  serial  PRIMARY KEY,
    name                text    NOT NULL,
    slug                text    NOT NULL,
    description         text,
    monthly_email_limit integer NOT NULL DEFAULT 100,
    smtp_accounts_limit integer NOT NULL DEFAULT 1,
    campaigns_limit     integer NOT NULL DEFAULT 5,
    batch_send_limit    integer NOT NULL DEFAULT 50,
    price               integer NOT NULL DEFAULT 0,
    price_label         text    NOT NULL DEFAULT 'Free',
    is_popular          boolean NOT NULL DEFAULT false,
    button_text         text    NOT NULL DEFAULT 'Request Access',
    support_level       text    NOT NULL DEFAULT 'Community',
    features            jsonb            DEFAULT '[]',
    sort_order          integer NOT NULL DEFAULT 0,
    is_active           boolean NOT NULL DEFAULT true,
    created_at          timestamp NOT NULL DEFAULT now(),
    updated_at          timestamp NOT NULL DEFAULT now(),
    CONSTRAINT plans_slug_unique UNIQUE (slug)
);

-- ── subscriptions  (depends on plans, users) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS subscriptions (
    id                     serial  PRIMARY KEY,
    user_id                integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_id                integer NOT NULL REFERENCES plans(id),
    status                 text    NOT NULL DEFAULT 'active',
    stripe_customer_id     text,
    stripe_subscription_id text,
    billing_status         text    NOT NULL DEFAULT 'free',
    current_period_start   timestamp NOT NULL DEFAULT now(),
    current_period_end     timestamp,
    created_at             timestamp NOT NULL DEFAULT now(),
    updated_at             timestamp NOT NULL DEFAULT now(),
    CONSTRAINT subscriptions_user_id_unique UNIQUE (user_id)
);

-- ── plan_requests  (depends on plans, users) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS plan_requests (
    id             serial  PRIMARY KEY,
    user_id        integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    from_plan_id   integer          REFERENCES plans(id),
    to_plan_id     integer NOT NULL REFERENCES plans(id),
    status         text    NOT NULL DEFAULT 'pending',
    payment_status text    NOT NULL DEFAULT 'pending_payment',
    price_snapshot integer NOT NULL DEFAULT 0,
    admin_note     text,
    created_at     timestamp NOT NULL DEFAULT now(),
    updated_at     timestamp NOT NULL DEFAULT now()
);

-- ── payment_methods  (no FK deps) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_methods (
    id              serial  PRIMARY KEY,
    display_name    text    NOT NULL,
    type            text    NOT NULL,
    is_enabled      boolean NOT NULL DEFAULT true,
    instructions    text,
    account_details text,
    wallet_address  text,
    qr_code_url     text,
    sort_order      integer NOT NULL DEFAULT 0,
    created_at      timestamp NOT NULL DEFAULT now(),
    updated_at      timestamp NOT NULL DEFAULT now()
);

-- ── system_logs  (depends on users; defined alongside activity table) ─────────
CREATE TABLE IF NOT EXISTS system_logs (
    id          serial  PRIMARY KEY,
    user_id     integer          REFERENCES users(id) ON DELETE SET NULL,
    type        text    NOT NULL,
    severity    text    NOT NULL DEFAULT 'info',
    description text    NOT NULL,
    metadata    jsonb,
    created_at  timestamp NOT NULL DEFAULT now()
);

-- ── support_tickets  (depends on users) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS support_tickets (
    id          serial  PRIMARY KEY,
    user_id     integer          REFERENCES users(id) ON DELETE SET NULL,
    user_email  text    NOT NULL,
    user_name   text,
    subject     text    NOT NULL,
    category    text    NOT NULL DEFAULT 'general',
    message     text    NOT NULL,
    attachments jsonb            DEFAULT '[]',
    status      text    NOT NULL DEFAULT 'open',
    priority    text    NOT NULL DEFAULT 'medium',
    admin_note  text,
    replies     jsonb            DEFAULT '[]',
    assigned_to text,
    resolved_at timestamp,
    created_at  timestamp NOT NULL DEFAULT now(),
    updated_at  timestamp NOT NULL DEFAULT now()
);

-- ── backup_history  (depends on users) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS backup_history (
    id               serial  PRIMARY KEY,
    name             text    NOT NULL,
    created_by_id    integer          REFERENCES users(id) ON DELETE SET NULL,
    created_by_email text    NOT NULL,
    size_bytes       integer NOT NULL DEFAULT 0,
    zip_data         text    NOT NULL,
    manifest_summary text    NOT NULL DEFAULT '{}',
    created_at       timestamp NOT NULL DEFAULT now()
);

-- ── campaign_batches  (depends on campaigns, users) ───────────────────────────
CREATE TABLE IF NOT EXISTS campaign_batches (
    id            serial  PRIMARY KEY,
    campaign_id   integer NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    user_id       integer NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
    job_id        text,
    send_mode     text    NOT NULL DEFAULT 'smtp',
    batch_size    integer NOT NULL DEFAULT 0,
    sent_count    integer NOT NULL DEFAULT 0,
    failed_count  integer NOT NULL DEFAULT 0,
    mailbox_email text,
    created_at    timestamp NOT NULL DEFAULT now()
);

-- ── email_tracking_events  (depends on drafts) ────────────────────────────────
CREATE TABLE IF NOT EXISTS email_tracking_events (
    id           serial  PRIMARY KEY,
    draft_id     integer          REFERENCES drafts(id) ON DELETE CASCADE,
    event_type   text    NOT NULL,
    link_url     text,
    button_label text,
    ip_address   text,
    user_agent   text,
    created_at   timestamp NOT NULL DEFAULT now()
);

-- ── suppression_list  (depends on users) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS suppression_list (
    id          serial  PRIMARY KEY,
    user_id     integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email       text    NOT NULL,
    reason      text    NOT NULL,
    bounce_code text,
    campaign_id integer,
    created_at  timestamp NOT NULL DEFAULT now()
);

-- ── processed_bounces  (mailbox_id is intentionally not FK'd) ─────────────────
CREATE TABLE IF NOT EXISTS processed_bounces (
    id           serial  PRIMARY KEY,
    mailbox_id   integer NOT NULL,
    message_id   text    NOT NULL,
    recipient    text,
    processed_at timestamp NOT NULL DEFAULT now()
);

-- ── composer_drafts  (depends on users) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS composer_drafts (
    id               serial  PRIMARY KEY,
    user_id          integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mailbox_id       integer,
    mailbox_type     text    NOT NULL DEFAULT 'smtp',
    to_email         text    NOT NULL DEFAULT '',
    cc_email         text             DEFAULT '',
    bcc_email        text             DEFAULT '',
    subject          text    NOT NULL DEFAULT '',
    body             text    NOT NULL DEFAULT '',
    track_open       boolean NOT NULL DEFAULT true,
    track_click      boolean NOT NULL DEFAULT true,
    include_branding boolean NOT NULL DEFAULT true,
    status           text    NOT NULL DEFAULT 'draft',
    attachments_meta text    NOT NULL DEFAULT '[]',
    sent_at          timestamp,
    created_at       timestamp NOT NULL DEFAULT now(),
    updated_at       timestamp NOT NULL DEFAULT now()
);

-- ── composer_email_templates  (depends on users) ──────────────────────────────
CREATE TABLE IF NOT EXISTS composer_email_templates (
    id               serial  PRIMARY KEY,
    user_id          integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name             text    NOT NULL,
    subject          text    NOT NULL DEFAULT '',
    body             text    NOT NULL DEFAULT '',
    design_id        text    NOT NULL DEFAULT 'professional',
    include_branding boolean NOT NULL DEFAULT true,
    created_at       timestamp NOT NULL DEFAULT now(),
    updated_at       timestamp NOT NULL DEFAULT now()
);

-- ── design_templates  (depends on users) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS design_templates (
    id          serial  PRIMARY KEY,
    user_id     integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        text    NOT NULL,
    description text,
    html_layout text    NOT NULL,
    created_at  timestamp NOT NULL DEFAULT now(),
    updated_at  timestamp NOT NULL DEFAULT now()
);

-- ── email_verification_codes  (CONFIRMED MISSING — depends on users) ──────────
CREATE TABLE IF NOT EXISTS email_verification_codes (
    id           serial  PRIMARY KEY,
    user_id      integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash    text    NOT NULL,
    expires_at   timestamp NOT NULL,
    used_at      timestamp,
    created_at   timestamp NOT NULL DEFAULT now(),
    resend_count integer   NOT NULL DEFAULT 0,
    last_sent_at timestamp NOT NULL DEFAULT now(),
    CONSTRAINT email_verification_codes_user_id_unique UNIQUE (user_id)
);

-- ── password_reset_tokens  (CONFIRMED MISSING — depends on users) ─────────────
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id         serial  PRIMARY KEY,
    user_id    integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash text    NOT NULL,
    expires_at timestamp NOT NULL,
    used_at    timestamp,
    created_at timestamp NOT NULL DEFAULT now(),
    CONSTRAINT password_reset_tokens_token_hash_unique UNIQUE (token_hash)
);


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 3 — INDEXES
-- Named indexes that cannot be expressed as single-column inline constraints,
-- plus safety guards for the key named indexes on the two confirmed-missing
-- tables (no-op if the CONSTRAINT in CREATE TABLE already created them).
-- ─────────────────────────────────────────────────────────────────────────────

-- suppression_list: composite unique (user_id, email)
CREATE UNIQUE INDEX IF NOT EXISTS suppression_user_email_uniq
    ON suppression_list (user_id, email);

-- processed_bounces: composite unique (mailbox_id, message_id)
CREATE UNIQUE INDEX IF NOT EXISTS processed_bounces_mailbox_message_uniq
    ON processed_bounces (mailbox_id, message_id);

-- email_verification_codes: named unique index (mirrors Drizzle-generated name)
CREATE UNIQUE INDEX IF NOT EXISTS email_verification_codes_user_id_unique
    ON email_verification_codes (user_id);

-- password_reset_tokens: named unique index (mirrors Drizzle-generated name)
CREATE UNIQUE INDEX IF NOT EXISTS password_reset_tokens_token_hash_unique
    ON password_reset_tokens (token_hash);


COMMIT;
