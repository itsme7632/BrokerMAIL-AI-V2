import { Router, type IRouter } from "express";
import {
  db, emailQueueTable, draftsTable, emailTrackingEventsTable, leadsTable,
} from "@workspace/db";
import { eq, and, desc, inArray, isNotNull, gte } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/**
 * GET /api/notifications/live
 * Returns recent email-open AND email-click events for the logged-in user.
 * Covers both SMTP-queued sends and Gmail-only drafts (marked as sent).
 * Uses ?limit=N (default 20, max 50)
 * Uses ?since=ISO_TIMESTAMP to filter to events after a given time.
 */
router.get("/notifications/live", requireAuth, async (req, res): Promise<void> => {
  const user  = req.user!;
  const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 50);
  const since = req.query.since ? new Date(req.query.since as string) : null;

  logger.info({ userId: user.id, limit, since: since?.toISOString() ?? null },
    "[NOTIF/LIVE] 1. Query started");

  try {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    // ── Path 1: SMTP-queued emails ────────────────────────────────────────────
    // Find queue items with a trackingId — these are the anchor for SMTP open events
    const queueItems = await db
      .select({
        id:          emailQueueTable.id,
        email:       emailQueueTable.email,
        subject:     emailQueueTable.subject,
        campaignId:  emailQueueTable.campaignId,
        trackingId:  emailQueueTable.trackingId,
        rowDataJson: emailQueueTable.rowDataJson,
      })
      .from(emailQueueTable)
      .where(
        and(
          eq(emailQueueTable.userId, user.id),
          isNotNull(emailQueueTable.trackingId),
          gte(emailQueueTable.createdAt, cutoff),
        )
      );

    // Build lookup: trackingId → queueItem
    const trackingToQueue = new Map<string, typeof queueItems[0]>();
    for (const q of queueItems) {
      if (q.trackingId) trackingToQueue.set(q.trackingId, q);
    }

    logger.info({ userId: user.id, smtpQueueItemsWithTrackingId: queueItems.length },
      "[NOTIF/LIVE] 2. SMTP queue items found (email_queue rows with trackingId set)");

    // Find draft rows that match SMTP queue trackingIds
    const smtpTrackingIds = queueItems.map(q => q.trackingId!).filter(Boolean);
    const smtpDraftRows = smtpTrackingIds.length > 0
      ? await db
          .select({ id: draftsTable.id, trackingId: draftsTable.trackingId })
          .from(draftsTable)
          .where(inArray(draftsTable.trackingId, smtpTrackingIds))
      : [];

    logger.info({
      userId:                user.id,
      smtpTrackingIdCount:   smtpTrackingIds.length,
      smtpDraftRowsMatched:  smtpDraftRows.length,
      // If smtpTrackingIdCount > 0 but smtpDraftRowsMatched = 0:
      // the drafts table insert in the campaign processor failed silently for all sends.
      // Events in email_tracking_events will exist but won't be found by this query.
    }, "[NOTIF/LIVE] 3. SMTP draft rows matched to queue trackingIds");

    // Build: draftId → trackingId (for SMTP events)
    const draftToTracking = new Map<number, string>();
    const smtpDraftIdSet  = new Set<number>();
    for (const d of smtpDraftRows) {
      if (d.trackingId) draftToTracking.set(d.id, d.trackingId);
      smtpDraftIdSet.add(d.id);
    }

    // ── Path 2: Gmail-only drafts (no emailQueueTable record) ────────────────
    // Only count drafts that have been explicitly marked as sent (sentAt IS NOT NULL)
    const gmailDraftItems = await db
      .select({
        id:         draftsTable.id,
        email:      draftsTable.email,
        subject:    draftsTable.subject,
        campaignId: draftsTable.campaignId,
        trackingId: draftsTable.trackingId,
        leadId:     draftsTable.leadId,
      })
      .from(draftsTable)
      .where(
        and(
          eq(draftsTable.userId, user.id),
          isNotNull(draftsTable.trackingId),
          isNotNull(draftsTable.sentAt),
          eq(draftsTable.status, "success"),
          gte(draftsTable.createdAt, cutoff),
        )
      );

    // Exclude draft IDs already covered by the SMTP path
    const gmailOnlyDrafts = gmailDraftItems.filter(d => !smtpDraftIdSet.has(d.id));

    logger.info({
      userId:                    user.id,
      gmailDraftItemsWithSentAt: gmailDraftItems.length,
      gmailOnlyDraftsExclSMTP:   gmailOnlyDrafts.length,
      // If gmailDraftItemsWithSentAt = 0 but Gmail sends exist:
      // - drafts.sentAt is still null (broker never marked sent AND pixel never fired AND
      //   gmail-draft-sync hasn't run yet). Open events exist in email_tracking_events
      //   but this query excludes the draft because sentAt IS NOT NULL filter blocks it.
      // - The tracking pixel auto-heal (tracking.ts step 6a) sets sentAt when the pixel
      //   fires, so after the first open this number should be >= 1.
    }, "[NOTIF/LIVE] 4. Gmail-only draft rows found (drafts with sentAt non-null, no SMTP queue row)");

    // ── Fetch lead names for Gmail drafts ─────────────────────────────────────
    // Join via leadId so notifications show "John Smith opened your email"
    // instead of the raw email address.
    const gmailLeadIds = gmailOnlyDrafts
      .map(d => d.leadId)
      .filter((id): id is number => id != null);

    const leadNameMap = new Map<number, string>();
    if (gmailLeadIds.length > 0) {
      const leads = await db
        .select({ id: leadsTable.id, name: leadsTable.name })
        .from(leadsTable)
        .where(inArray(leadsTable.id, gmailLeadIds));
      for (const l of leads) leadNameMap.set(l.id, l.name);
    }

    // Build: draftId → { email, subject, campaignId, customerName }
    const gmailDraftMap = new Map<number, {
      email: string | null;
      subject: string;
      campaignId: number | null;
      customerName: string | null;
    }>();
    for (const d of gmailOnlyDrafts) {
      gmailDraftMap.set(d.id, {
        email:        d.email,
        subject:      d.subject,
        campaignId:   d.campaignId,
        customerName: d.leadId ? (leadNameMap.get(d.leadId) ?? null) : null,
      });
    }

    // ── Collect all draft IDs to query events for ─────────────────────────────
    const allDraftIds = [
      ...smtpDraftRows.map(d => d.id),
      ...gmailOnlyDrafts.map(d => d.id),
    ];

    logger.info({
      userId:           user.id,
      smtpDraftIds:     smtpDraftRows.map(d => d.id),
      gmailDraftIds:    gmailOnlyDrafts.map(d => d.id),
      totalDraftIds:    allDraftIds.length,
      // If totalDraftIds=0: no qualifying drafts for this user at all — nothing to show.
      // Check: (A) queue items have trackingId set, (B) draft rows exist with those trackingIds,
      // (C) Gmail draft rows have sentAt non-null (either manually marked or auto-healed by pixel).
    }, "[NOTIF/LIVE] 5. Draft IDs collected for event query");

    if (allDraftIds.length === 0) {
      logger.info({ userId: user.id },
        "[NOTIF/LIVE] 5a. EXIT — No qualifying drafts found — returning empty events");
      res.json({ events: [], total: 0 });
      return;
    }

    // ── Fetch open + click events ─────────────────────────────────────────────
    const conditions: any[] = [
      inArray(emailTrackingEventsTable.draftId, allDraftIds),
    ];
    if (since && !isNaN(since.getTime())) {
      conditions.push(gte(emailTrackingEventsTable.createdAt, since));
    }

    const events = await db
      .select()
      .from(emailTrackingEventsTable)
      .where(and(...conditions))
      .orderBy(desc(emailTrackingEventsTable.createdAt))
      .limit(limit);

    logger.info({
      userId:      user.id,
      eventsFound: events.length,
      since:       since?.toISOString() ?? null,
      // If totalDraftIds > 0 but eventsFound = 0:
      // tracking events exist in email_tracking_events for those draftIds but none
      // match the since filter OR no opens have been recorded at all yet.
      // Verify with: SELECT * FROM email_tracking_events WHERE draft_id IN (<ids>);
    }, "[NOTIF/LIVE] 6. Tracking events fetched from email_tracking_events");

    // ── Format ────────────────────────────────────────────────────────────────
    const formatted = events.map(e => {
      let email: string | null        = null;
      let customerName: string | null = null;
      let subject: string | null      = null;
      let campaignId: number | null   = null;
      let queueId: number | null      = null;

      const tId   = e.draftId != null ? draftToTracking.get(e.draftId) : null;
      const qItem = tId ? trackingToQueue.get(tId) : null;

      if (qItem) {
        // SMTP path — full context available from emailQueueTable
        email      = qItem.email;
        subject    = qItem.subject;
        campaignId = qItem.campaignId;
        queueId    = qItem.id;
        let row: Record<string, string> = {};
        try { if (qItem.rowDataJson) row = JSON.parse(qItem.rowDataJson); } catch {}
        // Case-insensitive name lookup: "name", "Name", "full_name", etc.
        const nameKey = Object.keys(row).find(k => k.toLowerCase() === "name")
          ?? Object.keys(row).find(k => k.toLowerCase().includes("name"));
        customerName = nameKey ? row[nameKey] : (row.companyName ?? null);
      } else if (e.draftId != null && gmailDraftMap.has(e.draftId)) {
        // Gmail draft path — context from draftsTable + lead join
        const gDraft = gmailDraftMap.get(e.draftId)!;
        email        = gDraft.email;
        subject      = gDraft.subject;
        campaignId   = gDraft.campaignId;
        customerName = gDraft.customerName;
      }

      const ua = e.userAgent ?? "";
      const isAppleMail =
        ua.toLowerCase().includes("applemail") ||
        /apple.*mail|mimestream|airmail/i.test(ua);

      return {
        id:           e.id,
        eventType:    e.eventType,        // "open" | "click"
        linkUrl:      e.linkUrl ?? null,  // click target URL
        buttonLabel:  e.buttonLabel ?? null,
        openedAt:     e.createdAt.toISOString(),
        email,
        customerName,
        subject,
        campaignId,
        userAgent:    ua || null,
        isAppleMail,
        queueId,
      };
    });

    logger.info({
      userId:         user.id,
      formattedCount: formatted.length,
      openCount:      formatted.filter(e => e.eventType === "open").length,
      clickCount:     formatted.filter(e => e.eventType === "click").length,
      smtpEventCount: formatted.filter(e => e.queueId != null).length,
      gmailEventCount: formatted.filter(e => e.queueId == null).length,
    }, "[NOTIF/LIVE] 7. Returning events to client");

    res.json({ events: formatted, total: formatted.length });
  } catch (err: any) {
    logger.error({ err, userId: (req as any).user?.id ?? null }, "[NOTIF/LIVE] ERROR — unhandled exception");
    res.status(500).json({ error: "Failed to load notifications" });
  }
});

export default router;
