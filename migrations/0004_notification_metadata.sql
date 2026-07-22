-- =============================================================================
-- Migration: add metadata column to notifications table
-- Generated: 2026-07-22
--
-- Context:
--   Adds a jsonb metadata column to the notifications table to support
--   rich structured notification types (e.g. unsubscribe notifications
--   that carry recipientEmail, campaignName, templateName, reason, source).
-- =============================================================================

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS metadata jsonb;
