---
name: Communications SSE architecture
description: How real-time inbox updates are delivered to browser tabs (EventSource, per-user connection registry, sync state, attachment metadata)
---

## Rule
All real-time inbox updates use Server-Sent Events (SSE), not WebSockets.

**Why:** EventSource needs no npm package, works through the Replit proxy, and reconnects automatically. WebSockets require upgrade headers that Replit's proxy blocks inconsistently.

## How to apply

### Backend event bus (`artifacts/api-server/src/lib/comm-events.ts`)
- `registerSSE(userId, res)` — adds the response to a per-userId Set; returns an unregister function
- `broadcastToUser(userId, event)` — sends to all tabs for one user
- `broadcastAll(event)` — sends to every connected browser
- `markSyncStarted()` / `markSyncComplete(results)` — updates in-memory sync state readable by `/sync-status`
- `getSyncState()` / `getConnectionCount()` — read-only accessors for the `/sync-status` endpoint

### SSE route (`/api/communications/events`)
- Token in `?token=` query param (EventSource API has no custom header support)
- Sends `": ping\n\n"` keepalive every 25 s to beat 30 s proxy timeout
- X-Accel-Buffering: no header disables nginx buffering

### When to call broadcastToUser
- `comm-sync.ts` `upsertMessage()` — after each successful insert, broadcasts `new_message`
- `communications.ts` PATCH conversations — broadcasts `conversation_updated`
- `communications.ts` POST notes — broadcasts `note_added`
- `comm-sync.ts` `runCommSync()` — `markSyncStarted` at top, `markSyncComplete` + `broadcastAll(sync_complete)` at end
- `tracking.ts` open pixel — fire-and-forget lookup of conv by leadId, broadcasts `tracking_event`
- `tracking.ts` click redirect — same pattern

### Sync-status endpoint (`/api/communications/sync-status`)
Reads `getSyncState()` + `getCronState("commSync")` from monitoring-state.
Returns: `isSyncing`, `lastSyncAt`, `nextSyncAt` (lastRunAt + 5min), `mailboxes[]`, `liveConnections`, `lastSyncResults[]`.

### Frontend (`Communications.tsx`)
- `useCommEvents()` hook — opens EventSource, handles events (invalidates react-query), exponential backoff reconnect (2s→30s)
- Returns `"connecting" | "connected" | "disconnected"` status
- Status drives Wifi/WifiOff icon in LeftPanel header
- `SyncStatusWidget` — queries `/sync-status` every 30s, shows last-sync time, next-sync countdown, mailbox health dots
- `HtmlEmailRenderer` — sandboxed iframe with `sandbox="allow-same-origin"`, strips `<script>` and `on*=` handlers; auto-sizes via `contentDocument.documentElement.scrollHeight`
- `AttachmentList` — renders `msg.attachmentsMeta` JSON array; shows File + Download icons, filename, human-readable size

### Attachment metadata
- Schema: `attachmentsMeta: text("attachments_meta")` on `commMessagesTable` (JSON array)
- `AttachmentMeta = { name, size, mimeType, partId? }` — no binary stored
- Populated by `extractGmailBody` (traverses payload parts) and `extractImapBody` (checks Content-Disposition: attachment)

### Admin monitor
- `artifacts/vertex-ai-mailer/src/pages/admin/AdminCommMonitor.tsx` — shows sync status cards, mailbox health, last sync results
- Accessible at Admin → "Comms" tab (`Tab` union includes `"comms"`, `MessageSquare` icon)
