/**
 * bounce-scanner.ts
 *
 * Scans mailbox INBOXes for DSN (Delivery Status Notification / bounce) messages
 * and marks the corresponding email_queue rows as "bounced".
 *
 * Called by the periodic watchdog in app.ts. Never throws — all errors are
 * logged and swallowed so the watchdog cannot be disrupted.
 */
import { ImapFlow } from "imapflow";
import {
  db,
  emailQueueTable,
  mailboxesTable,
} from "@workspace/db";
import { and, eq, isNotNull } from "drizzle-orm";
import { decrypt } from "./crypto";
import { logger } from "./logger";
import { getTrackingSettings } from "./tracking-settings";

// ---------------------------------------------------------------------------
// DSN / bounce message parsing helpers
// ---------------------------------------------------------------------------

/**
 * Extract the original bounced recipient address from a raw DSN message source.
 * Supports RFC 3464 (Final-Recipient / Original-Recipient headers) and
 * common proprietary headers used by major mail servers.
 */
function extractBounceRecipient(source: string): string | null {
  const clean = (s: string) =>
    s.trim().toLowerCase().replace(/[<>]/g, "").split(/[,;\s]/)[0];

  // RFC 3464: Final-Recipient: rfc822; user@example.com
  const m1 = source.match(/Final-Recipient:\s*rfc822;\s*([^\r\n]+)/i);
  if (m1) return clean(m1[1]);

  // RFC 3464: Original-Recipient: rfc822; user@example.com
  const m2 = source.match(/Original-Recipient:\s*rfc822;\s*([^\r\n]+)/i);
  if (m2) return clean(m2[1]);

  // X-Failed-Recipients: user@example.com (Exim, Postfix)
  const m3 = source.match(/X-Failed-Recipients:\s*([^\r\n]+)/i);
  if (m3) return clean(m3[1]);

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

      // Search for unseen DSN / bounce messages using common patterns.
      // Top-level criteria are AND'd; the or[] criteria are OR'd.
      const seqNums = await client.search({
        seen: false,
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
        ],
      });

      if (!seqNums || seqNums.length === 0) return 0;

      // Cap at 50 per scan cycle to avoid long-running IMAP sessions
      const range = seqNums.slice(0, 50);

      const messages = await client.fetchAll(range.join(","), {
        source: true,
      });

      for (const msg of messages) {
        if (!msg.source) continue;

        const source = msg.source.toString("utf8");
        const recipient = extractBounceRecipient(source);
        if (!recipient) continue;

        const reason = extractBounceReason(source);

        // Find the most-recently-sent (status=success) email to this address.
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
          .select({ id: emailQueueTable.id })
          .from(emailQueueTable)
          .where(whereConditions)
          .limit(1);

        if (item) {
          await db
            .update(emailQueueTable)
            .set({
              status: "bounced",
              lastError: reason,
              bounceAt: new Date(),
            })
            .where(eq(emailQueueTable.id, item.id));
          detected++;
        }

        // Mark the DSN message as seen so it is not re-processed on the next scan
        await client.messageFlagsAdd(
          { seq: String(msg.seq) },
          ["\\Seen"],
        );
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
        id: mailboxesTable.id,
        userId: mailboxesTable.userId,
        imapHost: mailboxesTable.imapHost,
        imapPort: mailboxesTable.imapPort,
        imapUser: mailboxesTable.imapUser,
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
