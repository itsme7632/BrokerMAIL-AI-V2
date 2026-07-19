/**
 * comm-events.ts
 *
 * Server-Sent Events (SSE) bus for the Communications inbox.
 *
 * Usage:
 *   import { registerSSE, broadcastToUser } from "./comm-events";
 *
 *   // In the SSE route handler:
 *   const unregister = registerSSE(userId, res);
 *   req.on("close", () => { clearInterval(keepalive); unregister(); });
 *
 *   // After a DB mutation:
 *   broadcastToUser(userId, { type: "new_message", conversationId: 42, data: {} });
 *
 * EventSource on the frontend uses GET /api/communications/events?token=...
 * because the EventSource API does not support custom HTTP headers.
 *
 * ISOLATION NOTE
 * ──────────────
 * Sync state is split into two layers:
 *   • GlobalSyncState  — only isSyncing + lastSyncAt (no user-identifying data)
 *   • UserSyncState    — per-user progress, mailbox names, and results
 *
 * getSyncState(userId) merges both layers and returns only data for that user.
 * This prevents any user from seeing another user's mailbox emails or sync results.
 */

import type { Response } from "express";
import { logger } from "./logger";

// ─── Event types ──────────────────────────────────────────────────────────────

export type CommEventType =
  | "connected"
  | "new_message"
  | "conversation_updated"
  | "sync_started"
  | "sync_progress"
  | "sync_complete"
  | "note_added"
  | "note_updated"
  | "note_deleted"
  | "read_updated"
  | "tracking_event"
  | "mailbox_status";

export interface CommEvent {
  type: CommEventType;
  conversationId?: number;
  data?: Record<string, unknown>;
  ts?: string;
}

// ─── Connection registry ──────────────────────────────────────────────────────

// userId → Set of active SSE response objects
const connections = new Map<number, Set<Response>>();

function writeEvent(res: Response, event: CommEvent): void {
  try {
    res.write(
      `data: ${JSON.stringify({ ...event, ts: event.ts ?? new Date().toISOString() })}\n\n`,
    );
  } catch {
    // Connection dropped — cleaned up when req "close" fires
  }
}

/**
 * Register a new SSE connection for userId.
 * Returns an unregister function — call it in req "close" handler.
 */
export function registerSSE(userId: number, res: Response): () => void {
  if (!connections.has(userId)) connections.set(userId, new Set());
  connections.get(userId)!.add(res);
  logger.debug({ userId, total: connections.get(userId)!.size }, "[SSE] Client connected");

  return () => {
    const bucket = connections.get(userId);
    if (bucket) {
      bucket.delete(res);
      if (bucket.size === 0) connections.delete(userId);
    }
    logger.debug({ userId }, "[SSE] Client disconnected");
  };
}

/** Broadcast an event to all active connections for a specific user. */
export function broadcastToUser(userId: number, event: CommEvent): void {
  const bucket = connections.get(userId);
  if (!bucket?.size) return;
  for (const res of bucket) writeEvent(res, event);
}

/** Broadcast an event to every connected browser (admin events, etc.). */
export function broadcastAll(event: CommEvent): void {
  for (const [, bucket] of connections) {
    for (const res of bucket) writeEvent(res, event);
  }
}

/** Broadcast an event to every connection for a specific user. Alias kept for symmetry. */
export function broadcastRead(userId: number, conversationId: number): void {
  broadcastToUser(userId, {
    type: "read_updated",
    conversationId,
    data: { status: "read", unreadCount: 0 },
  });
}

export function getConnectionCount(): number {
  let count = 0;
  for (const b of connections.values()) count += b.size;
  return count;
}

// ─── Sync state ───────────────────────────────────────────────────────────────
//
// ISOLATION: split into two tiers so that no per-user data (mailbox email
// addresses, imported counts, folder names) is ever readable by another user.
//
//   GlobalSyncState  — process-wide, contains no PII
//   UserSyncState    — keyed by userId, contains per-mailbox details

export interface SyncMailboxResult {
  /** The userId this result belongs to — used internally to route results. */
  userId: number;
  mailbox: string;
  imported: number;
  error?: string;
}

// Process-wide state — nothing user-identifying here
interface GlobalSyncState {
  isSyncing: boolean;
  lastSyncAt: Date | null;
}

// Per-user state — all fields that could reveal a user's email addresses
interface UserSyncState {
  lastSyncResults: Omit<SyncMailboxResult, "userId">[];
  currentMailbox: string | null;
  currentFolder: string | null;
  scanned: number;
  imported: number;
  totalMailboxes: number;
  completedMailboxes: number;
}

// The merged shape returned by getSyncState — safe to return to the owning user
export interface SyncState {
  isSyncing: boolean;
  lastSyncAt: Date | null;
  lastSyncResults: Omit<SyncMailboxResult, "userId">[];
  currentMailbox: string | null;
  currentFolder: string | null;
  scanned: number;
  imported: number;
  totalMailboxes: number;
  completedMailboxes: number;
}

let globalSyncState: GlobalSyncState = {
  isSyncing: false,
  lastSyncAt: null,
};

// Per-user progress and results — keyed by userId
const userSyncStates = new Map<number, UserSyncState>();

function defaultUserState(): UserSyncState {
  return {
    lastSyncResults: [],
    currentMailbox: null,
    currentFolder: null,
    scanned: 0,
    imported: 0,
    totalMailboxes: 0,
    completedMailboxes: 0,
  };
}

/**
 * Returns the merged sync state for a specific user.
 * Only that user's mailbox names and results are included.
 */
export function getSyncState(userId: number): Readonly<SyncState> {
  const u = userSyncStates.get(userId) ?? defaultUserState();
  return { ...globalSyncState, ...u };
}

/** Call this at the very start of runCommSync (before any mailbox work). */
export function markSyncStarted(totalMailboxes = 0): void {
  globalSyncState = { ...globalSyncState, isSyncing: true };
  // broadcastAll is safe here — totalMailboxes is a count, not user data
  broadcastAll({ type: "sync_started", data: { totalMailboxes } });
}

/**
 * Call this as each mailbox / folder is processed.
 * Broadcasts a sync_progress event to the owning user only.
 */
export function markSyncProgress(
  userId: number,
  mailbox: string,
  folder: string,
  scanned: number,
  imported: number,
): void {
  const current = userSyncStates.get(userId) ?? defaultUserState();
  userSyncStates.set(userId, {
    ...current,
    currentMailbox: mailbox,
    currentFolder: folder,
    scanned,
    imported,
  });
  // Only the owning user receives their mailbox name
  broadcastToUser(userId, {
    type: "sync_progress",
    data: { mailbox, folder, scanned, imported },
  });
}

/** Call this when a mailbox finishes so we can update the completed count. */
export function markMailboxComplete(
  userId: number,
  mailbox: string,
  imported: number,
  error?: string,
): void {
  const current = userSyncStates.get(userId) ?? defaultUserState();
  userSyncStates.set(userId, {
    ...current,
    completedMailboxes: current.completedMailboxes + 1,
  });
  // Only the owning user receives their mailbox name
  broadcastToUser(userId, {
    type: "sync_progress",
    data: {
      mailbox,
      folder: null,
      scanned: current.scanned,
      imported: current.imported,
      mailboxDone: true,
      error,
    },
  });
}

/**
 * Call this after runCommSync finishes (success or partial error).
 * Results must include userId so they can be stored per-user.
 * Broadcasts sync_complete only to users whose mailboxes were synced.
 */
export function markSyncComplete(results: SyncMailboxResult[]): void {
  globalSyncState = {
    isSyncing: false,
    lastSyncAt: new Date(),
  };

  // Group results by userId and store them; clear live progress fields
  const seen = new Set<number>();
  for (const r of results) {
    if (!seen.has(r.userId)) {
      // Reset progress fields but preserve any existing lastSyncResults until replaced
      const existing = userSyncStates.get(r.userId) ?? defaultUserState();
      userSyncStates.set(r.userId, {
        ...existing,
        lastSyncResults: [],
        currentMailbox: null,
        currentFolder: null,
        scanned: 0,
        imported: 0,
        totalMailboxes: 0,
        completedMailboxes: 0,
      });
      seen.add(r.userId);
    }
    const state = userSyncStates.get(r.userId)!;
    state.lastSyncResults.push({ mailbox: r.mailbox, imported: r.imported, error: r.error });
  }

  // Broadcast sync_complete only to users who had mailboxes synced this run
  for (const userId of seen) {
    const state = userSyncStates.get(userId)!;
    const totalImported = state.lastSyncResults.reduce((s, r) => s + r.imported, 0);
    broadcastToUser(userId, {
      type: "sync_complete",
      data: { totalImported },
    });
  }
}
