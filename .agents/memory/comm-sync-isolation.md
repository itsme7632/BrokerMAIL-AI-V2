---
name: Comm sync state isolation
description: Global syncState leaked another user's mailbox email addresses via /sync-status; architecture of the fix
---

## The bug
`comm-events.ts` held a single process-wide `syncState` object containing `currentMailbox` (an email address string), `currentFolder`, `scanned/imported` counts, and `lastSyncResults` (array of `{ mailbox: email, imported, error }` for ALL users). Any authenticated user calling `GET /communications/sync-status` during a sync run would receive another user's email address in `currentMailbox` and the full `lastSyncResults` array containing all users' mailbox emails.

Additionally, `broadcastAll` was used for `sync_complete`, sending cross-user data to every connected SSE client.

## The fix (comm-events.ts)
Split `syncState` into two tiers:
- `GlobalSyncState` — only `{ isSyncing, lastSyncAt }`, no PII
- `UserSyncState` — per-user `Map<number, UserSyncState>` holding mailbox name, progress, and results

`getSyncState(userId)` merges both layers and returns only that user's data.

`markSyncComplete(results)` now receives results tagged with `userId` and distributes them to the per-user map, then broadcasts `sync_complete` only to each user's own SSE connections via `broadcastToUser`.

## The fix (comm-sync.ts)
Added `resultUserIds: number[]` parallel to `results: SyncResult[]`. Each `results.push(r)` is paired with `resultUserIds.push(user.id or mb.userId)`. The `finally` block builds `SyncMailboxResult[]` with `userId: resultUserIds[i]`.

Removed the now-redundant `broadcastAll({ type: "sync_complete", ... })` call — `markSyncComplete` handles per-user broadcasting.

## The fix (communications.ts)
- `getSyncState()` → `getSyncState(user.id)` so the endpoint only reads that user's state.
- `mailboxId` query param now verified against `mailboxesTable.userId = userId` before being added to filter conditions. If the mailbox doesn't belong to the user, the filter is silently ignored (no data leak; just prevents ID probing).

**Why:** Without isolation, a multi-tenant SaaS leaks one user's email addresses to any other authenticated user who hits the sync-status endpoint during a live sync run. The per-user Map pattern is the correct fix — global isSyncing/lastSyncAt flags are safe to share but anything containing a mailbox address must be scoped to the owner.
