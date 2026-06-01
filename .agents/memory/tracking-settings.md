---
name: Tracking settings pattern
description: How tracking URLs and deliverability config flow from DB → campaign processors, and what to keep consistent
---

## The rule
All email tracking URLs (open pixel, click wraps) are driven by `lib/tracking-settings.ts`, NOT env vars directly. Both `processCampaignJobQueue` and `processCampaignFully` call `getTrackingSettings()` once before their while loop and use `trackingSettings.trackingUrl` as `publicBase`.

**Why:** The old code read `REPLIT_DEV_DOMAIN` (dev domain) instead of the production domain, breaking tracking in deployed environments. The fix makes the domain a DB setting overridable without code changes.

## Priority chain for tracking base URL
1. `trackingUrl` from `adminSettingsTable` (explicit tracking domain)
2. `appUrl` from `adminSettingsTable` (app base URL)
3. `PUBLIC_URL` env var
4. First domain in `REPLIT_DOMAINS` (= production domain when deployed via Replit)
5. `REPLIT_DEV_DOMAIN` (dev preview only — last resort)
6. `http://localhost:3000`

## Cache invalidation
`invalidateTrackingSettingsCache()` is called inside `PUT /admin/settings` right after `invalidateMaintenanceCache()`. Cache TTL is 30s.

**How to apply:** Any time admin settings are saved, both caches invalidate. If adding a new settings endpoint that touches tracking keys, also call `invalidateTrackingSettingsCache()`.

## Bounce scanner
`_scanMailbox` accepts an optional `overridePlainPass` param for the admin-configured bounce mailbox (whose password is stored plaintext in adminSettingsTable, not encrypted). When `userId < 0`, the emailQueue query runs without a userId filter (searches all users).

## Admin test endpoints
- `POST /admin/test-open-tracking` — fetches `{trackingBase}/api/track/open/_admin_test_` with 8s timeout
- `POST /admin/test-click-tracking` — fetches click endpoint with `redirect: "manual"`; 302/400/404 all count as OK (endpoint exists)
- `POST /admin/test-bounce-imap` — connects ImapFlow, acquires mailbox lock, reads message count
