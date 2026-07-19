import { Router } from "express";
import { db } from "@workspace/db";
import {
  commConversationsTable, commMessagesTable, commNotesTable,
  draftsTable, leadsTable, campaignsTable, mailboxesTable, usersTable,
} from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { verifyToken } from "../lib/auth";
import { eq, and, desc, or, ilike, sql, inArray, isNotNull } from "drizzle-orm";
import { logger } from "../lib/logger";
import { runCommSync } from "../lib/comm-sync";
import {
  registerSSE, broadcastToUser, broadcastAll,
  getSyncState, getConnectionCount, broadcastRead,
} from "../lib/comm-events";
import { getCronState } from "../lib/monitoring-state";
import { sendGmailMessage } from "../lib/gmail";
import { decrypt } from "../lib/crypto";
import nodemailer from "nodemailer";
import OpenAI from "openai";

const router = Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function snippet(html: string, max = 160): string {
  const plain = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return plain.length > max ? plain.slice(0, max) + "…" : plain;
}

// Auto-populate conversations from existing sent drafts (idempotent)
async function ensureConversationsSeeded(userId: number) {
  try {
    const existing = await db
      .select({ id: commConversationsTable.id })
      .from(commConversationsTable)
      .where(eq(commConversationsTable.userId, userId))
      .limit(1);

    if (existing.length > 0) return;

    const drafts = await db
      .select({
        id: draftsTable.id,
        leadId: draftsTable.leadId,
        campaignId: draftsTable.campaignId,
        email: draftsTable.email,
        subject: draftsTable.subject,
        body: draftsTable.body,
        sentAt: draftsTable.sentAt,
        createdAt: draftsTable.createdAt,
      })
      .from(draftsTable)
      .where(and(eq(draftsTable.userId, userId), eq(draftsTable.status, "sent")))
      .orderBy(draftsTable.createdAt)
      .limit(200);

    if (drafts.length === 0) return;

    const byEmail = new Map<string, typeof drafts>();
    for (const d of drafts) {
      if (!d.email) continue;
      const key = d.email.toLowerCase();
      if (!byEmail.has(key)) byEmail.set(key, []);
      byEmail.get(key)!.push(d);
    }

    const leadIds = [...new Set(drafts.map(d => d.leadId).filter(Boolean) as number[])];
    const leads = leadIds.length
      ? await db.select().from(leadsTable).where(inArray(leadsTable.id, leadIds))
      : [];
    const leadMap = new Map(leads.map(l => [l.id, l]));

    for (const [email, draftGroup] of byEmail.entries()) {
      const last = draftGroup[draftGroup.length - 1];
      const lead = last.leadId ? leadMap.get(last.leadId) : undefined;
      const name = lead?.name ?? email.split("@")[0] ?? "Customer";

      const [conv] = await db
        .insert(commConversationsTable)
        .values({
          userId,
          leadId: lead?.id ?? null,
          campaignId: last.campaignId ?? null,
          subject: last.subject,
          customerName: name,
          customerEmail: email,
          customerPhone: null,
          status: "read",
          starred: false,
          messageCount: draftGroup.length,
          unreadCount: 0,
          lastMessageAt: last.sentAt ?? last.createdAt,
        })
        .returning();

      for (const d of draftGroup) {
        const body = d.body ?? "";
        await db.insert(commMessagesTable).values({
          conversationId: conv.id,
          userId,
          direction: "outbound",
          fromEmail: email,
          fromName: "You",
          toEmail: email,
          subject: d.subject,
          body: body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
          htmlBody: body,
          snippet: snippet(body),
          isRead: true,
          draftId: d.id,
          sentAt: d.sentAt ?? d.createdAt,
        });
      }
    }
  } catch (err) {
    logger.warn({ err }, "[COMMS] Seed skipped (non-fatal)");
  }
}

// ─── GET /api/communications/conversations ────────────────────────────────────

router.get("/communications/conversations", requireAuth, async (req, res) => {
  const userId = (req as any).user.id as number;

  await ensureConversationsSeeded(userId);

  const filter    = typeof req.query.filter    === "string" ? req.query.filter    : "all";
  const search    = typeof req.query.search    === "string" ? req.query.search    : "";
  const page      = typeof req.query.page      === "string" ? req.query.page      : "1";
  const limit     = typeof req.query.limit     === "string" ? req.query.limit     : "30";
  const mailboxId = typeof req.query.mailboxId === "string" ? req.query.mailboxId : undefined;
  const campaignId= typeof req.query.campaignId=== "string" ? req.query.campaignId: undefined;

  const pageNum  = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
  const offset   = (pageNum - 1) * limitNum;

  const conditions = [eq(commConversationsTable.userId, userId)];

  if (filter === "unread")        conditions.push(eq(commConversationsTable.status, "unread"));
  else if (filter === "needs_reply") conditions.push(eq(commConversationsTable.status, "needs_reply"));
  else if (filter === "starred")  conditions.push(eq(commConversationsTable.starred, true));
  else if (filter === "archived") conditions.push(eq(commConversationsTable.status, "archived"));
  else if (filter === "spam")     conditions.push(eq(commConversationsTable.status, "spam"));
  else if (filter === "trash")    conditions.push(eq(commConversationsTable.status, "trash"));
  else if (filter === "system")   conditions.push(eq(commConversationsTable.status, "system"));
  else if (filter === "drafts") {
    // Conversations that are drafts (outbound-only threads not yet replied to)
    conditions.push(sql`${commConversationsTable.status} NOT IN ('archived', 'spam', 'trash', 'system')`);
    conditions.push(sql`(SELECT direction FROM comm_messages WHERE conversation_id = ${commConversationsTable.id} ORDER BY COALESCE(sent_at, created_at) DESC NULLS LAST LIMIT 1) = 'outbound'`);
    conditions.push(sql`${commConversationsTable.messageCount} = 1`);
  }
  else if (filter === "inbox") {
    // Inbox: has an inbound message as the most recent; exclude special folders
    conditions.push(sql`${commConversationsTable.status} NOT IN ('archived', 'spam', 'trash', 'system')`);
    conditions.push(sql`(SELECT direction FROM comm_messages WHERE conversation_id = ${commConversationsTable.id} ORDER BY COALESCE(sent_at, created_at) DESC NULLS LAST LIMIT 1) = 'inbound'`);
  }
  else if (filter === "sent") {
    conditions.push(sql`${commConversationsTable.status} NOT IN ('archived', 'spam', 'trash', 'system')`);
    conditions.push(sql`(SELECT direction FROM comm_messages WHERE conversation_id = ${commConversationsTable.id} ORDER BY COALESCE(sent_at, created_at) DESC NULLS LAST LIMIT 1) = 'outbound'`);
  }
  else {
    // "all" — every active conversation (not archived, spam, trash, or system)
    conditions.push(sql`${commConversationsTable.status} NOT IN ('archived', 'spam', 'trash', 'system')`);
  }

  if (mailboxId) {
    // Verify the mailbox belongs to this user before using it as a filter.
    // Without this check a caller could probe for another user's mailbox ID.
    const mbId = parseInt(mailboxId, 10);
    if (!isNaN(mbId)) {
      const owned = await db
        .select({ id: mailboxesTable.id })
        .from(mailboxesTable)
        .where(and(eq(mailboxesTable.id, mbId), eq(mailboxesTable.userId, userId)))
        .limit(1);
      if (owned.length > 0) {
        conditions.push(eq(commConversationsTable.mailboxId, mbId));
      }
      // If the mailbox doesn't belong to this user, silently ignore the filter
      // (returning all conversations for the user is safe; leaking nothing)
    }
  }
  if (campaignId) conditions.push(eq(commConversationsTable.campaignId, parseInt(campaignId, 10)));

  // Search: customer name, email, subject. For phone/vehicle, join leads.
  if (search.trim()) {
    const q = `%${search.trim()}%`;
    // Find leadIds that match vehicle/phone/notes
    const matchingLeads = await db
      .select({ id: leadsTable.id })
      .from(leadsTable)
      .where(
        and(
          eq(leadsTable.userId, userId),
          or(
            ilike(leadsTable.vehicle, q),
            ilike(leadsTable.notes, q),
            ilike(leadsTable.pickup, q),
            ilike(leadsTable.delivery, q),
            ilike(sql`coalesce(${leadsTable.price}, '')`, q),
          ),
        )
      )
      .limit(200);

    const leadIds = matchingLeads.map(l => l.id);

    // Also match campaign names
    const matchingCampaigns = await db
      .select({ id: campaignsTable.id })
      .from(campaignsTable)
      .where(and(eq(campaignsTable.userId, userId), ilike(campaignsTable.name, q)))
      .limit(100);
    const campaignIds = matchingCampaigns.map(c => c.id);

    const searchConditions = [
      ilike(commConversationsTable.customerName, q),
      ilike(commConversationsTable.customerEmail, q),
      ilike(commConversationsTable.subject, q),
      ilike(commConversationsTable.customerPhone ?? sql`''`, q),
    ];
    if (leadIds.length > 0) {
      searchConditions.push(inArray(commConversationsTable.leadId, leadIds));
    }
    if (campaignIds.length > 0) {
      searchConditions.push(inArray(commConversationsTable.campaignId, campaignIds));
    }
    conditions.push(or(...searchConditions)!);
  }

  const where = and(...conditions);

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(commConversationsTable)
    .where(where);

  const conversations = await db
    .select({
      id:            commConversationsTable.id,
      leadId:        commConversationsTable.leadId,
      campaignId:    commConversationsTable.campaignId,
      mailboxId:     commConversationsTable.mailboxId,
      subject:       commConversationsTable.subject,
      customerName:  commConversationsTable.customerName,
      customerEmail: commConversationsTable.customerEmail,
      customerPhone: commConversationsTable.customerPhone,
      status:        commConversationsTable.status,
      starred:       commConversationsTable.starred,
      messageCount:  commConversationsTable.messageCount,
      unreadCount:   commConversationsTable.unreadCount,
      lastMessageAt: commConversationsTable.lastMessageAt,
    })
    .from(commConversationsTable)
    .where(where)
    .orderBy(desc(commConversationsTable.lastMessageAt))
    .limit(limitNum)
    .offset(offset);

  return res.json({ data: conversations, total: countRow?.count ?? 0 });
});

// ─── PATCH /api/communications/conversations/bulk ────────────────────────────
// Must be defined BEFORE /:id so Express doesn't treat "bulk" as an ID param.

router.patch("/communications/conversations/bulk", requireAuth, async (req, res) => {
  const userId = (req as any).user.id as number;
  const { ids, action } = req.body as { ids?: number[]; action?: string };

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "ids must be a non-empty array" });
  }
  const validActions = ["mark_read", "mark_unread", "archive", "spam", "trash", "restore", "delete", "star", "unstar"];
  if (!action || !validActions.includes(action)) {
    return res.status(400).json({ error: `action must be one of: ${validActions.join(", ")}` });
  }

  // Verify ownership
  const owned = await db
    .select({ id: commConversationsTable.id })
    .from(commConversationsTable)
    .where(and(
      eq(commConversationsTable.userId, userId),
      inArray(commConversationsTable.id, ids),
    ));
  const ownedIds = owned.map(r => r.id);
  if (ownedIds.length === 0) return res.status(404).json({ error: "No matching conversations" });

  if (action === "delete") {
    await db.delete(commConversationsTable).where(inArray(commConversationsTable.id, ownedIds));
  } else {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (action === "mark_read")   { updates.status = "read";     updates.unreadCount = 0; }
    if (action === "mark_unread") { updates.status = "unread"; }
    if (action === "archive")     updates.status = "archived";
    if (action === "spam")        updates.status = "spam";
    if (action === "trash")       updates.status = "trash";
    if (action === "restore")     { updates.status = "read"; updates.unreadCount = 0; }
    if (action === "star")        updates.starred = true;
    if (action === "unstar")      updates.starred = false;

    await db.update(commConversationsTable)
      .set(updates)
      .where(inArray(commConversationsTable.id, ownedIds));
  }

  // Broadcast to all open tabs
  broadcastToUser(userId, {
    type: "conversation_updated",
    data: { ids: ownedIds, action },
  });

  return res.json({ success: true, affected: ownedIds.length });
});

// ─── GET /api/communications/conversations/:id ────────────────────────────────

router.get("/communications/conversations/:id", requireAuth, async (req, res) => {
  const userId = (req as any).user.id as number;
  const convId = parseInt(typeof req.params.id === "string" ? req.params.id : "", 10);

  const [conv] = await db
    .select()
    .from(commConversationsTable)
    .where(and(eq(commConversationsTable.id, convId), eq(commConversationsTable.userId, userId)));

  if (!conv) return res.status(404).json({ error: "Conversation not found" });

  const messages = await db
    .select()
    .from(commMessagesTable)
    .where(eq(commMessagesTable.conversationId, convId))
    .orderBy(commMessagesTable.sentAt);

  // Join notes with author name
  const rawNotes = await db
    .select({
      id:         commNotesTable.id,
      content:    commNotesTable.content,
      createdAt:  commNotesTable.createdAt,
      userId:     commNotesTable.userId,
      authorName: usersTable.name,
    })
    .from(commNotesTable)
    .leftJoin(usersTable, eq(commNotesTable.userId, usersTable.id))
    .where(eq(commNotesTable.conversationId, convId))
    .orderBy(commNotesTable.createdAt);

  const notes = rawNotes.map(n => ({
    id:         n.id,
    content:    n.content,
    createdAt:  n.createdAt,
    userId:     n.userId,
    authorName: n.authorName ?? "Unknown",
  }));

  let lead = null;
  if (conv.leadId) {
    const [l] = await db.select().from(leadsTable).where(eq(leadsTable.id, conv.leadId));
    lead = l ?? null;
  }

  let campaign = null;
  if (conv.campaignId) {
    const [c] = await db.select({ id: campaignsTable.id, name: campaignsTable.name })
      .from(campaignsTable).where(eq(campaignsTable.id, conv.campaignId));
    campaign = c ?? null;
  }

  // ── Unread tracking: only mark read for INBOUND messages ──────────────────
  // Never mark a conversation read just because the broker opened their own sent message.
  const unreadInbound = messages.filter(m => m.direction === "inbound" && !m.isRead);
  if (unreadInbound.length > 0) {
    const ids = unreadInbound.map(m => m.id);
    await db.update(commMessagesTable).set({ isRead: true }).where(inArray(commMessagesTable.id, ids));
    if (conv.status === "unread" || conv.unreadCount > 0) {
      await db
        .update(commConversationsTable)
        .set({ status: conv.status === "unread" ? "read" : conv.status, unreadCount: 0, updatedAt: new Date() })
        .where(eq(commConversationsTable.id, convId));
      broadcastRead(userId, convId);
    }
  }

  // Return messages with updated isRead state
  const updatedMessages = messages.map(m =>
    m.direction === "inbound" && !m.isRead ? { ...m, isRead: true } : m,
  );
  const updatedStatus = conv.status === "unread" && unreadInbound.length > 0 ? "read" : conv.status;
  const updatedUnreadCount = unreadInbound.length > 0 ? 0 : conv.unreadCount;

  return res.json({
    conversation: { ...conv, status: updatedStatus, unreadCount: updatedUnreadCount },
    messages: updatedMessages,
    notes,
    lead,
    campaign,
  });
});

// ─── PATCH /api/communications/conversations/:id ──────────────────────────────

router.patch("/communications/conversations/:id", requireAuth, async (req, res) => {
  const userId = (req as any).user.id as number;
  const convId = parseInt(typeof req.params.id === "string" ? req.params.id : "", 10);

  const { status, starred } = req.body as { status?: string; starred?: boolean };

  const [conv] = await db
    .select({ id: commConversationsTable.id })
    .from(commConversationsTable)
    .where(and(eq(commConversationsTable.id, convId), eq(commConversationsTable.userId, userId)));

  if (!conv) return res.status(404).json({ error: "Conversation not found" });

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (status !== undefined) updates.status = status;
  if (starred !== undefined) updates.starred = starred;

  await db.update(commConversationsTable).set(updates).where(eq(commConversationsTable.id, convId));

  broadcastToUser(userId, { type: "conversation_updated", conversationId: convId, data: updates });

  return res.json({ success: true });
});

// ─── DELETE /api/communications/conversations/:id ─────────────────────────────

router.delete("/communications/conversations/:id", requireAuth, async (req, res) => {
  const userId = (req as any).user.id as number;
  const convId = parseInt(typeof req.params.id === "string" ? req.params.id : "", 10);

  const [conv] = await db
    .select({ id: commConversationsTable.id })
    .from(commConversationsTable)
    .where(and(eq(commConversationsTable.id, convId), eq(commConversationsTable.userId, userId)));

  if (!conv) return res.status(404).json({ error: "Conversation not found" });

  await db.delete(commConversationsTable).where(eq(commConversationsTable.id, convId));

  broadcastToUser(userId, { type: "conversation_updated", conversationId: convId, data: { deleted: true } });
  return res.json({ success: true });
});

// ─── POST /api/communications/conversations/:id/reply ────────────────────────

router.post("/communications/conversations/:id/reply", requireAuth, async (req, res) => {
  const user   = (req as any).user;
  const userId = user.id as number;
  const convId = parseInt(typeof req.params.id === "string" ? req.params.id : "", 10);

  const [conv] = await db
    .select()
    .from(commConversationsTable)
    .where(and(eq(commConversationsTable.id, convId), eq(commConversationsTable.userId, userId)));

  if (!conv) return res.status(404).json({ error: "Conversation not found" });

  const { body = "", subject: rawSubject, to: rawTo, cc, bcc } = req.body as {
    body?: string; subject?: string; to?: string; cc?: string; bcc?: string;
  };

  if (!body.trim()) return res.status(400).json({ error: "Reply body is required" });

  const toEmail  = (rawTo ?? conv.customerEmail).trim();
  const subjectLine = (rawSubject ?? `Re: ${conv.subject}`).trim();
  const sentAt   = new Date();

  try {
    // ── Gmail path ──
    if (!conv.mailboxId && user.gmailConnected && user.gmailEmail) {
      await sendGmailMessage(user, {
        to:       toEmail,
        cc:       cc ?? undefined,
        bcc:      bcc ?? undefined,
        subject:  subjectLine,
        bodyText: body,
        bodyHtml: `<div style="font-family:sans-serif;font-size:14px;line-height:1.5">${body.replace(/\n/g, "<br>")}</div>`,
      });

      const fromEmail = user.gmailEmail;
      const fromName  = user.agentName ?? user.name ?? fromEmail;

      const [msg] = await db.insert(commMessagesTable).values({
        conversationId: convId,
        userId,
        direction:  "outbound",
        fromEmail,
        fromName,
        toEmail,
        subject:    subjectLine,
        body,
        htmlBody:   null,
        snippet:    body.slice(0, 160),
        isRead:     true,
        sentAt,
      }).returning();

      await db.update(commConversationsTable).set({
        messageCount:  sql`${commConversationsTable.messageCount} + 1`,
        lastMessageAt: sentAt,
        status:        "replied",
        updatedAt:     sentAt,
      }).where(eq(commConversationsTable.id, convId));

      broadcastToUser(userId, { type: "new_message", conversationId: convId, data: { direction: "outbound" } });
      return res.json({ success: true, message: msg });
    }

    // ── SMTP path ──
    if (conv.mailboxId) {
      const [mailbox] = await db.select().from(mailboxesTable)
        .where(and(eq(mailboxesTable.id, conv.mailboxId), eq(mailboxesTable.userId, userId)));

      if (!mailbox) return res.status(400).json({ error: "Mailbox not found" });

      const pass = decrypt(mailbox.smtpPassEncrypted);
      const transporter = nodemailer.createTransport({
        host:   mailbox.smtpHost,
        port:   mailbox.smtpPort,
        secure: mailbox.smtpSecure === "ssl",
        auth:   { user: mailbox.smtpUser, pass },
        tls:    { rejectUnauthorized: false },
      } as any);

      const fromName  = user.agentName ?? user.name ?? mailbox.smtpUser;
      const fromEmail = mailbox.smtpUser;

      await transporter.sendMail({
        from:    `"${fromName}" <${fromEmail}>`,
        to:      toEmail,
        cc:      cc ?? undefined,
        bcc:     bcc ?? undefined,
        subject: subjectLine,
        text:    body,
        html:    `<div style="font-family:sans-serif;font-size:14px;line-height:1.5">${body.replace(/\n/g, "<br>")}</div>`,
      });

      const [msg] = await db.insert(commMessagesTable).values({
        conversationId: convId,
        userId,
        direction:  "outbound",
        fromEmail,
        fromName,
        toEmail,
        subject:    subjectLine,
        body,
        htmlBody:   null,
        snippet:    body.slice(0, 160),
        isRead:     true,
        sentAt,
      }).returning();

      await db.update(commConversationsTable).set({
        messageCount:  sql`${commConversationsTable.messageCount} + 1`,
        lastMessageAt: sentAt,
        status:        "replied",
        updatedAt:     sentAt,
      }).where(eq(commConversationsTable.id, convId));

      broadcastToUser(userId, { type: "new_message", conversationId: convId, data: { direction: "outbound" } });
      return res.json({ success: true, message: msg });
    }

    return res.status(400).json({ error: "No connected mailbox available for sending" });

  } catch (err) {
    logger.error({ err, convId, userId }, "[COMMS] Reply send error");
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to send reply" });
  }
});

// ─── POST /api/communications/conversations/:id/notes ────────────────────────

router.post("/communications/conversations/:id/notes", requireAuth, async (req, res) => {
  const userId = (req as any).user.id as number;
  const convId = parseInt(typeof req.params.id === "string" ? req.params.id : "", 10);

  const { content } = req.body as { content: string };
  if (!content?.trim()) return res.status(400).json({ error: "Content is required" });

  const [conv] = await db
    .select({ id: commConversationsTable.id })
    .from(commConversationsTable)
    .where(and(eq(commConversationsTable.id, convId), eq(commConversationsTable.userId, userId)));

  if (!conv) return res.status(404).json({ error: "Conversation not found" });

  const [note] = await db
    .insert(commNotesTable)
    .values({ conversationId: convId, userId, content: content.trim() })
    .returning();

  // Fetch author name for the response
  const [userRow] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
  const noteWithAuthor = { ...note, authorName: userRow?.name ?? "Unknown" };

  broadcastToUser(userId, { type: "note_added", conversationId: convId, data: { note: noteWithAuthor } });

  return res.json({ note: noteWithAuthor });
});

// ─── PATCH /api/communications/conversations/:id/notes/:noteId ───────────────

router.patch("/communications/conversations/:id/notes/:noteId", requireAuth, async (req, res) => {
  const userId  = (req as any).user.id as number;
  const convId  = parseInt(typeof req.params.id     === "string" ? req.params.id     : "", 10);
  const noteId  = parseInt(typeof req.params.noteId === "string" ? req.params.noteId : "", 10);

  const { content } = req.body as { content?: string };
  if (!content?.trim()) return res.status(400).json({ error: "Content is required" });

  const [note] = await db
    .select({ id: commNotesTable.id, userId: commNotesTable.userId })
    .from(commNotesTable)
    .where(and(eq(commNotesTable.id, noteId), eq(commNotesTable.conversationId, convId)));

  if (!note) return res.status(404).json({ error: "Note not found" });
  if (note.userId !== userId) return res.status(403).json({ error: "Forbidden — not the note author" });

  const [updated] = await db
    .update(commNotesTable)
    .set({ content: content.trim() })
    .where(eq(commNotesTable.id, noteId))
    .returning();

  const [userRow] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
  const noteWithAuthor = { ...updated, authorName: userRow?.name ?? "Unknown" };

  broadcastToUser(userId, { type: "note_updated", conversationId: convId, data: { note: noteWithAuthor } });

  return res.json({ note: noteWithAuthor });
});

// ─── DELETE /api/communications/conversations/:id/notes/:noteId ──────────────

router.delete("/communications/conversations/:id/notes/:noteId", requireAuth, async (req, res) => {
  const userId = (req as any).user.id as number;
  const convId = parseInt(typeof req.params.id     === "string" ? req.params.id     : "", 10);
  const noteId = parseInt(typeof req.params.noteId === "string" ? req.params.noteId : "", 10);

  const [note] = await db
    .select({ id: commNotesTable.id, userId: commNotesTable.userId })
    .from(commNotesTable)
    .where(and(eq(commNotesTable.id, noteId), eq(commNotesTable.conversationId, convId)));

  if (!note) return res.status(404).json({ error: "Note not found" });
  if (note.userId !== userId) return res.status(403).json({ error: "Forbidden — not the note author" });

  await db.delete(commNotesTable).where(eq(commNotesTable.id, noteId));

  broadcastToUser(userId, { type: "note_deleted", conversationId: convId, data: { noteId } });

  return res.json({ success: true });
});

// ─── GET /api/communications/stats ───────────────────────────────────────────

router.get("/communications/stats", requireAuth, async (req, res) => {
  const userId = (req as any).user.id as number;

  const [stats] = await db
    .select({
      total:      sql<number>`count(*) filter (where ${commConversationsTable.status} NOT IN ('archived', 'spam', 'trash', 'system'))::int`,
      unread:     sql<number>`count(*) filter (where ${commConversationsTable.status} = 'unread')::int`,
      needsReply: sql<number>`count(*) filter (where ${commConversationsTable.status} = 'needs_reply')::int`,
      starred:    sql<number>`count(*) filter (where ${commConversationsTable.starred} = true AND ${commConversationsTable.status} NOT IN ('archived', 'spam', 'trash', 'system'))::int`,
      archived:   sql<number>`count(*) filter (where ${commConversationsTable.status} = 'archived')::int`,
      spam:       sql<number>`count(*) filter (where ${commConversationsTable.status} = 'spam')::int`,
      trash:      sql<number>`count(*) filter (where ${commConversationsTable.status} = 'trash')::int`,
      system:     sql<number>`count(*) filter (where ${commConversationsTable.status} = 'system')::int`,
      inbox:      sql<number>`count(*) filter (where ${commConversationsTable.status} NOT IN ('archived', 'spam', 'trash', 'system') AND (SELECT direction FROM comm_messages WHERE conversation_id = ${commConversationsTable.id} ORDER BY COALESCE(sent_at, created_at) DESC NULLS LAST LIMIT 1) = 'inbound')::int`,
      sent:       sql<number>`count(*) filter (where ${commConversationsTable.status} NOT IN ('archived', 'spam', 'trash', 'system') AND (SELECT direction FROM comm_messages WHERE conversation_id = ${commConversationsTable.id} ORDER BY COALESCE(sent_at, created_at) DESC NULLS LAST LIMIT 1) = 'outbound')::int`,
    })
    .from(commConversationsTable)
    .where(eq(commConversationsTable.userId, userId));

  res.json(stats ?? { total: 0, unread: 0, needsReply: 0, starred: 0, archived: 0, spam: 0, trash: 0, system: 0, inbox: 0, sent: 0 });
});

// ─── POST /api/communications/ai-assist ──────────────────────────────────────

router.post("/communications/ai-assist", requireAuth, async (req, res) => {
  const userId = (req as any).user.id as number;
  const { type, conversationId, text, language } = req.body as {
    type?: string; conversationId?: number; text?: string; language?: string;
  };

  const validTypes = ["summarize", "suggest_reply", "extract_intent", "rewrite", "translate", "sentiment"];
  if (!type || !validTypes.includes(type)) {
    return res.status(400).json({ error: `type must be one of: ${validTypes.join(", ")}` });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(503).json({ error: "AI not configured — OPENAI_API_KEY is missing" });

  try {
    // Build context from conversation
    let context = text ?? "";
    if (conversationId) {
      const [conv] = await db
        .select({ subject: commConversationsTable.subject, customerName: commConversationsTable.customerName })
        .from(commConversationsTable)
        .where(and(eq(commConversationsTable.id, conversationId), eq(commConversationsTable.userId, userId)));

      if (conv) {
        const msgs = await db
          .select({ direction: commMessagesTable.direction, body: commMessagesTable.body, fromName: commMessagesTable.fromName, sentAt: commMessagesTable.sentAt })
          .from(commMessagesTable)
          .where(eq(commMessagesTable.conversationId, conversationId))
          .orderBy(commMessagesTable.sentAt)
          .limit(20);

        context = `Subject: ${conv.subject}\nCustomer: ${conv.customerName}\n\n` +
          msgs.map(m => `[${m.direction === "outbound" ? "You" : (m.fromName ?? "Customer")}]: ${m.body.slice(0, 500)}`).join("\n\n");
      }
    }

    const openai = new OpenAI({ apiKey });

    let prompt = "";
    if (type === "summarize") {
      prompt = `Summarize this email thread in 2-3 sentences. Focus on: customer request, current status, and any action needed.\n\nThread:\n${context}`;
    } else if (type === "suggest_reply") {
      prompt = `Write a professional, friendly reply to this email thread from a vehicle shipping broker. Keep it concise (2-3 paragraphs max). Do not include a subject line or signature.\n\nThread:\n${context}`;
    } else if (type === "extract_intent") {
      prompt = `Extract the customer's intent and key information from this email thread. Format as:\n- Intent: [what they want]\n- Vehicle: [if mentioned]\n- Route: [if mentioned]\n- Timeline: [if mentioned]\n- Questions: [any specific questions they asked]\n\nThread:\n${context}`;
    } else if (type === "rewrite") {
      prompt = `Rewrite the following text to be more professional and clear, while keeping the same meaning:\n\n${text ?? context}`;
    } else if (type === "translate") {
      prompt = `Translate the following text to ${language ?? "Spanish"}:\n\n${text ?? context}`;
    } else if (type === "sentiment") {
      prompt = `Analyze the sentiment of this email thread. Provide:\n- Overall tone: [positive/neutral/negative/mixed]\n- Customer emotion: [e.g., interested, frustrated, confused, excited]\n- Urgency level: [low/medium/high]\n- Buying intent: [low/medium/high]\n- Key insight: [one sentence about the customer's attitude]\n\nThread:\n${context}`;
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are an expert vehicle shipping broker assistant. Be concise, professional, and helpful." },
        { role: "user",   content: prompt },
      ],
      max_tokens: 600,
      temperature: 0.7,
    });

    const result = completion.choices[0]?.message?.content?.trim() ?? "";
    return res.json({ result });

  } catch (err) {
    logger.error({ err, type, userId }, "[COMMS] AI assist error");
    return res.status(500).json({ error: err instanceof Error ? err.message : "AI request failed" });
  }
});

// ─── POST /api/communications/sync ───────────────────────────────────────────

router.post("/communications/sync", requireAuth, async (req, res) => {
  const userId = (req as any).user.id as number;
  const state  = getSyncState(userId);

  if (state.isSyncing) {
    return res.json({ started: false, message: "Sync already in progress" });
  }

  // Respond immediately — progress and completion flow through SSE
  res.json({ started: true });

  // Run sync in background (do NOT await — must not block the response)
  runCommSync(userId)
    .then(results => {
      const total = results.reduce((s, r) => s + r.messagesImported, 0);
      logger.info({ userId, total, mailboxCount: results.length }, "[COMM-SYNC] Manual sync complete");
    })
    .catch(err => {
      logger.error({ err, userId }, "[COMM-SYNC] Manual sync background error");
    });

  return; // satisfy TS7030 — all code paths must return a value
});

// ─── GET /api/communications/events ──────────────────────────────────────────

router.get("/communications/events", async (req, res) => {
  const queryToken  = typeof req.query.token === "string" ? req.query.token : null;
  const headerToken = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice(7) : null;
  const token = queryToken ?? headerToken;

  if (!token) { res.status(401).json({ error: "Unauthorized" }); return; }
  const payload = verifyToken(token);
  if (!payload) { res.status(401).json({ error: "Invalid or expired token" }); return; }

  res.set({
    "Content-Type":      "text/event-stream",
    "Cache-Control":     "no-cache",
    "Connection":        "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  res.write(`data: ${JSON.stringify({ type: "connected", ts: new Date().toISOString() })}\n\n`);

  const unregister = registerSSE(payload.userId, res);

  const keepalive = setInterval(() => {
    try { res.write(": ping\n\n"); } catch { clearInterval(keepalive); }
  }, 25_000);

  req.on("close", () => {
    clearInterval(keepalive);
    unregister();
  });
});

// ─── GET /api/communications/sync-status ─────────────────────────────────────

router.get("/communications/sync-status", requireAuth, async (req, res) => {
  const user      = (req as any).user;
  const syncState = getSyncState(user.id);
  const cronState = getCronState("commSync");

  const SYNC_INTERVAL_MS = 5 * 60_000;
  const lastRunAt  = cronState?.lastRunAt  ? new Date(cronState.lastRunAt)  : null;
  const nextSyncAt = lastRunAt ? new Date(lastRunAt.getTime() + SYNC_INTERVAL_MS) : null;

  const mailboxes: Array<{
    email: string; type: string; connected: boolean; lastSyncAt: string | null;
  }> = [];

  if (user.gmailConnected && user.gmailEmail) {
    mailboxes.push({
      email:      user.gmailEmail,
      type:       "gmail",
      connected:  !!(user.gmailAccessToken && user.gmailRefreshToken),
      lastSyncAt: user.gmailCommSyncAt?.toISOString() ?? null,
    });
  }

  const [box] = await db
    .select({
      smtpUser:       mailboxesTable.smtpUser,
      imapHost:       mailboxesTable.imapHost,
      lastCommSyncAt: mailboxesTable.lastCommSyncAt,
    })
    .from(mailboxesTable)
    .where(eq(mailboxesTable.userId, user.id))
    .limit(1);

  if (box?.smtpUser) {
    mailboxes.push({
      email:      box.smtpUser,
      type:       "smtp",
      connected:  !!box.imapHost,
      lastSyncAt: box.lastCommSyncAt?.toISOString() ?? null,
    });
  }

  return res.json({
    isSyncing:          syncState.isSyncing,
    lastSyncAt:         syncState.lastSyncAt?.toISOString() ?? cronState?.lastSuccessAt ?? null,
    nextSyncAt:         nextSyncAt?.toISOString() ?? null,
    lastSyncResults:    syncState.lastSyncResults,
    mailboxes,
    liveConnections:    getConnectionCount(),
    // Live progress fields
    currentMailbox:     syncState.currentMailbox,
    currentFolder:      syncState.currentFolder,
    scanned:            syncState.scanned,
    imported:           syncState.imported,
    totalMailboxes:     syncState.totalMailboxes,
    completedMailboxes: syncState.completedMailboxes,
  });
});

// ─── GET /api/communications/mailboxes ───────────────────────────────────────

router.get("/communications/mailboxes", requireAuth, async (req, res) => {
  const user = (req as any).user;
  const result: Array<{ id: string | number; email: string; type: "gmail" | "smtp" }> = [];

  if (user.gmailConnected && user.gmailEmail) {
    result.push({ id: "gmail", email: user.gmailEmail, type: "gmail" });
  }

  const [box] = await db
    .select({ id: mailboxesTable.id, smtpUser: mailboxesTable.smtpUser })
    .from(mailboxesTable)
    .where(eq(mailboxesTable.userId, user.id));

  if (box?.smtpUser) {
    result.push({ id: box.id, email: box.smtpUser, type: "smtp" });
  }

  res.json(result);
});

export default router;
