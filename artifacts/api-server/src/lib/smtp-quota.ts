/**
 * Adaptive SMTP Quota Recovery System
 *
 * Detects when the SMTP provider returns a quota/rate-limit error (distinct
 * from our own configured hourly limit), pauses the mailbox and all affected
 * campaigns, then runs a probe-based recovery loop:
 *
 *   READY → SENDING → QUOTA_REACHED → COOLING_DOWN → PROBE_SEND
 *                                                   → (success) → READY
 *                                                   → (fail)    → COOLING_DOWN (+probeRetryMinutes)
 *
 * Cooldown duration and probe retry interval are configurable per mailbox
 * (mailboxes.cooldown_minutes / mailboxes.probe_retry_minutes).
 *
 * This module ONLY extends the existing processors — it never replaces them.
 * The probe is the processor's own first send after the cooldown expires.
 */

import {
  db, mailboxesTable, campaignsTable, activityTable, emailQueueTable,
} from "@workspace/db";
import { eq, and, inArray, sql } from "drizzle-orm";
import { logger } from "./logger";

// Campaign statuses that mean "still in play" — as long as any campaign for
// the user is in one of these, the mailbox is NOT considered fully idle.
const ACTIVE_OR_PAUSED_CAMPAIGN_STATUSES = [
  "pending", "sending", "paused", "queued", "cooling_down",
];

// ─── One recovery loop per mailbox (keyed by mailboxId) ──────────────────────
const activeRecovery = new Map<number, boolean>();

// ─── Default cooldown durations (used when mailbox settings are unavailable) ──
const DEFAULT_COOLDOWN_MINUTES  = 60;  // 60 minutes on first detection
const DEFAULT_PROBE_RETRY_MINUTES = 5; // +5 minutes per failed probe
const PROBE_WINDOW_MS           = 120_000; // wait up to 2 min for probe result
const PROBE_CHECK_MS            = 15_000;  // poll every 15 s

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms));
}

// ─── logActivity ──────────────────────────────────────────────────────────────

async function logActivity(
  userId: number,
  type: string,
  description: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    await db.insert(activityTable).values({
      userId,
      type,
      description,
      metadata: metadata ?? null,
    });
  } catch (err) {
    logger.warn({ err, type }, "[SMTP-QUOTA] Activity log insert failed (non-fatal)");
  }
}

// ─── isQuotaReachedError ──────────────────────────────────────────────────────

/**
 * Provider-agnostic SMTP quota/rate-limit detection.
 *
 * Matches responses from any SMTP provider, not just a single vendor.
 * Covers the specific Exim/cPanel pattern referenced in the spec:
 *   "Domain X has exceeded the max emails per hour (51/50 allowed).
 *    Message will be reattempted later."
 *
 * Nodemailer SMTP errors carry three distinct fields:
 *   - err.message      — human-readable description (may or may not embed the response)
 *   - err.responseCode — numeric SMTP response code (e.g. 421, 452) as a Number property
 *   - err.response     — the raw server response string (always contains the full line)
 *
 * Previously only err.message was checked, so providers whose quota response text
 * did not match any pattern caused the loop to fall through to the generic "deferred"
 * branch — processing the next lead, and the next, creating hundreds of deferred rows
 * instead of one clean pause.  Now all three fields are checked.
 */
export function isQuotaReachedError(err: unknown): boolean {
  // ── 1. Nodemailer numeric response code (most reliable signal) ──────────────
  // err.responseCode is a plain Number on every Nodemailer SMTPError; check it
  // first so a provider that returns 421 with unusual text is still caught.
  const responseCode = (err as any)?.responseCode;
  if (responseCode === 421 || responseCode === 452) return true;

  // ── 2. Build a combined search string from all text fields ──────────────────
  // err.response is the full raw server response (e.g. "421 4.7.0 Try again
  // later") and is the definitive source; err.message is kept as a fallback.
  const rawMsg =
    err instanceof Error
      ? err.message
      : typeof err === "string"
      ? err
      : String((err as any)?.message ?? err);

  const smtpResponse: string = (err as any)?.response ?? "";

  // Concatenate both so a single set of pattern checks covers everything.
  const s = (rawMsg + " " + smtpResponse).toLowerCase();

  return (
    // ── Exim / cPanel patterns ─────────────────────────────────────────────
    s.includes("has exceeded the max emails per hour") ||
    s.includes("max emails per hour") ||
    s.includes("exceeded the max emails") ||
    s.includes("message will be reattempted later") ||
    s.includes("will be reattempted") ||
    // ── Limit / quota keywords ─────────────────────────────────────────────
    s.includes("hourly limit") ||
    s.includes("daily limit") ||
    s.includes("rate limit") ||
    s.includes("rate-limit") ||
    s.includes("sending limit") ||
    s.includes("sending limit exceeded") ||
    s.includes("too many emails") ||
    s.includes("too many recipients") ||
    s.includes("quota exceeded") ||
    s.includes("mailbox temporarily blocked") ||
    s.includes("temporarily deferred") ||
    s.includes("try again later") ||
    s.includes("retry later") ||
    s.includes("slow down") ||
    s.includes("exceeded your") ||
    s.includes("over the limit") ||
    s.includes("limit exceeded") ||
    s.includes("frequency limit") ||
    s.includes("throttle") ||
    // ── "51/50 allowed" — numeric limit exhausted ──────────────────────────
    /\d+\/\d+\s+allowed/.test(s) ||
    // ── SMTP numeric codes embedded in the response text ───────────────────
    // These complement the responseCode check above for providers that embed
    // the code in the response string but use a different err.responseCode.
    /\b421\b/.test(s) ||   // 421 = service temporarily unavailable / rate limit
    /\b452\b/.test(s)      // 452 = insufficient system storage / quota exceeded
  );
}

// ─── handleMailboxQuotaReached ────────────────────────────────────────────────

/**
 * Called the moment a quota error is detected during any SMTP send.
 *
 * First detection  → cooldownMinutes cooldown (default 60 min), campaigns paused.
 * Probe failure    → +probeRetryMinutes (default 5 min), campaigns paused again.
 *
 * DOES NOT touch Gmail, IMAP, open-tracking, bounce processing, or the
 * existing hourly quota scheduler. Only SMTP quota state.
 */
export async function handleMailboxQuotaReached(
  mailboxId: number,
  userId: number,
  smtpResponse: string,
): Promise<void> {
  // Determine whether this is the first detection or a probe failure,
  // and read per-mailbox cooldown settings.
  const [existing] = await db
    .select({
      quotaStatus:        mailboxesTable.quotaStatus,
      quotaProbeCount:    mailboxesTable.quotaProbeCount,
      quotaCooldownUntil: mailboxesTable.quotaCooldownUntil,
      cooldownMinutes:    mailboxesTable.cooldownMinutes,
      probeRetryMinutes:  mailboxesTable.probeRetryMinutes,
      smtpUser:           mailboxesTable.smtpUser,
    })
    .from(mailboxesTable)
    .where(eq(mailboxesTable.id, mailboxId));

  const isFirstDetection = existing?.quotaStatus !== "quota_reached";
  const now              = new Date();

  // ── Guard against concurrent duplicate detections ─────────────────────────
  // When quota is hit, several in-flight sends can fail with the same quota
  // error within milliseconds of each other (before the first one's cooldown
  // has even started, let alone elapsed). Without this guard, the 2nd/3rd
  // failure would read quotaStatus === "quota_reached" (set by the 1st) and
  // be misclassified as a "probe failure", overwriting the just-set
  // InitialCooldownMinutes (e.g. 60 min) with ProbeRetryMinutes (e.g. 5 min).
  // InitialCooldownMinutes must NEVER be replaced by ProbeRetryMinutes.
  // A detection only counts as a genuine probe failure once the existing
  // cooldown has actually elapsed (i.e. we are past quotaCooldownUntil) —
  // that only happens after runQuotaRecovery() has resumed a campaign to
  // send the probe and that probe failed.
  const existingCooldownUntil = existing?.quotaCooldownUntil ?? null;
  const isDuplicateDuringCooldown =
    !isFirstDetection &&
    existingCooldownUntil !== null &&
    now.getTime() < existingCooldownUntil.getTime();

  if (isDuplicateDuringCooldown) {
    logger.debug({
      mailboxId,
      cooldownUntil: existingCooldownUntil?.toISOString(),
    }, "[SMTP-QUOTA] Duplicate quota detection during active cooldown — ignoring (cooldown left untouched)");
    return;
  }

  const isProbeFailure    = !isFirstDetection; // guard above already excluded duplicates
  const probeCount        = isFirstDetection ? 0 : ((existing?.quotaProbeCount ?? 0) + 1);
  const cooldownMinutes   = existing?.cooldownMinutes  ?? DEFAULT_COOLDOWN_MINUTES;
  const probeRetryMinutes = existing?.probeRetryMinutes ?? DEFAULT_PROBE_RETRY_MINUTES;
  const cooldownMs        = isProbeFailure
    ? probeRetryMinutes * 60_000
    : cooldownMinutes * 60_000;
  const mailboxEmail      = existing?.smtpUser ?? `mailbox #${mailboxId}`;
  const cooldownUntil     = new Date(Date.now() + cooldownMs);

  if (isFirstDetection) {
    // First detection — set full cooldown and pause campaigns
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
      cooldown:      `${cooldownMinutes} min`,
      cooldownUntil: cooldownUntil.toISOString(),
      nextProbe:     cooldownUntil.toISOString(),
    }, "[SMTP-QUOTA] Quota detected — mailbox paused, campaigns paused, cooldown started");

    // Pause all active campaigns for this user
    const paused = await db.update(campaignsTable).set({
      status:       "paused",
      pauseReason:  "SMTP_QUOTA_REACHED",
      cooldownUntil,
      updatedAt:    now,
    }).where(and(
      eq(campaignsTable.userId, userId),
      inArray(campaignsTable.status, ["sending", "cooling_down", "pending"]),
    )).returning({ id: campaignsTable.id, name: campaignsTable.name });

    // Activity feed events
    await logActivity(userId, "smtp_quota_reached",
      `SMTP quota reached on ${mailboxEmail}. Cooling down for ${cooldownMinutes} minutes.`,
      { mailboxId, mailboxEmail, reason: smtpResponse, cooldownMinutes, cooldownUntil: cooldownUntil.toISOString() });

    await logActivity(userId, "mailbox_paused",
      `Mailbox ${mailboxEmail} paused — SMTP provider quota reached.`,
      { mailboxId, mailboxEmail });

    for (const c of paused) {
      await logActivity(userId, "campaign_paused",
        `Campaign "${c.name}" paused — SMTP quota reached on ${mailboxEmail}.`,
        { campaignId: c.id, campaignName: c.name, mailboxId, reason: "SMTP_QUOTA_REACHED" });
    }

  } else {
    // Probe failure — extend cooldown by probeRetryMinutes, update all quota-paused campaigns.
    // Also pause any campaigns currently in "sending" state (catches the probe campaign
    // which was temporarily resumed but failed; its pauseReason was cleared by the recovery loop).
    await db.update(mailboxesTable).set({
      quotaCooldownUntil: cooldownUntil,
      quotaSmtpResponse:  smtpResponse,
      quotaProbeCount:    probeCount,
      updatedAt:          now,
    }).where(eq(mailboxesTable.id, mailboxId));

    // Re-pause quota-paused campaigns (update their cooldown timestamps)
    await db.update(campaignsTable).set({
      cooldownUntil,
      updatedAt: now,
    }).where(and(
      eq(campaignsTable.userId, userId),
      eq(campaignsTable.pauseReason, "SMTP_QUOTA_REACHED"),
    ));

    // Also catch any "sending" campaigns that may have been the probe (pauseReason cleared)
    await db.update(campaignsTable).set({
      status:       "paused",
      pauseReason:  "SMTP_QUOTA_REACHED",
      cooldownUntil,
      updatedAt:    now,
    }).where(and(
      eq(campaignsTable.userId, userId),
      eq(campaignsTable.status, "sending"),
      // Only campaigns belonging to this mailbox's user that have no other pause reason
    ));

    logger.warn({
      mailboxId,
      userId,
      smtpResponse,
      probeCount,
      cooldown:      `${probeRetryMinutes} min`,
      cooldownUntil: cooldownUntil.toISOString(),
      nextProbe:     cooldownUntil.toISOString(),
    }, "[SMTP-QUOTA] Still rate limited — probe failed, cooldown extended");

    await logActivity(userId, "smtp_probe_failed",
      `Probe email failed on ${mailboxEmail} — quota still active. Next retry in ${probeRetryMinutes} minutes.`,
      { mailboxId, mailboxEmail, probeCount, probeRetryMinutes, cooldownUntil: cooldownUntil.toISOString() });
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
    .select({ quotaStatus: mailboxesTable.quotaStatus, smtpUser: mailboxesTable.smtpUser })
    .from(mailboxesTable)
    .where(eq(mailboxesTable.id, mailboxId));

  if (!box || box.quotaStatus !== "quota_reached") return;

  const mailboxEmail = box.smtpUser ?? `mailbox #${mailboxId}`;

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

  // Activity: probe success + mailbox healthy
  await logActivity(userId, "smtp_probe_successful",
    `Probe email succeeded on ${mailboxEmail} — SMTP quota has reset.`,
    { mailboxId, mailboxEmail });

  await logActivity(userId, "mailbox_resumed",
    `Mailbox ${mailboxEmail} is healthy — quota cleared, sending can resume.`,
    { mailboxId, mailboxEmail });
}

// ─── finalizeMailboxIfNoActiveCampaigns ───────────────────────────────────────

/**
 * Called synchronously whenever a campaign transitions to a terminal state
 * (completed / cancelled / failed).
 *
 * If NO other campaigns for this user are still active or paused, the
 * mailbox is fully idle — immediately clear all quota_* fields (do not wait
 * for another probe/send/recovery-loop tick), and clean up any deferred
 * email_queue rows left behind by the finishing campaign so the Mailbox
 * page's "Retry Queue"/"Deferred" counters reflect reality right away.
 *
 * Historical rows are never deleted — deferred rows are moved to a terminal
 * "failed" status (they will never be retried, since the campaign that owned
 * them is done) while `lastError` is preserved for reporting/diagnostics.
 */
export async function finalizeMailboxIfNoActiveCampaigns(
  userId: number,
  campaignId: number,
): Promise<void> {
  // ── Step 1: Always clean up queue rows for THIS specific campaign ─────────
  //
  // This must run regardless of whether other campaigns are still active,
  // because the rows belong to THIS campaign's processor which has already exited.
  //
  // Two cleanup operations run unconditionally:
  //   a) If the campaign was cancelled, mark any remaining pending/sending rows
  //      as "cancelled". These are emails that were never dispatched (or were
  //      mid-pick-up when the processor was stopped). Nothing will ever send them.
  //   b) Mark any deferred rows as "failed". Deferred rows for a finished
  //      campaign will never be retried — the processor that owned them is gone.

  const [campaignRow] = await db
    .select({ status: campaignsTable.status })
    .from(campaignsTable)
    .where(eq(campaignsTable.id, campaignId));

  if (campaignRow?.status === "cancelled") {
    // Pending/sending rows are unsent and undeliverable — mark them "cancelled"
    // so they are excluded from all "active queue" counts immediately.
    const cancelledRows = await db.update(emailQueueTable).set({
      status: "cancelled",
    }).where(and(
      eq(emailQueueTable.campaignId, campaignId),
      inArray(emailQueueTable.status, ["pending", "sending"]),
    )).returning({ id: emailQueueTable.id });

    if (cancelledRows.length > 0) {
      logger.info(
        { campaignId, userId, count: cancelledRows.length },
        "[SMTP-QUOTA] Unsent pending/sending rows for cancelled campaign marked as 'cancelled' — removed from active queue",
      );
    }
  }

  // Deferred rows for any finished campaign are terminal: move to "failed".
  // lastError is preserved for diagnostics; deferredCount and retryAfter are
  // reset since they have no meaning for rows that will never be retried.
  const cleaned = await db.update(emailQueueTable).set({
    status:        "failed",
    deferredCount: 0,
    retryAfter:    null,
  }).where(and(
    eq(emailQueueTable.campaignId, campaignId),
    eq(emailQueueTable.status, "deferred"),
  )).returning({ id: emailQueueTable.id });

  if (cleaned.length > 0) {
    logger.info(
      { campaignId, userId, count: cleaned.length },
      "[SMTP-QUOTA] Stale deferred email_queue rows for finished campaign moved to terminal 'failed' state",
    );
  }

  // ── Step 2: Conditionally clear mailbox quota state ───────────────────────
  //
  // Only reset quota fields when NO other campaigns for this user are still
  // active or paused — i.e. the mailbox is now fully idle.
  const [remainingRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(campaignsTable)
    .where(and(
      eq(campaignsTable.userId, userId),
      inArray(campaignsTable.status, ACTIVE_OR_PAUSED_CAMPAIGN_STATUSES),
    ));

  const remainingCount = remainingRow?.count ?? 0;

  if (remainingCount > 0) {
    logger.debug(
      { userId, campaignId, remainingCount },
      "[SMTP-QUOTA] Other active/paused campaigns remain — leaving mailbox quota state untouched",
    );
    return;
  }

  // ── No active/paused campaigns left for this user — mailbox is idle ──────
  const [box] = await db
    .select({ id: mailboxesTable.id, quotaStatus: mailboxesTable.quotaStatus, smtpUser: mailboxesTable.smtpUser })
    .from(mailboxesTable)
    .where(eq(mailboxesTable.userId, userId));

  if (box && box.quotaStatus === "quota_reached") {
    await db.update(mailboxesTable).set({
      quotaStatus:        null,
      quotaReachedAt:     null,
      quotaCooldownUntil: null,
      quotaSmtpResponse:  null,
      quotaProbeCount:    0,
      updatedAt:          new Date(),
    }).where(eq(mailboxesTable.id, box.id));

    const mailboxEmail = box.smtpUser ?? `mailbox #${box.id}`;
    logger.info(
      { mailboxId: box.id, userId, campaignId },
      "[SMTP-QUOTA] Last active/paused campaign ended — mailbox quota state cleared immediately",
    );

    await logActivity(userId, "mailbox_resumed",
      `Mailbox ${mailboxEmail} quota cleared — last campaign ended with no active campaigns remaining.`,
      { mailboxId: box.id, mailboxEmail, campaignId });
  }
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
          smtpUser:           mailboxesTable.smtpUser,
        })
        .from(mailboxesTable)
        .where(eq(mailboxesTable.id, mailboxId));

      if (!box || box.quotaStatus !== "quota_reached") {
        logger.info({ mailboxId }, "[SMTP-QUOTA] Quota state cleared externally — recovery loop exiting");
        break;
      }

      const mailboxEmail = box.smtpUser ?? `mailbox #${mailboxId}`;

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

      // ── Find all campaigns still paused for quota ─────────────────────────
      const allPaused = await db
        .select({ id: campaignsTable.id, name: campaignsTable.name })
        .from(campaignsTable)
        .where(and(
          eq(campaignsTable.userId, userId),
          eq(campaignsTable.pauseReason, "SMTP_QUOTA_REACHED"),
        ));

      // ── No-campaign fallback ───────────────────────────────────────────────
      // If there are no paused campaigns (all completed/cancelled during cooldown),
      // we cannot send a probe email. Clear the quota state so that the next
      // campaign or manual send can attempt freely. If the quota is still active,
      // the first real send will re-detect it and re-trigger recovery.
      if (allPaused.length === 0) {
        logger.info({ mailboxId, userId },
          "[SMTP-QUOTA] No paused campaigns to probe — clearing quota state. Next send will verify health.");

        await db.update(mailboxesTable).set({
          quotaStatus:        null,
          quotaReachedAt:     null,
          quotaCooldownUntil: null,
          quotaSmtpResponse:  null,
          quotaProbeCount:    0,
          updatedAt:          new Date(),
        }).where(eq(mailboxesTable.id, mailboxId));

        await logActivity(userId, "mailbox_resumed",
          `Mailbox ${mailboxEmail} quota state cleared — no active campaigns to probe; next send will verify.`,
          { mailboxId, mailboxEmail });

        break;
      }

      // ── Step 1: Resume exactly ONE campaign for the probe ─────────────────
      // Only ONE campaign is resumed and started. Its first real send IS the probe.
      // All remaining campaigns stay paused until the probe succeeds.
      const probeCandidate = allPaused[0];

      await db.update(campaignsTable).set({
        status:       "sending",
        pauseReason:  null,
        cooldownUntil: null,
        updatedAt:    new Date(),
      }).where(eq(campaignsTable.id, probeCandidate.id));

      logger.info({
        mailboxId,
        userId,
        probeCampaignId: probeCandidate.id,
        remainingPaused: allPaused.length - 1,
      }, "[SMTP-PROBE] Cooldown expired — starting single probe via one campaign; remaining campaigns stay paused");

      await logActivity(userId, "smtp_probe_started",
        `Sending probe email via campaign "${probeCandidate.name}" on ${mailboxEmail}. ${allPaused.length - 1} other campaign(s) remain paused.`,
        { mailboxId, mailboxEmail, probeCampaignId: probeCandidate.id });

      startCampaignProcessorFn(probeCandidate.id).catch(err =>
        logger.error({ err, campaignId: probeCandidate.id }, "[SMTP-PROBE] Probe campaign processor restart failed"),
      );

      // ── Step 2: Monitor for probe result (up to 2 minutes) ────────────────
      let elapsed      = 0;
      let probeCleared = false;
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
        // ── Step 3: Probe succeeded — resume ALL remaining paused campaigns ──
        logger.info({ mailboxId, userId },
          "[SMTP-QUOTA] Probe succeeded — resuming all remaining campaigns");

        const remaining: Array<{ id: number; name: string }> = await db.update(campaignsTable).set({
          status:       "sending",
          pauseReason:  null,
          cooldownUntil: null,
          updatedAt:    new Date(),
        }).where(and(
          eq(campaignsTable.userId, userId),
          eq(campaignsTable.pauseReason, "SMTP_QUOTA_REACHED"),
        )).returning({ id: campaignsTable.id, name: campaignsTable.name });

        for (const c of remaining) {
          await logActivity(userId, "campaign_resumed",
            `Campaign "${c.name}" resumed after successful SMTP probe on ${mailboxEmail}.`,
            { campaignId: c.id, campaignName: c.name, mailboxId });
          startCampaignProcessorFn(c.id).catch(err =>
            logger.error({ err, campaignId: c.id }, "[SMTP-PROBE] Campaign processor restart failed"),
          );
        }

        break; // exit the outer while loop
      }

      // ── Probe failed ───────────────────────────────────────────────────────
      // handleMailboxQuotaReached was called again inside the probe processor,
      // which extended the cooldown. However, the probe campaign has pauseReason=null
      // (we cleared it above), so we must explicitly re-pause it to keep it consistent.
      await db.update(campaignsTable).set({
        status:      "paused",
        pauseReason: "SMTP_QUOTA_REACHED",
        updatedAt:   new Date(),
      }).where(and(
        eq(campaignsTable.id, probeCandidate.id),
        eq(campaignsTable.status, "sending"),  // only if it's still sending (not already re-paused)
      ));

      logger.warn({ mailboxId, userId, probeCampaignId: probeCandidate.id },
        "[SMTP-QUOTA] Probe window expired — quota still active, extended cooldown, looping");
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
