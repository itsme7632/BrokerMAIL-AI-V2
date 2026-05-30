---
name: Campaign completion logic
description: The correct way to mark a campaign COMPLETED — critical bugs and fixes for processCampaignFully and processCampaignJobQueue
---

## The Rule

A campaign is COMPLETED only when `count(leads WHERE status IN ('sent','drafted','failed')) >= totalLeads`.

**Never** use `emailQueue.pending === 0` as the completion signal — this fires prematurely when items are in `deferred` state (failed SMTP sends awaiting retry).

## Why

The original `processCampaignFully` finally block checked `emailQueueTable.status='pending' count === 0`. When a send fails on the first/second attempt, the item becomes `deferred` (with a retryAfter delay). The while loop then finds no `pending` items and exits. The finally block sees `pending=0` → marks COMPLETED with sentCount=0. Frontend then shows "All 0 emails sent successfully!".

## How to Apply

In both `processCampaignFully` and `processCampaignJobQueue` finally blocks:

```typescript
const [termRow] = await db.select({ count: sql<number>`count(*)::int` })
  .from(leadsTable)
  .where(and(
    eq(leadsTable.campaignId, campaignId),
    inArray(leadsTable.status, ["sent", "drafted", "failed"])
  ));
const termCount = termRow?.count ?? 0;

if (total > 0 && termCount >= total) {
  // COMPLETED
} else {
  // PAUSED — deferred items or incomplete leads remain
}
```

For `processCampaignFully`, also exclude `cooling_down` status from triggering the check (the campaign is in an expected wait state).

## Lead Status Transitions

The full intended sequence: `new → queued → sending → sent/failed`

- `queued`: set when leads are enqueued (start-campaign / send-batch route)
- `sending`: set when the processor picks up the queue item (BEFORE sleep delay)
- When paused mid-delay: queue item reset to `pending`, lead reset to `queued`
- `sent`/`failed`: set after SMTP delivery result

## Success Banner Guard

Frontend must check `progress.sent > 0 || progress.failed > 0` before showing the done banner — otherwise "All 0 emails sent successfully!" can appear when campaign is marked completed with 0 actual sends.
