/**
 * Adaptive SMTP Quota Recovery System
 *
 * Detects when the SMTP provider returns a quota/rate-limit error (distinct
 * from our own configured hourly limit), pauses the mailbox and all affected
 * campaigns, then runs a probe-based recovery loop:
 *
 *   READY → SENDING → QUOTA_REACHED → COOLING_DOWN → PROBE_SEND
 *                                                   → (success) → READY
 *                                                   → (fail)    → COOLING_DOWN (+10 min)
 *
 * This module ONLY extends the existing processors — it never replaces them.
 * The probe is the processor's own first send after the cooldown expires.
 */

import {
  db, mailboxesTable, campaignsTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { logger } from "./logger";

// ─── One recovery loop per mailbox (keyed by mailboxId) ──────────────────────
const activeRecovery = new Map<number, boolean>();

// ─── Default cooldown durations ───────────────────────────────────────────────
const INITIAL_COOLDOWN_MS = 60 * 60_000;   // 60 minutes on first detection
const PROBE_EXTEND_MS     = 10 * 60_000;   // +10 minutes per failed probe
const PROBE_WINDOW_MS     = 120_000;        // wait up to 2 min for probe result
const PROBE_CHECK_MS      = 15_000;         // poll every 15 s

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms));
}

// ─── isQuotaReachedError ──────────────────────────────────────────────────────

/**
 * Provider-agnostic SMTP quota/rate-limit detection.
 *
 * Matches responses from any SMTP provider, not just a single vendor.
 * This is intentionally broader than the existing isProviderRateLimitError
 * to catch responses the narrower version misses.
 */
export function isQuotaReachedError(err: unknown): boolean {
  const rawMsg =
    err instanceof Error
      ? err.message
      : typeof err === "string"
      ? err
      : String((err as any)?.message ?? err);

  const s = rawMsg.toLowerCase();

  return (
    s.includes("max emails per hour") ||
    s.includes("hourly limit") ||
    s.includes("daily limit") ||
    s.includes("rate limit") ||
    s.includes("rate-limit") ||
    s.includes("sending limit") ||
    s.includes("sending limit exceeded") ||
    s.includes("too many emails") ||
    s.includes("too many recipients") ||
    s.includes("too many") ||
    s.includes("quota exceeded") ||
    s.includes("mailbox temporarily blocked") ||
    s.includes("temporarily deferred") ||
    s.includes("temporarily unavailable") ||
    s.includes("try again later") ||
    s.includes("slow down") ||
    // SMTP numeric codes often embedded in the message
    /\b421\b/.test(s) ||   // 421 = service temporarily unavailable / rate limit
    /\b452\b/.test(s)      // 452 = insufficient system storage / quota exceeded
  );
}

// ─── handleMailboxQuotaReached ────────────────────────────────────────────────

/**
 * Called the moment a quota error is detected during any SMTP send.
 *
 * First detection  → 60-minute cooldown, campaigns paused with reason.
 * Probe failure    → +10-minute cooldown (compounding), campaigns paused again.
 *
 * DOES NOT touch Gmail, IMAP, open-tracking, bounce processing, or the
 * existing hourly quota scheduler. Only SMTP quota state.
 */
export async function handleMailboxQuotaReached(
  mailboxId: number,
  userId: number,
  smtpResponse: string,
): Promise<void> {
  // Determine whether this is the first detection or a probe failure
  const [existing] = await db
    .select({
      quotaStatus:    mailboxesTable.quotaStatus,
      quotaProbeCount: mailboxesTable.quotaProbeCount,
    })
    .from(mailboxesTable)
    .where(eq(mailboxesTable.id, mailboxId));

  const isFirstDetection = existing?.quotaStatus !== "quota_reached";
  const probeCount       = isFirstDetection ? 0 : ((existing?.quotaProbeCount ?? 0) + 1);
  const cooldownMs       = isFirstDetection ? INITIAL_COOLDOWN_MS : PROBE_EXTEND_MS;
  const now              = new Date();
  const cooldownUntil    = new Date(Date.now() + cooldownMs);

  // Update mailbox quota state
  if (isFirstDetection) {
    await db.update(mailboxesTable).set({
      quotaStatus:        "quota_reached",
      quotaReachedAt:     now,
      quotaCooldownUntil: cooldownUntil,
      quotaSmtpResponse:  smtpResponse,
      quotaProbeCount:    0,
      updatedAt:          now,
    }).where(eq(mailboxesTable.id, mailboxId));

    logger.warn({
      mailboxId,
      userId,
      smtpResponse,
      cooldown:   "60 min",
      cooldownUntil: cooldownUntil.toISOString(),
      nextProbe:  cooldownUntil.toISOString(),
    }, "[SMTP-QUOTA] Quota detected — mailbox paused, campaigns paused, cooldown: 60 min");

  } else {
    await db.update(mailboxesTable).set({
      quotaCooldownUntil: cooldownUntil,
      quotaSmtpResponse:  smtpResponse,
      quotaProbeCount:    probeCount,
      updatedAt:          now,
    }).where(eq(mailboxesTable.id, mailboxId));

    logger.warn({
      mailboxId,
      userId,
      smtpResponse,
      probeCount,
      cooldown:   "10 min",
      cooldownUntil: cooldownUntil.toISOString(),
      nextProbe:  cooldownUntil.toISOString(),
    }, "[SMTP-QUOTA] Still rate limited — probe failed, cooldown extended by 10 min");
  }

  // Pause all active campaigns for this user (sending / cooling_down / pending)
  // so no processor tries to send while the mailbox is in quota_reached state.
  if (isFirstDetection) {
    await db.update(campaignsTable).set({
      status:       "paused",
      pauseReason:  "SMTP_QUOTA_REACHED",
      cooldownUntil,
      updatedAt:    now,
    }).where(and(
      eq(campaignsTable.userId, userId),
      inArray(campaignsTable.status, ["sending", "cooling_down", "pending"]),
    ));
  } else {
    // Update cooldownUntil on already-paused campaigns so the UI countdown refreshes
    await db.update(campaignsTable).set({
      cooldownUntil,
      updatedAt: now,
    }).where(and(
      eq(campaignsTable.userId, userId),
      eq(campaignsTable.pauseReason, "SMTP_QUOTA_REACHED"),
    ));
  }
}

// ─── clearMailboxQuotaIfNeeded ────────────────────────────────────────────────

/**
 * Called from the processor's SUCCESS path after every SMTP send.
 *
 * If the mailbox was in quota_reached state (meaning the send was a probe),
 * clears the state so the recovery loop can detect success and exit.
 *
 * Campaigns are NOT resumed here — the recovery loop already resumed them
 * before restarting the processors for the probe. This is intentionally
 * non-fatal: a failure here does not affect the email that was just sent.
 */
export async function clearMailboxQuotaIfNeeded(
  mailboxId: number,
  userId: number,
): Promise<void> {
  const [box] = await db
    .select({ quotaStatus: mailboxesTable.quotaStatus })
    .from(mailboxesTable)
    .where(eq(mailboxesTable.id, mailboxId));

  if (!box || box.quotaStatus !== "quota_reached") return;

  await db.update(mailboxesTable).set({
    quotaStatus:        null,
    quotaReachedAt:     null,
    quotaCooldownUntil: null,
    quotaSmtpResponse:  null,
    quotaProbeCount:    0,
    updatedAt:          new Date(),
  }).where(eq(mailboxesTable.id, mailboxId));

  logger.info({
    mailboxId,
    userId,
  }, "[SMTP-QUOTA] Recovered — successful send after quota cooldown, mailbox quota state cleared");
}

// ─── runQuotaRecovery ─────────────────────────────────────────────────────────

/**
 * Background probe loop. Must be started (fire-and-forget) immediately after
 * handleMailboxQuotaReached() is called for the first detection.
 *
 * Probe cycle:
 *  1. Sleep until quotaCooldownUntil
 *  2. Resume paused campaigns (set back to 'sending')
 *  3. Restart campaign processors — the processor's first send IS the probe
 *  4. Monitor for up to 2 minutes:
 *     • Probe succeeded → processor called clearMailboxQuotaIfNeeded → quotaStatus=null → exit ✓
 *     • Probe failed    → processor called handleMailboxQuotaReached → new cooldown set
 *       → loop continues with the extended cooldown
 *
 * @param startCampaignProcessorFn  Passed in to avoid circular imports between
 *                                  this lib and campaigns.ts
 */
export async function runQuotaRecovery(
  mailboxId: number,
  userId:    number,
  startCampaignProcessorFn: (campaignId: number) => Promise<void>,
): Promise<void> {
  // De-duplicate: one recovery loop per mailbox
  if (activeRecovery.get(mailboxId)) {
    logger.debug({ mailboxId }, "[SMTP-QUOTA] Recovery loop already running — skipping duplicate start");
    return;
  }
  activeRecovery.set(mailboxId, true);

  logger.info({ mailboxId, userId }, "[SMTP-QUOTA] Recovery loop started");

  try {
    while (true) {
      // Re-read mailbox state (may have been updated by a parallel probe failure)
      const [box] = await db
        .select({
          quotaStatus:        mailboxesTable.quotaStatus,
          quotaCooldownUntil: mailboxesTable.quotaCooldownUntil,
          quotaProbeCount:    mailboxesTable.quotaProbeCount,
        })
        .from(mailboxesTable)
        .where(eq(mailboxesTable.id, mailboxId));

      if (!box || box.quotaStatus !== "quota_reached") {
        logger.info({ mailboxId }, "[SMTP-QUOTA] Quota state cleared externally — recovery loop exiting");
        break;
      }

      // Sleep until the cooldown expires
      const cooldownUntil = box.quotaCooldownUntil?.getTime() ?? Date.now();
      const waitMs        = Math.max(0, cooldownUntil - Date.now());
      if (waitMs > 0) {
        logger.info({
          mailboxId,
          probeCount:  box.quotaProbeCount,
          cooldownUntil: new Date(cooldownUntil).toISOString(),
          waitMs,
        }, "[SMTP-QUOTA] Sleeping until cooldown expires before probe");
        await sleep(waitMs);
      }

      // Re-read after sleep — state may have changed while we were waiting
      const [freshBox] = await db
        .select({ quotaStatus: mailboxesTable.quotaStatus })
        .from(mailboxesTable)
        .where(eq(mailboxesTable.id, mailboxId));

      if (!freshBox || freshBox.quotaStatus !== "quota_reached") {
        logger.info({ mailboxId }, "[SMTP-QUOTA] Quota cleared during sleep — recovery loop exiting");
        break;
      }

      // ── Resume campaigns (they were paused for quota) ──────────────────────
      // Setting them back to 'sending' + clearing pauseReason allows the
      // processor to pick up the next pending item (the probe).
      const resumed = await db.update(campaignsTable).set({
        status:       "sending",
        pauseReason:  null,
        cooldownUntil: null,
        updatedAt:    new Date(),
      }).where(and(
        eq(campaignsTable.userId, userId),
        eq(campaignsTable.pauseReason, "SMTP_QUOTA_REACHED"),
      )).returning({ id: campaignsTable.id });

      logger.info({
        mailboxId,
        userId,
        resumedCampaigns: resumed.map(c => c.id),
      }, "[SMTP-PROBE] Cooldown expired — campaigns resumed, starting probe send");

      // ── Restart processors — their first send IS the probe ─────────────────
      for (const { id: campaignId } of resumed) {
        startCampaignProcessorFn(campaignId).catch(err =>
          logger.error({ err, campaignId }, "[SMTP-PROBE] Campaign processor restart failed"),
        );
      }

      // ── Monitor for probe result (up to 2 minutes) ─────────────────────────
      let elapsed       = 0;
      let probeCleared  = false;
      while (elapsed < PROBE_WINDOW_MS) {
        await sleep(PROBE_CHECK_MS);
        elapsed += PROBE_CHECK_MS;
        const [check] = await db
          .select({ quotaStatus: mailboxesTable.quotaStatus })
          .from(mailboxesTable)
          .where(eq(mailboxesTable.id, mailboxId));
        if (!check || check.quotaStatus !== "quota_reached") {
          probeCleared = true;
          break;
        }
      }

      if (probeCleared) {
        logger.info({ mailboxId, userId },
          "[SMTP-QUOTA] Recovered — probe email sent successfully, quota state cleared");
        break; // exit the outer while loop
      }

      // Probe failed — handleMailboxQuotaReached was called again inside the processor,
      // which extended the cooldown. The outer loop continues with the new cooldown.
      logger.warn({ mailboxId, userId },
        "[SMTP-QUOTA] Probe window expired without quota clear — likely re-triggered, looping with extended cooldown");
    }
  } catch (err) {
    logger.error({ err, mailboxId, userId }, "[SMTP-QUOTA] Recovery loop threw unexpectedly");
  } finally {
    activeRecovery.delete(mailboxId);
    logger.info({ mailboxId, userId }, "[SMTP-QUOTA] Recovery loop exited");
  }
}

// ─── resumeMailboxQuotaRecovery ───────────────────────────────────────────────

/**
 * Called on server startup to resume recovery for any mailboxes that were
 * already in quota_reached state before the process restarted.
 */
export async function resumeMailboxQuotaRecovery(
  startCampaignProcessorFn: (campaignId: number) => Promise<void>,
): Promise<void> {
  const blockedMailboxes = await db
    .select({
      id:     mailboxesTable.id,
      userId: mailboxesTable.userId,
    })
    .from(mailboxesTable)
    .where(eq(mailboxesTable.quotaStatus, "quota_reached"));

  if (blockedMailboxes.length === 0) return;

  logger.info({ count: blockedMailboxes.length },
    "[SMTP-QUOTA] Server startup: found mailboxes in quota_reached state — resuming recovery loops");

  for (const { id, userId } of blockedMailboxes) {
    runQuotaRecovery(id, userId, startCampaignProcessorFn).catch(err =>
      logger.error({ err, mailboxId: id }, "[SMTP-QUOTA] Startup recovery loop error"),
    );
  }
}
