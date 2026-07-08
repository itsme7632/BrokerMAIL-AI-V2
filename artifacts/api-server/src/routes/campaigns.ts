import { Router, type IRouter } from "express";
import { logger } from "../lib/logger";
import {
  db, campaignsTable, leadsTable, draftsTable, templatesTable,
  activityTable, usersTable, emailQueueTable, campaignBatchesTable,
  mailboxesTable, suppressionListTable,
} from "@workspace/db";
import { eq, and, count, sql, desc, gte, inArray, or, isNull, lte, isNotNull, ne } from "drizzle-orm";
import { emailTrackingEventsTable } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import {
  CreateCampaignBody, UpdateCampaignBody, GetCampaignParams,
  UpdateCampaignParams, DeleteCampaignParams,
  GenerateCampaignDraftsParams, GenerateCampaignDraftsBody,
} from "@workspace/api-zod";
import { generatePersonalizedEmail, AiConfigError } from "../lib/ai";
import { createGmailDraft } from "../lib/gmail";
import { validateEmailFast } from "../lib/email-validator";
import { buildHtmlEmail, replaceVarsText, formatPrice, extractLogoAttachment, type BrandingSettings } from "../lib/email-html";
import { buildUnsubscribeUrl } from "../lib/unsubscribe-token";
import type { User } from "@workspace/db";
import { randomUUID } from "crypto";
import { sendEmail } from "../lib/smtp";
import { saveToSent, buildRawMessage } from "../lib/imap";
import { getTrackingSettings } from "../lib/tracking-settings";
import { checkEmailLimit, checkCampaignLimit } from "../lib/plan-limits";
import { isSuppressed, filterSuppressed } from "../lib/suppression";
import {
  isQuotaReachedError,
  handleMailboxQuotaReached,
  clearMailboxQuotaIfNeeded,
  runQuotaRecovery,
} from "../lib/smtp-quota";

const router: IRouter = Router();

// Import the active-jobs map so we can kick off processing
// We use a module-level re-export from mailbox.ts
// Instead, we duplicate the logic inline for campaign batches
const activeJobs = new Map<string, boolean>();

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function sendEmailWithTimeout(
  box: typeof mailboxesTable.$inferSelect,
  opts: Parameters<typeof sendEmail>[1],
  // 90s: connectionTimeout(20) + greetingTimeout(30) + socketTimeout(60) with buffer.
  // Must be > nodemailer's own timeouts so nodemailer always fires its error first.
  timeoutMs = 90_000,
): ReturnType<typeof sendEmail> {
  return Promise.race([
    sendEmail(box, opts),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`SMTP send timed out after ${timeoutMs / 1000}s — nodemailer did not resolve/reject`)),
        timeoutMs,
      )
    ),
  ]);
}

function isProviderRateLimitError(msg: string): boolean {
  const s = msg.toLowerCase();
  return (
    s.includes("max emails per hour") ||
    s.includes("sending limit") ||
    s.includes("rate limit") ||
    s.includes("too many") ||
    s.includes("slow down") ||
    s.includes("quota exceeded") ||
    /\b421\b/.test(s) ||
    /\b452\b/.test(s)
  );
}

function retryBackoffMs(deferredCount: number): number {
  if (deferredCount <= 1) return 15 * 60_000;
  if (deferredCount === 2) return 30 * 60_000;
  return 60 * 60_000;
}

/** Serialize raw SMTP error details into JSON for persistent storage in lastError. */
function buildSmtpErrorJson(
  err: any,
  box: { smtpHost: string; smtpPort: number; smtpSecure: string },
  stage = "sendMail",
): string {
  const friendly  = String(err?.message ?? "Send failed");
  const rawCode   = err?.rawCode  ?? err?.code    ?? null;
  const rawMsg    = err?.rawMsg   ?? friendly;
  const smtpCmd   = err?.command  ?? null;
  logger.error({
    stage, rawCode, rawMsg, smtpCommand: smtpCmd,
    smtpHost: box.smtpHost, smtpPort: box.smtpPort, encryption: box.smtpSecure,
  }, "[SMTP FAILURE] Raw error details at send stage (before storing)");
  return JSON.stringify({
    friendly, rawCode, rawMsg, smtpCommand: smtpCmd,
    smtpHost:   box.smtpHost,
    smtpPort:   box.smtpPort,
    encryption: box.smtpSecure,
    stage,
    timestamp:  new Date().toISOString(),
  });
}

function userBranding(user: User): BrandingSettings {
  return {
    agentName:      user.agentName      ?? null,
    companyName:    user.companyName    ?? null,
    companyTagline: user.companyTagline ?? null,
    companyPhone:   user.companyPhone   ?? null,
    companyWebsite: user.companyWebsite ?? null,
    usdot:          user.usdot          ?? null,
    mcNumber:       user.mcNumber       ?? null,
    accentColor:    user.accentColor    ?? null,
  };
}

// ─── Background queue processor (campaign-aware) ───────────────────────────────
export async function processCampaignJobQueue(
  jobId: string,
  campaignId: number,
  box: typeof mailboxesTable.$inferSelect,
  template: typeof templatesTable.$inferSelect,
  user: User,
) {
  if (activeJobs.get(jobId)) {
    logger.info({ jobId, campaignId }, "[QUEUE] 1. Processor already running — skipping duplicate start");
    return;
  }
  activeJobs.set(jobId, true);
  logger.info({ jobId, campaignId, mailbox: box.smtpUser }, "[QUEUE] 1. Campaign processor started");

  // Pass 1: Recover queue items stuck in 'sending' → reset to 'pending' + leads to 'queued'
  const stuckSendingItems = await db
    .update(emailQueueTable)
    .set({ status: "pending" })
    .where(and(eq(emailQueueTable.jobId, jobId), eq(emailQueueTable.status, "sending")))
    .returning({ id: emailQueueTable.id, leadId: emailQueueTable.leadId });
  if (stuckSendingItems.length > 0) {
    logger.warn({ jobId, campaignId, count: stuckSendingItems.length }, "[QUEUE] Recovered stuck 'sending' queue items → reset to pending");
    const ids = stuckSendingItems.map(i => i.leadId).filter((id): id is number => id != null);
    if (ids.length > 0) {
      await db.update(leadsTable).set({ status: "queued", updatedAt: new Date() })
        .where(inArray(leadsTable.id, ids));
    }
  }

  // Pass 2: Recover leads stuck in 'sending' when their queue item is already 'deferred'
  // (happens when the previous run failed and deferred the queue item but never reset the lead)
  const deferredItems = await db
    .select({ leadId: emailQueueTable.leadId })
    .from(emailQueueTable)
    .where(and(eq(emailQueueTable.jobId, jobId), eq(emailQueueTable.status, "deferred"), isNotNull(emailQueueTable.leadId)));
  if (deferredItems.length > 0) {
    const deferredLeadIds = deferredItems.map(i => i.leadId).filter((id): id is number => id != null);
    const fixed = await db.update(leadsTable)
      .set({ status: "queued", updatedAt: new Date() })
      .where(and(inArray(leadsTable.id, deferredLeadIds), eq(leadsTable.status, "sending")))
      .returning({ id: leadsTable.id });
    if (fixed.length > 0) {
      logger.warn({ jobId, campaignId, count: fixed.length }, "[QUEUE] Recovered leads stuck in 'sending' with deferred queue item → reset to queued");
    }
  }

  const branding   = userBranding(user);
  const fromAddress = box.fromName
    ? `"${box.fromName.replace(/"/g, "")}" <${box.smtpUser}>`
    : box.smtpUser;

  const [campaignRow] = await db.select({
    bookingUrl:  campaignsTable.bookingUrl,
    quoteUrl:    campaignsTable.quoteUrl,
    websiteUrl:  campaignsTable.websiteUrl,
    phoneNumber: campaignsTable.phoneNumber,
  }).from(campaignsTable).where(eq(campaignsTable.id, campaignId));

  const trackingSettings = await getTrackingSettings();
  let batchSent = 0;
  let batchFailed = 0;

  try {
    while (activeJobs.get(jobId)) {
      // ── True rolling-60-min quota check ───────────────────────────────
      const hourAgo = new Date(Date.now() - 3_600_000);
      const [hourlyRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(emailQueueTable)
        .where(and(
          eq(emailQueueTable.mailboxId, box.id),
          isNotNull(emailQueueTable.firstAttemptAt),
          gte(emailQueueTable.firstAttemptAt, hourAgo),
        ));
      const sentThisHour = hourlyRow?.count ?? 0;
      const maxPerHour   = box.maxPerHour ?? 100;

      if (sentThisHour >= maxPerHour) {
        // Check if the mailbox is already in quota_reached state (recovery loop running)
        const [boxQuota] = await db
          .select({ quotaStatus: mailboxesTable.quotaStatus })
          .from(mailboxesTable)
          .where(eq(mailboxesTable.id, box.id));

        if (boxQuota?.quotaStatus === "quota_reached") {
          // This processor was restarted as the recovery probe. The hourly count is still
          // high from sends made before the quota was hit — that is expected. Do NOT break
          // here: breaking silently freezes the campaign in "Sending" with 0 emails and no
          // error because the finally block sees activeQCount > 0 and leaves status unchanged.
          // Fall through and attempt the send — that send IS the probe.
          logger.info({ jobId, campaignId, sentThisHour, maxPerHour },
            "[QUEUE] In quota recovery probe mode — hourly count high from pre-quota sends, skipping preemptive check, attempting probe send");
        } else {
          // First detection of preemptive hourly limit — treat as quota reached
          const reason = `Hourly send limit reached: ${sentThisHour}/${maxPerHour} emails sent in the last 60 minutes`;
          logger.warn({ jobId, campaignId, sentThisHour, maxPerHour },
            "[QUEUE] Preemptive quota pause — hourly limit reached, pausing mailbox and campaigns");
          await handleMailboxQuotaReached(box.id, user.id, reason);
          runQuotaRecovery(box.id, user.id, startCampaignProcessor).catch(err2 =>
            logger.error({ err: err2 }, "[SMTP-QUOTA] Recovery loop error (preemptive hourly limit)"));
          break;
        }
      }

      // ── Grab next pending OR ready-deferred item ───────────────────────
      const nowTs = new Date();
      const [item] = await db
        .select()
        .from(emailQueueTable)
        .where(and(
          eq(emailQueueTable.jobId, jobId),
          or(
            eq(emailQueueTable.status, "pending"),
            and(
              eq(emailQueueTable.status, "deferred"),
              or(isNull(emailQueueTable.retryAfter), lte(emailQueueTable.retryAfter, nowTs))
            )
          )
        ))
        .orderBy(emailQueueTable.id)
        .limit(1);

      if (!item) {
        // No immediately-ready item. Check whether a future deferred item exists.
        const [nextDeferred] = await db
          .select({ id: emailQueueTable.id, retryAfter: emailQueueTable.retryAfter })
          .from(emailQueueTable)
          .where(and(
            eq(emailQueueTable.jobId, jobId),
            eq(emailQueueTable.status, "deferred"),
            isNotNull(emailQueueTable.retryAfter),
          ))
          .orderBy(emailQueueTable.retryAfter)
          .limit(1);

        if (!nextDeferred || !nextDeferred.retryAfter) {
          logger.info({ jobId, campaignId }, "[QUEUE] No pending or deferred items remain — exiting loop");
          break;
        }

        const waitMs = Math.max(0, nextDeferred.retryAfter.getTime() - Date.now());
        logger.info({ jobId, campaignId, queueItemId: nextDeferred.id, retryAfter: nextDeferred.retryAfter, waitMs },
          "[QUEUE] 7. All items deferred — sleeping until retry window (poll every 30s for pause/cancel)");

        let remaining = waitMs;
        let aborted   = false;
        while (remaining > 0 && activeJobs.get(jobId)) {
          await sleep(Math.min(30_000, remaining));
          remaining -= 30_000;
          const [campCheck] = await db.select({ status: campaignsTable.status })
            .from(campaignsTable).where(eq(campaignsTable.id, campaignId));
          if (!campCheck || campCheck.status === "paused" || campCheck.status === "cancelled") {
            logger.info({ jobId, campaignId, status: campCheck?.status },
              "[QUEUE] Pause/cancel detected during deferred wait — stopping");
            aborted = true;
            break;
          }
        }
        if (aborted) break;
        logger.info({ jobId, campaignId }, "[QUEUE] Retry window reached — resuming processing loop");
        continue;
      }

      logger.info({ jobId, campaignId, queueItemId: item.id, email: item.email }, "[QUEUE] 2. Queue item picked up");

      await db.update(emailQueueTable)
        .set({ status: "sending", firstAttemptAt: item.firstAttemptAt ?? nowTs })
        .where(eq(emailQueueTable.id, item.id));

      if (item.leadId) {
        await db.update(leadsTable)
          .set({ status: "sending", updatedAt: new Date() })
          .where(eq(leadsTable.id, item.leadId));
        logger.info({ jobId, campaignId, queueItemId: item.id, leadId: item.leadId }, "[QUEUE] 3. Lead status updated to sending");
      }

      const delay = (box.delaySeconds ?? 15) * 1000;
      logger.info({ jobId, campaignId, queueItemId: item.id, delayMs: delay }, "[QUEUE] Sleeping before send");
      await sleep(delay);

      // ── Build email content ────────────────────────────────────────────
      const row = JSON.parse(item.rowDataJson) as Record<string, string>;
      if (row.price) row.price = formatPrice(row.price);
      if (campaignRow?.bookingUrl)  row.booking_link = campaignRow.bookingUrl;
      if (campaignRow?.quoteUrl)    row.quote_link   = campaignRow.quoteUrl;
      if (campaignRow?.websiteUrl)  row.website_link = campaignRow.websiteUrl;
      if (campaignRow?.phoneNumber) row.phone_link   = campaignRow.phoneNumber;

      const trackingId = randomUUID();
      const publicBase = trackingSettings.trackingUrl;

      const ctaButtons = (() => {
        try { return template.ctaButtonsJson ? JSON.parse(template.ctaButtonsJson) : []; }
        catch { return []; }
      })();

      const subject  = replaceVarsText(template.subject, row);
      const bodyText = replaceVarsText(template.body, row);
      const resolvedStyle = (item.style ?? "clean") as any;
      logger.info({ jobId, campaignId, queueItemId: item.id, templateId: template.id, templateName: template.name, ctaCount: ctaButtons.length, itemStyle: item.style, resolvedStyle },
        "[EMAIL BUILDER] processCampaignJobQueue: rendering HTML email (ctaCount included)");
      const bodyHtml = buildHtmlEmail(template.body, row, branding, {
        style: resolvedStyle,
        useSignatureBuilder: item.useSignatureBuilder,
        ctaButtons,
        trackingId: trackingSettings.clickTrackingEnabled ? trackingId : undefined,
        publicBase: trackingSettings.clickTrackingEnabled ? publicBase : undefined,
        unsubscribeUrl: buildUnsubscribeUrl(publicBase, user.id, item.leadId ?? null, campaignId, item.email),
      });

      const pixelTag    = trackingSettings.openTrackingEnabled
        ? `<img src="${publicBase}/api/track/open/${trackingId}" width="1" height="1" alt="" style="display:none!important;width:1px!important;height:1px!important;border:0;" />`
        : "";
      const trackedHtml = pixelTag
        ? (bodyHtml.includes("</body>") ? bodyHtml.replace(/<\/body>/i, `${pixelTag}</body>`) : bodyHtml + pixelTag)
        : bodyHtml;

      // ── [OPEN TRACKING] Diagnostics ────────────────────────────────────────
      logger.info({
        sendPath:             "processCampaignJobQueue",
        jobId, campaignId, queueItemId: item.id,
        trackingId,
        openTrackingEnabled:  trackingSettings.openTrackingEnabled,
        clickTrackingEnabled: trackingSettings.clickTrackingEnabled,
        publicBase,
        pixelTagLength:       pixelTag.length,
        pixelTag:             pixelTag || "(EMPTY — pixel NOT injected)",
        bodyHtmlHasBody:      bodyHtml.includes("</body>"),
        trackedHtmlHasPixel:  trackedHtml.includes("/api/track/open/"),
        htmlTail:             trackedHtml.slice(-600),
      }, "[OPEN TRACKING] Pre-sendMail diagnostics");
      // ── End diagnostics ────────────────────────────────────────────────────

      logger.info({ jobId, campaignId, queueItemId: item.id, to: item.email, subject, ctaCount: ctaButtons.length, smtpHost: box.smtpHost, smtpPort: box.smtpPort, encryption: box.smtpSecure }, "[SMTP SEND] sendMail starting — host/port/ctaCount for verification");

      try {
        const info = await sendEmailWithTimeout(box, { to: item.email, subject, text: bodyText, html: trackedHtml });
        logger.info({ jobId, campaignId, queueItemId: item.id, messageId: info.messageId }, "[QUEUE] 6. sendMail() returned successfully");

        // ── Critical state updates first — these must succeed before anything optional ──
        // Updating the queue item to "success" is the idempotency guard: if the process
        // crashes after this point, the startup recovery will NOT re-send this email.
        //
        // [SMTP DIAG] Pre-update checkpoint: confirms SMTP accepted (250) and the DB write is
        // about to start. If this log appears in PM2 but "[QUEUE] 8" does NOT follow, the DB
        // update is throwing or the process crashed between 250 acceptance and DB commit.
        // In that case: email_queue.status stays "sending", email_queue.trackingId stays NULL,
        // no draft row is created → tracking handler cannot record any opens for this email.
        const sentAtTs = new Date();
        logger.info({
          jobId, campaignId,
          queueItemId:    item.id,
          previousStatus: "sending",
          newStatus:      "success",
          sentAt:         sentAtTs.toISOString(),
          trackingId,
          messageId:      info.messageId,
        }, "[QUEUE] 7. [SMTP DIAG] Pre-update — SMTP 250 accepted, writing status/sentAt/trackingId to email_queue now");

        await db.update(emailQueueTable)
          .set({ status: "success", sentAt: sentAtTs, trackingId })
          .where(eq(emailQueueTable.id, item.id));

        logger.info({
          jobId, campaignId,
          queueItemId:    item.id,
          newStatus:      "success",
          sentAt:         sentAtTs.toISOString(),
          trackingId,
        }, "[QUEUE] 8. [SMTP DIAG] Post-update — email_queue.status=success confirmed, critical DB update succeeded");

        if (item.leadId) {
          await db.update(leadsTable)
            .set({ status: "sent", sentAt: new Date(), updatedAt: new Date() })
            .where(eq(leadsTable.id, item.leadId));
        }

        await db.update(campaignsTable).set({
          sentCount: sql`${campaignsTable.sentCount} + 1`,
          status: "sending",
          cooldownUntil: null,
          updatedAt: new Date(),
        }).where(eq(campaignsTable.id, campaignId));

        // ── Non-fatal: IMAP sent-folder copy ──
        if (box.imapHost && box.imapUser && box.imapPassEncrypted) {
          const raw = buildRawMessage({
            from: fromAddress, to: item.email, subject,
            html: trackedHtml, text: bodyText, messageId: info.messageId,
          });
          saveToSent(box, raw).catch(() => {});
        }

        // ── Non-fatal: drafts tracking record — failure here must never revert a sent email ──
        // sentAt is set to now() because the email is already delivered; this makes
        // the open-tracking pixel record events immediately without needing "Mark Sent".
        try {
          await db.insert(draftsTable).values({
            userId: user.id, campaignId, leadId: item.leadId ?? null,
            email: item.email, subject, body: bodyText, status: "success",
            trackingId, gmailDraftId: `smtp:${info.messageId}`,
            sentAt: new Date(),
          });
        } catch (draftErr) {
          logger.warn({ draftErr, jobId, campaignId, queueItemId: item.id },
            "[QUEUE] Non-fatal: drafts table insert failed — email WAS sent and queue/lead already marked success");
        }

        // Non-fatal: if this was a probe send after SMTP quota, clear the quota state.
        // The recovery loop detects quota_status=null and exits cleanly.
        clearMailboxQuotaIfNeeded(box.id, user.id).catch(err2 =>
          logger.warn({ err: err2 }, "[SMTP-QUOTA] clearMailboxQuotaIfNeeded failed (non-fatal)"));

        batchSent++;
      } catch (err: any) {
        const errMsg   = String(err?.message ?? "Send failed");
        const attempts = item.attempts + 1;
        const newDeferred = (item.deferredCount ?? 0) + 1;
        const errorJson = buildSmtpErrorJson(err, box);
        logger.error({ jobId, campaignId, queueItemId: item.id, to: item.email, errMsg, attempts }, "[QUEUE] 7. sendMail() threw exception");

        try {
          await db.insert(draftsTable).values({
            userId: user.id, campaignId, leadId: item.leadId ?? null,
            subject, body: bodyText, status: "failed", errorMessage: errMsg,
          });
        } catch { /* non-fatal */ }

        if (isQuotaReachedError(err)) {
          // Leave item queued (not deferred/failed) — it will be retried after the probe succeeds.
          // Do NOT increment attempts: this is a mailbox quota issue, not an email-level failure.
          await db.update(emailQueueTable)
            .set({ status: "pending", lastError: errorJson, retryAfter: null })
            .where(eq(emailQueueTable.id, item.id));
          if (item.leadId) {
            await db.update(leadsTable)
              .set({ status: "queued", updatedAt: new Date() })
              .where(eq(leadsTable.id, item.leadId));
          }
          await handleMailboxQuotaReached(box.id, user.id, errMsg);
          runQuotaRecovery(box.id, user.id, startCampaignProcessor).catch(err2 =>
            logger.error({ err: err2 }, "[SMTP-QUOTA] Recovery loop error (processCampaignJobQueue)"));
          logger.warn({ jobId, campaignId, queueItemId: item.id, mailboxId: box.id },
            "[SMTP-QUOTA] SMTP provider quota — item left queued, mailbox+campaigns paused, recovery started");
          break;
        } else if (attempts >= 3) {
          await db.update(emailQueueTable)
            .set({ status: "failed", attempts, lastError: errorJson, sentAt: new Date() })
            .where(eq(emailQueueTable.id, item.id));
          if (item.leadId) {
            await db.update(leadsTable)
              .set({ status: "failed", errorMessage: errMsg, updatedAt: new Date() })
              .where(eq(leadsTable.id, item.leadId));
          }
          await db.update(campaignsTable).set({
            failedCount: sql`${campaignsTable.failedCount} + 1`,
            updatedAt: new Date(),
          }).where(eq(campaignsTable.id, campaignId));
          logger.warn({ jobId, campaignId, queueItemId: item.id, attempts }, "[QUEUE] 9. Queue item marked failed (max attempts reached)");
          batchFailed++;
        } else {
          const retryAfter = new Date(Date.now() + retryBackoffMs(newDeferred));
          await db.update(emailQueueTable)
            .set({ status: "deferred", attempts, deferredCount: newDeferred, retryAfter, lastError: errorJson })
            .where(eq(emailQueueTable.id, item.id));
          if (item.leadId) {
            await db.update(leadsTable)
              .set({ status: "queued", updatedAt: new Date() })
              .where(eq(leadsTable.id, item.leadId));
          }
          logger.info({ jobId, campaignId, queueItemId: item.id, retryAfter }, "[QUEUE] Queue item deferred for retry — lead reset to queued");
        }
      }
    }
  } finally {
    activeJobs.delete(jobId);
    logger.info({ jobId, campaignId }, "[QUEUE] Processor loop exited — evaluating final campaign status");

    await db.update(campaignBatchesTable).set({ sentCount: batchSent, failedCount: batchFailed })
      .where(eq(campaignBatchesTable.jobId, jobId));

    const [campFinal] = await db.select({ status: campaignsTable.status, totalLeads: campaignsTable.totalLeads })
      .from(campaignsTable).where(eq(campaignsTable.id, campaignId));

    if (campFinal && campFinal.status !== "cancelled") {
      // Never finalize while any queue items are still pending/sending/deferred
      const [activeQRow] = await db.select({ count: sql<number>`count(*)::int` })
        .from(emailQueueTable)
        .where(and(
          eq(emailQueueTable.campaignId, campaignId),
          inArray(emailQueueTable.status, ["pending", "sending", "deferred"]),
        ));
      const activeQCount = activeQRow?.count ?? 0;

      if (activeQCount > 0) {
        logger.info({ jobId, campaignId, activeQCount }, "[QUEUE] Active queue items remain — not pausing/completing campaign");
        return;
      }

      const total = campFinal.totalLeads ?? 0;
      const [termRow] = await db.select({ count: sql<number>`count(*)::int` })
        .from(leadsTable)
        .where(and(
          eq(leadsTable.campaignId, campaignId),
          inArray(leadsTable.status, ["sent", "drafted", "failed"])
        ));
      const termCount = termRow?.count ?? 0;
      logger.info({ jobId, campaignId, total, termCount, activeQCount }, "[QUEUE] Final status check");

      if (total > 0 && termCount >= total) {
        logger.info({ jobId, campaignId }, "[QUEUE] All leads terminal — marking campaign completed");
        await db.update(campaignsTable).set({ status: "completed", updatedAt: new Date() })
          .where(eq(campaignsTable.id, campaignId));
      } else {
        logger.info({ jobId, campaignId, total, termCount }, "[QUEUE] 10. Campaign pause logic triggered — not all leads terminal");
        await db.update(campaignsTable).set({ status: "paused", updatedAt: new Date() })
          .where(eq(campaignsTable.id, campaignId));
      }
    } else {
      logger.info({ jobId, campaignId, status: campFinal?.status }, "[QUEUE] Campaign already in terminal/hold status — not overriding");
    }
  }
}

// ─── Self-contained campaign processor launcher ───────────────────────────────
// Loads box / template / user from DB, then delegates to processCampaignFully.
// Used by startup-recovery and the periodic watchdog so they don't need callers
// to pass context. Safe to call even if the processor is already running (no-op).
export async function startCampaignProcessor(campaignId: number): Promise<void> {
  const key = `campaign:${campaignId}`;
  if (activeJobs.get(key)) {
    logger.info({ campaignId }, "[PROCESSOR] Already active — skipping duplicate start");
    return;
  }

  const [campaign] = await db.select().from(campaignsTable)
    .where(eq(campaignsTable.id, campaignId));
  if (!campaign) {
    logger.warn({ campaignId }, "[PROCESSOR] Campaign not found — skipping");
    return;
  }
  if (!campaign.templateId) {
    logger.warn({ campaignId }, "[PROCESSOR] No template on campaign — skipping");
    return;
  }

  const [template] = await db.select().from(templatesTable)
    .where(eq(templatesTable.id, campaign.templateId));
  if (!template) {
    logger.warn({ campaignId }, "[PROCESSOR] Template not found — skipping");
    return;
  }

  const [freshUser] = await db.select().from(usersTable)
    .where(eq(usersTable.id, campaign.userId));
  if (!freshUser) {
    logger.warn({ campaignId }, "[PROCESSOR] User not found — skipping");
    return;
  }

  const [box] = await db.select().from(mailboxesTable)
    .where(and(eq(mailboxesTable.userId, campaign.userId), eq(mailboxesTable.isActive, true)));
  if (!box) {
    logger.warn({ campaignId }, "[PROCESSOR] No active mailbox — skipping");
    return;
  }

  // If the campaign was stuck in cooling_down at startup, reset it to sending so
  // processCampaignFully can re-evaluate the quota and set a fresh cooldown if needed.
  if (campaign.status === "cooling_down") {
    await db.update(campaignsTable)
      .set({ status: "sending", updatedAt: new Date() })
      .where(eq(campaignsTable.id, campaignId));
    logger.info({ campaignId }, "[PROCESSOR] Reset cooling_down → sending before restart");
  }

  processCampaignFully(campaignId, box, template, freshUser).catch(err =>
    logger.error({ err, campaignId }, "[PROCESSOR] Campaign processor error after restart"),
  );
}

// ─── Fully automated campaign processor (campaign-level, not batch-level) ────
export async function processCampaignFully(
  campaignId: number,
  box: typeof mailboxesTable.$inferSelect,
  template: typeof templatesTable.$inferSelect,
  user: User,
) {
  const key = `campaign:${campaignId}`;
  if (activeJobs.get(key)) {
    logger.info({ campaignId }, "[CAMPAIGN] 1. Processor already running — skipping duplicate start");
    return;
  }
  activeJobs.set(key, true);
  logger.info({ campaignId, mailbox: box.smtpUser }, "[CAMPAIGN] 1. Campaign processor started");

  // Pass 1: Recover queue items stuck in 'sending' → reset to 'pending' + leads to 'queued'
  const stuckSendingQueue = await db
    .update(emailQueueTable)
    .set({ status: "pending" })
    .where(and(
      eq(emailQueueTable.campaignId, campaignId),
      eq(emailQueueTable.status, "sending"),
    ))
    .returning({ id: emailQueueTable.id, leadId: emailQueueTable.leadId });
  if (stuckSendingQueue.length > 0) {
    logger.warn({ campaignId, count: stuckSendingQueue.length }, "[CAMPAIGN] Recovered stuck 'sending' queue items → reset to pending");
    const ids = stuckSendingQueue.map(i => i.leadId).filter((id): id is number => id != null);
    if (ids.length > 0) {
      await db.update(leadsTable)
        .set({ status: "queued", updatedAt: new Date() })
        .where(inArray(leadsTable.id, ids));
    }
  }

  // Pass 2: Recover leads stuck in 'sending' when their queue item is already 'deferred'
  // (happens when a previous run failed, deferred the queue item, but never reset the lead)
  const deferredQItems = await db
    .select({ leadId: emailQueueTable.leadId })
    .from(emailQueueTable)
    .where(and(eq(emailQueueTable.campaignId, campaignId), eq(emailQueueTable.status, "deferred"), isNotNull(emailQueueTable.leadId)));
  if (deferredQItems.length > 0) {
    const deferredLeadIds = deferredQItems.map(i => i.leadId).filter((id): id is number => id != null);
    const fixed = await db.update(leadsTable)
      .set({ status: "queued", updatedAt: new Date() })
      .where(and(inArray(leadsTable.id, deferredLeadIds), eq(leadsTable.status, "sending")))
      .returning({ id: leadsTable.id });
    if (fixed.length > 0) {
      logger.warn({ campaignId, count: fixed.length }, "[CAMPAIGN] Recovered leads stuck in 'sending' with deferred queue item → reset to queued");
    }
  }

  const branding    = userBranding(user);
  const fromAddress = box.fromName
    ? `"${box.fromName.replace(/"/g, "")}" <${box.smtpUser}>`
    : box.smtpUser;

  const [campaignUrlRow] = await db.select({
    bookingUrl:  campaignsTable.bookingUrl,
    quoteUrl:    campaignsTable.quoteUrl,
    websiteUrl:  campaignsTable.websiteUrl,
    phoneNumber: campaignsTable.phoneNumber,
  }).from(campaignsTable).where(eq(campaignsTable.id, campaignId));

  const trackingSettings = await getTrackingSettings();

  try {
    while (activeJobs.get(key)) {
      const [camp] = await db.select({ status: campaignsTable.status })
        .from(campaignsTable).where(eq(campaignsTable.id, campaignId));
      if (!camp || camp.status === "paused" || camp.status === "cancelled") {
        logger.info({ campaignId, status: camp?.status }, "[CAMPAIGN] 10. Campaign pause/cancel detected — stopping loop");
        break;
      }

      // Rolling-60-min quota check
      const hourAgo = new Date(Date.now() - 3_600_000);
      const [hourlyRow] = await db.select({ count: sql<number>`count(*)::int` })
        .from(emailQueueTable)
        .where(and(
          eq(emailQueueTable.mailboxId, box.id),
          isNotNull(emailQueueTable.firstAttemptAt),
          gte(emailQueueTable.firstAttemptAt, hourAgo),
        ));
      const sentThisHour = hourlyRow?.count ?? 0;
      const maxPerHour   = box.maxPerHour ?? 100;

      if (sentThisHour >= maxPerHour) {
        // Check if the mailbox is already in quota_reached state (recovery loop may be running)
        const [boxQuota] = await db
          .select({ quotaStatus: mailboxesTable.quotaStatus })
          .from(mailboxesTable)
          .where(eq(mailboxesTable.id, box.id));

        if (boxQuota?.quotaStatus === "quota_reached") {
          // This processor was restarted as the recovery probe. The hourly count is still
          // high from sends made before the quota was hit — that is expected. Do NOT break
          // here: breaking silently freezes the campaign in "Sending" with 0 emails and no
          // error because the finally block sees activeQCount > 0 and leaves status unchanged.
          // Instead, fall through and attempt the send. That send IS the probe: if it
          // succeeds, clearMailboxQuotaIfNeeded clears quota_status and the recovery loop
          // exits cleanly; if it fails with a quota error, handleMailboxQuotaReached
          // (probe-failure branch) extends the cooldown and the loop retries.
          logger.info({ campaignId, sentThisHour, maxPerHour },
            "[CAMPAIGN] In quota recovery probe mode — hourly count high from pre-quota sends, skipping preemptive check, attempting probe send");
        } else {
          // First detection of preemptive hourly limit — engage the full quota recovery system
          const reason = `Hourly send limit reached: ${sentThisHour}/${maxPerHour} emails sent in the last 60 minutes`;
          logger.warn({ campaignId, sentThisHour, maxPerHour },
            "[CAMPAIGN] Preemptive quota pause — hourly limit reached, pausing mailbox and all campaigns");
          await handleMailboxQuotaReached(box.id, user.id, reason);
          runQuotaRecovery(box.id, user.id, startCampaignProcessor).catch(err2 =>
            logger.error({ err: err2 }, "[SMTP-QUOTA] Recovery loop error (processCampaignFully preemptive)"));
          break;
        }
      }

      // Clear cooling_down only when the full rolling 60-min quota window has cleared.
      // If any sends remain in the window (sentThisHour > 0), stay in cooling_down
      // to prevent quota probing (send 5 → cooldown → send 4 → cooldown …).
      const [campNow] = await db.select({ status: campaignsTable.status })
        .from(campaignsTable).where(eq(campaignsTable.id, campaignId));
      if (campNow?.status === "cooling_down") {
        if (sentThisHour === 0) {
          await db.update(campaignsTable).set({
            status: "sending", cooldownUntil: null, updatedAt: new Date(),
          }).where(eq(campaignsTable.id, campaignId));
          logger.info({ campaignId, maxPerHour }, "[CAMPAIGN] Full quota window cleared — resuming from cooling_down");
        } else {
          // Quota window partially used — hold in cooling_down and check again in 60 s
          logger.info({ campaignId, sentThisHour, maxPerHour },
            "[CAMPAIGN] Quota window not fully cleared — staying in cooling_down");
          await sleep(60_000);
          continue;
        }
      }

      // Grab next pending OR ready-deferred item for this campaign
      const nowTs = new Date();
      const [item] = await db.select()
        .from(emailQueueTable)
        .where(and(
          eq(emailQueueTable.campaignId, campaignId),
          or(
            eq(emailQueueTable.status, "pending"),
            and(
              eq(emailQueueTable.status, "deferred"),
              or(isNull(emailQueueTable.retryAfter), lte(emailQueueTable.retryAfter, nowTs))
            )
          )
        ))
        .orderBy(emailQueueTable.id)
        .limit(1);

      if (!item) {
        // No immediately-ready item. Check whether a future deferred item exists.
        const [nextDeferred] = await db
          .select({ id: emailQueueTable.id, retryAfter: emailQueueTable.retryAfter })
          .from(emailQueueTable)
          .where(and(
            eq(emailQueueTable.campaignId, campaignId),
            eq(emailQueueTable.status, "deferred"),
            isNotNull(emailQueueTable.retryAfter),
          ))
          .orderBy(emailQueueTable.retryAfter)
          .limit(1);

        if (!nextDeferred || !nextDeferred.retryAfter) {
          logger.info({ campaignId }, "[CAMPAIGN] No pending or deferred items remain — exiting loop");
          break;
        }

        const waitMs = Math.max(0, nextDeferred.retryAfter.getTime() - Date.now());
        logger.info({ campaignId, queueItemId: nextDeferred.id, retryAfter: nextDeferred.retryAfter, waitMs },
          "[CAMPAIGN] 7. All items deferred — sleeping until retry window (poll every 30s for pause/cancel)");

        let remaining = waitMs;
        let aborted   = false;
        while (remaining > 0 && activeJobs.get(key)) {
          await sleep(Math.min(30_000, remaining));
          remaining -= 30_000;
          const [campCheck] = await db.select({ status: campaignsTable.status })
            .from(campaignsTable).where(eq(campaignsTable.id, campaignId));
          if (!campCheck || campCheck.status === "paused" || campCheck.status === "cancelled") {
            logger.info({ campaignId, status: campCheck?.status },
              "[CAMPAIGN] Pause/cancel detected during deferred wait — stopping");
            aborted = true;
            break;
          }
        }
        if (aborted) break;
        logger.info({ campaignId }, "[CAMPAIGN] Retry window reached — resuming processing loop");
        continue;
      }

      logger.info({ campaignId, queueItemId: item.id, email: item.email }, "[CAMPAIGN] 2. Queue item picked up");

      await db.update(emailQueueTable)
        .set({ status: "sending", firstAttemptAt: item.firstAttemptAt ?? nowTs })
        .where(eq(emailQueueTable.id, item.id));

      if (item.leadId) {
        await db.update(leadsTable)
          .set({ status: "sending", updatedAt: new Date() })
          .where(eq(leadsTable.id, item.leadId));
        logger.info({ campaignId, queueItemId: item.id, leadId: item.leadId }, "[CAMPAIGN] 3. Lead status updated to sending");
      }

      const delay = (box.delaySeconds ?? 15) * 1000;
      logger.info({ campaignId, queueItemId: item.id, delayMs: delay }, "[CAMPAIGN] Sleeping before send");
      await sleep(delay);

      // Re-check pause / cancel after delay
      const [campAfter] = await db.select({ status: campaignsTable.status })
        .from(campaignsTable).where(eq(campaignsTable.id, campaignId));
      if (!campAfter || campAfter.status === "paused" || campAfter.status === "cancelled") {
        logger.info({ campaignId, status: campAfter?.status }, "[CAMPAIGN] 10. Pause/cancel detected after delay — requeueing item");
        await db.update(emailQueueTable).set({ status: "pending" }).where(eq(emailQueueTable.id, item.id));
        if (item.leadId) {
          await db.update(leadsTable)
            .set({ status: "queued", updatedAt: new Date() })
            .where(eq(leadsTable.id, item.leadId));
        }
        break;
      }

      // Build email content
      const row = JSON.parse(item.rowDataJson) as Record<string, string>;
      if (row.price) row.price = formatPrice(row.price);
      if (campaignUrlRow?.bookingUrl)  row.booking_link = campaignUrlRow.bookingUrl;
      if (campaignUrlRow?.quoteUrl)    row.quote_link   = campaignUrlRow.quoteUrl;
      if (campaignUrlRow?.websiteUrl)  row.website_link = campaignUrlRow.websiteUrl;
      if (campaignUrlRow?.phoneNumber) row.phone_link   = campaignUrlRow.phoneNumber;

      const trackingId = randomUUID();
      const publicBase = trackingSettings.trackingUrl;

      const ctaButtonsFull = (() => {
        try { return template.ctaButtonsJson ? JSON.parse(template.ctaButtonsJson) : []; }
        catch { return []; }
      })();

      const subject  = replaceVarsText(template.subject, row);
      const bodyText = replaceVarsText(template.body, row);
      const resolvedStyleFull = (item.style ?? "clean") as any;
      logger.info({ campaignId, queueItemId: item.id, templateId: template.id, templateName: template.name, ctaCount: ctaButtonsFull.length, itemStyle: item.style, resolvedStyle: resolvedStyleFull },
        "[EMAIL BUILDER] processCampaignFully: rendering HTML email (ctaCount included)");
      const bodyHtml = buildHtmlEmail(template.body, row, branding, {
        style: resolvedStyleFull,
        useSignatureBuilder: item.useSignatureBuilder,
        ctaButtons:          ctaButtonsFull,
        trackingId: trackingSettings.clickTrackingEnabled ? trackingId : undefined,
        publicBase: trackingSettings.clickTrackingEnabled ? publicBase : undefined,
        unsubscribeUrl: buildUnsubscribeUrl(publicBase, user.id, item.leadId ?? null, campaignId, item.email),
      });

      const pixelTag    = trackingSettings.openTrackingEnabled
        ? `<img src="${publicBase}/api/track/open/${trackingId}" width="1" height="1" alt="" style="display:none!important;width:1px!important;height:1px!important;border:0;" />`
        : "";
      const trackedHtml = pixelTag
        ? (bodyHtml.includes("</body>") ? bodyHtml.replace(/<\/body>/i, `${pixelTag}</body>`) : bodyHtml + pixelTag)
        : bodyHtml;

      // ── [OPEN TRACKING] Diagnostics ────────────────────────────────────────
      logger.info({
        sendPath:             "processCampaignFully",
        campaignId, queueItemId: item.id,
        trackingId,
        openTrackingEnabled:  trackingSettings.openTrackingEnabled,
        clickTrackingEnabled: trackingSettings.clickTrackingEnabled,
        publicBase,
        pixelTagLength:       pixelTag.length,
        pixelTag:             pixelTag || "(EMPTY — pixel NOT injected)",
        bodyHtmlHasBody:      bodyHtml.includes("</body>"),
        trackedHtmlHasPixel:  trackedHtml.includes("/api/track/open/"),
        htmlTail:             trackedHtml.slice(-600),
      }, "[OPEN TRACKING] Pre-sendMail diagnostics");
      // ── End diagnostics ────────────────────────────────────────────────────

      // ── Suppression re-check: a lead can be suppressed (bounce/unsubscribe) after
      // it was originally imported/queued, so we must re-check right before sending. ──
      if (await isSuppressed(user.id, item.email)) {
        logger.warn({ campaignId, queueItemId: item.id, to: item.email }, "[CAMPAIGN] Recipient is suppressed — skipping send");
        await db.update(emailQueueTable)
          .set({ status: "failed", lastError: "Recipient is on the suppression list", sentAt: new Date() })
          .where(eq(emailQueueTable.id, item.id));
        if (item.leadId) {
          await db.update(leadsTable)
            .set({ status: "failed", errorMessage: "Recipient is on the suppression list", updatedAt: new Date() })
            .where(eq(leadsTable.id, item.leadId));
        }
        await db.update(campaignsTable).set({
          failedCount: sql`${campaignsTable.failedCount} + 1`,
          updatedAt: new Date(),
        }).where(eq(campaignsTable.id, campaignId));
        continue;
      }

      logger.info({ campaignId, queueItemId: item.id, to: item.email, subject, ctaCount: ctaButtonsFull.length, smtpHost: box.smtpHost, smtpPort: box.smtpPort, encryption: box.smtpSecure }, "[SMTP SEND] sendMail starting — host/port/ctaCount for verification");

      try {
        const info = await sendEmailWithTimeout(box, { to: item.email, subject, text: bodyText, html: trackedHtml });
        logger.info({ campaignId, queueItemId: item.id, messageId: info.messageId }, "[CAMPAIGN] 6. sendMail() returned successfully");

        // ── Critical state updates first — these must succeed before anything optional ──
        // Updating the queue item to "success" is the idempotency guard: if the process
        // crashes after this point, the startup recovery will NOT re-send this email.
        //
        // [SMTP DIAG] Pre-update checkpoint: if this log appears but "[CAMPAIGN] 8" does NOT,
        // the DB update threw (DB down, constraint error) or the process crashed between
        // SMTP 250 acceptance and the DB commit. Status stays "sending", trackingId stays NULL,
        // no draft row is created → opens can never be recorded for this email.
        const sentAtTs = new Date();
        logger.info({
          campaignId,
          queueItemId:    item.id,
          mailboxId:      box.id,
          previousStatus: "sending",
          newStatus:      "success",
          sentAt:         sentAtTs.toISOString(),
          trackingId,
          messageId:      info.messageId,
        }, "[CAMPAIGN] 7. [SMTP DIAG] Pre-update — SMTP 250 accepted, writing status/sentAt/trackingId to email_queue now");

        await db.update(emailQueueTable)
          .set({ status: "success", sentAt: sentAtTs, trackingId })
          .where(eq(emailQueueTable.id, item.id));

        logger.info({
          campaignId,
          queueItemId:    item.id,
          mailboxId:      box.id,
          newStatus:      "success",
          sentAt:         sentAtTs.toISOString(),
          trackingId,
        }, "[CAMPAIGN] 8. [SMTP DIAG] Post-update — email_queue.status=success confirmed, critical DB update succeeded");

        if (item.leadId) {
          await db.update(leadsTable)
            .set({ status: "sent", sentAt: new Date(), updatedAt: new Date() })
            .where(eq(leadsTable.id, item.leadId));
        }

        await db.update(campaignsTable).set({
          sentCount: sql`${campaignsTable.sentCount} + 1`,
          status: "sending",
          cooldownUntil: null,
          updatedAt: new Date(),
        }).where(eq(campaignsTable.id, campaignId));

        // ── Non-fatal: IMAP sent-folder copy ──
        if (box.imapHost && box.imapUser && box.imapPassEncrypted) {
          const raw = buildRawMessage({
            from: fromAddress, to: item.email, subject,
            html: trackedHtml, text: bodyText, messageId: info.messageId,
          });
          saveToSent(box, raw).catch(() => {});
        }

        // ── Non-fatal: drafts tracking record — failure here must never revert a sent email ──
        // sentAt is set to now() because the email is already delivered; this makes
        // the open-tracking pixel record events immediately without needing "Mark Sent".
        try {
          await db.insert(draftsTable).values({
            userId: user.id, campaignId, leadId: item.leadId ?? null,
            email: item.email, subject, body: bodyText, status: "success",
            trackingId, gmailDraftId: `smtp:${info.messageId}`,
            sentAt: new Date(),
          });
        } catch (draftErr) {
          logger.warn({ draftErr, campaignId, queueItemId: item.id },
            "[CAMPAIGN] Non-fatal: drafts table insert failed — email WAS sent and queue/lead already marked success");
        }

        // Non-fatal: if this was a probe send after SMTP quota, clear the quota state.
        // The recovery loop detects quota_status=null and exits cleanly.
        clearMailboxQuotaIfNeeded(box.id, user.id).catch(err2 =>
          logger.warn({ err: err2 }, "[SMTP-QUOTA] clearMailboxQuotaIfNeeded failed (non-fatal)"));

      } catch (err: any) {
        const errMsg      = String(err?.message ?? "Send failed");
        const attempts    = item.attempts + 1;
        const newDeferred = (item.deferredCount ?? 0) + 1;
        const errorJson   = buildSmtpErrorJson(err, box);
        logger.error({ campaignId, queueItemId: item.id, to: item.email, errMsg, attempts }, "[CAMPAIGN] 7. sendMail() threw exception");

        try {
          await db.insert(draftsTable).values({
            userId: user.id, campaignId, leadId: item.leadId ?? null,
            subject, body: bodyText, status: "failed", errorMessage: errMsg,
          });
        } catch { /* non-fatal */ }

        if (isQuotaReachedError(err)) {
          // Leave item queued (not deferred/failed) — it will be retried after the probe succeeds.
          // Do NOT increment attempts: this is a mailbox quota issue, not an email-level failure.
          await db.update(emailQueueTable)
            .set({ status: "pending", lastError: errorJson, retryAfter: null })
            .where(eq(emailQueueTable.id, item.id));
          if (item.leadId) {
            await db.update(leadsTable)
              .set({ status: "queued", updatedAt: new Date() })
              .where(eq(leadsTable.id, item.leadId));
          }
          await handleMailboxQuotaReached(box.id, user.id, errMsg);
          runQuotaRecovery(box.id, user.id, startCampaignProcessor).catch(err2 =>
            logger.error({ err: err2 }, "[SMTP-QUOTA] Recovery loop error (processCampaignFully)"));
          logger.warn({ campaignId, queueItemId: item.id, mailboxId: box.id },
            "[SMTP-QUOTA] SMTP provider quota — item left queued, mailbox+campaigns paused, recovery started");
          break;
        } else if (attempts >= 3) {
          await db.update(emailQueueTable)
            .set({ status: "failed", attempts, lastError: errorJson, sentAt: new Date() })
            .where(eq(emailQueueTable.id, item.id));
          if (item.leadId) {
            await db.update(leadsTable)
              .set({ status: "failed", errorMessage: errMsg, updatedAt: new Date() })
              .where(eq(leadsTable.id, item.leadId));
          }
          await db.update(campaignsTable).set({
            failedCount: sql`${campaignsTable.failedCount} + 1`,
            updatedAt: new Date(),
          }).where(eq(campaignsTable.id, campaignId));
          logger.warn({ campaignId, queueItemId: item.id, attempts }, "[CAMPAIGN] 9. Queue item marked failed (max attempts reached)");
        } else {
          const retryAfter = new Date(Date.now() + retryBackoffMs(newDeferred));
          await db.update(emailQueueTable)
            .set({ status: "deferred", attempts, deferredCount: newDeferred, retryAfter, lastError: errorJson })
            .where(eq(emailQueueTable.id, item.id));
          if (item.leadId) {
            await db.update(leadsTable)
              .set({ status: "queued", updatedAt: new Date() })
              .where(eq(leadsTable.id, item.leadId));
          }
          logger.info({ campaignId, queueItemId: item.id, retryAfter }, "[CAMPAIGN] Queue item deferred for retry — lead reset to queued");
        }
      }
    }
  } finally {
    activeJobs.delete(key);
    logger.info({ campaignId }, "[CAMPAIGN] Processor loop exited — evaluating final campaign status");

    const [camp] = await db.select({ status: campaignsTable.status, totalLeads: campaignsTable.totalLeads })
      .from(campaignsTable).where(eq(campaignsTable.id, campaignId));

    if (camp && camp.status !== "paused" && camp.status !== "cancelled" && camp.status !== "cooling_down") {
      // Never finalize while any queue items are still pending/sending/deferred
      const [activeQRow] = await db.select({ count: sql<number>`count(*)::int` })
        .from(emailQueueTable)
        .where(and(
          eq(emailQueueTable.campaignId, campaignId),
          inArray(emailQueueTable.status, ["pending", "sending", "deferred"]),
        ));
      const activeQCount = activeQRow?.count ?? 0;

      if (activeQCount > 0) {
        logger.info({ campaignId, activeQCount }, "[CAMPAIGN] Active queue items remain — not pausing/completing campaign");
        return;
      }

      const total = camp.totalLeads ?? 0;
      const [termRow] = await db.select({ count: sql<number>`count(*)::int` })
        .from(leadsTable)
        .where(and(
          eq(leadsTable.campaignId, campaignId),
          inArray(leadsTable.status, ["sent", "drafted", "failed"])
        ));
      const termCount = termRow?.count ?? 0;
      logger.info({ campaignId, total, termCount, activeQCount }, "[CAMPAIGN] Final status check");

      if (total > 0 && termCount >= total) {
        logger.info({ campaignId }, "[CAMPAIGN] All leads terminal — marking campaign completed");
        await db.update(campaignsTable).set({ status: "completed", updatedAt: new Date() })
          .where(eq(campaignsTable.id, campaignId));
      } else {
        logger.info({ campaignId, total, termCount }, "[CAMPAIGN] 10. Campaign pause logic triggered — not all leads terminal");
        await db.update(campaignsTable).set({ status: "paused", updatedAt: new Date() })
          .where(eq(campaignsTable.id, campaignId));
      }
    } else {
      logger.info({ campaignId, status: camp?.status }, "[CAMPAIGN] Campaign already in terminal/hold status — not overriding");
    }
  }
}

// ─── GET /api/campaigns ───────────────────────────────────────────────────────
router.get("/campaigns", requireAuth, async (req, res): Promise<void> => {
  const user   = req.user!;
  const page   = parseInt(req.query.page as string, 10) || 1;
  const limit  = parseInt(req.query.limit as string, 10) || 20;
  const status = (req.query.status as string | undefined)?.trim();
  const search = (req.query.search as string | undefined)?.trim();

  const conditions = [
    eq(campaignsTable.userId, user.id),
    ne(campaignsTable.status, "archived"),
  ];
  if (status && status !== "all") conditions.push(eq(campaignsTable.status, status));
  if (search) conditions.push(sql`lower(${campaignsTable.name}) like ${`%${search.toLowerCase()}%`}` as any);

  const [totalResult] = await db.select({ count: count() })
    .from(campaignsTable).where(and(...conditions));

  const rows = await db
    .select({
      id:           campaignsTable.id,
      userId:       campaignsTable.userId,
      name:         campaignsTable.name,
      status:       campaignsTable.status,
      templateId:   campaignsTable.templateId,
      templateName: templatesTable.name,
      totalLeads:   campaignsTable.totalLeads,
      draftedCount: campaignsTable.draftedCount,
      failedCount:  campaignsTable.failedCount,
      fileName:     campaignsTable.fileName,
      sendMode:     campaignsTable.sendMode,
      sentCount:    campaignsTable.sentCount,
      currentJobId: campaignsTable.currentJobId,
      emailStyle:   campaignsTable.emailStyle,
      useSignature: campaignsTable.useSignature,
      cooldownUntil: campaignsTable.cooldownUntil,
      pauseReason:  campaignsTable.pauseReason,
      createdAt:    campaignsTable.createdAt,
      updatedAt:    campaignsTable.updatedAt,
    })
    .from(campaignsTable)
    .leftJoin(templatesTable, eq(campaignsTable.templateId, templatesTable.id))
    .where(and(...conditions))
    .orderBy(desc(campaignsTable.createdAt))
    .limit(limit)
    .offset((page - 1) * limit);

  res.json({
    data: rows.map(c => ({
      ...c,
      cooldownUntil: c.cooldownUntil?.toISOString() ?? null,
      pauseReason:   c.pauseReason ?? null,
      createdAt:     c.createdAt.toISOString(),
      updatedAt:     c.updatedAt.toISOString(),
    })),
    total: totalResult.count, page, limit,
  });
});

// ─── POST /api/campaigns ──────────────────────────────────────────────────────
router.post("/campaigns", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  try {
    logger.info({ userId: user.id, email: user.email, body: req.body }, "[CREATE_CAMPAIGN] Request received");

    const parsed = CreateCampaignBody.safeParse(req.body);
    if (!parsed.success) {
      logger.warn({ userId: user.id, validationError: parsed.error.message }, "[CREATE_CAMPAIGN] Validation failed");
      res.status(400).json({ success: false, error: parsed.error.message }); return;
    }

    // Enforce campaign limit before creation
    const campaignLimitErr = await checkCampaignLimit(user.id);
    if (campaignLimitErr) {
      logger.warn({ userId: user.id, limitError: campaignLimitErr }, "[CREATE_CAMPAIGN] Campaign limit reached");
      res.status(429).json(campaignLimitErr); return;
    }

    logger.info({ userId: user.id, name: parsed.data.name }, "[CREATE_CAMPAIGN] Inserting campaign row");
    const [campaign] = await db.insert(campaignsTable).values({
      userId: user.id, name: parsed.data.name, templateId: parsed.data.templateId ?? null,
    }).returning();
    logger.info({ userId: user.id, campaignId: campaign.id }, "[CREATE_CAMPAIGN] Campaign row inserted successfully");

    await db.insert(activityTable).values({ userId: user.id, type: "campaign_created", description: `Campaign "${campaign.name}" created` });
    res.status(201).json({ ...campaign, createdAt: campaign.createdAt.toISOString(), updatedAt: campaign.updatedAt.toISOString() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack   = err instanceof Error ? err.stack   : undefined;
    logger.error({ err, userId: user.id, email: user.email, stack }, `[CREATE_CAMPAIGN] Unhandled exception: ${message}`);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: message });
    }
  }
});

// ─── POST /api/campaigns/from-upload ─────────────────────────────────────────
/**
 * Create a campaign from a parsed CSV/XLSX upload.
 * Body: { name, templateId?, sendMode, emailStyle, useSignature, fileName, rows[] }
 * Returns: { campaignId, total, valid, duplicates, invalid }
 */
router.post("/campaigns/from-upload", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  try {
  const contentLength = req.headers["content-length"];
  const bodyBytes     = Buffer.byteLength(JSON.stringify(req.body));
  logger.info(
    {
      userId: user.id,
      email:  user.email,
      sendMode: req.body?.sendMode,
      rowCount: Array.isArray(req.body?.rows) ? req.body.rows.length : "N/A",
      contentLengthHeader: contentLength ?? "(none)",
      parsedBodyBytes: bodyBytes,
      parsedBodyKB: (bodyBytes / 1024).toFixed(1),
    },
    "[CREATE_CAMPAIGN_UPLOAD] Request received",
  );

  // Enforce campaign limit before creation
  const campaignLimitErr = await checkCampaignLimit(user.id);
  if (campaignLimitErr) {
    logger.warn({ userId: user.id, limitError: campaignLimitErr }, "[CREATE_CAMPAIGN_UPLOAD] Campaign limit reached");
    res.status(429).json(campaignLimitErr); return;
  }

  const {
    name, templateId, sendMode, emailStyle, useSignature, fileName, rows,
    bookingUrl, quoteUrl, websiteUrl, phoneNumber,
  } = req.body as {
    name: string;
    templateId?: number;
    sendMode?: string;
    emailStyle?: string;
    useSignature?: boolean;
    fileName?: string;
    rows: Record<string, string | null | boolean | undefined>[];
    bookingUrl?: string;
    quoteUrl?: string;
    websiteUrl?: string;
    phoneNumber?: string;
  };

  if (!name?.trim()) { res.status(400).json({ success: false, error: "Campaign name is required." }); return; }
  if (!Array.isArray(rows) || rows.length === 0) { res.status(400).json({ success: false, error: "No rows provided." }); return; }

  // Create campaign
  const [campaign] = await db.insert(campaignsTable).values({
    userId:     user.id,
    name:       name.trim(),
    templateId: templateId ?? null,
    sendMode:   sendMode ?? "gmail",
    emailStyle: emailStyle ?? "clean",
    useSignature: useSignature ?? false,
    fileName:   fileName ?? null,
    status:     "pending",
    bookingUrl:  bookingUrl?.trim() || null,
    quoteUrl:    quoteUrl?.trim()   || null,
    websiteUrl:  websiteUrl?.trim() || null,
    phoneNumber: phoneNumber?.trim() || null,
  }).returning();

  // Insert leads (deduplicate by email within this campaign)
  const seenEmails = new Set<string>();
  let valid = 0, duplicates = 0, invalid = 0, suppressed = 0;
  const candidateValues: (typeof leadsTable.$inferInsert & { _email: string })[] = [];

  for (const row of rows) {
    const email = typeof row.email === "string" ? row.email.trim().toLowerCase() : "";
    if (!email || !validateEmailFast(email).valid) { invalid++; continue; }
    if (seenEmails.has(email)) { duplicates++; continue; }
    seenEmails.add(email);

    candidateValues.push({
      _email:     email,
      userId:     user.id,
      campaignId: campaign.id,
      name:       typeof row.name === "string" ? row.name : "",
      email,
      vehicle:    typeof row.vehicle === "string" ? row.vehicle || null : null,
      route:      typeof row.route === "string" ? row.route || null : null,
      pickup:     typeof row.pickup === "string" ? row.pickup || null : null,
      delivery:   typeof row.delivery === "string" ? row.delivery || null : null,
      price:      typeof row.price === "string" ? row.price || null : null,
      notes:      typeof row.notes === "string" ? row.notes || null : null,
      quoteId:    typeof row.quote_id === "string" ? row.quote_id || null : null,
      status:     "new",
    });
  }

  // Batch suppression check — remove any emails already suppressed for this user
  const suppressedSet = await filterSuppressed(user.id, candidateValues.map(v => v._email));

  const leadValues = candidateValues
    .filter(v => {
      if (suppressedSet.has(v._email)) { suppressed++; return false; }
      valid++;
      return true;
    })
    .map(({ _email: _unused, ...rest }) => rest);

  if (leadValues.length > 0) {
    // Insert in chunks of 500
    for (let i = 0; i < leadValues.length; i += 500) {
      await db.insert(leadsTable).values(leadValues.slice(i, i + 500));
    }
  }

  await db.update(campaignsTable).set({ totalLeads: valid, updatedAt: new Date() })
    .where(eq(campaignsTable.id, campaign.id));

  await db.insert(activityTable).values({
    userId: user.id, type: "campaign_created",
    description: `Campaign "${campaign.name}" created with ${valid} leads`,
    metadata: { campaignId: campaign.id, valid, duplicates, invalid, suppressed },
  });

  logger.info({ userId: user.id, campaignId: campaign.id, valid, duplicates, invalid, suppressed }, "[CREATE_CAMPAIGN_UPLOAD] Campaign created successfully");
  res.status(201).json({ campaignId: campaign.id, total: rows.length, valid, duplicates, invalid, suppressed });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack   = err instanceof Error ? err.stack   : undefined;
    logger.error({ err, userId: user.id, email: user.email, stack }, `[CREATE_CAMPAIGN_UPLOAD] Unhandled exception: ${message}`);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: message });
    }
  }
});

// ─── GET /api/campaigns/summary ──────────────────────────────────────────────
router.get("/campaigns/summary", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;

  const rows = await db
    .select({
      status: campaignsTable.status,
      cnt:    sql<number>`count(*)::int`,
    })
    .from(campaignsTable)
    .where(and(
      eq(campaignsTable.userId, user.id),
      ne(campaignsTable.status, "archived"),
    ))
    .groupBy(campaignsTable.status);

  const byStatus: Record<string, number> = {};
  for (const r of rows) byStatus[r.status] = r.cnt;

  const total     = rows.reduce((s, r) => s + r.cnt, 0);
  const active    = byStatus.sending    ?? 0;
  const completed = byStatus.completed  ?? 0;
  const paused    = byStatus.paused     ?? 0;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [todayRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(emailQueueTable)
    .where(and(
      eq(emailQueueTable.userId, user.id),
      eq(emailQueueTable.status, "success"),
      gte(emailQueueTable.sentAt, todayStart),
    ));

  res.json({ total, active, completed, paused, sentToday: todayRow?.total ?? 0 });
});

// ─── GET /api/campaigns/:id ───────────────────────────────────────────────────
router.get("/campaigns/:id", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const params = GetCampaignParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [campaign] = await db.select().from(campaignsTable)
    .where(and(eq(campaignsTable.id, params.data.id), eq(campaignsTable.userId, user.id)));
  if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }
  res.json({ ...campaign, createdAt: campaign.createdAt.toISOString(), updatedAt: campaign.updatedAt.toISOString() });
});

// ─── GET /api/campaigns/:id/progress ─────────────────────────────────────────
router.get("/campaigns/:id/progress", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const campaignId = parseInt((req.params.id as string), 10);
  if (!campaignId) { res.status(400).json({ error: "Invalid campaign id" }); return; }

  const [campaign] = await db.select().from(campaignsTable)
    .where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.userId, user.id)));
  if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }

  // Count leads by status
  const statuses = ["new", "queued", "sending", "sent", "drafted", "failed"] as const;
  const counts: Record<string, number> = {};
  for (const s of statuses) {
    const [row] = await db.select({ count: sql<number>`count(*)::int` })
      .from(leadsTable)
      .where(and(eq(leadsTable.campaignId, campaignId), eq(leadsTable.status, s)));
    counts[s] = row?.count ?? 0;
  }

  const total     = campaign.totalLeads;
  const sent      = (counts.sent ?? 0) + (counts.drafted ?? 0);
  const sending   = counts.sending ?? 0;
  const queued    = counts.queued ?? 0;
  const failed    = counts.failed ?? 0;
  const remaining = counts.new ?? 0;

  // Hourly rate info (for SMTP mode)
  let sentThisHour = 0, hourlyLimit = 100, remainingQuota = 100;
  let isHourlyLimitReached = false, cooldownSeconds = 0;

  if (campaign.sendMode === "smtp") {
    const [box] = await db.select().from(mailboxesTable).where(eq(mailboxesTable.userId, user.id));
    hourlyLimit = box?.maxPerHour ?? 100;

    const hourAgo = new Date(Date.now() - 3_600_000);
    // Use the same query as the campaign processors (firstAttemptAt + mailboxId)
    // so the displayed quota matches exactly what the processor enforces.
    // The old query (sentAt + userId + status='success') diverged from the
    // processor by field, scope, and status filter — causing oscillation.
    if (box) {
      const [hourlyRow] = await db.select({ count: sql<number>`count(*)::int` })
        .from(emailQueueTable)
        .where(and(
          eq(emailQueueTable.mailboxId, box.id),
          isNotNull(emailQueueTable.firstAttemptAt),
          gte(emailQueueTable.firstAttemptAt, hourAgo),
        ));
      sentThisHour = hourlyRow?.count ?? 0;
    }
    remainingQuota = Math.max(0, hourlyLimit - sentThisHour);
    isHourlyLimitReached = sentThisHour >= hourlyLimit;

    if (campaign.cooldownUntil && campaign.cooldownUntil > new Date()) {
      cooldownSeconds = Math.ceil((campaign.cooldownUntil.getTime() - Date.now()) / 1000);
    }
  }

  const campaignKey = `campaign:${campaignId}`;
  const legacyKey   = campaign.currentJobId ?? "";
  const isJobActive = activeJobs.has(campaignKey) || activeJobs.has(legacyKey);

  // Currently-sending email (for real-time display)
  let currentlySendingEmail: string | null = null;
  let estimatedCompletionSeconds = 0;
  if (campaign.sendMode === "smtp") {
    const [sendingItem] = await db.select({ email: emailQueueTable.email })
      .from(emailQueueTable)
      .where(and(
        eq(emailQueueTable.campaignId, campaignId),
        eq(emailQueueTable.status, "sending"),
      ))
      .limit(1);
    currentlySendingEmail = sendingItem?.email ?? null;

    const [box2] = await db.select({ delaySeconds: mailboxesTable.delaySeconds })
      .from(mailboxesTable).where(eq(mailboxesTable.userId, user.id));
    const delayS = box2?.delaySeconds ?? 15;

    // Find the furthest retryAfter across all deferred items for this campaign.
    // Each deferred item represents an email that cannot be retried until that
    // time — so the longest deferred wait is a floor on the real completion time.
    const [maxDef] = await db
      .select({ maxRetry: sql<string | null>`max(retry_after)::text` })
      .from(emailQueueTable)
      .where(and(
        eq(emailQueueTable.campaignId, campaignId),
        eq(emailQueueTable.status, "deferred"),
      ));
    const deferredWaitSecs = maxDef?.maxRetry
      ? Math.max(0, Math.ceil((new Date(maxDef.maxRetry).getTime() - Date.now()) / 1000))
      : 0;

    // ETA = cooldown remaining + max deferred-item wait + send time for all pending leads.
    // cooldownSeconds already accounts for the active hourly-limit cooldown.
    // deferredWaitSecs accounts for SMTP-retry backoffs.
    // (queued + remaining) * delayS is the per-email delay configured by the user.
    estimatedCompletionSeconds = cooldownSeconds + deferredWaitSecs + (queued + remaining) * delayS;
  }

  // Lightweight open/click counts for frontend change-detection.
  // Used only to know when to invalidate the analytics cache — not for display.
  let openCount = 0, clickCount = 0;
  if (campaign.sendMode === "smtp") {
    const [evtCounts] = await db
      .select({
        opens:  sql<number>`count(*) filter (where ${emailTrackingEventsTable.eventType} = 'open')::int`,
        clicks: sql<number>`count(*) filter (where ${emailTrackingEventsTable.eventType} = 'click')::int`,
      })
      .from(emailTrackingEventsTable)
      .innerJoin(draftsTable, eq(emailTrackingEventsTable.draftId, draftsTable.id))
      .innerJoin(emailQueueTable, and(
        eq(emailQueueTable.trackingId, draftsTable.trackingId),
        eq(emailQueueTable.campaignId, campaignId),
      ));
    openCount  = evtCounts?.opens  ?? 0;
    clickCount = evtCounts?.clicks ?? 0;
  }

  res.json({
    total, sent, sending, queued, failed, remaining,
    sentThisHour, hourlyLimit, remainingQuota,
    isHourlyLimitReached, cooldownSeconds,
    cooldownUntil: campaign.cooldownUntil?.toISOString() ?? null,
    currentJobId: campaign.currentJobId ?? null,
    isJobActive,
    sendMode: campaign.sendMode,
    status: campaign.status,
    currentlySendingEmail,
    estimatedCompletionSeconds,
    openCount,
    clickCount,
  });
});

// ─── POST /api/campaigns/:id/send-batch ──────────────────────────────────────
/**
 * Send next N unsent leads in this campaign.
 * Body: { batchSize: number }
 * Returns: { jobId, mode, total }
 */
router.post("/campaigns/:id/send-batch", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const campaignId = parseInt((req.params.id as string), 10);
  if (!campaignId) { res.status(400).json({ error: "Invalid campaign id" }); return; }

  const { batchSize } = req.body as { batchSize?: number };
  const limit = Math.max(1, Math.min(batchSize ?? 10, 500));

  const [campaign] = await db.select().from(campaignsTable)
    .where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.userId, user.id)));
  if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }

  if (!campaign.templateId) { res.status(400).json({ error: "Campaign has no template. Update the campaign with a template first." }); return; }

  const [template] = await db.select().from(templatesTable)
    .where(and(eq(templatesTable.id, campaign.templateId), eq(templatesTable.userId, user.id)));
  if (!template) { res.status(404).json({ error: "Template not found." }); return; }

  const [freshUser] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
  if (!freshUser) { res.status(404).json({ error: "User not found." }); return; }

  // Get next batch of unsent leads
  const candidateLeads = await db.select().from(leadsTable)
    .where(and(eq(leadsTable.campaignId, campaignId), eq(leadsTable.status, "new")))
    .orderBy(leadsTable.id)
    .limit(limit);

  if (candidateLeads.length === 0) {
    res.status(400).json({ error: "No remaining leads to send. All leads have been processed." });
    return;
  }

  // Re-check suppression right before enqueueing — a lead may have been
  // suppressed (bounce/unsubscribe) after it was originally imported.
  const sendBatchSuppressed = await filterSuppressed(user.id, candidateLeads.map(l => l.email ?? ""));
  const nextLeads = candidateLeads.filter(l => !sendBatchSuppressed.has((l.email ?? "").trim().toLowerCase()));
  if (sendBatchSuppressed.size > 0) {
    const suppressedLeadIds = candidateLeads
      .filter(l => sendBatchSuppressed.has((l.email ?? "").trim().toLowerCase()))
      .map(l => l.id);
    await db.update(leadsTable)
      .set({ status: "failed", errorMessage: "Recipient is on the suppression list", updatedAt: new Date() })
      .where(inArray(leadsTable.id, suppressedLeadIds));
  }

  if (nextLeads.length === 0) {
    res.status(400).json({ error: "All remaining leads in this batch are suppressed." });
    return;
  }

  if (campaign.sendMode === "smtp") {
    const [box] = await db.select().from(mailboxesTable)
      .where(and(eq(mailboxesTable.userId, user.id), eq(mailboxesTable.isActive, true)));
    if (!box) { res.status(400).json({ error: "No active SMTP mailbox configured." }); return; }

    const jobId = randomUUID();
    const ALL_STYLES_SB = ["clean","modern","minimal","luxury","corporate","urgent","dispatch","friendly","mobile","dark"] as const;
    const emailStyle  = ALL_STYLES_SB.includes(campaign.emailStyle as any)
      ? campaign.emailStyle as any : "clean";
    const useSig = campaign.useSignature ?? freshUser.useSignature ?? false;
    logger.info({ campaignId, templateId: template.id, templateName: template.name, selectedEmailStyle: campaign.emailStyle, resolvedEmailStyle: emailStyle },
      "[TEMPLATE] send-batch: templateId and style resolved");

    // Mark leads as queued
    const leadIds = nextLeads.map(l => l.id);
    for (const id of leadIds) {
      await db.update(leadsTable).set({ status: "queued", updatedAt: new Date() }).where(eq(leadsTable.id, id));
    }

    // Enqueue emails
    const entries: (typeof emailQueueTable.$inferInsert)[] = [];
    for (const lead of nextLeads) {
      if (!lead.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) continue;

      const row: Record<string, string> = {
        name: lead.name ?? "",
        email: lead.email,
        vehicle: lead.vehicle ?? "",
        route: lead.route ?? "",
        pickup: lead.pickup ?? "",
        delivery: lead.delivery ?? "",
        price: lead.price ?? "",
        notes: lead.notes ?? "",
        quote_id: lead.quoteId ?? "",
      };

      const subject = replaceVarsText(template.subject, row);

      entries.push({
        jobId,
        userId:             user.id,
        mailboxId:          box.id,
        templateId:         template.id,
        campaignId,
        leadId:             lead.id,
        email:              lead.email,
        subject,
        rowDataJson:        JSON.stringify(row),
        style:              emailStyle,
        useSignatureBuilder: useSig,
        quoteId:            lead.quoteId ?? null,
        status:             "pending",
      });
    }

    if (entries.length === 0) {
      res.status(400).json({ error: "No valid email addresses in the selected batch." });
      return;
    }

    try {
      await db.insert(emailQueueTable).values(entries);
    } catch (insertErr: any) {
      const pg = insertErr?.cause ?? insertErr;
      logger.error({
        tag: "[QUEUE INSERT FAILED]",
        campaignId, mailboxId: box.id, templateId: template.id,
        entryCount: entries.length,
        sampleEntry: entries[0],
        pgMessage:    pg?.message,
        pgCode:       pg?.code,
        pgDetail:     pg?.detail,
        pgConstraint: pg?.constraint,
        pgColumn:     pg?.column,
        pgTable:      pg?.table,
        rawError:     String(pg),
      }, `[QUEUE INSERT FAILED] campaignId=${campaignId} pgCode=${pg?.code} pgConstraint=${pg?.constraint} pgDetail=${pg?.detail} pgMessage=${pg?.message}`);
      throw insertErr;
    }

    // Create batch record
    await db.insert(campaignBatchesTable).values({
      campaignId,
      userId:       user.id,
      jobId,
      sendMode:     "smtp",
      batchSize:    entries.length,
      mailboxEmail: box.smtpUser,
    });

    // Update campaign currentJobId + status
    await db.update(campaignsTable).set({
      currentJobId: jobId,
      status:       "sending",
      updatedAt:    new Date(),
    }).where(eq(campaignsTable.id, campaignId));

    // Kick off background processing
    processCampaignJobQueue(jobId, campaignId, box, template, freshUser).catch(console.error);

    res.json({
      jobId,
      mode:        "smtp",
      total:       entries.length,
      delaySeconds: box.delaySeconds ?? 15,
    });

  } else {
    // Gmail draft mode
    if (!freshUser.gmailConnected || !freshUser.gmailAccessToken) {
      res.status(400).json({ error: "Gmail not connected. Please connect Gmail in Settings." });
      return;
    }

    const branding   = userBranding(freshUser);
    const useSig     = campaign.useSignature ?? freshUser.useSignature ?? false;
    const emailStyle = campaign.emailStyle ?? "clean";

    let succeeded = 0;
    let failed = 0;
    const errors: string[] = [];

    // Create batch record
    const [batchRecord] = await db.insert(campaignBatchesTable).values({
      campaignId,
      userId:   user.id,
      sendMode: "gmail",
      batchSize: nextLeads.length,
    }).returning();

    const nextLeadsSuppressed = await filterSuppressed(user.id, nextLeads.map(l => l.email ?? ""));

    for (const lead of nextLeads) {
      // ── Phase 1: Build the email + create the Gmail draft ──────────────────
      // This is separated from Phase 2 (DB recording) so that a DB write failure
      // after a successful draft creation does not make the draft appear as "failed"
      // in the UI (which was the state-sync bug: draft in Gmail but error toast shown).
      let gmailDraftId: string | null = null;
      let generatedSubject = "";
      let generatedBody    = "";
      let trackingId       = "";
      let phase1Error: string | null = null;

      if (nextLeadsSuppressed.has((lead.email ?? "").trim().toLowerCase())) {
        try {
          await db.insert(draftsTable).values({
            userId: user.id, campaignId, leadId: lead.id,
            email: lead.email, subject: "", body: "",
            status: "failed", errorMessage: "Recipient is on the suppression list",
          });
        } catch { /* non-fatal */ }
        await db.update(leadsTable)
          .set({ status: "failed", errorMessage: "Recipient is on the suppression list", updatedAt: new Date() })
          .where(eq(leadsTable.id, lead.id));
        failed++;
        continue;
      }

      try {
        const leadRow: Record<string, string> = {
          name: lead.name ?? "", email: lead.email,
          vehicle: lead.vehicle ?? "", route: lead.route ?? "",
          pickup: lead.pickup ?? "", delivery: lead.delivery ?? "",
          price: lead.price ?? "", notes: lead.notes ?? "",
          quote_id: lead.quoteId ?? "",
        };
        if (campaign.bookingUrl)  leadRow.booking_link = campaign.bookingUrl;
        if (campaign.quoteUrl)    leadRow.quote_link   = campaign.quoteUrl;
        if (campaign.websiteUrl)  leadRow.website_link = campaign.websiteUrl;
        if (campaign.phoneNumber) leadRow.phone_link   = campaign.phoneNumber;

        let generated: { subject: string; body: string };
        try {
          generated = await generatePersonalizedEmail({
            name: lead.name, email: lead.email,
            vehicle: lead.vehicle, route: lead.route,
            pickup: lead.pickup, delivery: lead.delivery,
            price: lead.price, notes: lead.notes,
            templateSubject: template.subject, templateBody: template.body,
            tone: "professional",
          });
        } catch (aiErr) {
          if (aiErr instanceof AiConfigError) {
            logger.info({ leadId: lead.id }, "[GMAIL] OPENAI_API_KEY not set — using template substitution fallback");
            generated = {
              subject: replaceVarsText(template.subject, leadRow),
              body:    replaceVarsText(template.body,    leadRow),
            };
          } else {
            throw aiErr;
          }
        }

        generatedSubject = generated.subject;
        generatedBody    = generated.body;
        trackingId       = randomUUID();

        const gmailTracking   = await getTrackingSettings();
        const gmailPublicBase = gmailTracking.trackingUrl;
        const gmailCtaButtons = (() => {
          try { return template.ctaButtonsJson ? JSON.parse(template.ctaButtonsJson) : []; }
          catch { return []; }
        })();
        const gmailLogoAttachment = extractLogoAttachment(branding.logoUrl);
        const gmailBranding = gmailLogoAttachment ? { ...branding, logoUrl: `cid:${gmailLogoAttachment.cid}` } : branding;
        const bodyHtml = buildHtmlEmail(template.body, leadRow, gmailBranding, {
          style: emailStyle as any,
          useSignatureBuilder: useSig,
          ctaButtons: gmailCtaButtons,
          trackingId: gmailTracking.clickTrackingEnabled ? trackingId : undefined,
          publicBase: gmailTracking.clickTrackingEnabled ? gmailPublicBase : undefined,
          unsubscribeUrl: buildUnsubscribeUrl(gmailPublicBase, user.id, lead.id, campaignId, lead.email ?? ""),
        });
        const gmailPixelTag  = gmailTracking.openTrackingEnabled
          ? `<img src="${gmailPublicBase}/api/track/open/${trackingId}" width="1" height="1" alt="" style="display:none!important;width:1px!important;height:1px!important;border:0;" />`
          : "";
        const gmailTrackedHtml = gmailPixelTag
          ? (bodyHtml.includes("</body>") ? bodyHtml.replace(/<\/body>/i, `${gmailPixelTag}</body>`) : bodyHtml + gmailPixelTag)
          : bodyHtml;

        gmailDraftId = await createGmailDraft(freshUser, lead.email, generatedSubject, generatedBody, gmailTrackedHtml, gmailLogoAttachment);
      } catch (err) {
        phase1Error = err instanceof Error ? err.message : String(err);
      }

      // ── Phase 2: Record outcome in DB ──────────────────────────────────────
      // DB write failures here are non-fatal for the drafts table but critical for leads.
      // If the draft was created, we always count it as succeeded — regardless of DB errors.
      if (phase1Error !== null || gmailDraftId === null) {
        // Draft creation genuinely failed
        try {
          await db.insert(draftsTable).values({
            userId: user.id, campaignId, leadId: lead.id,
            email: lead.email, subject: generatedSubject, body: generatedBody,
            status: "failed", errorMessage: phase1Error ?? "Unknown error",
          });
        } catch { /* non-fatal */ }
        try {
          await db.update(leadsTable)
            .set({ status: "failed", errorMessage: phase1Error ?? "Unknown error", updatedAt: new Date() })
            .where(eq(leadsTable.id, lead.id));
        } catch { /* non-fatal */ }
        errors.push(`Lead ${lead.email}: ${phase1Error ?? "Unknown error"}`);
        failed++;
      } else {
        // Draft confirmed created in Gmail — record success (DB writes here are non-fatal)
        // sentAt is intentionally left null: the broker still needs to open Gmail and manually
        // send the draft. The tracking pixel should only count opens AFTER the broker clicks
        // "Mark Sent" in BrokerMAIL (which sets sentAt). Setting sentAt here would cause a
        // false "opened" event when the broker previews the draft before sending it.
        try {
          await db.insert(draftsTable).values({
            userId: user.id, campaignId, leadId: lead.id,
            gmailDraftId, email: lead.email, subject: generatedSubject, body: generatedBody,
            status: "success", trackingId,
          });
        } catch (draftErr) {
          logger.warn({ draftErr, campaignId, leadId: lead.id },
            "[GMAIL] Non-fatal: drafts table insert failed — draft WAS created in Gmail");
        }
        try {
          await db.update(leadsTable)
            .set({ status: "drafted", gmailDraftId, updatedAt: new Date() })
            .where(eq(leadsTable.id, lead.id));
        } catch (leadErr) {
          logger.warn({ leadErr, campaignId, leadId: lead.id },
            "[GMAIL] Non-fatal: lead status update failed — draft WAS created in Gmail");
        }
        succeeded++;
      }
    }

    const batchStatus = failed === nextLeads.length ? "failed" : succeeded > 0 ? "drafted" : "pending";
    await db.update(campaignsTable).set({
      status: batchStatus,
      draftedCount: sql`${campaignsTable.draftedCount} + ${succeeded}`,
      failedCount:  sql`${campaignsTable.failedCount}  + ${failed}`,
      updatedAt: new Date(),
    }).where(eq(campaignsTable.id, campaignId));

    // Mirror the SMTP processor's terminal-count check: if every lead in the campaign
    // is now in a terminal state (drafted/failed/sent), mark the campaign completed.
    // Run unconditionally — even a fully-failed batch may complete a campaign that had
    // prior successful drafts, and skipping the check would leave it stuck in "failed".
    // Wrapped in try/catch so that a DB failure here does NOT fail the HTTP response —
    // the batch status update above already succeeded; only the completion upgrade is at risk.
    try {
      const [campCheck] = await db
        .select({ totalLeads: campaignsTable.totalLeads })
        .from(campaignsTable)
        .where(eq(campaignsTable.id, campaignId));
      const total = campCheck?.totalLeads ?? 0;
      logger.info({ campaignId, total, succeeded, failed, batchStatus }, "[GMAIL_BATCH] Terminal-count check starting");
      if (total > 0) {
        const [termRow] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(leadsTable)
          .where(and(
            eq(leadsTable.campaignId, campaignId),
            inArray(leadsTable.status, ["sent", "drafted", "failed"]),
          ));
        const termCount = termRow?.count ?? 0;
        logger.info({ campaignId, termCount, total }, "[GMAIL_BATCH] Terminal-count result");
        if (termCount >= total) {
          logger.info({ campaignId, termCount, total }, "[GMAIL_BATCH] All leads terminal — marking campaign completed");
          await db.update(campaignsTable)
            .set({ status: "completed", updatedAt: new Date() })
            .where(eq(campaignsTable.id, campaignId));
          logger.info({ campaignId }, "[GMAIL_BATCH] Campaign status set to completed ✓");
        } else {
          logger.info({ campaignId, termCount, total, remaining: total - termCount },
            "[GMAIL_BATCH] Not all leads terminal yet — campaign stays in current status");
        }
      } else {
        logger.warn({ campaignId }, "[GMAIL_BATCH] totalLeads is 0 — skipping completion check");
      }
    } catch (completionErr: any) {
      // Non-fatal: the batch status was already saved above. Log and continue.
      logger.error({ err: completionErr, campaignId }, "[GMAIL_BATCH] Completion check failed (non-fatal) — batch response still sent");
    }

    await db.update(campaignBatchesTable).set({ sentCount: succeeded, failedCount: failed })
      .where(eq(campaignBatchesTable.id, batchRecord.id));

    await db.insert(activityTable).values({
      userId: user.id, type: "drafts_generated",
      description: `Generated ${succeeded} drafts for campaign "${campaign.name}"`,
      metadata: { campaignId, succeeded, failed },
    });

    res.json({ mode: "gmail", total: nextLeads.length, succeeded, failed, errors });
  }
});

// ─── POST /api/campaigns/:id/start-campaign ──────────────────────────────────
/**
 * Start the fully automated campaign engine. Queues ALL remaining leads and
 * processes them automatically — handling cooldowns and retries with no user
 * interaction required.
 */
router.post("/campaigns/:id/start-campaign", requireAuth, async (req, res): Promise<void> => {
  const user       = req.user!;
  const campaignId = parseInt((req.params.id as string), 10);
  if (!campaignId) { res.status(400).json({ success: false, error: "Invalid campaign id" }); return; }

  try {
    const [campaign] = await db.select().from(campaignsTable)
      .where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.userId, user.id)));
    if (!campaign) { res.status(404).json({ success: false, error: "Campaign not found" }); return; }

    if (campaign.status === "sending" || campaign.status === "cooling_down") {
      res.status(400).json({ success: false, error: "Campaign is already running." }); return;
    }
    if (campaign.status === "completed" || campaign.status === "cancelled") {
      res.status(400).json({ success: false, error: "Campaign has already finished." }); return;
    }
    if (!campaign.templateId) {
      res.status(400).json({ success: false, error: "Campaign has no template assigned." }); return;
    }
    if (campaign.sendMode !== "smtp") {
      res.status(400).json({ success: false, error: "Automated sending is only available for SMTP mode." }); return;
    }

    const [template] = await db.select().from(templatesTable)
      .where(and(eq(templatesTable.id, campaign.templateId), eq(templatesTable.userId, user.id)));
    if (!template) { res.status(404).json({ success: false, error: "Template not found." }); return; }

    const [freshUser] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    if (!freshUser) { res.status(404).json({ success: false, error: "User not found." }); return; }

    const [box] = await db.select().from(mailboxesTable)
      .where(and(eq(mailboxesTable.userId, user.id), eq(mailboxesTable.isActive, true)));
    if (!box) { res.status(400).json({ success: false, error: "No active SMTP mailbox configured. Please add an SMTP mailbox in Settings → Mailboxes." }); return; }

    // Fix 2: Enforce monthly email limit before starting
    const emailLimitErr = await checkEmailLimit(user.id);
    if (emailLimitErr) { res.status(429).json({ success: false, ...emailLimitErr }); return; }

    // Get ALL remaining new leads
    const newLeads = await db.select().from(leadsTable)
      .where(and(eq(leadsTable.campaignId, campaignId), eq(leadsTable.status, "new")))
      .orderBy(leadsTable.id);

    // Check for any still-pending queue items (e.g. from a previous paused run)
    const [pendingCount] = await db.select({ count: sql<number>`count(*)::int` })
      .from(emailQueueTable)
      .where(and(eq(emailQueueTable.campaignId, campaignId), eq(emailQueueTable.status, "pending")));

    if (newLeads.length === 0 && (pendingCount?.count ?? 0) === 0) {
      res.status(400).json({ success: false, error: "No remaining leads to send." }); return;
    }

    const jobId      = randomUUID();
    const ALL_STYLES_SC = ["clean","modern","minimal","luxury","corporate","urgent","dispatch","friendly","mobile","dark"] as const;
    const emailStyle = ALL_STYLES_SC.includes(campaign.emailStyle as any)
      ? campaign.emailStyle as any : "clean";
    const useSig     = campaign.useSignature ?? freshUser.useSignature ?? false;
    logger.info({ campaignId, templateId: template.id, templateName: template.name, selectedEmailStyle: campaign.emailStyle, resolvedEmailStyle: emailStyle },
      "[TEMPLATE] start-campaign: templateId and style resolved");

    // Enqueue all new leads
    if (newLeads.length > 0) {
      const entries: (typeof emailQueueTable.$inferInsert)[] = [];
      for (const lead of newLeads) {
        if (!lead.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) continue;
        const row: Record<string, string> = {
          name: lead.name ?? "", email: lead.email,
          vehicle: lead.vehicle ?? "", route: lead.route ?? "",
          pickup: lead.pickup ?? "", delivery: lead.delivery ?? "",
          price: lead.price ?? "", notes: lead.notes ?? "",
          quote_id: lead.quoteId ?? "",
        };
        entries.push({
          jobId,
          userId: user.id, mailboxId: box.id, templateId: template.id,
          campaignId, leadId: lead.id, email: lead.email,
          subject: replaceVarsText(template.subject, row),
          rowDataJson: JSON.stringify(row),
          style: emailStyle, useSignatureBuilder: useSig,
          quoteId: lead.quoteId ?? null, status: "pending",
        });
      }

      if (entries.length > 0) {
        for (let i = 0; i < entries.length; i += 500) {
          const batch = entries.slice(i, i + 500);
          try {
            await db.insert(emailQueueTable).values(batch);
          } catch (insertErr: any) {
            const pg = insertErr?.cause ?? insertErr;
            logger.error({
              tag: "[QUEUE INSERT FAILED]",
              campaignId, mailboxId: box.id, templateId: template.id,
              batchStart: i, batchSize: batch.length,
              sampleEntry: batch[0],
              pgMessage:    pg?.message,
              pgCode:       pg?.code,
              pgDetail:     pg?.detail,
              pgConstraint: pg?.constraint,
              pgColumn:     pg?.column,
              pgTable:      pg?.table,
              rawError:     String(pg),
            }, `[QUEUE INSERT FAILED] campaignId=${campaignId} batchStart=${i} pgCode=${pg?.code} pgConstraint=${pg?.constraint} pgDetail=${pg?.detail} pgMessage=${pg?.message}`);
            throw insertErr;
          }
        }
        const leadIds = newLeads.map(l => l.id);
        for (let i = 0; i < leadIds.length; i += 500) {
          await db.update(leadsTable)
            .set({ status: "queued", updatedAt: new Date() })
            .where(inArray(leadsTable.id, leadIds.slice(i, i + 500)));
        }
      }
    }

    await db.insert(campaignBatchesTable).values({
      campaignId, userId: user.id, jobId, sendMode: "smtp",
      batchSize: newLeads.length, mailboxEmail: box.smtpUser,
    });

    await db.update(campaignsTable).set({
      currentJobId: jobId, status: "sending", cooldownUntil: null, updatedAt: new Date(),
    }).where(eq(campaignsTable.id, campaignId));

    processCampaignFully(campaignId, box, template, freshUser).catch((err) => {
      logger.error({ err, campaignId }, "Background campaign processor error");
    });

    logger.info({ campaignId, userId: user.id, total: newLeads.length }, "Campaign started");

    res.json({
      success: true,
      message: "Campaign started",
      mode: "smtp", total: newLeads.length,
      delaySeconds: box.delaySeconds ?? 15,
      hourlyLimit: box.maxPerHour ?? 100,
    });
  } catch (err: any) {
    // Drizzle wraps the real PG error in err.cause — extract it for a useful message
    const pg = err?.cause ?? err;
    const pgMessage    = pg?.message;
    const pgCode       = pg?.code;
    const pgDetail     = pg?.detail;
    const pgConstraint = pg?.constraint;
    const pgColumn     = pg?.column;
    const pgTable      = pg?.table;

    // Build a human-readable error: prefer PG message over Drizzle's SQL dump
    const userMessage = pgMessage && !pgMessage.startsWith("Failed query")
      ? pgMessage
      : (err?.message?.startsWith("Failed query") ? "Database insert failed" : (err?.message ?? "Failed to start campaign"));

    logger.error({
      campaignId, userId: user.id,
      pgMessage, pgCode, pgDetail, pgConstraint, pgColumn, pgTable,
      drizzleMessage: err?.message?.slice(0, 300),
    }, `[START-CAMPAIGN ERROR] campaignId=${campaignId} pgCode=${pgCode} pgConstraint=${pgConstraint} pgMessage=${pgMessage}`);

    res.status(500).json({
      success: false,
      error:        userMessage,
      pgCode,
      pgDetail,
      pgConstraint,
      pgColumn,
      pgTable,
    });
  }
});

// ─── POST /api/campaigns/:id/pause ────────────────────────────────────────────
router.post("/campaigns/:id/pause", requireAuth, async (req, res): Promise<void> => {
  const user       = req.user!;
  const campaignId = parseInt((req.params.id as string), 10);
  if (!campaignId) { res.status(400).json({ success: false, error: "Invalid campaign id" }); return; }

  try {
    const [campaign] = await db.select().from(campaignsTable)
      .where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.userId, user.id)));
    if (!campaign) { res.status(404).json({ success: false, error: "Campaign not found" }); return; }

    await db.update(campaignsTable)
      .set({ status: "paused", updatedAt: new Date() })
      .where(eq(campaignsTable.id, campaignId));

    // Signal the loop to stop (it checks DB status each iteration)
    activeJobs.delete(`campaign:${campaignId}`);

    res.json({ success: true, status: "paused" });
  } catch (err: any) {
    logger.error({ err, campaignId, userId: user.id }, `Pause campaign error: ${err?.message}`);
    res.status(500).json({ success: false, error: err?.message ?? "Failed to pause campaign" });
  }
});

// ─── POST /api/campaigns/:id/resume ───────────────────────────────────────────
router.post("/campaigns/:id/resume", requireAuth, async (req, res): Promise<void> => {
  const user       = req.user!;
  const campaignId = parseInt((req.params.id as string), 10);
  if (!campaignId) { res.status(400).json({ success: false, error: "Invalid campaign id" }); return; }

  try {
    const [campaign] = await db.select().from(campaignsTable)
      .where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.userId, user.id)));
    if (!campaign) { res.status(404).json({ success: false, error: "Campaign not found" }); return; }

    if (!campaign.templateId) {
      res.status(400).json({ success: false, error: "Campaign has no template." }); return;
    }

    const [template] = await db.select().from(templatesTable)
      .where(and(eq(templatesTable.id, campaign.templateId), eq(templatesTable.userId, user.id)));
    if (!template) { res.status(404).json({ success: false, error: "Template not found." }); return; }

    const [freshUser] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    if (!freshUser) { res.status(404).json({ success: false, error: "User not found." }); return; }

    const [box] = await db.select().from(mailboxesTable)
      .where(and(eq(mailboxesTable.userId, user.id), eq(mailboxesTable.isActive, true)));
    if (!box) { res.status(400).json({ success: false, error: "No active SMTP mailbox configured." }); return; }

    // Fix 2: Enforce monthly email limit before resuming
    const emailLimitErr = await checkEmailLimit(user.id);
    if (emailLimitErr) { res.status(429).json({ success: false, ...emailLimitErr }); return; }

    // Do NOT clear cooldownUntil on resume — preserve the existing timestamp so
    // the remaining cooldown continues from where it was when the user paused.
    // processCampaignFully will detect the active cooldown and wait out the remainder.
    await db.update(campaignsTable)
      .set({ status: "sending", updatedAt: new Date() })
      .where(eq(campaignsTable.id, campaignId));

    processCampaignFully(campaignId, box, template, freshUser).catch((err) => {
      logger.error({ err, campaignId }, "Background campaign resume error");
    });

    res.json({ success: true, status: "sending" });
  } catch (err: any) {
    logger.error({ err, campaignId, userId: user.id }, `Resume campaign error: ${err?.message}`);
    res.status(500).json({ success: false, error: err?.message ?? "Failed to resume campaign" });
  }
});

// ─── POST /api/campaigns/:id/cancel ───────────────────────────────────────────
router.post("/campaigns/:id/cancel", requireAuth, async (req, res): Promise<void> => {
  const user       = req.user!;
  const campaignId = parseInt((req.params.id as string), 10);
  if (!campaignId) { res.status(400).json({ success: false, error: "Invalid campaign id" }); return; }

  try {
    const [campaign] = await db.select().from(campaignsTable)
      .where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.userId, user.id)));
    if (!campaign) { res.status(404).json({ success: false, error: "Campaign not found" }); return; }

    await db.update(campaignsTable)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(campaignsTable.id, campaignId));

    activeJobs.delete(`campaign:${campaignId}`);

    res.json({ success: true, status: "cancelled" });
  } catch (err: any) {
    logger.error({ err, campaignId, userId: user.id }, `Cancel campaign error: ${err?.message}`);
    res.status(500).json({ success: false, error: err?.message ?? "Failed to cancel campaign" });
  }
});

// ─── POST /api/campaigns/:id/duplicate ───────────────────────────────────────
router.post("/campaigns/:id/duplicate", requireAuth, async (req, res): Promise<void> => {
  const user       = req.user!;
  const campaignId = parseInt((req.params.id as string), 10);
  if (!campaignId) { res.status(400).json({ error: "Invalid campaign id" }); return; }

  try {
    const [original] = await db.select().from(campaignsTable)
      .where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.userId, user.id)));
    if (!original) { res.status(404).json({ error: "Campaign not found" }); return; }

    const [newCampaign] = await db.insert(campaignsTable).values({
      userId:       user.id,
      name:         `${original.name} (Copy)`,
      templateId:   original.templateId ?? null,
      sendMode:     original.sendMode,
      emailStyle:   original.emailStyle,
      useSignature: original.useSignature,
      status:       "pending",
      totalLeads:   0,
      draftedCount: 0,
      failedCount:  0,
      sentCount:    0,
    }).returning();

    await db.insert(activityTable).values({
      userId: user.id, type: "campaign_created",
      description: `Campaign "${newCampaign.name}" duplicated from "${original.name}"`,
    });

    res.status(201).json({
      ...newCampaign,
      createdAt: newCampaign.createdAt.toISOString(),
      updatedAt: newCampaign.updatedAt.toISOString(),
    });
  } catch (err: any) {
    logger.error({ err, campaignId }, `Duplicate campaign error: ${err?.message}`);
    res.status(500).json({ error: err?.message ?? "Failed to duplicate campaign" });
  }
});

// ─── POST /api/campaigns/:id/archive ─────────────────────────────────────────
router.post("/campaigns/:id/archive", requireAuth, async (req, res): Promise<void> => {
  const user       = req.user!;
  const campaignId = parseInt((req.params.id as string), 10);
  if (!campaignId) { res.status(400).json({ error: "Invalid campaign id" }); return; }

  try {
    const [campaign] = await db.update(campaignsTable)
      .set({ status: "archived", updatedAt: new Date() })
      .where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.userId, user.id)))
      .returning();
    if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }

    activeJobs.delete(`campaign:${campaignId}`);
    res.json({ success: true, status: "archived" });
  } catch (err: any) {
    logger.error({ err, campaignId }, `Archive campaign error: ${err?.message}`);
    res.status(500).json({ error: err?.message ?? "Failed to archive campaign" });
  }
});

// ─── GET /api/campaigns/:id/batches ──────────────────────────────────────────
router.get("/campaigns/:id/batches", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const campaignId = parseInt((req.params.id as string), 10);
  if (!campaignId) { res.status(400).json({ error: "Invalid campaign id" }); return; }

  const [campaign] = await db.select({ id: campaignsTable.id })
    .from(campaignsTable)
    .where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.userId, user.id)));
  if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }

  const batches = await db.select().from(campaignBatchesTable)
    .where(eq(campaignBatchesTable.campaignId, campaignId))
    .orderBy(desc(campaignBatchesTable.createdAt));

  res.json({ data: batches.map(b => ({ ...b, createdAt: b.createdAt.toISOString() })) });
});

// ─── GET /api/campaigns/:id/diagnostics ──────────────────────────────────────
router.get("/campaigns/:id/diagnostics", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const campaignId = parseInt((req.params.id as string), 10);
  if (!campaignId) { res.status(400).json({ error: "Invalid campaign id" }); return; }

  const [campaign] = await db.select().from(campaignsTable)
    .where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.userId, user.id)));
  if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }

  const leadStatuses = ["new", "queued", "sending", "sent", "drafted", "failed"] as const;
  const leadCounts: Record<string, number> = {};
  for (const s of leadStatuses) {
    const [row] = await db.select({ count: sql<number>`count(*)::int` })
      .from(leadsTable)
      .where(and(eq(leadsTable.campaignId, campaignId), eq(leadsTable.status, s)));
    leadCounts[s] = row?.count ?? 0;
  }

  const queueStatuses = ["pending", "sending", "success", "failed", "deferred", "bounced"] as const;
  const queueCounts: Record<string, number> = {};
  for (const s of queueStatuses) {
    const [row] = await db.select({ count: sql<number>`count(*)::int` })
      .from(emailQueueTable)
      .where(and(eq(emailQueueTable.campaignId, campaignId), eq(emailQueueTable.status, s)));
    queueCounts[s] = row?.count ?? 0;
  }

  const [nextDeferred] = await db.select({
    id: emailQueueTable.id,
    email: emailQueueTable.email,
    retryAfter: emailQueueTable.retryAfter,
    deferredCount: emailQueueTable.deferredCount,
    lastError: emailQueueTable.lastError,
    attempts: emailQueueTable.attempts,
  }).from(emailQueueTable)
    .where(and(
      eq(emailQueueTable.campaignId, campaignId),
      eq(emailQueueTable.status, "deferred"),
    ))
    .orderBy(emailQueueTable.retryAfter)
    .limit(1);

  // Most recent item with a lastError (deferred OR failed) for Last SMTP Attempt panel
  const [lastAttempted] = await db.select({
    id: emailQueueTable.id,
    email: emailQueueTable.email,
    lastError: emailQueueTable.lastError,
    attempts: emailQueueTable.attempts,
    deferredCount: emailQueueTable.deferredCount,
    retryAfter: emailQueueTable.retryAfter,
  }).from(emailQueueTable)
    .where(and(
      eq(emailQueueTable.campaignId, campaignId),
      isNotNull(emailQueueTable.lastError),
      inArray(emailQueueTable.status, ["deferred", "failed"]),
    ))
    .orderBy(desc(emailQueueTable.id))
    .limit(1);

  function parseSmtpErrorJson(raw: string | null): Record<string, any> | null {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && ("rawCode" in parsed || "smtpHost" in parsed)) return parsed;
      return null;
    } catch {
      return null;
    }
  }

  const lastSmtpAttempt = (() => {
    if (!lastAttempted?.lastError) return null;
    const parsed = parseSmtpErrorJson(lastAttempted.lastError);
    const retryAfterDate = lastAttempted.retryAfter;
    return {
      email:          lastAttempted.email,
      attemptNumber:  lastAttempted.attempts,
      deferredCount:  lastAttempted.deferredCount,
      smtpHost:       parsed?.smtpHost ?? null,
      smtpPort:       parsed?.smtpPort ?? null,
      encryption:     parsed?.encryption ?? null,
      stage:          parsed?.stage ?? null,
      rawCode:        parsed?.rawCode ?? null,
      rawMsg:         parsed?.rawMsg ?? null,
      smtpCommand:    parsed?.smtpCommand ?? null,
      friendlyError:  parsed?.friendly ?? lastAttempted.lastError,
      timestamp:      parsed?.timestamp ?? null,
      retryAfter:     retryAfterDate?.toISOString() ?? null,
      retryInSeconds: retryAfterDate
        ? Math.max(0, Math.ceil((retryAfterDate.getTime() - Date.now()) / 1000))
        : null,
    };
  })();

  const campaignKey = `campaign:${campaignId}`;
  const legacyKey   = campaign.currentJobId ?? "";
  const isJobActive = activeJobs.has(campaignKey) || activeJobs.has(legacyKey);

  // Last successful send timestamp
  const [lastSent] = await db.select({ sentAt: emailQueueTable.sentAt })
    .from(emailQueueTable)
    .where(and(
      eq(emailQueueTable.campaignId, campaignId),
      eq(emailQueueTable.status, "success"),
      isNotNull(emailQueueTable.sentAt),
    ))
    .orderBy(desc(emailQueueTable.sentAt))
    .limit(1);

  const now = new Date();
  const cooldownUntilDate = campaign.cooldownUntil;
  const remainingCooldownSeconds = cooldownUntilDate && cooldownUntilDate > now
    ? Math.ceil((cooldownUntilDate.getTime() - now.getTime()) / 1000)
    : 0;

  res.json({
    campaignId,
    status: campaign.status,
    totalLeads: campaign.totalLeads,
    sentCount: campaign.sentCount,
    failedCount: campaign.failedCount,
    isJobActive,
    currentJobId: campaign.currentJobId ?? null,
    cooldownUntil: campaign.cooldownUntil?.toISOString() ?? null,
    currentServerTime: now.toISOString(),
    lastSuccessfulSend: lastSent?.sentAt?.toISOString() ?? null,
    remainingCooldownSeconds,
    leadCounts,
    queueCounts,
    nextDeferred: nextDeferred ? {
      ...nextDeferred,
      retryAfter: nextDeferred.retryAfter?.toISOString() ?? null,
      retryInSeconds: nextDeferred.retryAfter
        ? Math.max(0, Math.ceil((nextDeferred.retryAfter.getTime() - Date.now()) / 1000))
        : null,
      // Parse JSON lastError for friendly display; fall back to raw string for old items
      lastError: (() => {
        const p = parseSmtpErrorJson(nextDeferred.lastError ?? null);
        return p ? (p.friendly ?? nextDeferred.lastError) : (nextDeferred.lastError ?? null);
      })(),
    } : null,
    lastSmtpAttempt,
  });
});

// ─── PATCH /api/campaigns/:id ─────────────────────────────────────────────────
router.patch("/campaigns/:id", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const params = UpdateCampaignParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const body = UpdateCampaignBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [campaign] = await db.update(campaignsTable)
    .set({ ...body.data, updatedAt: new Date() })
    .where(and(eq(campaignsTable.id, params.data.id), eq(campaignsTable.userId, user.id)))
    .returning();
  if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }
  res.json({ ...campaign, createdAt: campaign.createdAt.toISOString(), updatedAt: campaign.updatedAt.toISOString() });
});

// ─── DELETE /api/campaigns/:id ────────────────────────────────────────────────
router.delete("/campaigns/:id", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const params = DeleteCampaignParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [campaign] = await db.delete(campaignsTable)
    .where(and(eq(campaignsTable.id, params.data.id), eq(campaignsTable.userId, user.id)))
    .returning();
  if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }
  res.json({ message: "Campaign deleted" });
});

// Proxy-safe aliases: POST with id in body (avoids numeric URL segments blocked by deployment proxy)
router.post("/campaigns/save", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const id = parseInt(req.body.id, 10);
  if (!id) { res.status(400).json({ error: "id is required" }); return; }
  const body = UpdateCampaignBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [campaign] = await db.update(campaignsTable)
    .set({ ...body.data, updatedAt: new Date() })
    .where(and(eq(campaignsTable.id, id), eq(campaignsTable.userId, user.id)))
    .returning();
  if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }
  res.json({ ...campaign, createdAt: campaign.createdAt.toISOString(), updatedAt: campaign.updatedAt.toISOString() });
});

router.post("/campaigns/remove", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const id = parseInt(req.body.id, 10);
  if (!id) { res.status(400).json({ error: "id is required" }); return; }
  const [campaign] = await db.delete(campaignsTable)
    .where(and(eq(campaignsTable.id, id), eq(campaignsTable.userId, user.id)))
    .returning();
  if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }
  res.json({ message: "Campaign deleted" });
});

// ─── POST /api/campaigns/:id/generate-drafts ─────────────────────────────────
router.post("/campaigns/:id/generate-drafts", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  try {
  logger.info(
    { userId: user.id, email: user.email, campaignId: req.params.id, templateId: req.body?.templateId },
    "[GENERATE_DRAFTS] Request received",
  );

  const params = GenerateCampaignDraftsParams.safeParse(req.params);
  if (!params.success) {
    logger.warn({ userId: user.id, validationError: params.error.message }, "[GENERATE_DRAFTS] Params validation failed");
    res.status(400).json({ success: false, error: params.error.message }); return;
  }
  const body = GenerateCampaignDraftsBody.safeParse(req.body);
  if (!body.success) {
    logger.warn({ userId: user.id, validationError: body.error.message }, "[GENERATE_DRAFTS] Body validation failed");
    res.status(400).json({ success: false, error: body.error.message }); return;
  }

  const [campaign] = await db.select().from(campaignsTable)
    .where(and(eq(campaignsTable.id, params.data.id), eq(campaignsTable.userId, user.id)));
  if (!campaign) {
    logger.warn({ userId: user.id, campaignId: params.data.id }, "[GENERATE_DRAFTS] Campaign not found");
    res.status(404).json({ success: false, error: "Campaign not found" }); return;
  }

  const [freshUser] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));

  // Log full OAuth state for diagnostics
  logger.info(
    {
      userId:              user.id,
      gmailAccount:        freshUser?.gmailEmail ?? null,
      mailboxId:           null, // Gmail mode — no SMTP mailbox
      oauthAccount:        freshUser?.gmailEmail ?? null,
      gmailConnected:      freshUser?.gmailConnected ?? false,
      hasAccessToken:      !!freshUser?.gmailAccessToken,
      hasRefreshToken:     !!freshUser?.gmailRefreshToken,
      tokenExpiry:         freshUser?.gmailTokenExpiry?.toISOString() ?? null,
      campaignId:          params.data.id,
    },
    "[GENERATE_DRAFTS] Gmail OAuth state",
  );

  if (!freshUser?.gmailConnected || !freshUser.gmailAccessToken) {
    logger.warn({ userId: user.id, gmailConnected: freshUser?.gmailConnected }, "[GENERATE_DRAFTS] Gmail not connected");
    res.status(400).json({
      success: false,
      code: "GMAIL_NOT_CONNECTED",
      error: "Gmail not connected. Please connect Gmail first.",
    });
    return;
  }

  // A missing refresh token means the OAuth grant was lost (revoked, re-auth without offline access,
  // or the token was never issued). Access tokens alone expire and cannot be refreshed — draft
  // creation will fail for every lead. Return a structured error so the frontend can surface it.
  if (!freshUser.gmailRefreshToken) {
    logger.warn(
      { userId: user.id, gmailAccount: freshUser.gmailEmail },
      "[GENERATE_DRAFTS] Gmail refresh token missing — user must reconnect",
    );
    res.status(401).json({
      success: false,
      code: "GMAIL_AUTH_EXPIRED",
      error: "Reconnect your Gmail account.",
    });
    return;
  }

  const [template] = await db.select().from(templatesTable)
    .where(and(eq(templatesTable.id, body.data.templateId), eq(templatesTable.userId, user.id)));
  if (!template) {
    logger.warn({ userId: user.id, templateId: body.data.templateId }, "[GENERATE_DRAFTS] Template not found");
    res.status(404).json({ success: false, error: "Template not found" }); return;
  }

  const leads = await db.select().from(leadsTable)
    .where(and(eq(leadsTable.campaignId, params.data.id), eq(leadsTable.status, "new")));

  logger.info({ userId: user.id, campaignId: params.data.id, leadCount: leads.length }, "[GENERATE_DRAFTS] Starting draft generation");

  const branding   = userBranding(freshUser);
  const useSig     = freshUser.useSignature ?? false;
  const emailStyle = (body.data as any).style ?? "clean";

  let succeeded = 0;
  let failed = 0;
  const errors: string[] = [];

  const leadsSuppressed = await filterSuppressed(user.id, leads.map(l => l.email ?? ""));

  for (const lead of leads) {
    if (leadsSuppressed.has((lead.email ?? "").trim().toLowerCase())) {
      await db.update(leadsTable)
        .set({ status: "failed", errorMessage: "Recipient is on the suppression list", updatedAt: new Date() })
        .where(eq(leadsTable.id, lead.id));
      errors.push(`${lead.email}: Recipient is on the suppression list`);
      failed++;
      continue;
    }
    try {
      const leadRow: Record<string, string> = {
        name: lead.name ?? "", email: lead.email ?? "",
        vehicle: lead.vehicle ?? "", route: lead.route ?? "",
        pickup: lead.pickup ?? "", delivery: lead.delivery ?? "",
        price: lead.price ?? "", notes: lead.notes ?? "",
        quote_id: lead.quoteId ?? "",
      };
      if (campaign.bookingUrl)  leadRow.booking_link = campaign.bookingUrl;
      if (campaign.quoteUrl)    leadRow.quote_link   = campaign.quoteUrl;
      if (campaign.websiteUrl)  leadRow.website_link = campaign.websiteUrl;
      if (campaign.phoneNumber) leadRow.phone_link   = campaign.phoneNumber;

      // Try AI personalisation; fall back to template substitution when no API key is set
      let generated: { subject: string; body: string };
      try {
        generated = await generatePersonalizedEmail({
          name: lead.name, email: lead.email,
          vehicle: lead.vehicle, route: lead.route,
          pickup: lead.pickup, delivery: lead.delivery,
          price: lead.price, notes: lead.notes,
          templateSubject: template.subject, templateBody: template.body,
          tone: body.data.tone ?? "professional",
          customPrompt: body.data.customPrompt,
        });
      } catch (aiErr) {
        if (aiErr instanceof AiConfigError) {
          logger.info({ leadId: lead.id }, "[DRAFTS] OPENAI_API_KEY not set — using template substitution fallback");
          generated = {
            subject: replaceVarsText(template.subject, leadRow),
            body:    replaceVarsText(template.body, leadRow),
          };
        } else {
          throw aiErr;
        }
      }

      const trackingId       = randomUUID();
      const gDraftTracking   = await getTrackingSettings();
      const gDraftPublicBase = gDraftTracking.trackingUrl;
      const gDraftCtaButtons = (() => {
        try { return template.ctaButtonsJson ? JSON.parse(template.ctaButtonsJson) : []; }
        catch { return []; }
      })();
      const gDraftLogoAttachment = extractLogoAttachment(branding.logoUrl);
      const gDraftBranding = gDraftLogoAttachment ? { ...branding, logoUrl: `cid:${gDraftLogoAttachment.cid}` } : branding;
      const bodyHtml = buildHtmlEmail(template.body, leadRow, gDraftBranding, {
        style: emailStyle,
        useSignatureBuilder: useSig,
        ctaButtons: gDraftCtaButtons,
        trackingId: gDraftTracking.clickTrackingEnabled ? trackingId : undefined,
        publicBase: gDraftTracking.clickTrackingEnabled ? gDraftPublicBase : undefined,
        unsubscribeUrl: buildUnsubscribeUrl(gDraftPublicBase, user.id, lead.id, campaign.id, lead.email ?? ""),
      });
      const gDraftPixelTag  = gDraftTracking.openTrackingEnabled
        ? `<img src="${gDraftPublicBase}/api/track/open/${trackingId}" width="1" height="1" alt="" style="display:none!important;width:1px!important;height:1px!important;border:0;" />`
        : "";
      const gDraftTrackedHtml = gDraftPixelTag
        ? (bodyHtml.includes("</body>") ? bodyHtml.replace(/<\/body>/i, `${gDraftPixelTag}</body>`) : bodyHtml + gDraftPixelTag)
        : bodyHtml;
      logger.info({ userId: user.id, leadId: lead.id, email: lead.email, campaignId: campaign.id }, "[GENERATE_DRAFTS] Calling Gmail API — createGmailDraft");
      const gmailDraftId = await createGmailDraft(freshUser, lead.email, generated.subject, generated.body, gDraftTrackedHtml, gDraftLogoAttachment);
      logger.info({ userId: user.id, leadId: lead.id, email: lead.email, gmailDraftId }, "[GENERATE_DRAFTS] Gmail API success — draft created");

      // sentAt left null intentionally — broker must "Mark Sent" in BrokerMAIL after
      // sending the draft from Gmail, which activates open tracking.
      await db.insert(draftsTable).values({
        userId: user.id, campaignId: campaign.id, leadId: lead.id,
        gmailDraftId, email: lead.email, subject: generated.subject, body: generated.body,
        status: "success", trackingId,
      });
      await db.update(leadsTable)
        .set({ status: "drafted", gmailDraftId, updatedAt: new Date() })
        .where(eq(leadsTable.id, lead.id));
      succeeded++;
    } catch (err) {
      const errMsg  = err instanceof Error ? err.message : String(err);
      const errStack = err instanceof Error ? err.stack : undefined;
      // Detect invalid_grant (expired/revoked OAuth grant) for clearer diagnostics
      const isAuthErr = errMsg.includes("invalid_grant") || errMsg.includes("Invalid Credentials") || errMsg.includes("Token has been expired");
      logger.error(
        {
          err,
          stack:       errStack,
          userId:      user.id,
          gmailAccount: freshUser.gmailEmail,
          leadId:      lead.id,
          email:       lead.email,
          campaignId:  campaign.id,
          isAuthErr,
        },
        `[GENERATE_DRAFTS] Lead failed: ${errMsg}`,
      );
      await db.insert(draftsTable).values({
        userId: user.id, campaignId: campaign.id, leadId: lead.id,
        email: lead.email, subject: "", body: "", status: "failed", errorMessage: errMsg,
      });
      await db.update(leadsTable)
        .set({ status: "failed", errorMessage: errMsg, updatedAt: new Date() })
        .where(eq(leadsTable.id, lead.id));
      errors.push(`Lead ${lead.email}: ${errMsg}`);
      failed++;
    }
  }

  const batchStatus = failed === leads.length ? "failed" : succeeded > 0 ? "drafted" : "pending";
  await db.update(campaignsTable).set({
    status: batchStatus,
    draftedCount: sql`${campaignsTable.draftedCount} + ${succeeded}`,
    failedCount:  sql`${campaignsTable.failedCount}  + ${failed}`,
    updatedAt: new Date(),
  }).where(eq(campaignsTable.id, campaign.id));

  // Mirror the SMTP processor's terminal-count check: if every lead in the campaign
  // is now in a terminal state (drafted/failed/sent), mark the campaign completed.
  // Run unconditionally — even a fully-failed batch may complete a campaign that had
  // prior successful drafts, and skipping the check would leave it stuck in "failed".
  // Wrapped in try/catch so that a DB failure here does NOT cause a 500 response —
  // the batch status update above already succeeded; only the completion upgrade is at risk.
  try {
    const total = campaign.totalLeads ?? 0;
    logger.info({ userId: user.id, campaignId: campaign.id, total, succeeded, failed, batchStatus }, "[GENERATE_DRAFTS] Terminal-count check starting");
    if (total > 0) {
      const [termRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(leadsTable)
        .where(and(
          eq(leadsTable.campaignId, campaign.id),
          inArray(leadsTable.status, ["sent", "drafted", "failed"]),
        ));
      const termCount = termRow?.count ?? 0;
      logger.info({ userId: user.id, campaignId: campaign.id, termCount, total }, "[GENERATE_DRAFTS] Terminal-count result");
      if (termCount >= total) {
        logger.info({ userId: user.id, campaignId: campaign.id, termCount, total }, "[GENERATE_DRAFTS] All leads terminal — marking campaign completed");
        await db.update(campaignsTable)
          .set({ status: "completed", updatedAt: new Date() })
          .where(eq(campaignsTable.id, campaign.id));
        logger.info({ userId: user.id, campaignId: campaign.id }, "[GENERATE_DRAFTS] Campaign status set to completed ✓");
      } else {
        logger.info({ userId: user.id, campaignId: campaign.id, termCount, total, remaining: total - termCount },
          "[GENERATE_DRAFTS] Not all leads terminal yet — campaign stays in current status");
      }
    } else {
      logger.warn({ userId: user.id, campaignId: campaign.id }, "[GENERATE_DRAFTS] totalLeads is 0 — skipping completion check");
    }
  } catch (completionErr: any) {
    // Non-fatal: the batch status was already saved above. Log and continue.
    logger.error({ err: completionErr, userId: user.id, campaignId: campaign.id }, "[GENERATE_DRAFTS] Completion check failed (non-fatal) — response still sent");
  }

  await db.insert(activityTable).values({
    userId: user.id, type: "drafts_generated",
    description: `Generated ${succeeded} drafts for campaign "${campaign.name}"`,
    metadata: { campaignId: campaign.id, succeeded, failed },
  });

  logger.info({ userId: user.id, campaignId: campaign.id, total: leads.length, succeeded, failed }, "[GENERATE_DRAFTS] Completed");
  res.json({ total: leads.length, succeeded, failed, errors });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack   = err instanceof Error ? err.stack   : undefined;
    logger.error(
      { err, userId: user.id, email: user.email, gmailAccount: (user as any).gmailEmail, stack },
      `[GENERATE_DRAFTS] Unhandled exception: ${message}`,
    );
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: message });
    }
  }
});

// ─── Retry a failed lead (SMTP) ───────────────────────────────────────────────

router.post("/campaigns/:id/leads/:leadId/retry", requireAuth, async (req, res): Promise<void> => {
  const user       = req.user!;
  const campaignId = parseInt((req.params.id as string), 10);
  const leadId     = parseInt((req.params.leadId as string), 10);
  if (!campaignId || !leadId) { res.status(400).json({ error: "Invalid campaign or lead id" }); return; }

  const [campaign] = await db.select().from(campaignsTable)
    .where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.userId, user.id)));
  if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }

  const [lead] = await db.select().from(leadsTable)
    .where(and(eq(leadsTable.id, leadId), eq(leadsTable.campaignId, campaignId), eq(leadsTable.userId, user.id)));
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }

  // Find the most recent failed queue item for this lead (SMTP path)
  const [queueItem] = await db.select().from(emailQueueTable)
    .where(and(
      eq(emailQueueTable.leadId, leadId),
      eq(emailQueueTable.campaignId, campaignId),
      eq(emailQueueTable.status, "failed"),
    ))
    .orderBy(desc(emailQueueTable.id))
    .limit(1);

  // ── Gmail draft failure path ──────────────────────────────────────────────
  if (!queueItem) {
    // No SMTP queue record — look for a failed Gmail draft record
    const [failedDraft] = await db.select().from(draftsTable)
      .where(and(
        eq(draftsTable.leadId, leadId),
        eq(draftsTable.campaignId, campaignId),
        eq(draftsTable.userId, user.id),
        eq(draftsTable.status, "failed"),
      ))
      .orderBy(desc(draftsTable.id))
      .limit(1);

    if (!failedDraft) { res.status(404).json({ error: "No failed email found for this lead" }); return; }

    if (!campaign.templateId) { res.status(400).json({ error: "Campaign has no template configured" }); return; }

    const [gFreshUser] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    if (!gFreshUser) { res.status(404).json({ error: "User not found" }); return; }
    if (!gFreshUser.gmailConnected || !gFreshUser.gmailAccessToken) {
      res.status(400).json({ error: "Gmail not connected. Please reconnect Gmail in Settings." }); return;
    }

    const [gTemplate] = await db.select().from(templatesTable)
      .where(and(eq(templatesTable.id, campaign.templateId), eq(templatesTable.userId, user.id)));
    if (!gTemplate) { res.status(404).json({ error: "Template not found" }); return; }

    const gBranding   = userBranding(gFreshUser);
    const gStyle      = campaign.emailStyle ?? "clean";
    const gUseSig     = campaign.useSignature ?? gFreshUser.useSignature ?? false;
    const gCtaButtons = (() => {
      try { return gTemplate.ctaButtonsJson ? JSON.parse(gTemplate.ctaButtonsJson) : []; }
      catch { return []; }
    })();

    const gLeadRow: Record<string, string> = {
      name: lead.name ?? "", email: lead.email ?? "",
      vehicle: lead.vehicle ?? "", route: lead.route ?? "",
      pickup: lead.pickup ?? "", delivery: lead.delivery ?? "",
      price: lead.price ? formatPrice(lead.price) : "", notes: lead.notes ?? "",
      quote_id: lead.quoteId ?? "",
    };
    if (campaign.bookingUrl)  gLeadRow.booking_link = campaign.bookingUrl;
    if (campaign.quoteUrl)    gLeadRow.quote_link   = campaign.quoteUrl;
    if (campaign.websiteUrl)  gLeadRow.website_link = campaign.websiteUrl;
    if (campaign.phoneNumber) gLeadRow.phone_link   = campaign.phoneNumber;

    const gTrackingId  = randomUUID();
    const gTracking    = await getTrackingSettings();
    const gPublicBase  = gTracking.trackingUrl;

    let gGenerated: { subject: string; body: string };
    try {
      gGenerated = await generatePersonalizedEmail({
        name: lead.name, email: lead.email,
        vehicle: lead.vehicle, route: lead.route,
        pickup: lead.pickup, delivery: lead.delivery,
        price: lead.price, notes: lead.notes,
        templateSubject: gTemplate.subject, templateBody: gTemplate.body,
        tone: "professional",
      });
    } catch (aiErr) {
      if (aiErr instanceof AiConfigError) {
        gGenerated = {
          subject: replaceVarsText(gTemplate.subject, gLeadRow),
          body:    replaceVarsText(gTemplate.body,    gLeadRow),
        };
      } else { throw aiErr; }
    }

    const gLogoAttachment = extractLogoAttachment(gBranding.logoUrl);
    const gGmailBranding = gLogoAttachment ? { ...gBranding, logoUrl: `cid:${gLogoAttachment.cid}` } : gBranding;
    const gBodyHtml = buildHtmlEmail(gTemplate.body, gLeadRow, gGmailBranding, {
      style: gStyle as any, useSignatureBuilder: gUseSig, ctaButtons: gCtaButtons,
      trackingId: gTracking.clickTrackingEnabled ? gTrackingId : undefined,
      publicBase: gTracking.clickTrackingEnabled ? gPublicBase : undefined,
      unsubscribeUrl: buildUnsubscribeUrl(gPublicBase, user.id, leadId, campaignId, lead.email ?? ""),
    });
    const gPixelTag    = gTracking.openTrackingEnabled
      ? `<img src="${gPublicBase}/api/track/open/${gTrackingId}" width="1" height="1" alt="" style="display:none!important;width:1px!important;height:1px!important;border:0;" />`
      : "";
    const gTrackedHtml = gPixelTag
      ? (gBodyHtml.includes("</body>") ? gBodyHtml.replace(/<\/body>/i, `${gPixelTag}</body>`) : gBodyHtml + gPixelTag)
      : gBodyHtml;

    logger.info({ campaignId, leadId, draftId: failedDraft.id }, "[RETRY-LEAD] Retrying failed Gmail draft");

    if (await isSuppressed(user.id, lead.email!)) {
      res.status(409).json({ error: "Recipient is on the suppression list and cannot be retried." });
      return;
    }

    try {
      const gmailDraftId = await createGmailDraft(gFreshUser, lead.email!, gGenerated.subject, gGenerated.body, gTrackedHtml, gLogoAttachment);

      // sentAt left null intentionally — broker must "Mark Sent" in BrokerMAIL after sending.
      await db.update(draftsTable)
        .set({ status: "success", gmailDraftId, subject: gGenerated.subject, body: gGenerated.body, trackingId: gTrackingId, errorMessage: null })
        .where(eq(draftsTable.id, failedDraft.id));

      await db.update(leadsTable)
        .set({ status: "drafted", gmailDraftId, errorMessage: null, updatedAt: new Date() })
        .where(eq(leadsTable.id, leadId));

      await db.update(campaignsTable).set({
        draftedCount: sql`${campaignsTable.draftedCount} + 1`,
        failedCount:  sql`GREATEST(${campaignsTable.failedCount} - 1, 0)`,
        updatedAt: new Date(),
      }).where(eq(campaignsTable.id, campaignId));

      logger.info({ campaignId, leadId, gmailDraftId, trackingId: gTrackingId }, "[RETRY-LEAD] Gmail draft retried successfully");
      res.json({ ok: true, mode: "gmail_draft", gmailDraftId, trackingId: gTrackingId });
    } catch (err: any) {
      const errMsg = String(err?.message ?? "Draft creation failed");
      await db.update(draftsTable).set({ errorMessage: errMsg }).where(eq(draftsTable.id, failedDraft.id));
      logger.error({ campaignId, leadId, errMsg }, "[RETRY-LEAD] Gmail draft retry failed");
      res.status(500).json({ error: errMsg });
    }
    return;
  }

  const [mailbox] = await db.select().from(mailboxesTable)
    .where(and(eq(mailboxesTable.id, queueItem.mailboxId), eq(mailboxesTable.userId, user.id)));
  if (!mailbox?.smtpHost) { res.status(400).json({ error: "Mailbox not configured" }); return; }

  const [template] = await db.select().from(templatesTable)
    .where(and(eq(templatesTable.id, queueItem.templateId), eq(templatesTable.userId, user.id)));
  if (!template) { res.status(404).json({ error: "Template not found" }); return; }

  const [freshUser] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
  if (!freshUser) { res.status(404).json({ error: "User not found" }); return; }

  const branding = userBranding(freshUser);
  let row: Record<string, string> = {};
  try { row = JSON.parse(queueItem.rowDataJson); } catch {}
  if (row.price) row.price = formatPrice(row.price);
  if (campaign.bookingUrl)  row.booking_link = campaign.bookingUrl;
  if (campaign.quoteUrl)    row.quote_link   = campaign.quoteUrl;
  if (campaign.websiteUrl)  row.website_link = campaign.websiteUrl;
  if (campaign.phoneNumber) row.phone_link   = campaign.phoneNumber;

  const trackingId     = randomUUID();
  const retryTracking  = await getTrackingSettings();
  const publicBase     = retryTracking.trackingUrl;

  const ctaButtons = (() => {
    try { return template.ctaButtonsJson ? JSON.parse(template.ctaButtonsJson) : []; }
    catch { return []; }
  })();

  const subject  = replaceVarsText(template.subject, row);
  const bodyText = replaceVarsText(template.body, row);
  const bodyHtml = buildHtmlEmail(template.body, row, branding, {
    style: (queueItem.style ?? "clean") as any,
    useSignatureBuilder: queueItem.useSignatureBuilder,
    ctaButtons,
    trackingId: retryTracking.clickTrackingEnabled ? trackingId : undefined,
    publicBase: retryTracking.clickTrackingEnabled ? publicBase : undefined,
    unsubscribeUrl: buildUnsubscribeUrl(publicBase, user.id, queueItem.leadId ?? null, campaignId, queueItem.email),
  });

  const pixelTag    = retryTracking.openTrackingEnabled
    ? `<img src="${publicBase}/api/track/open/${trackingId}" width="1" height="1" alt="" style="display:none!important;width:1px!important;height:1px!important;border:0;" />`
    : "";
  const trackedHtml = pixelTag
    ? (bodyHtml.includes("</body>") ? bodyHtml.replace(/<\/body>/i, `${pixelTag}</body>`) : bodyHtml + pixelTag)
    : bodyHtml;

  logger.info({ campaignId, leadId, queueItemId: queueItem.id, email: queueItem.email }, "[RETRY-LEAD] Retrying failed lead");

  if (await isSuppressed(user.id, queueItem.email)) {
    res.status(409).json({ error: "Recipient is on the suppression list and cannot be retried." });
    return;
  }

  try {
    await sendEmail(mailbox, { to: queueItem.email, subject, text: bodyText, html: trackedHtml });

    // ── Critical state updates first — these must succeed so the sent email
    // is visible and trackingId is linked to the queue row before anything else.
    const now = new Date();
    await db.update(emailQueueTable)
      .set({ status: "success", sentAt: now, trackingId, lastError: null, attempts: queueItem.attempts + 1 })
      .where(eq(emailQueueTable.id, queueItem.id));

    await db.update(leadsTable)
      .set({ status: "sent", sentAt: now, errorMessage: null, updatedAt: now })
      .where(eq(leadsTable.id, leadId));

    await db.update(campaignsTable).set({
      sentCount:   sql`${campaignsTable.sentCount} + 1`,
      failedCount: sql`GREATEST(${campaignsTable.failedCount} - 1, 0)`,
      updatedAt: new Date(),
    }).where(eq(campaignsTable.id, campaignId));

    // ── Non-fatal: drafts tracking record — failure here must never roll back
    // a successfully sent email. sentAt is set to now() so the tracking pixel
    // records opens immediately without needing "Mark Sent". The queue row
    // already has the trackingId, so even if this insert fails the
    // SMTP-fallback lazy-create path in tracking.ts will recover on first open.
    try {
      await db.insert(draftsTable).values({
        userId: user.id, campaignId, leadId,
        email: queueItem.email, subject, body: bodyText,
        status: "success", trackingId,
        gmailDraftId: `smtp:retry:lead:${leadId}`,
        sentAt: now,
      });
    } catch (draftErr) {
      logger.warn({ draftErr, campaignId, leadId, trackingId },
        "[RETRY-LEAD] Non-fatal: drafts table insert failed — email WAS sent, queue/lead already marked success");
    }

    logger.info({ campaignId, leadId, trackingId }, "[RETRY-LEAD] Lead retried successfully");
    res.json({ ok: true, sentAt: now.toISOString(), trackingId });
  } catch (err: any) {
    const errMsg = String(err?.message ?? "Send failed");
    await db.update(emailQueueTable)
      .set({ attempts: queueItem.attempts + 1, lastError: errMsg })
      .where(eq(emailQueueTable.id, queueItem.id));
    logger.error({ campaignId, leadId, errMsg }, "[RETRY-LEAD] Retry failed");
    res.status(500).json({ error: errMsg });
  }
});

// ─── Campaign Analytics ───────────────────────────────────────────────────────

router.get("/campaigns/:id/analytics", requireAuth, async (req, res): Promise<void> => {
  const user       = req.user!;
  const campaignId = parseInt((req.params.id as string), 10);
  if (!campaignId) { res.status(400).json({ error: "Invalid campaign id" }); return; }

  const [campaign] = await db
    .select()
    .from(campaignsTable)
    .where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.userId, user.id)));
  if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }

  const statusRows = await db
    .select({ status: leadsTable.status, cnt: sql<number>`count(*)::int` })
    .from(leadsTable)
    .where(eq(leadsTable.campaignId, campaignId))
    .groupBy(leadsTable.status);

  const counts: Record<string, number> = {};
  for (const r of statusRows) counts[r.status] = r.cnt;

  const total     = campaign.totalLeads ?? 0;
  const sent      = (counts.sent ?? 0) + (counts.drafted ?? 0);
  const failed    = counts.failed ?? 0;
  const remaining = counts.new ?? 0;

  let totalOpens  = 0;
  let uniqueOpens = 0;
  let opensTimeline: Array<{ date: string; opens: number }> = [];
  let totalClicks  = 0;
  let uniqueClicks = 0;
  let clickRate    = 0;
  let ctr          = 0;
  let topClickedLinks: Array<{ url: string; label: string | null; clicks: number }> = [];
  let mostEngaged: Array<{
    email: string | null;
    name:  string | null;
    opens: number;
    firstOpenAt: string | null;
    lastOpenAt:  string | null;
  }> = [];

  if (campaign.sendMode === "smtp") {
    const queueItems = await db
      .select({
        trackingId:  emailQueueTable.trackingId,
        email:       emailQueueTable.email,
        rowDataJson: emailQueueTable.rowDataJson,
      })
      .from(emailQueueTable)
      .where(and(eq(emailQueueTable.campaignId, campaignId), eq(emailQueueTable.status, "success")));

    const trackingIds = queueItems.filter(i => i.trackingId).map(i => i.trackingId!);

    if (trackingIds.length > 0) {
      const draftRows = await db
        .select({ id: draftsTable.id, trackingId: draftsTable.trackingId })
        .from(draftsTable)
        .where(inArray(draftsTable.trackingId, trackingIds));

      const draftIds = draftRows.map(d => d.id);

      // Build lookup maps for mostEngaged enrichment
      const draftToTracking = new Map<number, string>();
      for (const d of draftRows) {
        if (d.trackingId) draftToTracking.set(d.id, d.trackingId);
      }
      const trackingToQueue = new Map<string, typeof queueItems[0]>();
      for (const q of queueItems) {
        if (q.trackingId) trackingToQueue.set(q.trackingId, q);
      }

      if (draftIds.length > 0) {
        // Aggregate totals
        const [openStats] = await db
          .select({
            total:  sql<number>`count(*)::int`,
            unique: sql<number>`count(distinct ${emailTrackingEventsTable.draftId})::int`,
          })
          .from(emailTrackingEventsTable)
          .where(
            and(
              inArray(emailTrackingEventsTable.draftId, draftIds),
              eq(emailTrackingEventsTable.eventType, "open"),
            )
          );

        totalOpens  = openStats?.total  ?? 0;
        uniqueOpens = openStats?.unique ?? 0;

        // Opens timeline — last 14 days grouped by day
        const timelineRows = await db
          .select({
            date:  sql<string>`date_trunc('day', ${emailTrackingEventsTable.createdAt})::text`,
            opens: sql<number>`count(*)::int`,
          })
          .from(emailTrackingEventsTable)
          .where(
            and(
              inArray(emailTrackingEventsTable.draftId, draftIds),
              eq(emailTrackingEventsTable.eventType, "open"),
              gte(emailTrackingEventsTable.createdAt, new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)),
            )
          )
          .groupBy(sql`date_trunc('day', ${emailTrackingEventsTable.createdAt})`)
          .orderBy(sql`date_trunc('day', ${emailTrackingEventsTable.createdAt})`);

        opensTimeline = timelineRows.map(r => ({ date: r.date, opens: r.opens }));

        // Most engaged leads — top 5 by open count
        const opensByDraft = await db
          .select({
            draftId:     emailTrackingEventsTable.draftId,
            opens:       sql<number>`count(*)::int`,
            firstOpenAt: sql<string>`min(${emailTrackingEventsTable.createdAt})::text`,
            lastOpenAt:  sql<string>`max(${emailTrackingEventsTable.createdAt})::text`,
          })
          .from(emailTrackingEventsTable)
          .where(
            and(
              inArray(emailTrackingEventsTable.draftId, draftIds),
              eq(emailTrackingEventsTable.eventType, "open"),
            )
          )
          .groupBy(emailTrackingEventsTable.draftId)
          .orderBy(sql`count(*) desc`)
          .limit(5);

        mostEngaged = opensByDraft
          .map(o => {
            const tId   = o.draftId != null ? draftToTracking.get(o.draftId) : null;
            const qItem = tId ? trackingToQueue.get(tId) : null;
            let row: Record<string, string> = {};
            try { if (qItem?.rowDataJson) row = JSON.parse(qItem.rowDataJson); } catch {}
            return {
              email:       qItem?.email ?? null,
              name:        row.name ?? row.companyName ?? null,
              opens:       o.opens,
              firstOpenAt: o.firstOpenAt ?? null,
              lastOpenAt:  o.lastOpenAt  ?? null,
            };
          })
          .filter(e => e.email);

        // ── Click stats ─────────────────────────────────────────────────────
        const [clickStats] = await db
          .select({
            total:  sql<number>`count(*)::int`,
            unique: sql<number>`count(distinct ${emailTrackingEventsTable.draftId})::int`,
          })
          .from(emailTrackingEventsTable)
          .where(and(
            inArray(emailTrackingEventsTable.draftId, draftIds),
            eq(emailTrackingEventsTable.eventType, "click"),
          ));

        totalClicks  = clickStats?.total  ?? 0;
        uniqueClicks = clickStats?.unique ?? 0;
        clickRate    = sent  > 0        ? Math.round((uniqueClicks / sent)        * 100) : 0;
        ctr          = uniqueOpens > 0  ? Math.round((uniqueClicks / uniqueOpens) * 100) : 0;

        const topLinksRows = await db
          .select({
            url:    emailTrackingEventsTable.linkUrl,
            label:  emailTrackingEventsTable.buttonLabel,
            clicks: sql<number>`count(*)::int`,
          })
          .from(emailTrackingEventsTable)
          .where(and(
            inArray(emailTrackingEventsTable.draftId, draftIds),
            eq(emailTrackingEventsTable.eventType, "click"),
            isNotNull(emailTrackingEventsTable.linkUrl),
          ))
          .groupBy(emailTrackingEventsTable.linkUrl, emailTrackingEventsTable.buttonLabel)
          .orderBy(sql`count(*) desc`)
          .limit(10);

        topClickedLinks = topLinksRows.map(r => ({
          url:    r.url    ?? "",
          label:  r.label  ?? null,
          clicks: r.clicks,
        }));
      }
    }
  }

  const deliveryRate = total > 0 ? Math.round((sent    / total) * 100) : 0;
  const failedRate   = total > 0 ? Math.round((failed  / total) * 100) : 0;
  const openRate     = sent  > 0 ? Math.round((uniqueOpens / sent) * 100) : 0;

  res.json({
    total, sent, failed, remaining,
    totalOpens, uniqueOpens,
    deliveryRate, failedRate, openRate,
    totalClicks, uniqueClicks, clickRate, ctr, topClickedLinks,
    opensTimeline, mostEngaged,
    sendMode: campaign.sendMode,
  });
});

// ─── GET /api/campaigns/:id/start-diagnostics ────────────────────────────────
/**
 * Returns a full pre-flight diagnostic payload so you can see exactly what
 * values would be inserted into email_queue on the next campaign start.
 */
router.get("/campaigns/:id/start-diagnostics", requireAuth, async (req, res): Promise<void> => {
  const user       = req.user!;
  const campaignId = parseInt((req.params.id as string), 10);
  if (!campaignId) { res.status(400).json({ error: "Invalid campaign id" }); return; }

  try {
    const [campaign] = await db.select().from(campaignsTable)
      .where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.userId, user.id)));

    const [template] = campaign?.templateId
      ? await db.select().from(templatesTable)
          .where(and(eq(templatesTable.id, campaign.templateId), eq(templatesTable.userId, user.id)))
      : [null];

    const [box] = await db.select().from(mailboxesTable)
      .where(and(eq(mailboxesTable.userId, user.id), eq(mailboxesTable.isActive, true)));

    const sampleLeads = await db.select().from(leadsTable)
      .where(and(eq(leadsTable.campaignId, campaignId), eq(leadsTable.status, "new")))
      .orderBy(leadsTable.id)
      .limit(3);

    const [newLeadCount] = await db.select({ count: sql<number>`count(*)::int` })
      .from(leadsTable)
      .where(and(eq(leadsTable.campaignId, campaignId), eq(leadsTable.status, "new")));

    const [queueCount] = await db.select({ count: sql<number>`count(*)::int` })
      .from(emailQueueTable)
      .where(and(eq(emailQueueTable.campaignId, campaignId)));

    // Build a sample insert payload for one lead
    let sampleInsertPayload: object | null = null;
    if (box && template && sampleLeads.length > 0) {
      const lead = sampleLeads[0];
      const row: Record<string, string> = {
        name: lead.name ?? "", email: lead.email,
        vehicle: lead.vehicle ?? "", route: lead.route ?? "",
        pickup: lead.pickup ?? "", delivery: lead.delivery ?? "",
        price: lead.price ?? "", notes: lead.notes ?? "",
        quote_id: lead.quoteId ?? "",
      };
      const ALL_STYLES_DG = ["clean","modern","minimal","luxury","corporate","urgent","dispatch","friendly","mobile","dark"] as const;
      const emailStyle = ALL_STYLES_DG.includes(campaign?.emailStyle as any)
        ? campaign?.emailStyle as any : "clean";
      sampleInsertPayload = {
        jobId:              "(would be a new UUID on start)",
        userId:             user.id,
        mailboxId:          box.id,
        templateId:         template.id,
        campaignId,
        leadId:             lead.id,
        email:              lead.email,
        subject:            replaceVarsText(template.subject, row),
        rowDataJson:        JSON.stringify(row),
        style:              emailStyle,
        useSignatureBuilder: campaign?.useSignature ?? false,
        quoteId:            lead.quoteId ?? null,
        status:             "pending",
      };
    }

    // Validation checks
    const issues: string[] = [];
    if (!campaign)  issues.push("Campaign not found or not owned by this user");
    if (!template)  issues.push(campaign ? "No template assigned to campaign" : "Template lookup skipped");
    if (!box)       issues.push("No active SMTP mailbox found for this user");
    if ((newLeadCount?.count ?? 0) === 0) issues.push("No leads with status=new in this campaign");
    if (campaign?.sendMode !== "smtp") issues.push(`sendMode is '${campaign?.sendMode}' — must be 'smtp'`);

    res.json({
      ok: issues.length === 0,
      issues,
      campaign: campaign ? {
        id: campaign.id, name: campaign.name, status: campaign.status,
        sendMode: campaign.sendMode, templateId: campaign.templateId,
        emailStyle: campaign.emailStyle, useSignature: campaign.useSignature,
      } : null,
      template: template ? {
        id: template.id, name: template.name,
        subjectLength: template.subject?.length,
        bodyLength: template.body?.length,
      } : null,
      mailbox: box ? {
        id: box.id, smtpUser: box.smtpUser, smtpHost: box.smtpHost,
        smtpPort: box.smtpPort, isActive: box.isActive,
        delaySeconds: box.delaySeconds, maxPerHour: box.maxPerHour,
      } : null,
      leads: {
        newCount: newLeadCount?.count ?? 0,
        sampleEmails: sampleLeads.map(l => ({ id: l.id, email: l.email, status: l.status })),
      },
      existingQueueCount: queueCount?.count ?? 0,
      sampleInsertPayload,
    });
  } catch (err: any) {
    const pg = err?.cause ?? err;
    res.status(500).json({ error: pg?.message ?? err?.message, pgCode: pg?.code });
  }
});

export default router;
