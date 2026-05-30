---
name: Cooldown timer pattern
description: How the campaign cooldown countdown is correctly implemented to avoid the 60→59→60 loop bug
---

## Rule
The frontend countdown hook must derive remaining seconds from an absolute ISO timestamp (`cooldownUntil`), NOT from a pre-calculated `cooldownSeconds` value returned by the API.

**Why:** The progress endpoint polls every 3s. `Math.ceil((cooldownUntil - now) / 1000)` can return 60 at 59.4s remaining (rounds up). On the next poll the timer resets to 60 instead of 59. The absolute timestamp never changes between polls, so the `useEffect` only re-runs when cooldown actually starts or ends.

**How to apply:**
- Backend `/progress` endpoint must include `cooldownUntil: campaign.cooldownUntil?.toISOString() ?? null`
- Frontend hook is `useCooldownTimerUntil(isoString | null)` — effect depends on the ISO string, not the calculated seconds
- Each tick recalculates from the target timestamp to prevent clock drift accumulation

## startCampaignProcessor
`processCampaignFully(id, box, template, user)` needs 4 args; startup recovery and the watchdog can't supply them.
Use `startCampaignProcessor(campaignId)` — it loads box/template/user from DB, handles `cooling_down → sending` reset, then delegates to `processCampaignFully`.

**Why:** The original `startupRecovery` called `processCampaignFully(campaignId)` with only 1 arg — this was silently broken. Any recovery path that doesn't have the campaign context in scope must use `startCampaignProcessor`.

## Watchdog
A 60s `setInterval` in `app.ts` finds campaigns with `status IN ('sending', 'cooling_down')` and calls `startCampaignProcessor` for any that lack an active job. For `cooling_down` campaigns, it only restarts once `cooldownUntil < now`.
