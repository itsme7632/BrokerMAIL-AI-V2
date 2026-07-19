---
name: Communications module correctness pass (phase 2)
description: RFC2047 decoding, system notification detection, threading window fix, email renderer light-mode fix, infinite scroll, Reply toolbar button
---

## RFC 2047 decoding
- Added `decodeRFC2047Word` + `decodeRFC2047` helpers in `comm-sync.ts` (after `decodeBase64Url`)
- `normalizeSubject` now calls `decodeRFC2047` before stripping Re/Fwd prefixes
- `parseEmailAddress` now calls `decodeRFC2047` on the raw header before parsing name/email
- Both Gmail sync (`syncGmailInbox`) and IMAP sync (`scanImapFolder`) decode subject headers
- Belt-and-suspenders: `communications.ts` API route has its own small `decodeRFC2047` and applies it to `subject` and `customerName` in both the list and detail endpoints

## System notification detection
- Added `isSystemEmail(fromEmail, subject): boolean` in `comm-sync.ts`
- Detects: mailer-daemon@, postmaster@, no-reply@, mail-daemon, delivery failures, bounces, auto-reply, out-of-office subjects
- Both Gmail and IMAP sync call this on inbound messages and pass `isSystemNotification: true` to `findOrCreateConversation`
- System conversations are created with `status: "system"` (existing System Notifications filter shows them)
- System notifications never use the email-based threading fallback (each gets its own conversation)

## Threading fix — 14-day window
- Removed the unbounded "most recent conversation with same customer email" fallback
- Replaced with a 14-day time window: only thread into a recent conversation (lastMessageAt > now - 14 days)
- Also gates: status NOT IN ('system','spam','archived','trash') — prevents dead threads from being revived
- System notifications skip the fallback entirely (`isSystemNotification` flag)

**Why:** The original fallback merged all emails from the same customer into one thread forever, causing unrelated emails weeks/months apart to land in the same conversation.

## HtmlEmailRenderer light-mode fix
- Removed the `isDark` prop (was causing invisible text — `color: black` on dark bg)
- Now always renders with `color-scheme: light`, `background: #ffffff`, `color: #1e293b`
- Added a white `<div>` wrapper around the iframe to prevent dark seam in dark mode
- Email HTML is always author-intent light; dark mode inversion is never applied to email content

## Infinite scroll pagination
- Added `CONVS_PAGE_SIZE = 50` constant and `convPage` / `accConversations` / `convTotal` state to main `Communications` component
- Query key now includes `convPage`; `convsUrl(page)` passes `page` param to API
- `useEffect` on `convData` accumulates pages (deduplicates by id); resets on filter/search/mailbox change
- `LeftPanel` now accepts `onLoadMore`, `hasMore`, `isFetchingMore` props
- `IntersectionObserver` on a sentinel div at the bottom of the conversation list triggers `onLoadMore`
- Shows a spinner while `isFetchingMore`, "All conversations loaded" when `!hasMore`

## Reply button in reading pane toolbar
- Added a Reply button between the existing toolbar buttons (before Star)
- Only shown when `!isSystem` (system notifications don't need replies)
- Calls `setComposerTrigger({ mode: "reply", ts: Date.now() })` to open the ReplyComposer
- Shows "Reply" label text on xl+ screens; icon only on smaller widths
