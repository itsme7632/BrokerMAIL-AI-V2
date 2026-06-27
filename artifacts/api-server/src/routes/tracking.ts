import { Router, type IRouter } from "express";
import { db, draftsTable, emailTrackingEventsTable, emailQueueTable } from "@workspace/db";
import { eq, and, gte, desc, count } from "drizzle-orm";
import { logger } from "../lib/logger";

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

/**
 * Returns true if the IP is a private/loopback address that should never
 * be recorded as a real open (localhost, RFC-1918, link-local).
 */
function isPrivateIp(ip: string | null): boolean {
  if (!ip) return false;
  const s = ip.trim();
  if (s === "::1" || s === "127.0.0.1" || s === "localhost") return true;
  // IPv4-mapped IPv6
  const v4 = s.replace(/^::ffff:/i, "");
  return (
    /^127\./.test(v4) ||
    /^10\./.test(v4) ||
    /^192\.168\./.test(v4) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(v4) ||
    /^169\.254\./.test(v4) ||
    /^fc00:/i.test(s) ||
    /^fd[0-9a-f]{2}:/i.test(s)
  );
}

/**
 * Returns true if the user-agent looks like an email prefetch bot / mail
 * privacy proxy that pre-downloads images without human intent.
 */
function isBotUserAgent(ua: string | null): boolean {
  if (!ua) return false;
  const l = ua.toLowerCase();
  // Known mail-prefetch services
  if (l.includes("apple privacy protection")) return true;
  if (l.includes("outlook fetch worker"))    return true;
  if (l.includes("microsoft office"))        return true;
  if (l.includes("yahoo slurp"))             return true;
  if (l.includes("googlebot"))               return true;
  if (l.includes("bingbot"))                 return true;
  if (l.includes("applebot"))                return true;
  if (l.includes("mimecast"))                return true;
  if (l.includes("proofpoint"))              return true;
  if (l.includes("barracuda"))               return true;
  // Generic bot keywords — intentionally narrow to avoid blocking real email clients.
  // "preview" and "scan" were removed: too broad and can match legitimate UAs.
  return (
    l.includes("bot") ||
    l.includes("crawler") ||
    l.includes("spider") ||
    l.includes("prefetch")
  );
}

router.get("/track/open/:trackingId", async (req, res): Promise<void> => {
  const { trackingId } = req.params;
  const ip = req.ip ?? null;
  const ua = req.get("user-agent") ?? null;
  const ts = new Date();

  try {
    // ── Filter false opens ───────────────────────────────────────────────────
    if (isPrivateIp(ip)) {
      logger.info({ trackingId, ip }, "[TRACK/OPEN] Private/loopback IP — open ignored");
      sendPixel(res);
      return;
    }
    if (isBotUserAgent(ua)) {
      logger.info({ trackingId, ua }, "[TRACK/OPEN] Bot/prefetch user-agent — open ignored");
      sendPixel(res);
      return;
    }

    // ── Early isTest guard: check email_queue BEFORE touching drafts.
    // This covers both the draft-exists path AND the lazy-create path.
    const [queueCheck] = await db
      .select({ isTest: emailQueueTable.isTest })
      .from(emailQueueTable)
      .where(eq(emailQueueTable.trackingId, trackingId))
      .limit(1);

    if (queueCheck?.isTest) {
      logger.info({ trackingId }, "[TRACK/OPEN] Test email — open not recorded (isTest=true)");
      sendPixel(res);
      return;
    }

    let draft = await db
      .select({ id: draftsTable.id, sentAt: draftsTable.sentAt })
      .from(draftsTable)
      .where(eq(draftsTable.trackingId, trackingId))
      .then(rows => rows[0] as { id: number; sentAt: Date | null } | undefined);

    // ── SMTP fallback: if no draft row exists for this trackingId, check whether
    // a successfully-sent SMTP queue item owns it (can happen when the non-fatal
    // drafts table insert was silently skipped in the processor).  Lazy-create
    // a minimal draft row so the event can be recorded and shown in the UI.
    if (!draft) {
      const [queueItem] = await db
        .select({
          id:         emailQueueTable.id,
          userId:     emailQueueTable.userId,
          campaignId: emailQueueTable.campaignId,
          leadId:     emailQueueTable.leadId,
          email:      emailQueueTable.email,
          subject:    emailQueueTable.subject,
          isTest:     emailQueueTable.isTest,
        })
        .from(emailQueueTable)
        .where(and(
          eq(emailQueueTable.trackingId, trackingId),
          eq(emailQueueTable.status, "success"),
        ))
        .limit(1);

      if (queueItem) {
        // isTest is already handled above via queueCheck, but guard defensively
        if (queueItem.isTest) {
          logger.info({ trackingId }, "[TRACK/OPEN] Test email — open not recorded (lazy path)");
          sendPixel(res);
          return;
        }

        logger.info({ trackingId, queueItemId: queueItem.id },
          "[TRACK/OPEN] No draft row found — lazy-creating from SMTP queue item");
        try {
          const [lazyDraft] = await db.insert(draftsTable).values({
            userId:      queueItem.userId,
            campaignId:  queueItem.campaignId ?? null,
            leadId:      queueItem.leadId     ?? null,
            email:       queueItem.email,
            subject:     queueItem.subject ?? "",
            body:        "",
            status:      "success",
            trackingId,
            gmailDraftId: `smtp:recovered:${trackingId}`,
            sentAt:      new Date(),
          }).returning({ id: draftsTable.id, sentAt: draftsTable.sentAt });
          if (lazyDraft) draft = lazyDraft;
        } catch (lazyErr) {
          logger.warn({ trackingId, lazyErr },
            "[TRACK/OPEN] Lazy-create draft failed — open not recorded");
        }
      } else {
        logger.warn({ trackingId, ip, ua },
          "[TRACK/OPEN] No draft or queue item found for trackingId — pixel served but not recorded");
      }
    }

    if (!draft) {
      // nothing to record — fall through to sendPixel
    } else if (!draft.sentAt) {
      logger.info({ trackingId, draftId: draft.id }, "[TRACK/OPEN] Draft not yet marked as sent — preview open ignored");
    } else {
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

      if (recent) {
        logger.info({ trackingId, draftId: draft.id, ip, ua }, "[TRACK/OPEN] Deduplicated open within 5s window — not recorded");
      } else {
        await db.insert(emailTrackingEventsTable).values({
          draftId:   draft.id,
          eventType: "open",
          ipAddress: ip,
          userAgent: ua,
        });

        // Get running open count for diagnostics
        const [{ openCount }] = await db
          .select({ openCount: count() })
          .from(emailTrackingEventsTable)
          .where(and(
            eq(emailTrackingEventsTable.draftId, draft.id),
            eq(emailTrackingEventsTable.eventType, "open"),
          ));

        logger.info({
          trackingId,
          draftId:    draft.id,
          leadId:     null,
          openCount,
          ip,
          ua,
          timestamp:  ts.toISOString(),
        }, "[TRACK/OPEN] Open recorded");
      }
    }
  } catch (err) {
    logger.error({ trackingId, err }, "[TRACK/OPEN] Error recording open — pixel still served");
  }

  sendPixel(res);
});

router.get("/track/click/:trackingId", async (req, res): Promise<void> => {
  const { trackingId } = req.params;
  const url   = req.query.url   as string | undefined;
  const label = req.query.label as string | undefined;
  const ip    = req.ip ?? null;
  const ua    = req.get("user-agent") ?? null;

  if (!url) {
    res.status(400).send("Missing url parameter");
    return;
  }

  try {
    // Do not record clicks from bots or private IPs
    if (isPrivateIp(ip) || isBotUserAgent(ua)) {
      logger.info({ trackingId, url }, "[TRACK/CLICK] Bot/private-IP click ignored");
    } else {
      // Skip click recording for test emails
      const [queueCheck] = await db
        .select({ isTest: emailQueueTable.isTest })
        .from(emailQueueTable)
        .where(eq(emailQueueTable.trackingId, trackingId))
        .limit(1);

      if (queueCheck?.isTest) {
        logger.info({ trackingId, url }, "[TRACK/CLICK] Test email — click not recorded (isTest=true)");
      } else {
        const [draft] = await db
          .select({ id: draftsTable.id })
          .from(draftsTable)
          .where(eq(draftsTable.trackingId, trackingId));

        if (!draft) {
          logger.warn({ trackingId, url, label }, "[TRACK/CLICK] No draft found for trackingId");
        } else {
          await db.insert(emailTrackingEventsTable).values({
            draftId:     draft.id,
            eventType:   "click",
            linkUrl:     url,
            buttonLabel: label ?? null,
            ipAddress:   ip,
            userAgent:   ua,
          });
          logger.info({ trackingId, draftId: draft.id, label, url, ip, timestamp: new Date().toISOString() }, "[TRACK/CLICK] Click recorded");
        }
      }
    }
  } catch (err) {
    logger.error({ trackingId, url, err }, "[TRACK/CLICK] Error recording click");
  }

  // Use direct header assignment (not res.redirect) so Express's encodeUrl()
  // does not mangle non-HTTP schemes such as tel: and mailto:
  // Only allow explicitly safe schemes to prevent open redirect to javascript: etc.
  const ALLOWED = /^(https?|tel|mailto|sms):/i;
  if (!ALLOWED.test(url)) {
    logger.warn({ trackingId, url }, "[TRACK/CLICK] Disallowed URL scheme — redirect blocked");
    res.status(400).send("Disallowed URL scheme");
    return;
  }
  res.writeHead(302, { Location: url });
  res.end();
});

export default router;
