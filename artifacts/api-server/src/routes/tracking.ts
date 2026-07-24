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

  // ── Google Image Proxy allowlist — checked BEFORE any block rules ─────────
  //
  // Gmail loads tracking pixels through its image privacy proxy.  Depending on
  // platform / Gmail version the proxy announces itself as either:
  //   • "Googleimageproxy/…"  (modern Gmail web + mobile)
  //   • "Googlebot-Image/1.0" (legacy path)
  //
  // Both represent a REAL recipient viewing their email and MUST NOT be blocked.
  //
  // "Googlebot-Image/1.0" contains both "googlebot" (caught by the explicit
  // block below) and "bot" (caught by the generic block at the bottom).
  // Without this early-return these two rules would silently drop every Gmail
  // open — which is the exact regression that was observed in production.
  //
  if (l.includes("googleimageproxy")) return false;  // modern Gmail image proxy
  if (l.includes("googlebot-image"))  return false;  // legacy Gmail image proxy

  // ── Google infrastructure ──────────────────────────────────────────────────
  //
  // Google Safe Browsing / security scanners — block them:
  if (l.includes("google-safety-net"))         return true;
  if (l.includes("google-inspectiontool"))     return true;
  if (l.includes("googlesafebrowsing"))        return true;
  // Google link / content crawlers:
  if (l.includes("google-read-aloud"))         return true;
  if (l.includes("feedfetcher-google"))        return true;
  if (l.includes("googlebot"))                 return true;  // web crawler (not image proxy — see allowlist above)

  // ── Known mail-prefetch / security-scanning services ──────────────────────
  if (l.includes("apple privacy protection")) return true;
  if (l.includes("outlook fetch worker"))    return true;
  if (l.includes("microsoft office"))        return true;
  if (l.includes("yahoo slurp"))             return true;
  if (l.includes("bingbot"))                 return true;
  if (l.includes("applebot"))                return true;
  if (l.includes("mimecast"))                return true;
  if (l.includes("proofpoint"))              return true;
  if (l.includes("barracuda"))               return true;
  // Email security / link-scanning vendors
  if (l.includes("agari"))                   return true;
  if (l.includes("abnormal security"))       return true;
  if (l.includes("cloudmark"))               return true;
  if (l.includes("greathorn"))               return true;
  if (l.includes("ironscales"))              return true;
  if (l.includes("vade secure"))             return true;
  if (l.includes("cofense"))                 return true;
  if (l.includes("tessian"))                 return true;
  if (l.includes("knowbe4"))                 return true;

  // ── Generic bot keywords — intentionally narrow ───────────────────────────
  // "preview" and "scan" were removed: too broad and can match legitimate UAs.
  return (
    l.includes("bot") ||
    l.includes("crawler") ||
    l.includes("spider") ||
    l.includes("prefetch")
  );
}

/**
 * Same logic as isBotUserAgent but returns the matched pattern string (for
 * diagnostic logging only) or null when the UA is not a bot.
 * Keep in sync with isBotUserAgent whenever that function changes.
 */
function getBotReason(ua: string | null): string | null {
  if (!ua) return null;
  const l = ua.toLowerCase();
  // Mirror the allowlist in isBotUserAgent — these are never bots
  if (l.includes("googleimageproxy")) return null;
  if (l.includes("googlebot-image"))  return null;
  const checks: [string, string][] = [
    ["google-safety-net", "google-safety-net"],
    ["google-inspectiontool", "google-inspectiontool"],
    ["googlesafebrowsing", "googlesafebrowsing"],
    ["google-read-aloud", "google-read-aloud"],
    ["feedfetcher-google", "feedfetcher-google"],
    ["googlebot", "googlebot"],
    ["apple privacy protection", "apple privacy protection"],
    ["outlook fetch worker", "outlook fetch worker"],
    ["microsoft office", "microsoft office"],
    ["yahoo slurp", "yahoo slurp"],
    ["bingbot", "bingbot"],
    ["applebot", "applebot"],
    ["mimecast", "mimecast"],
    ["proofpoint", "proofpoint"],
    ["barracuda", "barracuda"],
    ["agari", "agari"],
    ["abnormal security", "abnormal security"],
    ["cloudmark", "cloudmark"],
    ["greathorn", "greathorn"],
    ["ironscales", "ironscales"],
    ["vade secure", "vade secure"],
    ["cofense", "cofense"],
    ["tessian", "tessian"],
    ["knowbe4", "knowbe4"],
    ["bot", "generic:bot"],
    ["crawler", "generic:crawler"],
    ["spider", "generic:spider"],
    ["prefetch", "generic:prefetch"],
  ];
  for (const [pattern, label] of checks) {
    if (l.includes(pattern)) return label;
  }
  return null;
}

// ── HEAD /track/open/:trackingId ─────────────────────────────────────────────
//
// Critical: without this explicit HEAD handler Express routes HEAD requests to
// the GET route below, executing ALL its code (UA check → DB lookup → dedup →
// DB insert) while suppressing only the response body.
//
// Root cause of the Gmail Single Composer false-open bug:
//   Google's outbound security scanner (not GoogleImageProxy — a different
//   service) probes every image URL in a message immediately after it is
//   accepted by the Gmail API.  It uses an HTTP HEAD request so it never
//   actually downloads the image.  Because there was no HEAD handler, Express
//   routed it to the GET handler; the handler ran in full, recorded the open,
//   then discarded the pixel bytes before sending.  The sender's open counter
//   incremented before the recipient ever opened the email.
//
//   SMTP is unaffected because SMTP messages are not processed by Google's
//   infrastructure at send time, so no HEAD probe is issued.
//
// This handler returns only the image metadata headers — zero DB work.
// It is the correct HTTP/1.1 behaviour: HEAD MUST return identical headers
// to GET but MUST NOT include a message body (RFC 9110 §9.3.2).
//
router.head("/track/open/:trackingId", (req, res): void => {
  // ── DIAG: log every HEAD request so we can see if scanners are hitting this path ──
  logger.info({
    handler:       "HEAD",
    trackingId:    req.params.trackingId,
    ip:            req.ip ?? null,
    ua:            req.get("user-agent") ?? null,
    xForwardedFor: req.headers["x-forwarded-for"] ?? "(not set)",
    xRealIp:       req.headers["x-real-ip"]       ?? "(not set)",
    referer:       req.get("referer")              ?? null,
    timestamp:     new Date().toISOString(),
  }, "[TRACK/HEAD] HEAD request intercepted — no DB work, headers only");

  res.set({
    "Content-Type":   "image/gif",
    "Content-Length": String(PIXEL.length),
    "Cache-Control":  "no-store, no-cache, must-revalidate, private",
    Pragma:           "no-cache",
    Expires:          "0",
  });
  res.end();
});

router.get("/track/open/:trackingId", async (req, res): Promise<void> => {
  const { trackingId } = req.params;
  const ip = req.ip ?? null;
  const ua = req.get("user-agent") ?? null;
  const ts = new Date();

  // ── Step 1: Log every incoming request ──────────────────────────────────
  // Dumps the full IP chain so we can diagnose reverse-proxy trust issues.
  // If ip shows 127.0.0.1 here, NGINX is not forwarding X-Forwarded-For and
  // every open will be dropped by the private-IP filter at step 2a.
  logger.info({
    trackingId,
    ip,
    ua,
    timestamp:            ts.toISOString(),
    // Raw IP headers — lets us verify what Express sees vs what the proxy sends
    xForwardedFor:        req.headers["x-forwarded-for"]  ?? "(not set)",
    xRealIp:              req.headers["x-real-ip"]        ?? "(not set)",
    socketRemoteAddress:  (req.socket as any)?.remoteAddress ?? "(not set)",
    trustProxySetting:    req.app.get("trust proxy"),
  }, "[TRACK/OPEN] 1. Pixel request received");

  try {
    // ── Step 2: Filter false opens ─────────────────────────────────────────
    if (isPrivateIp(ip)) {
      logger.info({
        trackingId, ip,
        xForwardedFor: req.headers["x-forwarded-for"] ?? "(not set)",
        fix: "If this is a real open, NGINX is not forwarding the client IP. Add 'proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;' to your NGINX location block.",
      }, "[TRACK/OPEN] 2a. EXIT — Private/loopback IP — open ignored, serving pixel");
      sendPixel(res);
      return;
    }
    if (isBotUserAgent(ua)) {
      logger.info({ trackingId, ua, botReason: getBotReason(ua) },
        "[TRACK/OPEN] 2b. EXIT — Bot/prefetch user-agent — open ignored, serving pixel");
      sendPixel(res);
      return;
    }
    logger.info({ trackingId, ip, ua }, "[TRACK/OPEN] 2c. IP and UA checks passed — proceeding to DB lookup");

    // ── Step 3: Early isTest guard ────────────────────────────────────────
    const [queueCheck] = await db
      .select({ isTest: emailQueueTable.isTest })
      .from(emailQueueTable)
      .where(eq(emailQueueTable.trackingId, trackingId))
      .limit(1);

    logger.info({
      trackingId,
      queueCheckFound: !!queueCheck,
      isTest:          queueCheck?.isTest ?? null,
    }, "[TRACK/OPEN] 3. email_queue isTest lookup result");

    if (queueCheck?.isTest) {
      logger.info({ trackingId }, "[TRACK/OPEN] 3a. EXIT — Test email — open not recorded (isTest=true)");
      sendPixel(res);
      return;
    }

    // ── Step 4: Draft lookup by trackingId ────────────────────────────────
    let draft = await db
      .select({ id: draftsTable.id, sentAt: draftsTable.sentAt, gmailDraftId: draftsTable.gmailDraftId, leadId: draftsTable.leadId, userId: draftsTable.userId })
      .from(draftsTable)
      .where(eq(draftsTable.trackingId, trackingId))
      .then((rows: Array<{ id: number; sentAt: Date | null; gmailDraftId: string | null; leadId: number | null; userId: number }>) => rows[0]);

    // A row is an *unconfirmed Gmail draft* when its gmailDraftId is a raw Gmail API
    // draft ID (no synthetic prefix). Every SMTP/composer/recovery path always writes
    // a prefixed id ("smtp:", "smtp:recovered:", "smtp:retry:", "smtp:edit-resend:",
    // "gmail-composer:", "smtp-composer:") AND sets sentAt at insert time — so the
    // *only* rows that ever reach this handler with sentAt === null are real Gmail
    // drafts intentionally left unsent (see drafts.ts). Only gmailDraftSync may mark
    // those as sent.
    const isUnconfirmedGmailDraft = (d: { gmailDraftId: string | null } | undefined): boolean =>
      !!d?.gmailDraftId && !d.gmailDraftId.includes(":");

    logger.info({
      trackingId,
      draftFound:  !!draft,
      draftId:     draft?.id    ?? null,
      sentAt:      draft?.sentAt?.toISOString() ?? null,
      // sentAtNull=true means Gmail draft not yet "marked sent" — auto-heal will fire at step 6a
      sentAtNull:  draft ? draft.sentAt === null : null,
      isUnconfirmedGmailDraft: draft ? isUnconfirmedGmailDraft(draft) : null,
    }, "[TRACK/OPEN] 4. drafts table lookup result");

    // ── Step 5: SMTP fallback ─────────────────────────────────────────────
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
          status:     emailQueueTable.status,
        })
        .from(emailQueueTable)
        .where(and(
          eq(emailQueueTable.trackingId, trackingId),
          eq(emailQueueTable.status, "success"),
        ))
        .limit(1);

      logger.info({
        trackingId,
        queueItemFound:  !!queueItem,
        queueItemId:     queueItem?.id     ?? null,
        queueItemStatus: queueItem?.status ?? null,
        // If queueItemFound=false but email was sent, the queue row may not have
        // trackingId set (processor crashed before the critical UPDATE), or the
        // queue status is not "success". Check email_queue directly with this UUID.
      }, "[TRACK/OPEN] 5a. SMTP fallback queue lookup result");

      if (queueItem) {
        if (queueItem.isTest) {
          logger.info({ trackingId }, "[TRACK/OPEN] 5b. EXIT — Test email — open not recorded (lazy path)");
          sendPixel(res);
          return;
        }

        logger.info({ trackingId, queueItemId: queueItem.id },
          "[TRACK/OPEN] 5c. Lazy-creating draft row from SMTP queue item");
        try {
          const [lazyDraft] = await db.insert(draftsTable).values({
            userId:       queueItem.userId,
            campaignId:   queueItem.campaignId ?? null,
            leadId:       queueItem.leadId     ?? null,
            email:        queueItem.email,
            subject:      queueItem.subject ?? "",
            body:         "",
            status:       "success",
            trackingId,
            gmailDraftId: `smtp:recovered:${trackingId}`,
            sentAt:       new Date(),
          }).returning({ id: draftsTable.id, sentAt: draftsTable.sentAt, gmailDraftId: draftsTable.gmailDraftId, leadId: draftsTable.leadId, userId: draftsTable.userId });

          if (lazyDraft) {
            draft = lazyDraft;
            logger.info({ trackingId, draftId: lazyDraft.id, sentAt: lazyDraft.sentAt?.toISOString() ?? null },
              "[TRACK/OPEN] 5d. Lazy draft created successfully — will proceed to record event");
          } else {
            // returning() came back empty — insert may have silently no-op'd (e.g. conflict)
            logger.warn({ trackingId, queueItemId: queueItem.id },
              "[TRACK/OPEN] 5d-warn. Lazy insert returned no rows — draft may not have been created");
          }
        } catch (lazyErr) {
          logger.warn({ trackingId, lazyErr },
            "[TRACK/OPEN] 5e. EXIT PATH — Lazy-create draft failed — open cannot be recorded");
        }
      } else {
        logger.warn({
          trackingId, ip, ua,
          // Possible causes:
          // 1. trackingId not in email_queue at all (pixel URL is wrong / UUID mismatch)
          // 2. email_queue row exists but status != "success" (send failed)
          // 3. email_queue row exists but trackingId column is null (processor crashed before UPDATE)
        }, "[TRACK/OPEN] 5f. EXIT PATH — No draft or queue item found for trackingId — pixel served but open not recorded");
      }
    }

    if (!draft) {
      logger.warn({ trackingId },
        "[TRACK/OPEN] 6. EXIT PATH — No draft record available after all lookups — open not recorded");
    } else {
      // ── Step 6: Auto-activate tracking if sentAt is null ─────────────────
      if (!draft.sentAt && isUnconfirmedGmailDraft(draft)) {
        // This is a real Gmail draft the broker has not sent yet (or Gmail Draft Sync
        // has not confirmed as sent). Opening the draft preview in Gmail must NEVER
        // activate tracking — only gmailDraftSync is allowed to set sentAt for these.
        logger.info({ trackingId, draftId: draft.id, gmailDraftId: draft.gmailDraftId },
          "[TRACK/OPEN] 6f. EXIT PATH — Unconfirmed Gmail draft (not yet sent) — auto-heal SKIPPED, open not recorded");
      } else if (!draft.sentAt) {
        logger.info({ trackingId, draftId: draft.id },
          "[TRACK/OPEN] 6a. Draft sentAt is null (SMTP recovery case) — auto-activating now");
        try {
          await db.update(draftsTable)
            .set({ sentAt: ts })
            .where(eq(draftsTable.id, draft.id));
          draft = { ...draft, sentAt: ts };
          logger.info({ trackingId, draftId: draft.id, sentAt: ts.toISOString() },
            "[TRACK/OPEN] 6b. sentAt auto-set successfully — proceeding to record open");
        } catch (autoSetErr) {
          logger.error({ trackingId, draftId: draft.id, autoSetErr },
            "[TRACK/OPEN] 6c. EXIT PATH — Failed to auto-set sentAt — open cannot be recorded");
          draft = { ...draft, sentAt: null };
        }
      } else {
        // sentAt was already set (SMTP emails always have it; Gmail drafts have it after
        // being marked sent or after the first pixel auto-healed it)
        logger.info({ trackingId, draftId: draft.id, sentAt: draft.sentAt.toISOString() },
          "[TRACK/OPEN] 6e. Draft already has sentAt — no auto-heal needed, proceeding to dedup check");
      }

      if (!draft.sentAt) {
        logger.warn({ trackingId, draftId: draft.id },
          "[TRACK/OPEN] 6d. EXIT PATH — sentAt still null after auto-set attempt — open not recorded");
      } else {
        // ── Step 7: Deduplication ─────────────────────────────────────────
        const DEDUP_WINDOW_MS = 5_000;
        const windowStart = new Date(Date.now() - DEDUP_WINDOW_MS);
        const ipIncludedInDedup = !!ip;

        const conditions: any[] = [
          eq(emailTrackingEventsTable.draftId, draft.id),
          eq(emailTrackingEventsTable.eventType, "open"),
          gte(emailTrackingEventsTable.createdAt, windowStart),
        ];
        if (ip) {
          conditions.push(eq(emailTrackingEventsTable.ipAddress, ip));
        }

        logger.info({
          trackingId, draftId: draft.id,
          dedupWindowMs:      DEDUP_WINDOW_MS,
          windowStart:        windowStart.toISOString(),
          ipIncludedInDedup,
          ip,
          // If ipIncludedInDedup=false, dedup only checks draftId+eventType+window.
          // This is intentional (avoids blocking different openers behind the same proxy).
          // If ip is always null here, check trust proxy + NGINX X-Forwarded-For config.
        }, "[TRACK/OPEN] 7. Running dedup check");

        const [recent] = await db
          .select({ id: emailTrackingEventsTable.id })
          .from(emailTrackingEventsTable)
          .where(and(...conditions))
          .orderBy(desc(emailTrackingEventsTable.createdAt))
          .limit(1);

        if (recent) {
          logger.info({
            trackingId, draftId: draft.id, ip, ua,
            existingEventId: recent.id,
          }, "[TRACK/OPEN] 7a. EXIT PATH — Deduplicated open within 5s window — not recorded");
        } else {
          logger.info({ trackingId, draftId: draft.id, ip },
            "[TRACK/OPEN] 7b. Dedup check passed — no recent event found — proceeding to insert");

          // ── Step 8: Insert tracking event ──────────────────────────────
          logger.info({ trackingId, draftId: draft.id, ip, ua },
            "[TRACK/OPEN] 8. Inserting open event into email_tracking_events");
          try {
            const [insertedRow] = await db.insert(emailTrackingEventsTable).values({
              draftId:   draft.id,
              eventType: "open",
              ipAddress: ip,
              userAgent: ua,
            }).returning({ id: emailTrackingEventsTable.id });

            // Step 9: Confirm total open count for this draft
            const [{ openCount }] = await db
              .select({ openCount: count() })
              .from(emailTrackingEventsTable)
              .where(and(
                eq(emailTrackingEventsTable.draftId, draft.id),
                eq(emailTrackingEventsTable.eventType, "open"),
              ));

            // ── FIRST-OPEN DIAGNOSTIC ──────────────────────────────────────
            // Fires only when the very first open for this draft is recorded
            // (openCount === 1).  Captures every header and request field
            // needed to identify whether the requester is a real browser, a
            // Google scanner, an image proxy, or anything else.
            // gmailDraftId prefix ("gmail-composer:…" vs "smtp-composer:…")
            // shows which transport was used without needing extra DB queries.
            if (openCount === 1) {
              logger.info({
                tag:             "[FIRST-OPEN-DIAG]",
                trackingId,
                draftId:         draft.id,
                gmailDraftId:    draft.gmailDraftId,
                transport:       draft.gmailDraftId?.startsWith("gmail") ? "gmail" : "smtp",
                method:          req.method,
                ip,
                ua,
                referer:         req.get("referer")           ?? null,
                host:            req.get("host")              ?? null,
                accept:          req.get("accept")            ?? null,
                acceptLanguage:  req.get("accept-language")   ?? null,
                acceptEncoding:  req.get("accept-encoding")   ?? null,
                xForwardedFor:   req.get("x-forwarded-for")   ?? null,
                xRealIp:         req.get("x-real-ip")         ?? null,
                xForwardedHost:  req.get("x-forwarded-host")  ?? null,
                xForwardedProto: req.get("x-forwarded-proto") ?? null,
                via:             req.get("via")               ?? null,
                forwarded:       req.get("forwarded")         ?? null,
                allHeaders:      req.headers,
                sentAt:          draft.sentAt?.toISOString()  ?? null,
                msSinceSentAt:   draft.sentAt ? ts.getTime() - draft.sentAt.getTime() : null,
                timestamp:       ts.toISOString(),
              }, "[TRACK/OPEN] FIRST-OPEN DIAGNOSTIC — first open recorded, full request dump above");
            }

            logger.info({
              trackingId,
              draftId:        draft.id,
              insertedEventId: insertedRow?.id ?? null,
              openCount,
              ip,
              ua,
              timestamp:      ts.toISOString(),
            }, "[TRACK/OPEN] 9. SUCCESS — Open event inserted and confirmed");
            // Real-time: notify any open Communications page (fire-and-forget)
          } catch (insertErr) {
            logger.error({ trackingId, draftId: draft.id, insertErr },
              "[TRACK/OPEN] 9. EXIT PATH — FAILED to insert open event — DB error");
          }
        }
      }
    }
  } catch (err) {
    logger.error({ trackingId, err },
      "[TRACK/OPEN] ERROR — Unhandled exception in tracking handler, pixel still served");
  }

  // Step 10: Always serve pixel last, after all DB work
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
          .select({ id: draftsTable.id, leadId: draftsTable.leadId })
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
          // Real-time: notify any open Communications page about this click event
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
