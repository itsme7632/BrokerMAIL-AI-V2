---
name: Suppression System Architecture
description: Design decisions for the email validation & suppression list feature
---

## Rules

1. **Per-user suppression**: `suppression_list` has a composite unique index on `(user_id, email)` — each tenant manages their own list independently. Global unique on email alone would incorrectly block cross-tenant sends.

2. **Bounce → auto-suppress**: `bounce-scanner.ts` calls `isPermanentBounce(reason)` (from `email-validator.ts`) after marking `email_queue` as bounced. If permanent (5xx), inserts into `suppression_list` with `onConflictDoNothing()`. This must be wrapped in its own try/catch — suppression failure must never disrupt scanning.

3. **Upload validation pipeline** (uploads.ts): Phase 1 = syntax + disposable + role (fast, sync); Phase 2 = DNS batch via `validateDomainsBatch()` (async, 3s timeout, domain-level cache 1h); Phase 3 = batch suppression DB query. New response fields: `disposableRows`, `suppressedRows`, `flaggedRows`.

4. **Campaign creation** (`from-upload`): Suppression check runs between dedup and DB insert — batch `inArray` query, then `.filter()` the candidate array. Returns `suppressed` count in response. **Do NOT add suppression logic to `processCampaignFully` or `processCampaignJobQueue`** — those are the campaign processor, off-limits.

5. **DNS fail-open**: DNS timeout/error = treat domain as valid. Avoids blocking legitimate sends due to transient resolver issues.

6. **Role accounts are "flagged" not blocked**: `isFlagged: true` rows ARE included in `readyRows` and ARE sent. Flagged = advisory warning only.

**Why:**
Bounce suppression is user-scoped because different brokers compete for the same leads. A bounce for one broker doesn't mean the lead is invalid for another. The DNS fail-open policy was chosen to avoid false positives — a temporary DNS failure should never silently skip a valid lead.
