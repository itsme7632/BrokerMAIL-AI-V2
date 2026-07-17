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
// Lightweight in-memory sync progress, readable by the /sync-status endpoint.

export interface SyncMailboxResult {
  mailbox: string;
  imported: number;
  error?: string;
}

interface SyncState {
  isSyncing: boolean;
  lastSyncAt: Date | null;
  lastSyncResults: SyncMailboxResult[];
  // Live progress (only meaningful while isSyncing = true)
  currentMailbox: string | null;
  currentFolder: string | null;
  scanned: number;
  imported: number;
  totalMailboxes: number;
  completedMailboxes: number;
}

let syncState: SyncState = {
  isSyncing: false,
  lastSyncAt: null,
  lastSyncResults: [],
  currentMailbox: null,
  currentFolder: null,
  scanned: 0,
  imported: 0,
  totalMailboxes: 0,
  completedMailboxes: 0,
};

export function getSyncState(): Readonly<SyncState> {
  return syncState;
}

/** Call this at the very start of runCommSync (before any mailbox work). */
export function markSyncStarted(totalMailboxes = 0): void {
  syncState = {
    ...syncState,
    isSyncing: true,
    currentMailbox: null,
    currentFolder: null,
    scanned: 0,
    imported: 0,
    totalMailboxes,
    completedMailboxes: 0,
  };
  broadcastAll({ type: "sync_started", data: { totalMailboxes } });
}

/**
 * Call this as each mailbox / folder is processed.
 * Broadcasts a sync_progress event to the user so the UI can show live progress.
 */
export function markSyncProgress(
  userId: number,
  mailbox: string,
  folder: string,
  scanned: number,
  imported: number,
): void {
  syncState = { ...syncState, currentMailbox: mailbox, currentFolder: folder, scanned, imported };
  broadcastToUser(userId, {
    type: "sync_progress",
    data: { mailbox, folder, scanned, imported },
  });
}

/** Call this when a mailbox finishes so we can update the completed count. */
export function markMailboxComplete(userId: number, mailbox: string, imported: number, error?: string): void {
  syncState = { ...syncState, completedMailboxes: syncState.completedMailboxes + 1 };
  broadcastToUser(userId, {
    type: "sync_progress",
    data: {
      mailbox,
      folder: null,
      scanned: syncState.scanned,
      imported: syncState.imported,
      mailboxDone: true,
      error,
    },
  });
}

/** Call this after runCommSync finishes (success or partial error). */
export function markSyncComplete(results: SyncMailboxResult[]): void {
  syncState = {
    ...syncState,
    isSyncing: false,
    lastSyncAt: new Date(),
    lastSyncResults: results,
    currentMailbox: null,
    currentFolder: null,
  };
}
