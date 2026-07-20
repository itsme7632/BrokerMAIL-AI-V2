---
name: Comm threading and rendering audit
description: Root-cause audit of email threading, snippet, pagination, and system-folder issues — decisions made
---

## Threading rule
Email-address-only (14-day window) fallback was **removed** from `findOrCreateConversation` in `comm-sync.ts`.
Threading ONLY happens via Message-ID / In-Reply-To / References headers. Customer email alone is never sufficient.

**Why:** Unrelated outbound emails to the same customer were being merged into one conversation.

**How to apply:** Never re-add the metadata fallback without explicit header evidence.

## System (delivery failure) emails in Inbox
The `system` status is no longer excluded from the inbox or all-mail filter. System emails appear in Inbox with a small "Delivery Failure" badge (AlertTriangle). The "Notifications" sidebar folder was removed.

**Why:** User requirement — each system email is its own conversation in Inbox, not a special folder.

## Snippet/body HTML stripping
Three places now use consistent proper HTML stripping (strip style/script/head blocks before tag removal):
- `snippetOf()` in `comm-sync.ts` (already correct)
- `body` column generation in `upsertMessage` (`comm-sync.ts`) — fixed
- `snippet()` helper in `communications.ts` route — fixed

**Why:** Raw CSS was leaking into conversation previews via the COALESCE body fallback.

## Pagination
Infinite scroll replaced with real page-based pagination (50/page). `ConversationListPanel` props changed:
- Removed: `onLoadMore`, `hasMore`, `isFetchingMore`
- Added: `currentPage`, `totalPages`, `onPageChange`, `pageSize`
- Shows "Showing X–Y of Z" + Prev/Next/page-number buttons with ellipsis
- Main component no longer accumulates pages — uses `convData?.data` directly with `placeholderData`
