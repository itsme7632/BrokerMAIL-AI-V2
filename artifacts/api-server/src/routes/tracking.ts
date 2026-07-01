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

  // Step 1 — log every incoming request so we can see it in server logs
  logger.info({ trackingId, ip, ua, timestamp: ts.toISOString() }, "[TRACK/OPEN] 1. Pixel request received");

  try {
    // ── Step 2: Filter false opens ─────────────────────────────────────────
    if (isPrivateIp(ip)) {
      logger.info({ trackingId, ip }, "[TRACK/OPEN] 2a. Private/loopback IP — open ignored, serving pixel");
      sendPixel(res);
      return;
    }
    if (isBotUserAgent(ua)) {
      logger.info({ trackingId, ua }, "[TRACK/OPEN] 2b. Bot/prefetch user-agent — open ignored, serving pixel");
      sendPixel(res);
      return;
    }
    logger.info({ trackingId, ip, ua }, "[TRACK/OPEN] 2c. IP and UA checks passed — proceeding to DB lookup");

    // ── Step 3: Early isTest guard: check email_queue BEFORE touching drafts.
    // This covers both the draft-exists path AND the lazy-create path.
    const [queueCheck] = await db
      .select({ isTest: emailQueueTable.isTest })
      .from(emailQueueTable)
      .where(eq(emailQueueTable.trackingId, trackingId))
      .limit(1);

    logger.info({ trackingId, queueCheckFound: !!queueCheck, isTest: queueCheck?.isTest ?? null },
      "[TRACK/OPEN] 3. email_queue isTest lookup result");

    if (queueCheck?.isTest) {
      logger.info({ trackingId }, "[TRACK/OPEN] 3a. Test email — open not recorded (isTest=true)");
      sendPixel(res);
      return;
    }

    // ── Step 4: Draft lookup by trackingId ────────────────────────────────
    let draft = await db
      .select({ id: draftsTable.id, sentAt: draftsTable.sentAt })
      .from(draftsTable)
      .where(eq(draftsTable.trackingId, trackingId))
      .then(rows => rows[0] as { id: number; sentAt: Date | null } | undefined);

    logger.info({
      trackingId,
      draftFound: !!draft,
      draftId:    draft?.id ?? null,
      sentAt:     draft?.sentAt?.toISOString() ?? null,
    }, "[TRACK/OPEN] 4. drafts table lookup result");

    // ── Step 5: SMTP fallback — if no draft row exists for this trackingId,
    // check whether a successfully-sent SMTP queue item owns it (can happen
    // when the non-fatal drafts table insert was silently skipped in the
    // processor).  Lazy-create a minimal draft row so the event can be
    // recorded and shown in the UI.
    if (!draft) {
      logger.info({ trackingId }, "[TRACK/OPEN] 5. No draft found — checking email_queue for SMTP fallback");
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

      logger.info({ trackingId, queueItemFound: !!queueItem, queueItemId: queueItem?.id ?? null },
        "[TRACK/OPEN] 5a. SMTP fallback queue lookup result");

      if (queueItem) {
        // isTest is already handled above via queueCheck, but guard defensively
        if (queueItem.isTest) {
          logger.info({ trackingId }, "[TRACK/OPEN] 5b. Test email — open not recorded (lazy path)");
          sendPixel(res);
          return;
        }

        logger.info({ trackingId, queueItemId: queueItem.id },
          "[TRACK/OPEN] 5c. Lazy-creating draft row from SMTP queue item");
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
          if (lazyDraft) {
            draft = lazyDraft;
            logger.info({ trackingId, draftId: lazyDraft.id }, "[TRACK/OPEN] 5d. Lazy draft created successfully");
          }
        } catch (lazyErr) {
          logger.warn({ trackingId, lazyErr },
            "[TRACK/OPEN] 5e. Lazy-create draft failed — open not recorded");
        }
      } else {
        logger.warn({ trackingId, ip, ua },
          "[TRACK/OPEN] 5f. No draft or queue item found for trackingId — pixel served but open not recorded");
      }
    }

    if (!draft) {
      // Nothing to record — fall through to sendPixel
      logger.warn({ trackingId }, "[TRACK/OPEN] 6. No draft record available — open not recorded");
    } else {
      // ── Step 6: Auto-activate tracking if sentAt is null ─────────────────
      // Gmail drafts are saved with sentAt=null until the broker manually sends
      // them from Gmail and gmailDraftSync picks it up. If the tracking pixel
      // fires, the email was clearly delivered — auto-set sentAt now so this
      // and all future opens are counted correctly.
      if (!draft.sentAt) {
        logger.info({ trackingId, draftId: draft.id },
          "[TRACK/OPEN] 6a. Draft sentAt is null — auto-activating (email was clearly delivered since pixel fired)");
        try {
          await db.update(draftsTable)
            .set({ sentAt: ts })
            .where(eq(draftsTable.id, draft.id));
          draft = { ...draft, sentAt: ts };
          logger.info({ trackingId, draftId: draft.id, sentAt: ts.toISOString() },
            "[TRACK/OPEN] 6b. sentAt auto-set successfully — proceeding to record open");
        } catch (autoSetErr) {
          logger.error({ trackingId, draftId: draft.id, autoSetErr },
            "[TRACK/OPEN] 6c. Failed to auto-set sentAt — open cannot be recorded");
          draft = { ...draft, sentAt: null };
        }
      }

      if (!draft.sentAt) {
        // sentAt still null after auto-set attempt failed — skip recording
        logger.warn({ trackingId, draftId: draft.id },
          "[TRACK/OPEN] 6d. sentAt still null after auto-set attempt — open not recorded");
      } else {
        // ── Step 7: Deduplication ─────────────────────────────────────────
        // Skip if this exact draft got an open from the same IP within the
        // last 5 seconds (prevents duplicate HTTP retries / Apple Mail rapid
        // prefetch burst, while still counting deliberate re-opens).
        const DEDUP_WINDOW_MS = 5_000;
        const windowStart = new Date(Date.now() - DEDUP_WINDOW_MS);

        const conditions: any[] = [
          eq(emailTrackingEventsTable.draftId, draft.id),
          eq(emailTrackingEventsTable.eventType, "open"),
          gte(emailTrackingEventsTable.createdAt, windowStart),
        ];
        // Only apply IP dedup if we have an IP (avoids blocking distinct
        // openers behind the same corporate proxy on different minutes)
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
          logger.info({ trackingId, draftId: draft.id, ip, ua },
            "[TRACK/OPEN] 7a. Deduplicated open within 5s window — not recorded");
        } else {
          // ── Step 8: Insert tracking event ──────────────────────────────
          logger.info({ trackingId, draftId: draft.id, ip, ua },
            "[TRACK/OPEN] 8. Inserting open event into email_tracking_events");
          try {
            await db.insert(emailTrackingEventsTable).values({
              draftId:   draft.id,
              eventType: "open",
              ipAddress: ip,
              userAgent: ua,
            });

            // Step 9: Confirm row count after insert
            const [{ openCount }] = await db
              .select({ openCount: count() })
              .from(emailTrackingEventsTable)
              .where(and(
                eq(emailTrackingEventsTable.draftId, draft.id),
                eq(emailTrackingEventsTable.eventType, "open"),
              ));

            logger.info({
              trackingId,
              draftId:   draft.id,
              openCount,
              ip,
              ua,
              timestamp: ts.toISOString(),
              rowsAffected: 1,
            }, "[TRACK/OPEN] 9. Open recorded successfully — event inserted");
          } catch (insertErr) {
            logger.error({ trackingId, draftId: draft.id, insertErr },
              "[TRACK/OPEN] 9. FAILED to insert open event — DB error");
          }
        }
      }
    }
  } catch (err) {
    logger.error({ trackingId, err }, "[TRACK/OPEN] ERROR — unhandled exception in tracking handler, pixel still served");
  }

  // Step 10: Serve pixel (always last, after all DB work is complete)
  logger.info({ trackingId }, "[TRACK/OPEN] 10. Serving tracking pixel — request complete");
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
