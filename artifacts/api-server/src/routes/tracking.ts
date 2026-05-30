import { Router, type IRouter } from "express";
import { db, draftsTable, emailTrackingEventsTable } from "@workspace/db";
import { eq, and, gte, desc } from "drizzle-orm";

const router: IRouter = Router();

const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

/** Send the 1x1 transparent GIF pixel regardless of tracking outcome */
function sendPixel(res: any) {
  res.set({
    "Content-Type": "image/gif",
    "Content-Length": PIXEL.length,
    "Cache-Control": "no-store, no-cache, must-revalidate, private",
    Pragma: "no-cache",
    Expires: "0",
  });
  res.send(PIXEL);
}

router.get("/track/open/:trackingId", async (req, res): Promise<void> => {
  const { trackingId } = req.params;
  const ip = req.ip ?? null;
  const ua = req.get("user-agent") ?? null;

  try {
    const [draft] = await db
      .select({ id: draftsTable.id })
      .from(draftsTable)
      .where(eq(draftsTable.trackingId, trackingId));

    if (draft) {
      // Deduplication: skip if this exact draft got an open from the same IP
      // within the last 5 seconds (prevents duplicate HTTP retries / Apple Mail
      // rapid prefetch burst, while still counting deliberate re-opens).
      const DEDUP_WINDOW_MS = 5_000;
      const windowStart = new Date(Date.now() - DEDUP_WINDOW_MS);

      const conditions: any[] = [
        eq(emailTrackingEventsTable.draftId, draft.id),
        eq(emailTrackingEventsTable.eventType, "open"),
        gte(emailTrackingEventsTable.createdAt, windowStart),
      ];
      // Only apply IP dedup if we have an IP (avoids blocking distinct openers
      // behind the same corporate proxy on different minutes)
      if (ip) {
        conditions.push(eq(emailTrackingEventsTable.ipAddress, ip));
      }

      const [recent] = await db
        .select({ id: emailTrackingEventsTable.id })
        .from(emailTrackingEventsTable)
        .where(and(...conditions))
        .orderBy(desc(emailTrackingEventsTable.createdAt))
        .limit(1);

      if (!recent) {
        // No duplicate in the window — record the open
        await db.insert(emailTrackingEventsTable).values({
          draftId:   draft.id,
          eventType: "open",
          ipAddress: ip,
          userAgent: ua,
        });
      }
    }
  } catch {
    // Never fail — always serve the pixel
  }

  sendPixel(res);
});

router.get("/track/click/:trackingId", async (req, res): Promise<void> => {
  const { trackingId } = req.params;
  const url   = req.query.url   as string | undefined;
  const label = req.query.label as string | undefined;

  if (!url) {
    res.status(400).send("Missing url parameter");
    return;
  }

  try {
    const [draft] = await db
      .select({ id: draftsTable.id })
      .from(draftsTable)
      .where(eq(draftsTable.trackingId, trackingId));

    if (draft) {
      await db.insert(emailTrackingEventsTable).values({
        draftId:     draft.id,
        eventType:   "click",
        linkUrl:     url,
        buttonLabel: label ?? null,
        ipAddress:   req.ip ?? null,
        userAgent:   req.get("user-agent") ?? null,
      });
    }
  } catch {
  }

  res.redirect(url);
});

export default router;
