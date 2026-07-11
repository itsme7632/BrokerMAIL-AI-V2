---
name: Mailbox stabilization pass
description: Race fix for deferred cleanup, retry queue scoping, healthState derivation, and Mailbox Health widget redesign
---

## Cancel-endpoint / processor finally race fix

**Rule:** `finalizeMailboxIfNoActiveCampaigns` must ONLY be called at one of:
1. The processor's own `finally` block (correct, event-driven endpoint)
2. The `/cancel` endpoint, **but only if no processor was actively running** at cancellation time

**Why:** The `/cancel` endpoint previously called finalize synchronously while the processor loop
could still be mid-send. Any `status='deferred'` rows written AFTER that finalize snapshot were
permanently orphaned (never cleaned up). Confirmed in prod with campaign 93's 7 EAUTH-deferred rows.

**How to apply:**
- In `/cancel`, read `wasJobActive` BEFORE deleting the `activeJobs` entry, then gate finalize on `!wasJobActive`.
- In both `processCampaignJobQueue` and `processCampaignFully` `finally` blocks, add an explicit
  `status === 'cancelled'` branch that calls finalize. Previously only the "completed" branch did.
- Keep `paused` and `cooling_down` skipping finalize (not terminal; processor may resume).
- Always call finalize with `.catch()` — it must stay fire-and-forget non-fatal.

## Retry queue count scoping

**Rule:** `GET /api/mailbox/quota`'s deferred count must LEFT JOIN campaigns and exclude rows
where the joined campaign's status is `'completed'` or `'cancelled'`.

**Why:** Orphaned deferred rows from finished campaigns were inflating the live Retry Queue counter
and causing the Mailbox Health widget to show "Retrying" indefinitely post-completion.

**Carve-out:** `campaignId IS NULL` rows (composer/single-send) must still count — they're
genuinely active retries, not historical orphans.

## EAUTH / healthState derivation (no schema change)

**Rule:** There is no dedicated auth-failure DB column. Detect via `email_queue` text matching.

**Why:** Schema changes were forbidden. Auth failures leave EAUTH-tagged `lastError` entries
in `email_queue`. Checking the most recent deferred/failed row + comparing against the most
recent `status='success'` row by id gives a correct "currently failed" signal.

**Critical gotchas:**
- `lastError` is NOT always JSON. Campaign sends store a JSON blob (buildSmtpErrorJson);
  mailbox.ts single-send path stores plain text `errMsg`. **Never use `::jsonb` cast** — use
  `ILIKE` text matching instead: `'%"rawCode":"EAUTH"%'`, `'%invalid login%'`, `'%authentication failed%'`, `'%535%'`.
- Successful sends in `email_queue` use `status='success'`, NOT `status='sent'`. Using `'sent'`
  causes auth-failure state to stick even after a successful recovery.

## healthState priority order (server-derived)

```
auth_failed > recovering (quota_reached + probeCount>0) > cooling_down (quota_reached) > connected
```

State is computed in `GET /api/mailbox/quota` and sent as `healthState` field. The frontend
consumes it directly — no client-side state derivation from `deferredCount`.

## Mailbox Health widget redesign

Replaced the 3×2 `HealthCard` grid with:
- Colored status badge banner (from `HEALTH_STATE_META` map, driven by `healthState`)
- `HealthRow` list (left label / right value, border-b rows, same pattern as LiveStatusWidget)
- "Last Activity" section at bottom wired to `lastVerified` (sourced from `mailboxes.updatedAt`
  returned by `GET /api/mailbox` — the `updatedAt` field was added to that endpoint's response)

`HealthCard` component was deleted (no remaining usages).
