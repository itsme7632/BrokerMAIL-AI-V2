/**
 * Lightweight in-memory tracking for the background watchdog/cron loops
 * started in app.ts (Campaign Watchdog, Bounce Scanner, Gmail Draft Sync).
 * Purely additive — does not change any control flow, just records when
 * each loop last ran and whether it last succeeded, so the admin
 * "System Monitoring" page (Phase 12) can report real status instead of
 * inferring it.
 */

export interface CronJobState {
  name: string;
  intervalSec: number;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  runCount: number;
}

const state: Record<string, CronJobState> = {
  campaignWatchdog: { name: "Campaign Watchdog",      intervalSec: 60,  lastRunAt: null, lastSuccessAt: null, lastError: null, runCount: 0 },
  bounceScanner:    { name: "Bounce Scanner",          intervalSec: 60,  lastRunAt: null, lastSuccessAt: null, lastError: null, runCount: 0 },
  gmailSync:        { name: "Gmail Draft Sync",        intervalSec: 300, lastRunAt: null, lastSuccessAt: null, lastError: null, runCount: 0 },
  commSync:         { name: "Communications Inbox Sync", intervalSec: 300, lastRunAt: null, lastSuccessAt: null, lastError: null, runCount: 0 },
};

export function touchCronStart(key: keyof typeof state): void {
  const s = state[key];
  if (!s) return;
  s.lastRunAt = new Date().toISOString();
  s.runCount += 1;
}

export function touchCronSuccess(key: keyof typeof state): void {
  const s = state[key];
  if (!s) return;
  s.lastSuccessAt = new Date().toISOString();
  s.lastError = null;
}

export function touchCronError(key: keyof typeof state, err: unknown): void {
  const s = state[key];
  if (!s) return;
  s.lastError = err instanceof Error ? err.message : String(err);
}

export function getCronJobStates(): CronJobState[] {
  return Object.values(state);
}

/** Get the state of a single cron job by key, or null if not found. */
export function getCronState(key: string): CronJobState | null {
  return state[key] ?? null;
}
