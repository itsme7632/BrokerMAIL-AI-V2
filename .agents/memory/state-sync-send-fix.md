---
name: State-sync bug — drafts table inside send try/catch
description: Root cause and fix for "email delivered but shown as failed" / "Gmail draft created but error toast shown" / open tracking not recording
---

## The Rule

In every send path, the `db.insert(draftsTable)` call must be wrapped in its own non-fatal try/catch and must execute AFTER the critical state updates (`emailQueueTable`, `leadsTable`, `campaignsTable`). It must never be inside the outer try/catch that guards `sendEmailWithTimeout` or `createGmailDraft`.

SMTP drafts must set `sentAt: new Date()` at insert time so the tracking pixel immediately records open events without requiring "Mark Sent".

**Why:** If `draftsTable` didn't exist (pre-migration) or had a transient error, the catch block fired and treated a successfully-sent email as a failure. This also caused the open-tracking pixel to fire but silently drop events (no draft row → no draftId → no tracking event stored → notifications bell stays empty).

**How to apply:**

For SMTP processors (`processCampaignFully`, `processCampaignJobQueue`):
1. After `sendEmailWithTimeout` returns, immediately update `emailQueueTable.status = "success"` — idempotency guard (prevents re-send on restart)
2. Then update `leadsTable.status = "sent"` and `campaignsTable.sentCount`
3. Then attempt `db.insert(draftsTable)` with `sentAt: new Date()` in its own `try/catch` — log warning on failure, never rethrow
4. The outer catch (for actual send failures) also wraps `db.insert(draftsTable)` in its own try/catch

For Gmail draft paths (`send-batch` gmail mode, `drafts/from-template`):
1. Phase 1: call `createGmailDraft`, capture error in a variable
2. Phase 2: if Phase 1 errored → mark failed (both DB writes non-fatal); if Phase 1 succeeded → mark success, wrap each DB write in its own try/catch, never rethrow

For open-tracking pixel (`/api/track/open/:trackingId`):
- If no draft row found for trackingId, check `emailQueueTable` for a matching sent item
- Lazy-create a minimal draft row (`sentAt: new Date()`, `gmailDraftId: smtp:recovered:${trackingId}`) so the tracking event can be recorded
- This covers the case where the non-fatal draft insert was silently skipped

**Files changed:** `artifacts/api-server/src/routes/campaigns.ts` (3 locations), `artifacts/api-server/src/routes/drafts.ts` (1 location), `artifacts/api-server/src/routes/tracking.ts` (lazy draft fallback + emailQueueTable import)
