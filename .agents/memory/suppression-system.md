---
name: Suppression System Architecture
description: Design decisions for the email validation & suppression list feature
---

## Rules

1. **Per-user suppression**: `suppression_list` has a composite unique index on `(user_id, email)` — each tenant manages their own list independently. Global unique on email alone would incorrectly block cross-tenant sends.

2. **Bounce → auto-suppress**: `bounce-scanner.ts` calls `isPermanentBounce(reason)` (from `email-validator.ts`) after marking `email_queue` as bounced. If permanent (5xx), inserts into `suppression_list` with `onConflictDoNothing()`. This must be wrapped in its own try/catch — suppression failure must never disrupt scanning.

3. **Upload validation pipeline** (uploads.ts): Phase 1 = syntax + disposable + role (fast, sync); Phase 2 = DNS batch via `validateDomainsBatch()` (async, 3s timeout, domain-level cache 1h); Phase 3 = batch suppression DB query. New response fields: `disposableRows`, `suppressedRows`, `flaggedRows`.

4. **Campaign creation** (`from-upload`): Suppression check runs between dedup and DB insert — batch `inArray` query, then `.filter()` the candidate array. Returns `suppressed` count in response.

5. **DNS fail-open**: DNS timeout/error = treat domain as valid. Avoids blocking legitimate sends due to transient resolver issues.

6. **Role accounts are "flagged" not blocked**: `isFlagged: true` rows ARE included in `readyRows` and ARE sent. Flagged = advisory warning only.

7. **Import-time check is not enough — every actual send path must re-check suppression right before sending.** A lead can become suppressed (bounce/unsubscribe) after import but before send, especially in long-running campaigns or retries. A dedicated `lib/suppression.ts` service (`isSuppressed(userId, email)`, `filterSuppressed(userId, emails[])`, both userId-scoped) is the single source of truth — call it from every send/retry call site (campaign SMTP loop, Gmail-draft loops, composer send, drafts create, retry-lead routes, general mailbox queue processor, sent-emails retry/edit-resend) rather than duplicating suppression SQL. Interactive single-send routes return 409; batch/loop processors skip the item, mark it failed with an explanatory error, and `continue`.

**Why:**
Bounce suppression is user-scoped because different brokers compete for the same leads. A bounce for one broker doesn't mean the lead is invalid for another. The DNS fail-open policy was chosen to avoid false positives — a temporary DNS failure should never silently skip a valid lead. A full audit found suppression was checked only at import time in several send paths (composer, drafts, Gmail-draft creation, mailbox queue, sent-emails retry) and was missing the userId scope in campaigns.ts/leads.ts — allowing cross-tenant suppression bypass and sends to already-suppressed recipients.
