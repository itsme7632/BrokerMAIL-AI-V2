---
name: Quota / Lead-refresh / ETA fixes
description: Three production bugs fixed — quota query unification, live lead status refresh, smooth ETA countdown
---

## Quota oscillation (Issue 2)

**Rule:** The `/progress` endpoint quota query MUST use `firstAttemptAt + mailboxId` — identical to both processor functions. Never use `sentAt + userId + status='success'`.

**Why:** Three different queries were measuring "sent this hour" with different fields (firstAttemptAt vs sentAt), different scope (mailboxId vs userId), and different status filters. This caused:
- 1–90s race window where processor saw N+1 items but UI showed N
- Multi-mailbox users: progress endpoint over-counted (userId spans all mailboxes)
- Rolling `NOW()-1h` boundary oscillation at the 60-minute mark (44↔45 flip)

**How to apply:** `campaigns.ts` progress endpoint quota block — always `eq(emailQueueTable.mailboxId, box.id)` + `isNotNull(emailQueueTable.firstAttemptAt)` + `gte(emailQueueTable.firstAttemptAt, hourAgo)`.

## Lead status live refresh (Issue 1)

**Rule:** `fetchProgress()` (3s poll) must invalidate `getGetLeadsQueryKey(...)` whenever `data.sent > prevSentRef.current`. Use a ref (`prevSentRef`) to track previous count. Use `leadsPageRef` (not `leadsPage` directly) in deps to avoid recreating the polling interval on page changes.

**Why:** `useGetLeads` has no `refetchInterval`. The only leads-invalidation paths were inside `handleSendBatch`, `handleRetryLead`, and `handleJobComplete` — none of which fire during automated campaigns because `activeJobId` is intentionally not set.

**How to apply:** `CampaignDetail.tsx` — `prevSentRef = useRef(0)`, `leadsPageRef = useRef(leadsPage)` with a sync `useEffect`. In `fetchProgress useCallback`, add `if (data.sent > prevSentRef.current) { prevSentRef.current = data.sent; queryClient.invalidateQueries(...) }`. Add `queryClient` to `useCallback` deps.

## ETA countdown smoothing (Issue 3)

**Rule:** ETA formula must be `cooldownSeconds + deferredWaitSecs + (queued + remaining) * delayS`. Remove the unexplained `+1`. Use `useETACountdown` hook (anchor on server value, 1s tick) instead of raw `formatSeconds(progress.estimatedCompletionSeconds)`.

**Why:** Old formula `(queued + remaining) * (delayS + 1)` excluded cooldown (could understate by 60+ minutes), excluded deferred retry windows, and had no client-side countdown (display jumped by `delayS` on each 3s poll).

**How to apply:** `campaigns.ts` ETA block — add `MAX(retry_after)::text` query for deferred items; sum `cooldownSeconds + deferredWaitSecs + (queued+remaining)*delayS`. `CampaignDetail.tsx` — `useETACountdown` hook anchors `serverSeconds` to `Date.now()` on update, ticks every 1s from anchor.
