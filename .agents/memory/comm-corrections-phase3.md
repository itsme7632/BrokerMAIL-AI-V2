---
name: Communications corrections phase 3
description: Root causes and fixes for four persistent bugs in the Communications module found in production screenshots
---

## Bug #1 — Per-message reply buttons
**Root cause:** ThreadEmailCard had two separate reply affordances:
1. A hover-visible `<Reply>` icon in the expanded header (every message)
2. An `isLatest && !isSystem` Reply / Reply All / Forward strip after the last message body

**Fix:** Both removed. `isLatest` prop removed from ThreadEmailCard interface and call site. The ReplyComposer + MiddlePanel toolbar are the correct conversation-level reply surface.

## Bug #2 — Dispatch notifications merged into one conversation
**Root cause #1 (code):** `findOrCreateConversation` in comm-sync.ts matched `In-Reply-To`/`References` against `commMessagesTable.externalId` with no direction constraint. Automated inbound notification chains (Dispatch alerts, carrier emails) that set `References` headers pointing to previous notifications were all threaded into one conversation — even though the broker never replied.

**Fix (code):** Added `sql\`EXISTS (SELECT 1 FROM comm_messages _cm WHERE _cm.conversation_id = ... AND _cm.direction = 'outbound')\`` to the threading query. Threading now only links a new message into an existing conversation if that conversation already contains at least one outbound (broker-sent) message.

**Root cause #2 (seeding):** `ensureConversationsSeeded` used a `byEmail` map that grouped ALL sent drafts to the same recipient email into one conversation.

**Fix (seeding):** Each draft now gets its own conversation (one-to-one).

**Data repair:** Added `POST /api/communications/repair` endpoint that:
- Resets `unreadCount = 0` on conversations where `status != 'unread'` but `unreadCount > 0`
- Splits all-inbound multi-message conversations (no outbound messages) — moves each message after the first into its own new conversation

## Bug #3 — Unread badge stuck at 99+
**Root cause:** `handleSelect` optimistic update only fired when `conv.unreadCount > 0 && conv.status === "unread"`. Conversations with `unreadCount: 105` but `status: "read"` (inconsistent legacy state) never got the optimistic reset.

**Fix:** Condition simplified to `conv.unreadCount > 0` — fires whenever there's a nonzero unread count regardless of status.

**Data repair:** The `/api/communications/repair` endpoint also resets bad unreadCount values.

## Bug #4 — Entire Communications page scrolls
**Root cause:** `flex-1 overflow-y-auto` children inside flex columns were missing `min-h-0`. In CSS flexbox, `flex-1` items have `min-height: auto` by default — they grow to fit content rather than being bounded by the flex container. After the 600px iframe height cap was removed, the iframe could report thousands of pixels of height, pushing the flex item beyond the viewport.

**Fix:** Added `min-h-0` to all four `flex-1 overflow-y-auto` containers:
- Folder sidebar nav
- Conversation list body
- MiddlePanel thread messages container
- MiddlePanel thread body outer wrapper

**Why min-h-0 is always needed with overflow-y-auto in flex columns:** See https://css-tricks.com/flexbox-truncated-text/ — flex items default min-height auto and must be overridden.
