---
name: OAuth flow pattern
description: How Google OAuth (login + Gmail connect) is wired end-to-end in this project
---

# OAuth Flow Pattern

## The core rule: one redirect URI for ALL OAuth flows

Google Console only lets you register specific redirect URIs. Use a single URI (`/api/auth/callback`) for both Google login and Gmail connect, and use the `state` parameter to distinguish them:
- `state = "google-login"` → sign-in / register flow
- `state = "gmail-connect:<userId>"` → Gmail account connection

This means `getGoogleAuthUrl()` and `getGmailAuthUrl()` both produce URLs with the same `redirect_uri`. The single `/api/auth/callback` route checks `state` to pick the right handler.

**Why:** If two different redirect URIs are used but not both registered in Google Console, Google rejects the callback with `redirect_uri_mismatch`. This is exactly what was happening: Gmail connect URI was registered, login URI was not → all callbacks went to `/api/gmail/callback` regardless of which flow triggered them.

## Redirect URI derivation

Never hardcode the redirect URI. Derive it:
```typescript
export function getOAuthRedirectUri(): string {
  if (process.env.OAUTH_REDIRECT_URI) return process.env.OAUTH_REDIRECT_URI;
  const domains = process.env.REPLIT_DOMAINS;
  if (domains) return `https://${domains.split(",")[0].trim()}/api/auth/callback`;
  return "http://localhost:5000/api/auth/callback";
}
```

`REPLIT_DOMAINS` is automatically set by Replit in production. No `FRONTEND_URL` env var needed.

## Relative redirects from the API to the frontend

In both dev and production, the frontend SPA and API share the same origin (Replit proxy routes `/api/*` to Express, everything else to the static build). So the API can redirect to `/auth/callback?token=...` as a relative path — the browser follows it to the SPA correctly.

**Never** use `FRONTEND_URL` for these redirects — it's always empty unless manually set.

## Frontend token capture page (`/auth/callback`)

After Google login the API does: `res.redirect('/auth/callback?token=<jwt>')`.

The frontend `/auth/callback` page must:
1. Read `?token=` from `window.location.search`
2. `localStorage.setItem("auth_token", token)`
3. Call `setAuthTokenGetter(() => localStorage.getItem("auth_token"))`
4. Do `window.location.href = "/dashboard"` — a **full page navigation**, not wouter's `setLocation`

**Why full navigation:** wouter's client-side routing doesn't re-run `AuthContext`'s `useState` initializer. The token just written to localStorage won't be picked up until the React app re-mounts from scratch. A full page reload triggers that.

## What to register in Google Cloud Console

One authorized redirect URI: `https://<your-replit-domain>/api/auth/callback`

You can find the exact value at runtime via `GET /api/auth/oauth-redirect-uri`.
