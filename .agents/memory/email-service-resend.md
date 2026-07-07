---
name: Resend email service
description: Transactional email is handled by email-service.ts using Resend SDK; system-email.ts (nodemailer) was deleted.
---

## Rule
All system/transactional emails (password reset, welcome, security alerts) go through `artifacts/api-server/src/lib/email-service.ts` via `sendTransactionalEmail()`. Campaign emails stay on per-user Gmail/SMTP (`smtp.ts`) — never touch that file.

**Why:** Resend provides reliable transactional delivery; nodemailer-based system-email.ts was removed. The two paths are intentionally separate.

## Key decisions
- **Missing RESEND_API_KEY in production** → hard throw (not silent drop). Callers must not report success when no provider is configured.
- **Dev fallback** → log to stdout when key absent; never throw in non-production.
- **HTML injection** → all user-controlled fields (name, resetUrl, event, details) are escaped via `escHtml()` before template interpolation.
- **SDK error handling** → two layers: `{ error }` from Resend API response, plus try/catch for network/SDK throws.
- **Resend singleton** → `_resend` module-level variable; initialized once on first send.

## Template builders exported
- `buildPasswordResetEmail(name, resetUrl)` — used in auth.ts (forgot-password) and admin.ts (admin-triggered reset)
- `buildWelcomeEmail(name, loginUrl)` — ready to use on registration
- `buildSecurityAlertEmail(name, event, details, timestamp)` — ready to use for account events

## How to apply
- Any new transactional email → add a `build*Email()` function here and call `sendTransactionalEmail()`.
- Never import from `system-email.ts` (deleted). Never use nodemailer for system emails.
