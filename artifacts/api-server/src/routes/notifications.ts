import { Router, type IRouter } from "express";
import {
  db, emailQueueTable, draftsTable, emailTrackingEventsTable,
} from "@workspace/db";
import { eq, and, desc, inArray, isNotNull, gte } from "drizzle-orm";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

/**
 * GET /api/notifications/live
 * Returns recent email-open events for the logged-in user.
 * Covers both SMTP-queued sends and Gmail-only drafts (marked as sent).
 * Uses ?limit=N (default 20, max 50)
 * Uses ?since=ISO_TIMESTAMP to filter to events after a given time.
 */
router.get("/notifications/live", requireAuth, async (req, res): Promise<void> => {
  const user  = req.user!;
  const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 50);
  const since = req.query.since ? new Date(req.query.since as string) : null;

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

    // Find draft rows that match SMTP queue trackingIds
    const smtpTrackingIds = queueItems.map(q => q.trackingId!).filter(Boolean);
    const smtpDraftRows = smtpTrackingIds.length > 0
      ? await db
          .select({ id: draftsTable.id, trackingId: draftsTable.trackingId })
          .from(draftsTable)
          .where(inArray(draftsTable.trackingId, smtpTrackingIds))
      : [];

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

    // Build: draftId → { email, subject, campaignId }
    const gmailDraftMap = new Map<number, { email: string | null; subject: string; campaignId: number | null }>();
    for (const d of gmailOnlyDrafts) {
      gmailDraftMap.set(d.id, { email: d.email, subject: d.subject, campaignId: d.campaignId });
    }

    // ── Collect all draft IDs to query events for ─────────────────────────────
    const allDraftIds = [
      ...smtpDraftRows.map(d => d.id),
      ...gmailOnlyDrafts.map(d => d.id),
    ];

    if (allDraftIds.length === 0) {
      res.json({ events: [], total: 0 });
      return;
    }

    // ── Fetch open events ─────────────────────────────────────────────────────
    const conditions: any[] = [
      inArray(emailTrackingEventsTable.draftId, allDraftIds),
      eq(emailTrackingEventsTable.eventType, "open"),
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
        customerName = row.name ?? row.companyName ?? null;
      } else if (e.draftId != null && gmailDraftMap.has(e.draftId)) {
        // Gmail draft path — context from draftsTable directly
        const gDraft = gmailDraftMap.get(e.draftId)!;
        email        = gDraft.email;
        subject      = gDraft.subject;
        campaignId   = gDraft.campaignId;
        customerName = null;
      }

      const ua = e.userAgent ?? "";
      const isAppleMail =
        ua.toLowerCase().includes("applemail") ||
        /apple.*mail|mimestream|airmail/i.test(ua);

      return {
        id:           e.id,
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

    res.json({ events: formatted, total: formatted.length });
  } catch (err: any) {
    console.error("notifications/live error:", err);
    res.status(500).json({ error: "Failed to load notifications" });
  }
});

export default router;
