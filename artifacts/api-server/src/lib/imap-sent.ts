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
 *
 * Fidelity: uses nodemailer's own streamTransport to produce the exact same
 * RFC 822 bytes that the SMTP send transmitted — same MIME structure, same
 * Message-ID (preserving reply threading in Outlook), same attachments.
 */
import nodemailer from "nodemailer";
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

// ─── Message options ──────────────────────────────────────────────────────────

export interface AppendEmailOpts {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  text: string;
  html: string;
  /** The Message-ID returned by sendEmail(). Pass it to preserve exact threading. */
  messageId?: string;
  /** Timestamp of the SMTP send. Defaults to now. */
  date?: Date;
  /** Attachments from the Compose route. Passed through to nodemailer unchanged. */
  attachments?: Array<{ filename: string; content: Buffer; contentType: string }>;
}

// ─── RFC 822 builder via nodemailer streamTransport ───────────────────────────

/**
 * Use nodemailer's own MIME engine to produce the exact same RFC 822 bytes
 * that were transmitted via SMTP:
 *   - Same Message-ID (pass info.messageId from sendEmail to preserve threading)
 *   - Same MIME structure (multipart/mixed when attachments present, etc.)
 *   - Same Content-Transfer-Encoding decisions
 *   - Same attachment payloads
 *
 * CRLF line endings (newline: 'windows') per RFC 3501 §6.3.11 APPEND.
 */
async function buildExactRfc822(
  from: string,
  opts: AppendEmailOpts,
  replyTo?: string,
): Promise<Buffer> {
  const streamTransport = nodemailer.createTransport({
    streamTransport: true,
    newline: "windows", // CRLF required by RFC 3501 APPEND
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: any = await streamTransport.sendMail({
    from,
    to:      opts.to,
    cc:      opts.cc,
    bcc:     opts.bcc,
    subject: opts.subject,
    text:    opts.text,
    html:    opts.html,
    replyTo,
    // Preserve the exact Message-ID from the SMTP send so that recipient
    // replies (which carry In-Reply-To / References headers pointing at this
    // Message-ID) thread correctly inside Outlook's Sent folder.
    messageId: opts.messageId,
    date:      opts.date ?? new Date(),
    ...(opts.attachments?.length
      ? {
          attachments: opts.attachments.map(a => ({
            filename:    a.filename,
            content:     a.content,
            contentType: a.contentType,
          })),
        }
      : {}),
  });

  // Drain the PassThrough stream into a Buffer
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    result.message.on("data",  (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    result.message.on("end",   resolve);
    result.message.on("error", reject);
  });

  return Buffer.concat(chunks);
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
  sentAt: Date,
  context: Record<string, unknown> = {},
): Promise<void> {
  const pass  = decrypt(creds.imapPassEncrypted);
  const isSSL = creds.imapSecure === "ssl";

  const client = new ImapFlow({
    host:              creds.imapHost,
    port:              creds.imapPort,
    secure:            isSSL, // true = implicit TLS (993); false = STARTTLS or plain (143)
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
        imapHost:         creds.imapHost,
        imapUser:         creds.imapUser,
        availableFolders: mailboxList.map(m => m.path),
      }, "[IMAP-SENT] Could not locate Sent folder — message not appended");
      return;
    }

    // Append with \Seen flag and the send timestamp so Outlook shows the
    // correct time rather than the append time
    await client.append(sentPath, rawMessage, ["\\Seen"], sentAt);
    logger.info({ ...context, sentPath, imapHost: creds.imapHost },
      "[IMAP-SENT] Message appended to Sent folder");
  } finally {
    try { await client.logout(); } catch { /* ignore logout errors */ }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Non-fatal wrapper: build the exact RFC 822 bytes (via nodemailer streamTransport)
 * and append them to the mailbox's IMAP Sent folder.
 *
 * Pass messageId from sendEmail's return value to preserve reply threading.
 * Pass attachments from the Compose route so the Sent copy includes them.
 * Silently no-ops if IMAP is not configured. Never throws.
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

  const sentAt = opts.date ?? new Date();

  try {
    const rawMessage = await buildExactRfc822(from, opts, mailbox.replyTo ?? undefined);
    await appendToSentFolder(
      {
        imapHost:          mailbox.imapHost,
        imapPort:          mailbox.imapPort ?? 993,
        imapUser:          mailbox.imapUser,
        imapPassEncrypted: mailbox.imapPassEncrypted,
        imapSecure:        mailbox.imapSecure ?? "ssl",
      },
      rawMessage,
      sentAt,
      context,
    );
  } catch (err) {
    logger.warn({ err, ...context, imapHost: mailbox.imapHost },
      "[IMAP-SENT] Non-fatal: failed to append message to Sent folder");
  }
}
