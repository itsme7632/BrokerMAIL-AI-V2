---
name: ETA countdown and analytics invalidation fix
description: Root causes and fixes for ETA jumping backward and analytics stats requiring manual refresh
---

## ETA backward jump — root cause and fix

**Root cause:** `useETACountdown` re-anchored on every poll via `useEffect([serverSeconds])`. The backend formula `(queued+remaining)*delayS` returns the same value every 3 s poll when no email has sent (processor is mid-delay). React's effect fired because numeric value changed by small rounding amounts, snapping the display back up to the server value, overwriting the local tick's countdown.

**Fix (CampaignDetail.tsx `useETACountdown`):** Before re-anchoring, compute `localProjection = serverRef.current > 0 ? serverRef.current - elapsed : Infinity`. Only re-anchor when `serverSeconds <= localProjection`. If server returns same or higher value, skip and let the tick continue uninterrupted.

**Why:** The first call always accepts (localProjection=Infinity). Subsequent calls only accept when the server sends a genuinely lower value (real send event happened). Mid-delay polls that return the same ETA are silently ignored.

## Analytics cache invalidation — root cause and fix

**Root cause:** `["campaign-analytics", campaignId]` had `refetchInterval: 30_000` and zero `invalidateQueries` calls anywhere. Send successes and open/click events never triggered a refresh.

**Fix (two parts):**

1. **Backend `GET /campaigns/:id/progress`:** Added `openCount` and `clickCount` to the response — a single JOIN aggregate across `emailTrackingEventsTable → draftsTable → emailQueueTable` filtered by `campaignId`.

2. **Frontend `fetchProgress`:** Added `prevOpensRef` and `prevClicksRef`. On every poll, compute `sentChanged`, `opensChanged`, `clicksChanged` **before** mutating any ref. Invalidate `["campaign-analytics", campaignId]` when any of the three increases.

**Critical ordering rule:** Compute ALL change flags before `prevSentRef.current = data.sent`. If you update prevSentRef first, `sentChanged` will always be false.

## Cooldown probe instrumentation

Added `pollCountRef` that logs first 5 polls with `{ cooldownSeconds, cooldownUntil }`. This determines whether cooldown display jumps are backend (cooldownUntil changes) or frontend (hook drifts from fixed anchor). See browser console `[cooldown probe]` lines. Cooldown fix deliberately deferred pending this evidence.
