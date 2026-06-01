/**
 * tracking-settings.ts
 *
 * Single source of truth for tracking URLs and deliverability config.
 * Reads from admin_settings (DB) first; falls back to environment variables.
 * Results are cached for 30 s so campaign processors don't hit the DB per email.
 *
 * Priority for tracking base URL:
 *   1. `trackingUrl`   — admin panel "Tracking URL" field
 *   2. `appUrl`        — admin panel "Application URL" field
 *   3. PUBLIC_URL      — env var (e.g. set to production domain)
 *   4. REPLIT_DOMAINS  — first domain = production when deployed via Replit
 *   5. REPLIT_DEV_DOMAIN — dev preview domain (fallback only)
 *   6. localhost:3000   — local dev
 */

import { db, adminSettingsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { logger } from "./logger";

const TRACKING_KEYS = [
  "trackingUrl", "appUrl",
  "openTrackingEnabled", "clickTrackingEnabled",
  "bounceEnabled", "bounceImapHost", "bounceImapPort",
  "bounceImapUser", "bounceImapPass", "bounceImapFolder", "bounceScanInterval",
];

export interface TrackingSettings {
  trackingUrl:          string;
  appUrl:               string;
  openTrackingEnabled:  boolean;
  clickTrackingEnabled: boolean;
  bounceEnabled:        boolean;
  bounceImapHost:       string;
  bounceImapPort:       number;
  bounceImapUser:       string;
  bounceImapPass:       string;
  bounceImapFolder:     string;
  bounceScanInterval:   number;
}

let _cache: { settings: TrackingSettings; expiresAt: number } | null = null;
const CACHE_TTL_MS = 30_000;

/** Derive the best public base URL from environment variables alone (no DB). */
function resolveEnvBase(): string {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, "");
  if (process.env.REPLIT_DOMAINS) {
    const first = process.env.REPLIT_DOMAINS.split(",")[0].trim();
    if (first) return `https://${first}`;
  }
  if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  return "http://localhost:3000";
}

/** Load tracking settings from DB with env-var fallback. Cached for 30 s. */
export async function getTrackingSettings(): Promise<TrackingSettings> {
  if (_cache && Date.now() < _cache.expiresAt) return _cache.settings;

  try {
    const rows = await db
      .select()
      .from(adminSettingsTable)
      .where(inArray(adminSettingsTable.key, TRACKING_KEYS));

    const map = Object.fromEntries(rows.map(r => [r.key, r.value]));

    const envBase    = resolveEnvBase();
    const trackingUrl = (map.trackingUrl || map.appUrl || envBase).replace(/\/+$/, "");
    const appUrl      = (map.appUrl || envBase).replace(/\/+$/, "");

    const settings: TrackingSettings = {
      trackingUrl,
      appUrl,
      openTrackingEnabled:  (map.openTrackingEnabled  ?? "true")  !== "false",
      clickTrackingEnabled: (map.clickTrackingEnabled ?? "true")  !== "false",
      bounceEnabled:        (map.bounceEnabled         ?? "false") === "true",
      bounceImapHost:       map.bounceImapHost   || "",
      bounceImapPort:       parseInt(map.bounceImapPort  || "993", 10),
      bounceImapUser:       map.bounceImapUser   || "",
      bounceImapPass:       map.bounceImapPass   || "",
      bounceImapFolder:     map.bounceImapFolder || "INBOX",
      bounceScanInterval:   parseInt(map.bounceScanInterval || "60", 10),
    };

    _cache = { settings, expiresAt: Date.now() + CACHE_TTL_MS };
    logger.debug({ trackingUrl, openTrackingEnabled: settings.openTrackingEnabled, clickTrackingEnabled: settings.clickTrackingEnabled },
      "[TRACKING-SETTINGS] Loaded from DB");
    return settings;
  } catch (err) {
    logger.warn({ err }, "[TRACKING-SETTINGS] Could not load from DB — using env fallback");
    const envBase = resolveEnvBase();
    return {
      trackingUrl: envBase, appUrl: envBase,
      openTrackingEnabled: true, clickTrackingEnabled: true,
      bounceEnabled: false, bounceImapHost: "", bounceImapPort: 993,
      bounceImapUser: "", bounceImapPass: "", bounceImapFolder: "INBOX",
      bounceScanInterval: 60,
    };
  }
}

/** Immediately expire the cache (call after admin saves tracking settings). */
export function invalidateTrackingSettingsCache(): void {
  _cache = null;
}

/** Convenience: return just the tracking base URL. */
export async function getTrackingBase(): Promise<string> {
  return (await getTrackingSettings()).trackingUrl;
}
