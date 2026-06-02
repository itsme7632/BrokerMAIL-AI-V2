---
name: State-sync bug — drafts table inside send try/catch
description: Root cause and fix for "email delivered but shown as failed" / "Gmail draft created but error toast shown"
---

## The Rule

In every send path, the `db.insert(draftsTable)` call must be wrapped in its own non-fatal try/catch and must execute AFTER the critical state updates (`emailQueueTable`, `leadsTable`, `campaignsTable`). It must never be inside the outer try/catch that guards `sendEmailWithTimeout` or `createGmailDraft`.

**Why:** If `draftsTable` didn't exist (pre-migration) or had a transient error, the catch block fired and treated a successfully-sent email as a failure. This caused:
- "Email shown as failed / lead stuck in failed state" even though the recipient got the email
- "Gmail Draft creation shows error in UI" even though the draft appeared in Gmail
- Potential duplicate sends: on processor restart, `sending` items were reset to `pending` and re-sent

**How to apply:**

For SMTP processors (`processCampaignFully`, `processCampaignJobQueue`):
1. After `sendEmailWithTimeout` returns, immediately update `emailQueueTable.status = "success"` — this is the idempotency guard (prevents re-send on restart)
2. Then update `leadsTable.status = "sent"` and `campaignsTable.sentCount`
3. Then attempt `db.insert(draftsTable)` in its own `try/catch` — log a warning on failure, never rethrow
4. The outer catch (for actual send failures) should also wrap `db.insert(draftsTable)` in its own try/catch

For Gmail draft paths (`send-batch` gmail mode, `drafts/from-template`):
1. Split into Phase 1 (call `createGmailDraft`, capture error in a variable) and Phase 2 (DB recording)
2. In Phase 2: if Phase 1 errored → mark failed (both DB writes non-fatal); if Phase 1 succeeded → mark success, wrap each DB write in its own try/catch, never rethrow
3. This way `succeeded++` runs even if the DB write fails — the draft is real

**Files changed:** `artifacts/api-server/src/routes/campaigns.ts` (3 locations), `artifacts/api-server/src/routes/drafts.ts` (1 location)
