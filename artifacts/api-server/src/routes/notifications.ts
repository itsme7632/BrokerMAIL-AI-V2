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
 * Uses ?limit=N (default 20, max 50)
 * Uses ?since=ISO_TIMESTAMP to filter to events after a given time.
 */
router.get("/notifications/live", requireAuth, async (req, res): Promise<void> => {
  const user  = req.user!;
  const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 50);
  const since = req.query.since ? new Date(req.query.since as string) : null;

  try {
    // Step 1: Get all email_queue entries for this user that have a trackingId
    // Limit to last 90 days to keep query fast
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
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

    if (queueItems.length === 0) {
      res.json({ events: [], total: 0 });
      return;
    }

    // Step 2: Find draft IDs for those trackingIds
    const trackingIds = queueItems.map(q => q.trackingId!).filter(Boolean);
    const draftRows = await db
      .select({ id: draftsTable.id, trackingId: draftsTable.trackingId })
      .from(draftsTable)
      .where(inArray(draftsTable.trackingId, trackingIds));

    if (draftRows.length === 0) {
      res.json({ events: [], total: 0 });
      return;
    }

    // Build lookup maps
    const trackingToQueue = new Map<string, typeof queueItems[0]>();
    for (const q of queueItems) {
      if (q.trackingId) trackingToQueue.set(q.trackingId, q);
    }
    const draftToTracking = new Map<number, string>();
    for (const d of draftRows) {
      if (d.trackingId) draftToTracking.set(d.id, d.trackingId);
    }
    const draftIds = draftRows.map(d => d.id);

    // Step 3: Get recent open events (with optional since filter)
    const conditions: any[] = [
      inArray(emailTrackingEventsTable.draftId, draftIds),
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

    // Step 4: Format with context
    const formatted = events.map(e => {
      const tId   = e.draftId != null ? draftToTracking.get(e.draftId) : null;
      const qItem = tId ? trackingToQueue.get(tId) : null;

      let row: Record<string, string> = {};
      try { if (qItem?.rowDataJson) row = JSON.parse(qItem.rowDataJson); } catch {}

      const ua = e.userAgent ?? "";
      const isAppleMail =
        ua.toLowerCase().includes("applemail") ||
        /apple.*mail|mimestream|airmail/i.test(ua);

      return {
        id:           e.id,
        openedAt:     e.createdAt.toISOString(),
        email:        qItem?.email ?? null,
        customerName: row.name ?? row.companyName ?? null,
        subject:      qItem?.subject ?? null,
        campaignId:   qItem?.campaignId ?? null,
        userAgent:    ua || null,
        isAppleMail,
        queueId:      qItem?.id ?? null,
      };
    });

    res.json({ events: formatted, total: formatted.length });
  } catch (err: any) {
    console.error("notifications/live error:", err);
    res.status(500).json({ error: "Failed to load notifications" });
  }
});

export default router;
