import { ImapFlow } from "imapflow";
import type { Mailbox } from "@workspace/db";
import { decrypt } from "./crypto";

export interface ImapCredentials {
  imapHost: string;
  imapPort: number;
  imapUser: string;
  imapPassEncrypted: string;
  rawPass?: string;
}

/** Verify an IMAP connection by connecting + logging out. */
export async function testImap(creds: ImapCredentials): Promise<void> {
  const pass = creds.rawPass ?? decrypt(creds.imapPassEncrypted);
  const client = new ImapFlow({
    host: creds.imapHost,
    port: creds.imapPort,
    secure: creds.imapPort === 993,
    auth: { user: creds.imapUser, pass },
    tls: { rejectUnauthorized: false },
    logger: false,
  });
  // Prevent unhandled EventEmitter errors from crashing Node.js
  client.on("error", () => {});
  try {
    await client.connect();
    await client.logout();
  } catch {
    try { client.close(); } catch { }
    throw new Error("IMAP connection failed — check host, port, username, and password.");
  }
}

/**
 * Append a raw RFC2822 message to the Sent folder.
 *
 * NEVER throws or rejects — SMTP delivery must not be blocked by IMAP.
 *
 * Detection order:
 *  1. Folder with \Sent special-use flag (RFC 6154 — Outlook/Office365, Gmail, Zoho).
 *  2. Case-insensitive name match: "Sent Items", "Sent Mail", "Sent", "INBOX.Sent", etc.
 *
 * Crash-safety: ImapFlow can emit 'error' events from its internal TLS socket
 * handler. These are EventEmitter errors — they bypass Promise .catch() and crash
 * Node.js as uncaughtExceptions. client.on('error', () => {}) is the mandatory fix.
 */
export async function saveToSent(mailbox: Mailbox, rawMessage: Buffer): Promise<void> {
  if (!mailbox.imapHost || !mailbox.imapUser || !mailbox.imapPassEncrypted) return;

  // Wrap in a separate async function and swallow ALL errors so nothing
  // — including EventEmitter errors set up before connection — can surface.
  try {
    await _appendToSent(mailbox, rawMessage);
  } catch {
    // Best-effort — SMTP has already succeeded.
  }
}

async function _appendToSent(mailbox: Mailbox, rawMessage: Buffer): Promise<void> {
  const pass = decrypt(mailbox.imapPassEncrypted);
  const port = mailbox.imapPort ?? 993;

  const client = new ImapFlow({
    host: mailbox.imapHost,
    port,
    secure: port === 993,
    auth: { user: mailbox.imapUser, pass },
    tls: { rejectUnauthorized: false },
    logger: false,
    // Generous timeouts for slow servers; fire-and-forget so latency is fine.
    connectionTimeout: 15_000,
    socketTimeout: 25_000,
  });

  // ─── CRITICAL ──────────────────────────────────────────────────────────────
  // ImapFlow throws from inside its TLS socket EventEmitter when the server
  // closes the connection mid-flight. That error is NOT a Promise rejection —
  // it is an unhandled 'error' event that becomes an uncaughtException and
  // kills the Node.js process. Registering this no-op listener makes the
  // EventEmitter handle it safely so our try/catch can do its job.
  client.on("error", () => {});
  // ───────────────────────────────────────────────────────────────────────────

  try {
    await client.connect();

    // Priority-ordered candidates — first match wins.
    // Outlook/Office 365 = "Sent Items" (also exposes \Sent special-use flag).
    // Outlook.com personal = "Sent".
    // Hostinger / cPanel = "Sent" or "INBOX.Sent".
    // Gmail = "Sent Mail" (also exposes \Sent flag via [Gmail]/Sent Mail).
    // Zoho / GoDaddy = "Sent".
    const sentCandidates = [
      "Sent Items",   // Outlook / Office 365
      "Sent Mail",    // Gmail IMAP
      "Sent Messages",
      "Sent",         // Outlook.com, Hostinger, cPanel, Zoho, GoDaddy
      "INBOX.Sent",   // Some cPanel / Dovecot configs
      "INBOX/Sent",
    ];

    let targetFolder: string | null = null;

    // Enumerate all folders once. We collect every path so the name-match
    // fallback has the full list even if we short-circuit on the special-use flag.
    const allPaths: string[] = [];
    for await (const box of client.list()) {
      const specialUse = (box as any).specialUse as string | undefined;
      allPaths.push(box.path);
      if (specialUse === "\\Sent" && !targetFolder) {
        targetFolder = box.path;
      }
    }

    // Fall back: case-insensitive name match against well-known names.
    if (!targetFolder) {
      const lowerPaths = allPaths.map(p => p.toLowerCase());
      for (const candidate of sentCandidates) {
        const idx = lowerPaths.indexOf(candidate.toLowerCase());
        if (idx !== -1) {
          targetFolder = allPaths[idx];
          break;
        }
      }
    }

    if (targetFolder) {
      // APPEND does not require the folder to be selected (no lock needed).
      // \Seen marks it as read so it looks like a normally sent message.
      await client.append(targetFolder, rawMessage, ["\\Seen"]);
    }
  } finally {
    // Do NOT call client.close() here — it throws "Connection not available"
    // synchronously when the server has already torn down the socket, and that
    // throw escapes into processTicksAndRejections (outside our try/catch).
    // logout() is async; we fire-and-forget it with .catch so it cannot reject.
    client.logout().catch(() => {});
  }
}

/**
 * Build a properly formatted RFC 2822 MIME message for IMAP APPEND.
 *
 * Uses multipart/alternative with both plain-text and HTML parts so the
 * copy in the Sent folder renders correctly in all mail clients including
 * Outlook, Outlook.com, Apple Mail, and webmail UIs.
 *
 * Compatible with: Outlook / Office365, Hostinger, cPanel, GoDaddy, Zoho,
 * and private IMAP servers running Dovecot / Courier.
 */
export function buildRawMessage(opts: {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  messageId?: string;
}): Buffer {
  const msgId = opts.messageId && opts.messageId.trim()
    ? opts.messageId.trim()
    : `<${Date.now()}.${Math.random().toString(36).slice(2)}@brokermail.ai>`;

  // RFC 2822 date: "Mon, 25 May 2026 17:40:00 +0000"
  const date = toRfc2822Date(new Date());

  // Unique boundary — must not appear in the message body.
  const boundary = `=_BrokerMail_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;

  const encodedSubject = encodeSubjectHeader(opts.subject);

  // All lines must use CRLF per RFC 2822.
  // The multipart/alternative structure is the correct MIME type for
  // messages that have both plain-text and HTML representations.
  const parts: string[] = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Subject: ${encodedSubject}`,
    `Date: ${date}`,
    `Message-ID: ${msgId}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    `X-Mailer: BrokerMail AI`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset=utf-8`,
    `Content-Transfer-Encoding: quoted-printable`,
    ``,
    encodeQuotedPrintable(opts.text),
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset=utf-8`,
    `Content-Transfer-Encoding: quoted-printable`,
    ``,
    encodeQuotedPrintable(opts.html),
    ``,
    `--${boundary}--`,
  ];

  return Buffer.from(parts.join("\r\n"), "utf8");
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Format a Date as RFC 2822 (e.g. "Mon, 25 May 2026 17:40:00 +0000"). */
function toRfc2822Date(d: Date): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${days[d.getUTCDay()]}, ${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} +0000`
  );
}

/**
 * Encode a header value as RFC 2047 UTF-8 Base64 when it contains non-ASCII.
 * ASCII-only subjects are left as-is (no unnecessary encoding overhead).
 */
function encodeSubjectHeader(subject: string): string {
  if (/^[\x00-\x7F]*$/.test(subject)) return subject;
  const b64 = Buffer.from(subject, "utf8").toString("base64");
  return `=?utf-8?B?${b64}?=`;
}

/**
 * Minimal quoted-printable encoder for UTF-8 text/HTML bodies.
 *
 * Encodes non-ASCII bytes and the special characters = ? _ as =XX.
 * Soft-wraps lines at 76 characters as required by RFC 2045.
 * This ensures the message survives every IMAP server's line-length checks.
 */
function encodeQuotedPrintable(input: string): string {
  // Encode each character
  const encoded = input.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, (ch) => {
    return Buffer.from(ch, "utf8")
      .toJSON().data
      .map((b: number) => `=${b.toString(16).toUpperCase().padStart(2, "0")}`)
      .join("");
  }).replace(/=/g, (match, offset, str) => {
    // Don't double-encode already-encoded sequences from above
    // Actually we need to encode bare = signs — but the replace above
    // only hits non-ASCII, so bare = in the original need encoding too.
    // Re-do: encode = that are not already part of =XX
    return match;
  });

  // Simpler, correct approach: encode char by char
  const bytes = Buffer.from(input, "utf8");
  let result = "";
  let lineLen = 0;

  for (const byte of bytes) {
    let ch: string;
    if (byte === 0x09 || byte === 0x20) {
      ch = String.fromCharCode(byte);
    } else if (byte === 0x0A) {
      result += "\r\n";
      lineLen = 0;
      continue;
    } else if (byte === 0x0D) {
      continue; // skip bare CR — we'll add CRLF on LF
    } else if (byte === 0x3D || byte < 0x20 || byte > 0x7E) {
      ch = `=${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    } else {
      ch = String.fromCharCode(byte);
    }

    if (lineLen + ch.length > 75) {
      result += "=\r\n"; // soft line break
      lineLen = 0;
    }
    result += ch;
    lineLen += ch.length;
  }

  return result;
}
