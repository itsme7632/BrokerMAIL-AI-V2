/**
 * comm-sync.ts
 *
 * Synchronisation engine for the Communications inbox.
 * Supports two mailbox types:
 *   • Gmail API  — connected Gmail accounts (gmailConnected = true on usersTable)
 *   • IMAP       — SMTP mailboxes with IMAP credentials (imapHost / imapUser set)
 *
 * Deduplication uses commMessagesTable.externalId:
 *   Gmail:  "gmail:<googleInternalMessageId>"
 *   IMAP:   Message-ID header value  (or "imap:<mailboxId>:<uid>" as fallback)
 *
 * Logging per the spec:
 *   [COMM-SYNC] Mailbox sync result  →  { mailbox, messagesScanned, messagesImported,
 *                                          conversationsCreated, conversationsUpdated,
 *                                          durationMs, error? }
 *
 * Never throws — every per-user / per-mailbox error is caught and stored in
 * SyncResult.error so the cron loop and route handler can always return.
 */

import { ImapFlow } from "imapflow";
import {
  db,
  usersTable,
  mailboxesTable,
  commConversationsTable,
  commMessagesTable,
} from "@workspace/db";
import type { User, Mailbox } from "@workspace/db";
import { eq, and, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { getGmailClient } from "./gmail";
import { decrypt } from "./crypto";
import { logger } from "./logger";
import {
  broadcastToUser,
  markSyncStarted,
  markSyncComplete,
  markSyncProgress,
  markMailboxComplete,
  type SyncMailboxResult,
} from "./comm-events";

// ─── Attachment metadata ──────────────────────────────────────────────────────

export interface AttachmentMeta {
  name: string;
  size: number;
  mimeType: string;
  /** Gmail partId, used for server-side download. Undefined for IMAP. */
  partId?: string;
}

// ─── Public result type ───────────────────────────────────────────────────────

export interface SyncResult {
  mailbox: string;
  messagesScanned: number;
  messagesImported: number;
  conversationsCreated: number;
  conversationsUpdated: number;
  durationMs: number;
  error?: string;
}

// ─── Parsing helpers ──────────────────────────────────────────────────────────

function normalizeSubject(subject: string): string {
  return decodeRFC2047(subject)
    .replace(/^(Re|Fwd|FW|RE|FWD|Fw):\s*/gi, "")
    .toLowerCase()
    .trim();
}

function parseEmailAddress(header: string): { name: string; email: string } {
  // Decode RFC 2047 encoded-words in the header before parsing
  const decoded = decodeRFC2047(header.trim());
  const m = decoded.match(/^(.+?)\s*<([^>]+)>\s*$/);
  if (m) {
    const name = m[1]!.trim().replace(/^["']|["']$/g, "");
    return { name, email: m[2]!.trim().toLowerCase() };
  }
  const email = decoded.trim().toLowerCase().replace(/[<>]/g, "").split(/[\s,;]/)[0] ?? "";
  return { name: email.split("@")[0] ?? "", email };
}

/**
 * Extract a single header value from a raw RFC 2822 message source,
 * unfolding continuation lines per RFC 2822 §2.2.3.
 */
function parseHeader(raw: string, name: string): string {
  const re = new RegExp(`^${name}:[ \\t]*(.+)`, "im");
  const m = raw.match(re);
  if (!m) return "";
  return m[1]!.replace(/\r?\n[ \t]+/g, " ").trim();
}

function decodeQuotedPrintable(s: string): string {
  // Unfold soft line breaks
  const unfolded = s.replace(/=\r?\n/g, "");
  // Collect raw bytes then decode as UTF-8.
  // The old char-by-char approach produced latin1 garbage for multi-byte UTF-8 sequences
  // (e.g. U+2022 BULLET encoded as =E2=80=A2 would render as "â€¢" instead of "•").
  const bytes: number[] = [];
  let i = 0;
  while (i < unfolded.length) {
    if (
      unfolded[i] === "=" &&
      i + 2 < unfolded.length &&
      /[0-9A-Fa-f]{2}/.test(unfolded.slice(i + 1, i + 3))
    ) {
      bytes.push(parseInt(unfolded.slice(i + 1, i + 3), 16));
      i += 3;
    } else {
      bytes.push(unfolded.charCodeAt(i) & 0xff);
      i++;
    }
  }
  try {
    return Buffer.from(bytes).toString("utf-8");
  } catch {
    return Buffer.from(bytes).toString("latin1");
  }
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
}

// ─── RFC 2047 encoded-word decoder ───────────────────────────────────────────

/**
 * Decode a single RFC 2047 encoded-word into a UTF-8 string.
 * Supports =?charset?B?base64?= (Base64) and =?charset?Q?qp?= (Quoted-Printable).
 */
function decodeRFC2047Word(charset: string, encoding: string, text: string): string {
  const enc = encoding.toUpperCase();
  let raw: Buffer;
  if (enc === "B") {
    raw = Buffer.from(text.replace(/\s/g, ""), "base64");
  } else {
    // Q encoding: underscores become spaces; =XX sequences become bytes
    const nums: number[] = [];
    const t = text.replace(/_/g, " ");
    let i = 0;
    while (i < t.length) {
      if (t[i] === "=" && i + 2 < t.length) {
        nums.push(parseInt(t.slice(i + 1, i + 3), 16));
        i += 3;
      } else {
        nums.push(t.charCodeAt(i));
        i++;
      }
    }
    raw = Buffer.from(nums);
  }
  // Most modern encoded subjects are UTF-8; fall back to latin1
  const cs = charset.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (cs.startsWith("utf")) return raw.toString("utf8");
  return raw.toString("latin1");
}

/**
 * Decode all RFC 2047 encoded-words in a header string.
 * Strips whitespace between adjacent encoded-words per RFC 2047 §6.2.
 */
function decodeRFC2047(str: string): string {
  if (!str || !str.includes("=?")) return str;
  return str
    .replace(/\?=[ \t]+=\?/g, "?==?")
    .replace(/=\?([^?*]+)(?:\*[^?]*)?\?([BbQq])\?([^?]*)\?=/g, (orig, cs, enc, txt) => {
      try { return decodeRFC2047Word(cs as string, enc as string, txt as string); } catch { return orig as string; }
    });
}

// ─── System notification classifier ─────────────────────────────────────────

/**
 * Return true when an email appears to be a system notification — delivery
 * failure, bounce, mailer daemon, auto-reply, or out-of-office message.
 * These must never be threaded into customer conversations.
 */
function isSystemEmail(fromEmail: string, subject: string): boolean {
  const from = fromEmail.toLowerCase().trim();
  const subj = subject.toLowerCase();

  // Well-known system sender addresses
  if (
    from.startsWith("mailer-daemon@") || from === "mailer-daemon" ||
    from.startsWith("postmaster@")    || from === "postmaster" ||
    from.includes("mail-daemon")      || from.includes("mailerdaemon") ||
    from.includes("mail-delivery")    || from.startsWith("noreply@") ||
    from.startsWith("no-reply@")      || from.startsWith("do-not-reply@")
  ) return true;

  // Delivery failure / bounce subjects
  if (
    subj.includes("delivery failed")            || subj.includes("delivery failure") ||
    subj.includes("mail delivery")              || subj.includes("undeliverable") ||
    subj.includes("undelivered mail")           || subj.includes("returned mail") ||
    subj.includes("failed permanently")         || subj.includes("message not delivered") ||
    subj.includes("could not be delivered")     || subj.includes("delivery status notification") ||
    subj.includes("mail system error")          || subj.includes("delivery notification")
  ) return true;

  // Auto-reply / out-of-office subjects
  if (
    subj.startsWith("auto:")                    || subj.startsWith("automatic reply:") ||
    subj.startsWith("autoreply:")               || subj.startsWith("out of office:") ||
    subj.includes("out of office")              || subj.includes("out-of-office") ||
    subj.includes("automatic reply")            || subj.includes("auto reply")
  ) return true;

  return false;
}

function snippetOf(text: string, html: string, max = 160): string {
  let content = "";
  if (text) {
    content = text.replace(/\s+/g, " ").trim();
  } else if (html) {
    // Strip non-text blocks first — otherwise <style>body{margin:0...}</style>
    // leaks raw CSS into the snippet when there is no plain-text part.
    const stripped = html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#(\d+);/g, (_, n) => {
        try { return String.fromCodePoint(Number(n)); } catch { return " "; }
      });
    content = stripped.replace(/\s+/g, " ").trim();
  }

  if (!content) return "";

  // Skip past common greeting lines (e.g. "Hello John," / "Hi," / "Dear Name,")
  // so the snippet surfaces the first meaningful sentence of the email body.
  // A "greeting line" is the first line when it:
  //   • starts with a salutation word
  //   • is short (≤ 60 chars) — longer first lines are body content, not greetings
  const greetingRe = /^(hello|hi|hey|dear|good\s+(?:morning|afternoon|evening))[^.!?]*[,.]?\s*/i;
  const trimmed = content.replace(greetingRe, "").trim();
  // Only use the de-greeted version if it still has meaningful content; otherwise
  // keep the original so we never return empty for a one-liner email.
  const result = trimmed.length >= 10 ? trimmed : content;

  return result.slice(0, max);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─── Gmail body parser ────────────────────────────────────────────────────────

function extractGmailBody(payload: any): { text: string; html: string; attachments: AttachmentMeta[] } {
  let text = "";
  let html = "";
  const attachments: AttachmentMeta[] = [];

  function traverse(part: any): void {
    const mt: string = part.mimeType ?? "";
    if (mt === "text/plain" && part.body?.data && !text) {
      try { text = decodeBase64Url(part.body.data).slice(0, 50_000); } catch { }
    } else if (mt === "text/html" && part.body?.data && !html) {
      try { html = decodeBase64Url(part.body.data).slice(0, 100_000); } catch { }
    } else if (
      part.filename &&
      (part.body?.size ?? 0) > 0 &&
      !mt.startsWith("text/") &&
      !mt.startsWith("multipart/")
    ) {
      attachments.push({
        name:     String(part.filename),
        size:     Number(part.body?.size ?? 0),
        mimeType: mt || "application/octet-stream",
        partId:   part.partId ? String(part.partId) : undefined,
      });
    }
    if (Array.isArray(part.parts)) {
      for (const p of part.parts) traverse(p);
    }
  }

  traverse(payload);
  return { text, html, attachments };
}

// ─── IMAP body parser (minimal RFC 2822 / MIME) ───────────────────────────────

function extractImapBody(source: string): { text: string; html: string; attachments: AttachmentMeta[] } {
  const attachments: AttachmentMeta[] = [];

  function decode(raw: string, encoding: string): string {
    if (encoding === "base64") {
      try { return Buffer.from(raw.replace(/\s/g, ""), "base64").toString("utf-8"); } catch { return raw; }
    }
    if (encoding === "quoted-printable") return decodeQuotedPrintable(raw);
    return raw;
  }

  // Recursive MIME part parser. Fills text/html/attachments from the outer scope.
  let text = "";
  let html = "";

  function parsePart(headers: string, body: string): void {
    const ct  = parseHeader(headers, "Content-Type");
    const cte = parseHeader(headers, "Content-Transfer-Encoding").toLowerCase();
    const ctLower = ct.toLowerCase();

    // ── Nested multipart — recurse into each sub-part ──────────────────────
    if (ctLower.includes("multipart/")) {
      const bm = ct.match(/boundary="?([^";,\r\n]+)"?/i);
      if (!bm) return; // malformed — skip

      const boundary = bm[1]!.trim();
      const parts = body.split(new RegExp(`--${escapeRegex(boundary)}(?:--)?`));

      for (const part of parts) {
        if (!part.trim() || part.trim() === "--") continue;
        const pSep = part.search(/\r?\n\r?\n/);
        if (pSep === -1) continue;
        const ph = part.slice(0, pSep);
        const pb = part.slice(pSep + (part.charAt(pSep + 1) === "\r" ? 4 : 2));
        parsePart(ph, pb.trim());
      }
      return;
    }

    // ── Leaf part: text/plain or text/html ─────────────────────────────────
    const cd = parseHeader(headers, "Content-Disposition").toLowerCase();
    if (ctLower.includes("text/plain") && !text) {
      text = decode(body, cte).slice(0, 50_000);
    } else if (ctLower.includes("text/html") && !html) {
      const decoded = decode(body, cte);
      html = decoded.slice(0, 100_000);
      // Derive plain text from HTML if we have no text part yet
      if (!text) {
        text = decoded
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 50_000);
      }
    } else if (cd.startsWith("attachment") || (cd.startsWith("inline") && !ctLower.startsWith("text/"))) {
      // Attachment metadata
      const fn =
        cd.match(/filename\*?=(?:UTF-8'')?["']?([^"';\r\n]+)["']?/i)?.[1]?.trim() ??
        ct.match(/name\*?=(?:UTF-8'')?["']?([^"';\r\n]+)["']?/i)?.[1]?.trim();
      if (fn) {
        const rawLen = body.replace(/\s/g, "").length;
        const size = cte === "base64" ? Math.round(rawLen * 0.75) : rawLen;
        attachments.push({
          name:     decodeURIComponent(fn),
          size,
          mimeType: ct.split(";")[0]?.trim() ?? "application/octet-stream",
        });
      }
    }
  }

  // ── Top-level split: headers vs body ──────────────────────────────────────
  const sep = source.search(/\r?\n\r?\n/);
  if (sep === -1) return { text: "", html: "", attachments };

  const topHeaders = source.slice(0, sep);
  const topBody    = source.slice(sep + (source.charAt(sep + 1) === "\r" ? 4 : 2));

  parsePart(topHeaders, topBody.trim());
  return { text, html, attachments };
}

// ─── Conversation threading ───────────────────────────────────────────────────

async function findOrCreateConversation(opts: {
  userId: number;
  mailboxId: number | null;
  /** Direction of the triggering message — outbound conversations start as "read". */
  direction: "inbound" | "outbound";
  customerEmail: string;
  customerName: string;
  subject: string;
  inReplyTo?: string;
  references?: string[];
  messageAt: Date;
  /** When true, conversation is created with status="system" and the email-based
   *  fallback is skipped (each system notification gets its own conversation). */
  isSystemNotification?: boolean;
}): Promise<{ id: number; isNew: boolean }> {
  const { userId, mailboxId, direction, customerEmail, customerName, subject, inReplyTo, references, messageAt, isSystemNotification } = opts;

  // 1. Thread by In-Reply-To ONLY — find existing conversation via the direct
  //    parent message's externalId.
  //
  //    Rules that prevent incorrect grouping:
  //    a) Only use In-Reply-To (not the full References chain). References can
  //       include old message-ids from unrelated threads (e.g. a dispatch system
  //       that echoes the original broker email in every status update), which
  //       would incorrectly pull all those notifications into one conversation.
  //    b) The matched message must itself be OUTBOUND — meaning the customer is
  //       directly replying to a message the broker sent. An inbound message's
  //       In-Reply-To pointing to another inbound (e.g. a dispatch chain) must
  //       NOT cause threading; each automated notification gets its own thread.
  //    c) Outbound messages never thread into an existing conversation — each
  //       outbound email the broker sends is its own fresh conversation.
  //    d) System notifications always get their own conversation (skipped below).
  if (!isSystemNotification && direction === "inbound" && inReplyTo && inReplyTo.trim()) {
    const [linked] = await db
      .select({ convId: commMessagesTable.conversationId })
      .from(commMessagesTable)
      .where(and(
        eq(commMessagesTable.externalId, inReplyTo.trim()),
        eq(commMessagesTable.direction, "outbound"),
      ))
      .limit(1);
    if (linked) return { id: linked.convId, isNew: false };
  }

  // 3. Create new conversation
  const [newConv] = await db
    .insert(commConversationsTable)
    .values({
      userId,
      mailboxId: mailboxId ?? null,
      subject: subject || "(No subject)",
      customerName: customerName || customerEmail.split("@")[0] || customerEmail,
      customerEmail,
      // System: isolated; outbound: broker sent it — never start as unread;
      // inbound: unread until the broker opens it.
      status: isSystemNotification ? "system" : (direction === "outbound" ? "read" : "unread"),
      starred: false,
      messageCount: 0,
      unreadCount: 0,
      lastMessageAt: messageAt,
    })
    .returning({ id: commConversationsTable.id });

  return { id: newConv!.id, isNew: true };
}

// ─── Message upsert ───────────────────────────────────────────────────────────

async function upsertMessage(opts: {
  externalId: string;
  conversationId: number;
  userId: number;
  direction: "inbound" | "outbound";
  fromEmail: string;
  fromName: string;
  toEmail: string;
  subject: string;
  text: string;
  html: string;
  sentAt: Date;
  attachmentsMeta?: AttachmentMeta[];
}): Promise<boolean> {
  const { externalId, conversationId, userId, direction, fromEmail, fromName, toEmail, subject, text, html, sentAt, attachmentsMeta } = opts;

  // Deduplication — skip if already present
  const [existing] = await db
    .select({ id: commMessagesTable.id })
    .from(commMessagesTable)
    .where(eq(commMessagesTable.externalId, externalId))
    .limit(1);
  if (existing) return false;

  // Use proper HTML stripping (same logic as snippetOf) so that CSS/style blocks
  // never leak raw text into the body column used as snippet fallback.
  const body = text || html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  const snippet = snippetOf(text, html);

  await db.insert(commMessagesTable).values({
    externalId,
    conversationId,
    userId,
    direction,
    fromEmail,
    fromName: fromName || fromEmail.split("@")[0] || fromEmail,
    toEmail,
    subject,
    body: body || "(empty)",
    htmlBody: html || null,
    snippet,
    isRead: direction === "outbound",
    attachmentsMeta: attachmentsMeta && attachmentsMeta.length > 0
      ? JSON.stringify(attachmentsMeta)
      : null,
    sentAt,
  });

  // Real-time: push the new message to any open browser tabs for this user
  broadcastToUser(userId, {
    type: "new_message",
    conversationId,
    data: { direction, fromEmail },
  });

  // Messages that arrived in the last 24 h are "unread" for the broker.
  const isRecent = (Date.now() - sentAt.getTime()) < 24 * 60 * 60 * 1_000;
  const updates: Record<string, unknown> = {
    messageCount: sql`${commConversationsTable.messageCount} + 1`,
    lastMessageAt: sql`GREATEST(${commConversationsTable.lastMessageAt}, ${sentAt.toISOString()}::timestamptz)`,
    updatedAt: new Date(),
  };
  if (direction === "inbound" && isRecent) {
    updates.unreadCount = sql`${commConversationsTable.unreadCount} + 1`;
    updates.status = "unread";
  }

  await db
    .update(commConversationsTable)
    .set(updates)
    .where(eq(commConversationsTable.id, conversationId));

  return true;
}

// ─── Gmail sync ───────────────────────────────────────────────────────────────

async function syncGmailInbox(user: User): Promise<SyncResult> {
  const t0 = Date.now();
  const r: SyncResult = {
    mailbox: `Gmail:${user.gmailEmail ?? user.email}`,
    messagesScanned: 0,
    messagesImported: 0,
    conversationsCreated: 0,
    conversationsUpdated: 0,
    durationMs: 0,
  };

  try {
    if (!user.gmailAccessToken || !user.gmailRefreshToken) {
      r.error = "Gmail tokens missing";
      return r;
    }

    const gmail = await getGmailClient(user);

    // Determine since date — 90 days for initial, incremental after that
    const sinceDate = user.gmailCommSyncAt
      ? new Date(user.gmailCommSyncAt)
      : new Date(Date.now() - 90 * 24 * 60 * 60 * 1_000);

    const sinceStr = [
      sinceDate.getFullYear(),
      String(sinceDate.getMonth() + 1).padStart(2, "0"),
      String(sinceDate.getDate()).padStart(2, "0"),
    ].join("/");

    markSyncProgress(user.id, r.mailbox, "INBOX", 0, 0);

    // Fetch up to 500 message IDs (1 API page)
    const listRes = await gmail.users.messages.list({
      userId: "me",
      q: `after:${sinceStr}`,
      maxResults: 500,
    });

    const msgRefs = listRes.data.messages ?? [];
    r.messagesScanned = msgRefs.length;
    markSyncProgress(user.id, r.mailbox, "INBOX", r.messagesScanned, 0);

    const brokerEmail = (user.gmailEmail ?? "").toLowerCase();

    for (const { id } of msgRefs) {
      if (!id) continue;
      try {
        const msgRes = await gmail.users.messages.get({
          userId: "me",
          id,
          format: "full",
        });

        const msg = msgRes.data;
        const payload = msg.payload;
        if (!payload) continue;

        const hdrs = payload.headers ?? [];
        const get = (n: string) =>
          hdrs.find(h => h.name?.toLowerCase() === n.toLowerCase())?.value ?? "";

        const fromHeader  = get("from");
        const toHeader    = get("to");
        // Decode RFC 2047 encoded-words that Gmail sometimes leaves in headers
        const subject     = decodeRFC2047(get("subject") || "(No subject)");
        const inReplyTo   = get("in-reply-to") || undefined;
        const refsStr     = get("references");
        const dateStr     = get("date");

        const sentAt = dateStr
          ? new Date(dateStr)
          : new Date(Number(msg.internalDate ?? Date.now()));
        if (isNaN(sentAt.getTime())) continue;

        const from = parseEmailAddress(fromHeader);
        const to   = parseEmailAddress(toHeader);

        const isOutbound  = from.email === brokerEmail;
        const direction   = isOutbound ? "outbound" : "inbound" as const;
        const customerEmail = isOutbound ? to.email : from.email;
        const customerName  = isOutbound ? to.name  : from.name;

        if (!customerEmail.includes("@")) continue;

        const { text, html, attachments } = extractGmailBody(payload);
        const references = refsStr.split(/\s+/).filter(Boolean);
        const externalId = `gmail:${id}`;

        // Classify system emails (delivery failures, bounces, auto-replies, OOO)
        const sysEmail = !isOutbound && isSystemEmail(from.email, subject);

        const conv = await findOrCreateConversation({
          userId: user.id,
          mailboxId: null,
          direction,
          customerEmail,
          customerName,
          subject,
          inReplyTo,
          references: references.length > 0 ? references : undefined,
          messageAt: sentAt,
          isSystemNotification: sysEmail,
        });

        const inserted = await upsertMessage({
          externalId,
          conversationId: conv.id,
          userId: user.id,
          direction,
          fromEmail: from.email,
          fromName: from.name,
          toEmail: to.email,
          subject,
          text,
          html,
          attachmentsMeta: attachments.length > 0 ? attachments : undefined,
          sentAt,
        });

        if (inserted) {
          r.messagesImported++;
          if (conv.isNew) r.conversationsCreated++;
          else r.conversationsUpdated++;
          // Broadcast progress every 10 messages
          if (r.messagesImported % 10 === 0) {
            markSyncProgress(user.id, r.mailbox, "INBOX", r.messagesScanned, r.messagesImported);
          }
        }
      } catch (msgErr) {
        logger.warn(
          { err: msgErr, gmailMsgId: id, userId: user.id },
          "[COMM-SYNC] Gmail message fetch failed — skipping",
        );
      }
    }

    // Persist sync timestamp
    await db
      .update(usersTable)
      .set({ gmailCommSyncAt: new Date(), updatedAt: new Date() })
      .where(eq(usersTable.id, user.id));

  } catch (err) {
    r.error = err instanceof Error ? err.message : String(err);
    logger.error({ err, userId: user.id }, "[COMM-SYNC] Gmail sync error");
  }

  markMailboxComplete(user.id, r.mailbox, r.messagesImported, r.error);
  r.durationMs = Date.now() - t0;
  return r;
}

// ─── IMAP folder scanner ──────────────────────────────────────────────────────

async function scanImapFolder(
  client: ImapFlow,
  folder: string,
  defaultDirection: "inbound" | "outbound",
  since: Date,
  mailbox: Mailbox,
  userId: number,
  r: SyncResult,
): Promise<void> {
  let lock: { release: () => void } | null = null;
  try {
    lock = await client.getMailboxLock(folder);
  } catch {
    return; // Folder not accessible — skip silently
  }

  try {
    const seqNums = await client.search({ since });
    if (!seqNums || seqNums.length === 0) return;

    // Take the most-recent 1000 (higher seq nums = more recent)
    const range = seqNums.slice(-1000);
    r.messagesScanned += range.length;
    markSyncProgress(userId, r.mailbox, folder, r.messagesScanned, r.messagesImported);

    const messages = await Promise.race([
      client.fetchAll(range.join(","), { source: true }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("fetchAll timed out after 120s")), 120_000)
      ),
    ]);

    for (const msg of messages) {
      const source = msg.source?.toString() ?? "";
      if (!source) continue;

      try {
        const fromHeader  = parseHeader(source, "From");
        const toHeader    = parseHeader(source, "To");
        // Decode RFC 2047 encoded-words (e.g. =?UTF-8?B?...?= subjects)
        const subject     = decodeRFC2047(parseHeader(source, "Subject") || "(No subject)");
        const messageId   = parseHeader(source, "Message-ID").trim();
        const inReplyTo   = parseHeader(source, "In-Reply-To").trim() || undefined;
        const refsStr     = parseHeader(source, "References");
        const dateStr     = parseHeader(source, "Date");

        const sentAt = dateStr ? new Date(dateStr) : new Date();
        if (isNaN(sentAt.getTime())) continue;

        const from = parseEmailAddress(fromHeader);
        const to   = parseEmailAddress(toHeader);

        if (!from.email.includes("@") || !to.email.includes("@")) continue;

        const brokerEmail = (mailbox.smtpUser ?? "").toLowerCase();
        const isOutbound  = from.email === brokerEmail || defaultDirection === "outbound";
        const direction   = isOutbound ? "outbound" : "inbound" as const;
        const customerEmail = isOutbound ? to.email : from.email;
        const customerName  = isOutbound ? to.name  : from.name;

        if (!customerEmail.includes("@")) continue;

        // Use Message-ID header as the dedup key; fall back to seq-based ID
        const externalId = messageId || `imap:${mailbox.id}:${msg.seq}`;
        const references = refsStr.split(/\s+/).filter(Boolean);

        const { text, html, attachments } = extractImapBody(source);

        // Classify system emails (delivery failures, bounces, auto-replies, OOO)
        const sysEmail = !isOutbound && isSystemEmail(from.email, subject);

        const conv = await findOrCreateConversation({
          userId,
          mailboxId: mailbox.id,
          direction,
          customerEmail,
          customerName,
          subject,
          inReplyTo,
          references: references.length > 0 ? references : undefined,
          messageAt: sentAt,
          isSystemNotification: sysEmail,
        });

        const inserted = await upsertMessage({
          externalId,
          conversationId: conv.id,
          userId,
          direction,
          fromEmail: from.email,
          fromName: from.name,
          toEmail: to.email,
          subject,
          text,
          html,
          attachmentsMeta: attachments.length > 0 ? attachments : undefined,
          sentAt,
        });

        if (inserted) {
          r.messagesImported++;
          if (conv.isNew) r.conversationsCreated++;
          else r.conversationsUpdated++;
          if (r.messagesImported % 10 === 0) {
            markSyncProgress(userId, r.mailbox, folder, r.messagesScanned, r.messagesImported);
          }
        }
      } catch (msgErr) {
        logger.warn(
          { err: msgErr, seq: msg.seq, mailboxId: mailbox.id },
          "[COMM-SYNC] IMAP message parse failed — skipping",
        );
      }
    }
  } finally {
    lock?.release();
  }
}

// ─── IMAP sync ────────────────────────────────────────────────────────────────

async function syncImapMailbox(mailbox: Mailbox, userId: number): Promise<SyncResult> {
  const t0 = Date.now();
  const r: SyncResult = {
    mailbox: `IMAP:${mailbox.smtpUser ?? mailbox.imapUser ?? "unknown"}`,
    messagesScanned: 0,
    messagesImported: 0,
    conversationsCreated: 0,
    conversationsUpdated: 0,
    durationMs: 0,
  };

  if (!mailbox.imapHost || !mailbox.imapUser || !mailbox.imapPassEncrypted) {
    r.error = "IMAP credentials not configured";
    r.durationMs = Date.now() - t0;
    return r;
  }

  let pass: string;
  try {
    pass = decrypt(mailbox.imapPassEncrypted);
    if (!pass) throw new Error("empty password after decrypt");
  } catch {
    r.error = "Failed to decrypt IMAP password";
    r.durationMs = Date.now() - t0;
    return r;
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

  // Critical: prevent ImapFlow TLS errors from becoming uncaughtExceptions
  client.on("error", () => {});

  const since = mailbox.lastCommSyncAt
    ? new Date(mailbox.lastCommSyncAt)
    : new Date(Date.now() - 90 * 24 * 60 * 60 * 1_000);

  try {
    await client.connect();

    // Locate the Sent folder (same detection logic as imap.ts saveToSent)
    const sentCandidates = [
      "Sent Items", "Sent Mail", "Sent Messages", "Sent", "INBOX.Sent", "INBOX/Sent",
    ];
    let sentFolder: string | null = null;
    const allPaths: string[] = [];
    const listed = await client.list();
    for (const box of listed) {
      const specialUse = (box as any).specialUse as string | undefined;
      allPaths.push(box.path);
      if (specialUse === "\\Sent" && !sentFolder) sentFolder = box.path;
    }
    if (!sentFolder) {
      const lower = allPaths.map(p => p.toLowerCase());
      for (const c of sentCandidates) {
        const idx = lower.indexOf(c.toLowerCase());
        if (idx !== -1) { sentFolder = allPaths[idx]!; break; }
      }
    }

    // Scan INBOX for inbound messages (and any outbound in inbox)
    await scanImapFolder(client, "INBOX", "inbound", since, mailbox, userId, r);

    // Scan Sent folder for outbound messages the broker sent
    if (sentFolder) {
      await scanImapFolder(client, sentFolder, "outbound", since, mailbox, userId, r);
    }

    // Persist sync timestamp
    await db
      .update(mailboxesTable)
      .set({ lastCommSyncAt: new Date(), updatedAt: new Date() })
      .where(eq(mailboxesTable.id, mailbox.id));

  } catch (err) {
    r.error = err instanceof Error ? err.message : String(err);
    logger.error({ err, mailboxId: mailbox.id, userId }, "[COMM-SYNC] IMAP sync error");
  } finally {
    client.logout().catch(() => {});
  }

  markMailboxComplete(userId, r.mailbox, r.messagesImported, r.error);
  r.durationMs = Date.now() - t0;
  return r;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Run communications inbox sync for one user (manual refresh) or all users
 * with connected mailboxes (background cron).
 *
 * Never throws — all errors are captured in SyncResult.error.
 */
export async function runCommSync(targetUserId?: number): Promise<SyncResult[]> {
  const results: SyncResult[] = [];
  // Parallel array — tracks which userId owns each entry in `results`
  const resultUserIds: number[] = [];

  // Count total mailboxes so progress panel can show N/M
  let totalMailboxes = 0;
  if (targetUserId) {
    const hasGmail = await db.select({ id: usersTable.id }).from(usersTable)
      .where(and(eq(usersTable.id, targetUserId), eq(usersTable.gmailConnected, true))).limit(1);
    const hasImap = await db.select({ id: mailboxesTable.id }).from(mailboxesTable)
      .where(and(eq(mailboxesTable.userId, targetUserId), isNotNull(mailboxesTable.imapHost))).limit(1);
    totalMailboxes = (hasGmail.length > 0 ? 1 : 0) + hasImap.length;
  }
  markSyncStarted(totalMailboxes);

  try {
    // ── Gmail users ──────────────────────────────────────────────────────────
    const gmailUsers: User[] = targetUserId
      ? await db.select().from(usersTable).where(eq(usersTable.id, targetUserId))
      : await db.select().from(usersTable).where(eq(usersTable.gmailConnected, true));

    for (const user of gmailUsers) {
      if (!user.gmailConnected || !user.gmailAccessToken) continue;
      const r = await syncGmailInbox(user);
      results.push(r);
      resultUserIds.push(user.id);
      logger.info(
        {
          mailbox: r.mailbox,
          messagesScanned:      r.messagesScanned,
          messagesImported:     r.messagesImported,
          conversationsCreated: r.conversationsCreated,
          conversationsUpdated: r.conversationsUpdated,
          durationMs:           r.durationMs,
          error:                r.error,
        },
        "[COMM-SYNC] Mailbox sync result",
      );
    }

    // ── IMAP mailboxes ───────────────────────────────────────────────────────
    const mailboxes: Mailbox[] = targetUserId
      ? await db
          .select()
          .from(mailboxesTable)
          .where(
            and(
              eq(mailboxesTable.userId, targetUserId),
              isNotNull(mailboxesTable.imapHost),
            ),
          )
      : await db
          .select()
          .from(mailboxesTable)
          .where(
            and(
              eq(mailboxesTable.isActive, true),
              isNotNull(mailboxesTable.imapHost),
            ),
          );

    for (const mb of mailboxes) {
      const r = await syncImapMailbox(mb, mb.userId);
      results.push(r);
      resultUserIds.push(mb.userId);
      logger.info(
        {
          mailbox: r.mailbox,
          messagesScanned:      r.messagesScanned,
          messagesImported:     r.messagesImported,
          conversationsCreated: r.conversationsCreated,
          conversationsUpdated: r.conversationsUpdated,
          durationMs:           r.durationMs,
          error:                r.error,
        },
        "[COMM-SYNC] Mailbox sync result",
      );
    }
  } catch (err) {
    logger.error({ err }, "[COMM-SYNC] runCommSync top-level error");
  } finally {
    // Tag each result with its owner so markSyncComplete can route per-user
    const syncMailboxResults: SyncMailboxResult[] = results.map((r, i) => ({
      userId:   resultUserIds[i] ?? 0,
      mailbox:  r.mailbox,
      imported: r.messagesImported,
      error:    r.error,
    }));
    // markSyncComplete stores results per-user and broadcasts only to each
    // user's own connections — no cross-user data exposure
    markSyncComplete(syncMailboxResults);
  }

  return results;
}
