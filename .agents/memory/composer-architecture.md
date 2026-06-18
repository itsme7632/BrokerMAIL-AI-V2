---
name: Single Email Composer architecture
description: Architecture decisions for the standalone /compose page and its backend plumbing
---

## Key decisions

**Route**: `/compose` — `ProtectedRoute` → `AppLayout` → `SingleEmailComposer`; nav item uses `PenLine` icon

**DB**: New `composerDraftsTable` (schema/composer_drafts.ts) with userId, mailboxId (nullable), mailboxType, toEmail, ccEmail, bccEmail, subject, body, trackOpen, trackClick, includeBranding, status, sentAt, createdAt, updatedAt.

**Sent Emails integration**: When sending, insert into `emailQueueTable` with `status: "success"` (NOT "sent" — the Sent Emails default filter checks for "success"). For Gmail sends use `mailboxId: 0` (no FK constraint on the column). `templateId: 0`, `jobId: "composer:{uuid}"`, `rowDataJson: "{}"`.

**Tracking linkage**: Also insert into `draftsTable` (campaignId=null, leadId=null, gmailDraftId="smtp-composer:{uuid}") so the tracking event system can resolve opens/clicks by trackingId.

**Gmail direct send**: Added `sendGmailMessage()` in `lib/gmail.ts`. The `gmail.compose` OAuth scope already allows direct sending (not just drafts) — no scope change needed.

**SMTP extension**: Extended `SendOptions` in `smtp.ts` to include optional `cc`, `bcc`, and `attachments: Array<{filename, content: Buffer, contentType}>`. Fully backward-compatible.

**Attachments**: multer with `memoryStorage()` on both `/composer/send` and `/composer/test`. Files passed to sendEmail/sendGmailMessage.

**Frontend RTE**: `contentEditable` div + `document.execCommand` — zero new npm deps, all browsers, handles all required formatting. Toolbar buttons use `onMouseDown + e.preventDefault()` to prevent focus loss. Toggle to HTML source textarea for raw editing.

**Method override**: PUT (draft update) and DELETE (draft delete) sent as POST + `X-HTTP-Method-Override` header (standard pattern for this codebase).

**Branding endpoint**: `/api/users/branding` (NOT `/api/branding`). Returns `{agentName, companyName, companyTagline, companyPhone, companyWebsite, usdot, mcNumber, accentColor, logoUrl}`.

**Why:**
- composerDraftsTable needed because draftsTable is tied to campaigns/leads and lacks mailbox/tracking metadata columns.
- mailboxId=0 in emailQueueTable is safe because the column has no FK constraint and the Sent Emails query uses LEFT JOIN.
- Separate draftsTable insert is needed because the tracking stats function resolves opens via draftsTable.trackingId.
