/**
 * imap-sent.ts — Append sent messages to the mailbox Sent folder via IMAP.
 *
 * This module is ONLY for appending sent messages. It does NOT implement:
 * - Inbox synchronization
 * - Email reading
 * - Threading or conversation storage
 * - Background IMAP sync
 *
 * All operations are non-fatal: SMTP send success is never affected by IMAP errors.
 */
import { ImapFlow } from "imapflow";
import { decrypt } from "./crypto";
import { logger } from "./logger";
import type { Mailbox } from "@workspace/db";

// ─── Common Sent folder names (tried in order when SPECIAL-USE not available) ─
const SENT_FOLDER_CANDIDATES = [
  "Sent",
  "Sent Items",
  "Sent Mail",
  "INBOX.Sent",
  "INBOX.Sent Items",
];

// ─── RFC 822 message builder ──────────────────────────────────────────────────

export interface AppendEmailOpts {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
  date?: Date;
}

/**
 * Build a minimal RFC 822 / MIME message buffer suitable for IMAP APPEND.
 * Uses base64 content-transfer-encoding for both text and HTML parts.
 * No external dependencies — pure Node.js Buffer / string operations.
 */
function buildRfc822(from: string, opts: AppendEmailOpts): Buffer {
  const boundary = `_bm_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const date = (opts.date ?? new Date()).toUTCString();

  // Encode subject as UTF-8 Base64 if non-ASCII characters are present
  const subjectEncoded = /[^\x00-\x7F]/.test(opts.subject)
    ? `=?UTF-8?B?${Buffer.from(opts.subject, "utf-8").toString("base64")}?=`
    : opts.subject;

  const toBase64Lines = (s: string): string =>
    Buffer.from(s, "utf-8")
      .toString("base64")
      .match(/.{1,76}/g)
      ?.join("\r\n") ?? "";

  const headers: string[] = [
    `From: ${from}`,
    `To: ${opts.to}`,
    ...(opts.cc  ? [`CC: ${opts.cc}`]  : []),
    ...(opts.bcc ? [`BCC: ${opts.bcc}`] : []),
    ...(opts.replyTo ? [`Reply-To: ${opts.replyTo}`] : []),
    `Subject: ${subjectEncoded}`,
    `Date: ${date}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];

  const body: string[] = [
    "",
    `--${boundary}`,
    `Content-Type: text/plain; charset=UTF-8`,
    `Content-Transfer-Encoding: base64`,
    "",
    toBase64Lines(opts.text),
    "",
    `--${boundary}`,
    `Content-Type: text/html; charset=UTF-8`,
    `Content-Transfer-Encoding: base64`,
    "",
    toBase64Lines(opts.html),
    "",
    `--${boundary}--`,
    "",
  ];

  return Buffer.from([...headers, ...body].join("\r\n"), "utf-8");
}

// ─── Core IMAP append ─────────────────────────────────────────────────────────

interface ImapCredentials {
  imapHost: string;
  imapPort: number;
  imapUser: string;
  imapPassEncrypted: string;
  imapSecure: string; // 'ssl' | 'tls' | 'none'
}

async function appendToSentFolder(
  creds: ImapCredentials,
  rawMessage: Buffer,
  context: Record<string, unknown> = {},
): Promise<void> {
  const pass   = decrypt(creds.imapPassEncrypted);
  const isSSL  = creds.imapSecure === "ssl";

  const client = new ImapFlow({
    host:              creds.imapHost,
    port:              creds.imapPort,
    secure:            isSSL,  // true = implicit TLS (993); false = STARTTLS or plain (143)
    auth:              { user: creds.imapUser, pass },
    tls:               { rejectUnauthorized: false },
    logger:            false,
    connectionTimeout: 15_000,
    greetingTimeout:   15_000,
    socketTimeout:     30_000,
  });

  await client.connect();

  try {
    const mailboxList = await client.list();

    // 1. Try RFC 6154 SPECIAL-USE \Sent attribute first (most reliable)
    let sentPath: string | undefined = mailboxList.find(mb =>
      mb.specialUse === "\\Sent" ||
      (mb.flags instanceof Set && (mb.flags as Set<string>).has("\\Sent"))
    )?.path;

    // 2. Fall back to common name matching
    if (!sentPath) {
      for (const candidate of SENT_FOLDER_CANDIDATES) {
        const found = mailboxList.find(mb =>
          mb.path.toLowerCase() === candidate.toLowerCase() ||
          mb.name.toLowerCase() === candidate.toLowerCase()
        );
        if (found) { sentPath = found.path; break; }
      }
    }

    if (!sentPath) {
      logger.warn({
        ...context,
        imapHost: creds.imapHost,
        imapUser: creds.imapUser,
        availableFolders: mailboxList.map(m => m.path),
      }, "[IMAP-SENT] Could not locate Sent folder — message not appended");
      return;
    }

    await client.append(sentPath, rawMessage, ["\\Seen"], new Date());
    logger.info({ ...context, sentPath, imapHost: creds.imapHost },
      "[IMAP-SENT] Message appended to Sent folder");
  } finally {
    try { await client.logout(); } catch { /* ignore logout errors */ }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Non-fatal wrapper: build a raw RFC 822 message and append it to the
 * mailbox's Sent folder via IMAP. Silently no-ops if IMAP is not configured.
 * Never throws — SMTP send success is never affected by this call.
 */
export async function tryAppendToSent(
  mailbox: Mailbox,
  opts: AppendEmailOpts,
  context: Record<string, unknown> = {},
): Promise<void> {
  if (!mailbox.imapHost || !mailbox.imapUser || !mailbox.imapPassEncrypted) return;

  const from = mailbox.fromName
    ? `"${mailbox.fromName.replace(/"/g, "")}" <${mailbox.smtpUser}>`
    : mailbox.smtpUser;

  try {
    const rawMessage = buildRfc822(from, {
      ...opts,
      replyTo: mailbox.replyTo ?? undefined,
    });
    await appendToSentFolder(
      {
        imapHost:          mailbox.imapHost,
        imapPort:          mailbox.imapPort ?? 993,
        imapUser:          mailbox.imapUser,
        imapPassEncrypted: mailbox.imapPassEncrypted,
        imapSecure:        mailbox.imapSecure ?? "ssl",
      },
      rawMessage,
      context,
    );
  } catch (err) {
    logger.warn({ err, ...context, imapHost: mailbox.imapHost },
      "[IMAP-SENT] Non-fatal: failed to append message to Sent folder");
  }
}
