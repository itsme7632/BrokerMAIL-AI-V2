/**
 * bounce-scanner.ts
 *
 * Scans mailbox INBOXes for DSN (Delivery Status Notification / bounce) messages
 * and marks the corresponding email_queue rows as "bounced".
 *
 * Deduplication is handled via the processed_bounces DB table.  The scanner
 * reads every matching NDR (regardless of IMAP \Seen flag), checks the table,
 * and skips any message whose (mailbox_id, message_id) pair is already present.
 * After successful processing it inserts the pair.  This replaces the previous
 * "mark as \Seen" approach which caused permanent misses whenever a mail client
 * pre-read bounce messages before the scanner ran.
 *
 * Called by the periodic watchdog in app.ts. Never throws — all errors are
 * logged and swallowed so the watchdog cannot be disrupted.
 */
import { ImapFlow } from "imapflow";
import {
  db,
  emailQueueTable,
  mailboxesTable,
  suppressionListTable,
  draftsTable,
  leadsTable,
  processedBouncesTable,
  emailTrackingEventsTable,
} from "@workspace/db";
import { and, eq, isNotNull, desc, count } from "drizzle-orm";
import { isPermanentBounce, extractBounceCode } from "./email-validator";
import { decrypt } from "./crypto";
import { logger } from "./logger";
import { getTrackingSettings } from "./tracking-settings";

// ---------------------------------------------------------------------------
// DSN / bounce message parsing helpers
// ---------------------------------------------------------------------------

/**
 * Extract the original bounced recipient address from a raw DSN message source.
 *
 * Priority order:
 *  1. RFC 3464 Final-Recipient / Original-Recipient headers (standard DSN)
 *  2. X-Failed-Recipients (Exim, Postfix)
 *  3. Angle-bracket email at start of line followed by colon — Google's
 *     "Message blocked" / spam-rejection plain-text format, e.g.:
 *       <user@example.com>:
 *       Message discarded as high-probability spam.
 *  4. "to <email>" or "unable to deliver.*to.*email" body patterns used by
 *     Microsoft, Yahoo, and other non-RFC-3464 notification formats.
 */
function extractBounceRecipient(source: string): string | null {
  const clean = (s: string) =>
    s.trim().toLowerCase().replace(/[<>]/g, "").split(/[,;\s]/)[0]!;

  const isValidAddr = (s: string) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length < 320;

  // ── RFC 3464: Final-Recipient: rfc822; user@example.com ───────────────────
  const m1 = source.match(/Final-Recipient:\s*rfc822;\s*([^\r\n]+)/i);
  if (m1) { const v = clean(m1[1]!); if (isValidAddr(v)) return v; }

  // ── RFC 3464: Original-Recipient: rfc822; user@example.com ───────────────
  const m2 = source.match(/Original-Recipient:\s*rfc822;\s*([^\r\n]+)/i);
  if (m2) { const v = clean(m2[1]!); if (isValidAddr(v)) return v; }

  // ── X-Failed-Recipients: user@example.com (Exim, Postfix) ─────────────────
  const m3 = source.match(/X-Failed-Recipients:\s*([^\r\n]+)/i);
  if (m3) { const v = clean(m3[1]!); if (isValidAddr(v)) return v; }

  // ── Google "Message blocked" format: <email>:\n reason ────────────────────
  // Matches an angle-bracket-wrapped email at the start of a line immediately
  // followed by a colon — the canonical Google spam-rejection NDR body format.
  const m4 = source.match(/^<([^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+)>:/m);
  if (m4) { const v = clean(m4[1]!); if (isValidAddr(v)) return v; }

  // ── Generic "to <email>" body patterns (Microsoft, Yahoo, others) ──────────
  // Covers: "your message to <email> could not", "failed to deliver to <email>"
  const m5 = source.match(/\bto\s+<([^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+)>/i);
  if (m5) { const v = clean(m5[1]!); if (isValidAddr(v)) return v; }

  return null;
}

/**
 * Extract a human-readable bounce reason from the DSN source.
 */
function extractBounceReason(source: string): string {
  // Diagnostic-Code: smtp; 550 5.1.1 User unknown
  const d = source.match(/Diagnostic-Code:\s*(?:smtp;\s*)?([^\r\n]+)/i);
  if (d) return d[1].trim().slice(0, 300);

  // Status: 5.1.1
  const s = source.match(/Status:\s*([\d.]+)/i);
  if (s) {
    const code = s[1];
    if (code.startsWith("5.1")) return `Bounced — address unknown (${code})`;
    if (code.startsWith("5.2")) return `Bounced — mailbox full / unavailable (${code})`;
    if (code.startsWith("5.")) return `Permanent delivery failure (${code})`;
    if (code.startsWith("4.")) return `Temporary delivery failure (${code})`;
    return `Delivery failure (${code})`;
  }

  // Subject of the bounce email (last resort)
  const subj = source.match(/^Subject:[ \t]*(.+?)[ \t]*$/im);
  if (subj) return subj[1].trim().slice(0, 200);

  return "Delivery bounce detected via IMAP";
}

/**
 * Extract the RFC 2822 Message-ID header value from a raw message source.
 * Returns null if the header is absent (should be rare for NDRs).
 */
function extractMessageId(source: string): string | null {
  const m = source.match(/^Message-ID:\s*([^\r\n]+)/im);
  if (!m) return null;
  return m[1].trim();
}

// ---------------------------------------------------------------------------
// Per-mailbox scanner
// ---------------------------------------------------------------------------

async function _scanMailbox(
  mailbox: {
    id: number;
    userId: number;
    imapHost: string;
    imapPort: number | null;
    imapUser: string;
    imapPassEncrypted: string;
  },
  overridePlainPass?: string,
): Promise<number> {
  let pass: string;
  if (overridePlainPass !== undefined) {
    pass = overridePlainPass;
  } else {
    try {
      pass = decrypt(mailbox.imapPassEncrypted);
    } catch {
      return 0;
    }
  }

  const port = mailbox.imapPort ?? 993;

  const client = new ImapFlow({
    host: mailbox.imapHost,
    port,
    secure: port === 993,
    auth: { user: mailbox.imapUser, pass },
    tls: { rejectUnauthorized: false },
    logger: false,
    connectionTimeout: 15_000,
    socketTimeout: 30_000,
  });

  client.on("error", () => {});

  let detected = 0;

  try {
    await client.connect();

    const lock = await client.getMailboxLock("INBOX");

    try {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000);

      // Search ALL bounce-pattern messages within the date window.
      // The \Seen flag is NOT consulted — deduplication is handled by the
      // processed_bounces DB table, which is immune to mail-client interference.
      const seqNums = await client.search({
        since,
        or: [
          { from: "MAILER-DAEMON" },
          { from: "postmaster" },
          { subject: "Delivery Status Notification" },
          { subject: "Mail delivery failed" },
          { subject: "Undelivered Mail" },
          { subject: "Failure Notice" },
          { subject: "Undeliverable" },
          { subject: "returned mail" },
          { subject: "Message blocked" },
          { subject: "Delivery failure" },
          { subject: "Mail Delivery Subsystem" },
        ],
      });

      const foundCount = Array.isArray(seqNums) ? seqNums.length : 0;
      logger.info(
        {
          mailboxId:   mailbox.id,
          imapUser:    mailbox.imapUser,
          found:       foundCount,
          willProcess: Math.min(foundCount, 50),
        },
        "[BOUNCE-SCAN-DEBUG] IMAP search complete — scanning all matching messages (seen+unseen), capped at 50 per cycle",
      );

      if (!seqNums || seqNums.length === 0) return 0;

      // Cap at 50 per scan cycle to avoid long-running IMAP sessions
      const range = seqNums.slice(0, 50);

      const messages = await client.fetchAll(range.join(","), {
        source: true,
      });

      logger.info(
        { mailboxId: mailbox.id, fetched: messages.length, processing: "all" },
        "[BOUNCE-SCAN-DEBUG] Messages fetched — iterating every message (no early exit)",
      );

      for (const msg of messages) {
        if (!msg.source) continue;

        const source = msg.source.toString("utf8");

        // ── Extract Message-ID for deduplication ─────────────────────────────
        const messageId = extractMessageId(source);

        const debugSubject = source.match(/^Subject:[ \t]*(.{0,120})/im)?.[1]?.trim() ?? "(no subject)";
        const debugFrom    = source.match(/^From:[ \t]*(.{0,120})/im)?.[1]?.trim()    ?? "(no from)";

        logger.info(
          {
            mailboxId: mailbox.id,
            seq:       msg.seq,
            messageId: messageId ?? "(missing)",
            from:      debugFrom,
            subject:   debugSubject,
          },
          "[BOUNCE-SCAN-DEBUG] Bounce email found — checking processed_bounces",
        );

        // ── Deduplication check ───────────────────────────────────────────────
        // Skip messages with no Message-ID only if we have genuinely no way to
        // deduplicate them — log a warning but still attempt processing (the
        // insert at the end will handle the duplicate if Message-ID is later
        // present). If messageId is null, we cannot record it, so we process
        // but cannot prevent re-processing; this is an edge case for malformed
        // NDRs and is logged explicitly.
        if (messageId) {
          const [existing] = await db
            .select({ id: processedBouncesTable.id })
            .from(processedBouncesTable)
            .where(
              and(
                eq(processedBouncesTable.mailboxId, mailbox.id),
                eq(processedBouncesTable.messageId, messageId),
              ),
            )
            .limit(1);

          if (existing) {
            logger.info(
              {
                mailboxId: mailbox.id,
                seq:       msg.seq,
                messageId,
              },
              "[BOUNCE-SCAN-DEBUG] Already processed — skipped (found in processed_bounces)",
            );
            continue;
          }
        } else {
          logger.warn(
            { mailboxId: mailbox.id, seq: msg.seq, subject: debugSubject },
            "[BOUNCE-SCAN-DEBUG] Message-ID missing — cannot deduplicate; processing anyway",
          );
        }

        const recipient = extractBounceRecipient(source);

        if (!recipient) {
          const hasRfc3464   = /Final-Recipient|Original-Recipient/i.test(source);
          const hasXFailed   = /X-Failed-Recipients/i.test(source);
          const hasAngleLine = /^<[^\s@<>]+@[^\s@<>]+>/m.test(source);
          const hasToAngle   = /\bto\s+<[^\s@<>]+@[^\s@<>]+>/i.test(source);
          logger.warn(
            {
              mailboxId: mailbox.id,
              seq:       msg.seq,
              messageId: messageId ?? "(missing)",
              subject:   debugSubject,
              from:      debugFrom,
              triedPatterns: { rfc3464: hasRfc3464, xFailed: hasXFailed, angleLine: hasAngleLine, toAngle: hasToAngle },
              sourceSnippet: source.slice(0, 400).replace(/\r?\n/g, " | "),
            },
            "[BOUNCE-SCAN-DEBUG] SKIPPED — no recipient could be extracted from this message",
          );
          continue;
        }

        logger.info(
          { mailboxId: mailbox.id, seq: msg.seq, messageId: messageId ?? "(missing)", recipient },
          "[BOUNCE-SCAN-DEBUG] Recipient extracted",
        );

        const reason    = extractBounceReason(source);
        const permanent = isPermanentBounce(reason);

        logger.info(
          {
            mailboxId:      mailbox.id,
            seq:            msg.seq,
            messageId:      messageId ?? "(missing)",
            recipient,
            reason,
            classification: permanent ? "PERMANENT" : "TEMPORARY",
          },
          `[BOUNCE-SCAN-DEBUG] Bounce reason — ${permanent ? "PERMANENT (suppression eligible)" : "TEMPORARY (suppression skipped)"}`,
        );

        // Find the most-recently-sent (status=success) email to this address.
        // ORDER BY sentAt DESC so we match the most-recent email, never an older one.
        // When scanning the admin bounce mailbox (userId < 0), search across all users.
        const whereConditions = mailbox.userId > 0
          ? and(
              eq(emailQueueTable.userId, mailbox.userId),
              eq(emailQueueTable.email, recipient),
              eq(emailQueueTable.status, "success"),
            )
          : and(
              eq(emailQueueTable.email, recipient),
              eq(emailQueueTable.status, "success"),
            );

        const [item] = await db
          .select({
            id:         emailQueueTable.id,
            userId:     emailQueueTable.userId,
            campaignId: emailQueueTable.campaignId,
            trackingId: emailQueueTable.trackingId,
          })
          .from(emailQueueTable)
          .where(whereConditions)
          .orderBy(desc(emailQueueTable.sentAt))
          .limit(1);

        let bounceRecorded = false;

        if (item) {
          // ── SAFETY CHECK: Never bounce an email that has open/click events ──
          // If the recipient actually opened the email (tracking pixel fired), it
          // reached the inbox. A bounce NDR for the same address must be spurious,
          // stale, or a false match. Log it for review and skip the update.
          let openEventCount = 0;
          if (item.trackingId) {
            try {
              const [draftRow] = await db
                .select({ id: draftsTable.id })
                .from(draftsTable)
                .where(eq(draftsTable.trackingId, item.trackingId))
                .limit(1);

              if (draftRow) {
                const [{ total }] = await db
                  .select({ total: count() })
                  .from(emailTrackingEventsTable)
                  .where(
                    and(
                      eq(emailTrackingEventsTable.draftId, draftRow.id),
                      eq(emailTrackingEventsTable.eventType, "open"),
                    ),
                  );
                openEventCount = total ?? 0;
              }
            } catch (checkErr) {
              logger.warn(
                { checkErr, emailQueueId: item.id },
                "[BOUNCE-SCAN] Could not check open events — proceeding with bounce (safe side)",
              );
            }
          }

          if (openEventCount > 0) {
            // Email was definitively opened — this bounce is a false positive.
            // Do NOT mark as bounced. Log everything for diagnosis.
            logger.error(
              {
                mailboxId:        mailbox.id,
                seq:              msg.seq,
                bounceMessageId:  messageId ?? "(missing)",
                recipient,
                emailQueueId:     item.id,
                trackingId:       item.trackingId ?? "(none)",
                openEventCount,
                bounceReason:     reason,
                action:           "SKIPPED — false positive bounce suppressed",
              },
              "[BOUNCE-SCAN] FALSE POSITIVE DETECTED: bounce NDR received for email that has open tracking events. " +
              "Email was delivered and opened. Bounce NOT recorded. Flagged for review.",
            );
            // Record in processed_bounces with messageId so we don't re-process
            // this NDR, but do not touch email_queue status.
            if (messageId) {
              try {
                await db.insert(processedBouncesTable).values({
                  mailboxId:   mailbox.id,
                  messageId,
                  recipient:   recipient + ":FALSE_POSITIVE",
                }).onConflictDoNothing();
              } catch { /* non-fatal */ }
            }
            continue;
          }

          await db
            .update(emailQueueTable)
            .set({
              status:    "bounced",
              lastError: reason,
              bounceAt:  new Date(),
            })
            .where(eq(emailQueueTable.id, item.id));

          detected++;
          bounceRecorded = true;

          logger.info(
            {
              mailboxId:    mailbox.id,
              seq:          msg.seq,
              messageId:    messageId ?? "(missing)",
              recipient,
              emailQueueId: item.id,
              trackingId:   item.trackingId ?? "(none)",
              openEvents:   openEventCount,
              source:       "email_queue",
            },
            "[BOUNCE-SCAN-DEBUG] Bounce processed — email_queue row updated to bounced",
          );

          if (reason && permanent) {
            try {
              await db.insert(suppressionListTable).values({
                userId:     item.userId,
                email:      recipient,
                reason:     reason.slice(0, 300),
                bounceCode: extractBounceCode(reason),
                campaignId: item.campaignId ?? null,
              }).onConflictDoNothing();

              logger.info(
                {
                  mailboxId: mailbox.id,
                  seq:       msg.seq,
                  messageId: messageId ?? "(missing)",
                  recipient,
                  reason:    reason.slice(0, 120),
                  source:    "email_queue",
                },
                "[BOUNCE-SCAN-DEBUG] Suppression inserted — email added to suppression list (via email_queue path)",
              );
            } catch {
              // non-fatal — suppression insert failure must never disrupt scanning
            }
          }
        } else {
          // ── Gmail-draft fallback ───────────────────────────────────────────
          // Gmail-draft campaigns never write to email_queue (they write to
          // draftsTable only). When the user manually sends a draft from Gmail
          // and it bounces, the bounce appears in the IMAP inbox but there is no
          // email_queue row to update. Fall back to draftsTable so those bounces
          // are still detected and suppressed.
          logger.info(
            { mailboxId: mailbox.id, seq: msg.seq, messageId: messageId ?? "(missing)", recipient },
            "[BOUNCE-SCAN-DEBUG] No email_queue row found — trying Gmail-draft fallback (draftsTable)",
          );

          const draftWhereConditions = mailbox.userId > 0
            ? and(
                eq(draftsTable.userId, mailbox.userId),
                eq(draftsTable.email!, recipient),
                eq(draftsTable.status, "success"),
              )
            : and(
                eq(draftsTable.email!, recipient),
                eq(draftsTable.status, "success"),
              );

          const [draft] = await db
            .select({
              id:         draftsTable.id,
              userId:     draftsTable.userId,
              campaignId: draftsTable.campaignId,
              leadId:     draftsTable.leadId,
            })
            .from(draftsTable)
            .where(draftWhereConditions)
            .orderBy(desc(draftsTable.createdAt))
            .limit(1);

          if (draft) {
            // ── SAFETY CHECK: Never bounce a draft that has open/click events ──
            // draftsTable.id is the direct FK used by emailTrackingEventsTable.draftId,
            // so we can query open events without an intermediate lookup.
            let draftOpenEventCount = 0;
            try {
              const [{ total: draftOpenTotal }] = await db
                .select({ total: count() })
                .from(emailTrackingEventsTable)
                .where(
                  and(
                    eq(emailTrackingEventsTable.draftId, draft.id),
                    eq(emailTrackingEventsTable.eventType, "open"),
                  ),
                );
              draftOpenEventCount = draftOpenTotal ?? 0;
            } catch (checkErr) {
              logger.warn(
                { checkErr, draftId: draft.id },
                "[BOUNCE-SCAN] Could not check open events for draft — proceeding with bounce (safe side)",
              );
            }

            if (draftOpenEventCount > 0) {
              logger.error(
                {
                  mailboxId:       mailbox.id,
                  seq:             msg.seq,
                  bounceMessageId: messageId ?? "(missing)",
                  recipient,
                  draftId:         draft.id,
                  draftOpenEvents: draftOpenEventCount,
                  bounceReason:    reason,
                  action:          "SKIPPED — false positive bounce suppressed (draft path)",
                },
                "[BOUNCE-PROTECT] FALSE POSITIVE DETECTED (draft path): bounce NDR received for draft that has open tracking events. " +
                "Email was delivered and opened. Bounce NOT recorded.",
              );
              if (messageId) {
                try {
                  await db.insert(processedBouncesTable).values({
                    mailboxId: mailbox.id,
                    messageId,
                    recipient: recipient + ":FALSE_POSITIVE",
                  }).onConflictDoNothing();
                } catch { /* non-fatal */ }
              }
              continue;
            }

            try {
              await db
                .update(draftsTable)
                .set({ status: "bounced", errorMessage: reason.slice(0, 300) })
                .where(eq(draftsTable.id, draft.id));
            } catch { /* non-fatal */ }

            if (draft.leadId) {
              try {
                await db
                  .update(leadsTable)
                  .set({ status: "failed", errorMessage: reason.slice(0, 300), updatedAt: new Date() })
                  .where(eq(leadsTable.id, draft.leadId));
              } catch { /* non-fatal */ }
            }

            detected++;
            bounceRecorded = true;

            logger.info(
              {
                mailboxId:       mailbox.id,
                seq:             msg.seq,
                messageId:       messageId ?? "(missing)",
                recipient,
                draftId:         draft.id,
                draftOpenEvents: draftOpenEventCount,
                source:          "drafts_fallback",
              },
              "[BOUNCE-SCAN-DEBUG] Bounce processed — drafts row updated to bounced",
            );

            if (reason && permanent) {
              try {
                await db.insert(suppressionListTable).values({
                  userId:     draft.userId,
                  email:      recipient,
                  reason:     reason.slice(0, 300),
                  bounceCode: extractBounceCode(reason),
                  campaignId: draft.campaignId ?? null,
                }).onConflictDoNothing();

                logger.info(
                  {
                    mailboxId: mailbox.id,
                    seq:       msg.seq,
                    messageId: messageId ?? "(missing)",
                    recipient,
                    reason:    reason.slice(0, 120),
                    source:    "drafts_fallback",
                  },
                  "[BOUNCE-SCAN-DEBUG] Suppression inserted — email added to suppression list (via Gmail-draft fallback path)",
                );
              } catch {
                // non-fatal
              }
            }
          } else {
            logger.warn(
              { mailboxId: mailbox.id, seq: msg.seq, messageId: messageId ?? "(missing)", recipient },
              "[BOUNCE-SCAN-DEBUG] SKIPPED — recipient not found in email_queue OR draftsTable (may be from a different account or already bounced)",
            );
          }
        }

        // ── Record in processed_bounces so this message is skipped on future cycles ──
        // Only record when bounce processing completed (email_queue or draft updated).
        // Messages skipped due to extraction failure or no matching row are NOT recorded
        // so they can be retried if data becomes available later (e.g., delayed send).
        if (bounceRecorded && messageId) {
          try {
            await db.insert(processedBouncesTable).values({
              mailboxId:   mailbox.id,
              messageId,
              recipient,
            }).onConflictDoNothing();

            logger.info(
              {
                mailboxId: mailbox.id,
                seq:       msg.seq,
                messageId,
                recipient,
              },
              "[BOUNCE-SCAN-DEBUG] Bounce recorded in processed_bounces — will be skipped on future scans",
            );
          } catch {
            // non-fatal — worst case is the message is re-processed next cycle,
            // which is safe because email_queue.status is already "bounced" and
            // suppressionListTable uses onConflictDoNothing()
          }
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    client.logout().catch(() => {});
  }

  return detected;
}

// ---------------------------------------------------------------------------
// Public entry point — called by the watchdog in app.ts
// ---------------------------------------------------------------------------

/**
 * Scan all IMAP-configured mailboxes for bounce messages and update
 * email_queue accordingly. Returns the total number of bounces detected.
 * Never throws.
 */
export async function runBounceScanner(): Promise<void> {
  try {
    const mailboxes = await db
      .select({
        id:                mailboxesTable.id,
        userId:            mailboxesTable.userId,
        imapHost:          mailboxesTable.imapHost,
        imapPort:          mailboxesTable.imapPort,
        imapUser:          mailboxesTable.imapUser,
        imapPassEncrypted: mailboxesTable.imapPassEncrypted,
      })
      .from(mailboxesTable)
      .where(
        and(
          isNotNull(mailboxesTable.imapHost),
          isNotNull(mailboxesTable.imapUser),
          isNotNull(mailboxesTable.imapPassEncrypted),
        ),
      );

    for (const mbox of mailboxes) {
      if (
        !mbox.imapHost ||
        !mbox.imapUser ||
        !mbox.imapPassEncrypted
      ) continue;

      try {
        const count = await _scanMailbox(
          mbox as {
            id: number;
            userId: number;
            imapHost: string;
            imapPort: number | null;
            imapUser: string;
            imapPassEncrypted: string;
          },
        );
        if (count > 0) {
          logger.info(
            { mailboxId: mbox.id, userId: mbox.userId, count },
            "[BOUNCE-SCAN] Bounces detected and marked",
          );
        }
      } catch (err) {
        logger.warn(
          { err, mailboxId: mbox.id },
          "[BOUNCE-SCAN] Per-mailbox scan failed (non-fatal)",
        );
      }
    }
  } catch (err) {
    logger.warn({ err }, "[BOUNCE-SCAN] Scanner skipped (non-fatal)");
  }

  // ── Admin-configured dedicated bounce mailbox ──────────────────────────────
  try {
    const ts = await getTrackingSettings();
    if (ts.bounceEnabled && ts.bounceImapHost && ts.bounceImapUser && ts.bounceImapPass) {
      const adminCount = await _scanMailbox(
        {
          id:                -1,
          userId:            -1,
          imapHost:          ts.bounceImapHost,
          imapPort:          ts.bounceImapPort,
          imapUser:          ts.bounceImapUser,
          imapPassEncrypted: "",
        },
        ts.bounceImapPass,
      );
      if (adminCount > 0) {
        logger.info({ count: adminCount }, "[BOUNCE-SCAN] Admin bounce mailbox: bounces detected and marked");
      }
    }
  } catch (err) {
    logger.warn({ err }, "[BOUNCE-SCAN] Admin bounce mailbox scan failed (non-fatal)");
  }
}
