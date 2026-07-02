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

/**
 * True when the resolved base is a localhost/loopback URL — unusable for external tracking.
 * Covers: localhost, 127.0.0.1, [::1] (IPv6 loopback), and bare ::1.
 */
function isLocalhostUrl(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|::1)(:\d+)?(\/|$)/.test(url);
}

/** Exported so admin routes can reuse the same detection logic. */
export { isLocalhostUrl };

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

    // ── CRITICAL WARNING — tracking pixel will be unreachable ──────────────
    // If the resolved trackingUrl is localhost, every pixel sent in emails
    // will point to the RECIPIENT'S localhost instead of the production server.
    // Email clients will refuse the connection silently; Express never receives
    // a single /track/open request and PM2 logs stay empty.
    //
    // Fix (choose one):
    //   A) Set PUBLIC_URL=https://yourdomain.com in your PM2 ecosystem config / .env
    //   B) Set "Tracking URL" in the Admin → Settings panel to https://yourdomain.com
    if (isLocalhostUrl(trackingUrl)) {
      // Determine the best remediation based on which source produced the bad value.
      const dbHasLocalhostValue = isLocalhostUrl(map.trackingUrl ?? "") || isLocalhostUrl(map.appUrl ?? "");
      const fix = dbHasLocalhostValue
        ? "DB admin_settings.trackingUrl or appUrl contains a localhost value — clear or update it in Admin → Settings to your production domain (e.g. https://getbrokermail.com). PUBLIC_URL is only consulted when BOTH DB fields are empty."
        : "Neither DB trackingUrl/appUrl nor PUBLIC_URL env var is set. Fix: set PUBLIC_URL=https://yourdomain.com in your PM2 ecosystem env, OR set Tracking URL in Admin → Settings.";
      logger.error({
        trackingUrl,
        publicUrl:       process.env.PUBLIC_URL    ?? "(not set)",
        replitDomains:   process.env.REPLIT_DOMAINS ?? "(not set)",
        dbTrackingUrl:   map.trackingUrl || "(empty/not in DB)",
        dbAppUrl:        map.appUrl      || "(empty/not in DB)",
        fix,
      }, "[TRACKING-SETTINGS] ⚠️  TRACKING URL RESOLVES TO LOCALHOST — open-tracking pixels will be unreachable by email clients. Emails will be sent with <img src=\"http://localhost:...\"> which recipients cannot load.");
    } else {
      logger.debug({ trackingUrl, openTrackingEnabled: settings.openTrackingEnabled, clickTrackingEnabled: settings.clickTrackingEnabled },
        "[TRACKING-SETTINGS] Loaded from DB");
    }

    return settings;
  } catch (err) {
    logger.warn({ err }, "[TRACKING-SETTINGS] Could not load from DB — using env fallback");
    const envBase = resolveEnvBase();
    if (isLocalhostUrl(envBase)) {
      logger.error({
        envBase,
        publicUrl:     process.env.PUBLIC_URL    ?? "(not set)",
        replitDomains: process.env.REPLIT_DOMAINS ?? "(not set)",
        fix: "Set PUBLIC_URL=https://yourdomain.com in PM2 ecosystem OR set Tracking URL in Admin → Settings",
      }, "[TRACKING-SETTINGS] ⚠️  TRACKING URL RESOLVES TO LOCALHOST (env fallback path) — open-tracking pixels will be unreachable by email clients. Set PUBLIC_URL or configure Tracking URL in admin settings.");
    }
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
