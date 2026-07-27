-- ─────────────────────────────────────────────────────────────────────────────
-- Cleanup: orphaned email_queue rows from cancelled campaigns
--
-- Run this once after deploying the fix to clear rows that accumulated before
-- finalizeMailboxIfNoActiveCampaigns was updated to handle pending/sending rows.
--
-- Safe to run while the app is live — UPDATE is transactional.
-- Run in a read-only transaction first (BEGIN; ... ROLLBACK) to preview counts.
-- ─────────────────────────────────────────────────────────────────────────────

-- Preview counts before making changes (optional dry-run)
SELECT
  eq.status,
  count(*) AS row_count
FROM email_queue eq
INNER JOIN campaigns c ON c.id = eq.campaign_id
WHERE c.status = 'cancelled'
  AND eq.status IN ('pending', 'sending', 'deferred')
GROUP BY eq.status;

-- ── 1. Mark pending/sending rows as "cancelled" ───────────────────────────────
-- These emails were never sent and will never be sent now that their campaign
-- is cancelled. Marking them "cancelled" removes them from all active-queue
-- counts immediately.
UPDATE email_queue
SET    status = 'cancelled'
WHERE  status IN ('pending', 'sending')
  AND  campaign_id IS NOT NULL
  AND  campaign_id IN (
         SELECT id FROM campaigns WHERE status = 'cancelled'
       );

-- ── 2. Mark deferred rows as "failed" ────────────────────────────────────────
-- Deferred rows for cancelled campaigns will never be retried — the processor
-- that owned them has exited. Moving them to "failed" clears the deferred
-- counter and preserves last_error for diagnostics.
UPDATE email_queue
SET    status        = 'failed',
       deferred_count = 0,
       retry_after   = NULL
WHERE  status = 'deferred'
  AND  campaign_id IS NOT NULL
  AND  campaign_id IN (
         SELECT id FROM campaigns WHERE status = 'cancelled'
       );

-- ── Verification ─────────────────────────────────────────────────────────────
-- After running, this query should return zero rows.
SELECT count(*) AS orphaned_rows_remaining
FROM email_queue eq
INNER JOIN campaigns c ON c.id = eq.campaign_id
WHERE c.status = 'cancelled'
  AND eq.status IN ('pending', 'sending', 'deferred');
