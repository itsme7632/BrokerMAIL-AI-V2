import { Router } from "express";
import { db } from "@workspace/db";
import {
  commConversationsTable, commMessagesTable, commNotesTable,
  draftsTable, leadsTable, campaignsTable, mailboxesTable,
} from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { eq, and, desc, or, ilike, sql, inArray } from "drizzle-orm";
import { logger } from "../lib/logger";

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

    if (existing.length > 0) return; // already seeded

    // Pull sent drafts for this user
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
      .where(
        and(
          eq(draftsTable.userId, userId),
          eq(draftsTable.status, "sent"),
        )
      )
      .orderBy(draftsTable.createdAt)
      .limit(200);

    if (drafts.length === 0) return;

    // Group by customer email to form conversations
    const byEmail = new Map<string, typeof drafts>();
    for (const d of drafts) {
      if (!d.email) continue;
      const key = d.email.toLowerCase();
      if (!byEmail.has(key)) byEmail.set(key, []);
      byEmail.get(key)!.push(d);
    }

    // Get lead data for enrichment
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

      // Insert messages for each draft
      for (const d of draftGroup) {
        const body = d.body ?? "";
        await db.insert(commMessagesTable).values({
          conversationId: conv.id,
          userId,
          direction: "outbound",
          fromEmail: email, // placeholder; no mailbox from_email available here
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

  // Seed on first visit (idempotent)
  await ensureConversationsSeeded(userId);

  const filter = typeof req.query.filter === "string" ? req.query.filter : "all";
  const search = typeof req.query.search === "string" ? req.query.search : "";
  const page = typeof req.query.page === "string" ? req.query.page : "1";
  const limit = typeof req.query.limit === "string" ? req.query.limit : "30";
  const mailboxId = typeof req.query.mailboxId === "string" ? req.query.mailboxId : undefined;
  const campaignId = typeof req.query.campaignId === "string" ? req.query.campaignId : undefined;

  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [eq(commConversationsTable.userId, userId)];

  // Filter by status
  if (filter === "unread") conditions.push(eq(commConversationsTable.status, "unread"));
  else if (filter === "needs_reply") conditions.push(eq(commConversationsTable.status, "needs_reply"));
  else if (filter === "starred") conditions.push(eq(commConversationsTable.starred, true));
  else if (filter === "archived") conditions.push(eq(commConversationsTable.status, "archived"));
  else if (filter === "spam") conditions.push(eq(commConversationsTable.status, "spam"));
  else {
    // "all" excludes archived & spam
    // Use sql template for NOT IN
    conditions.push(
      sql`${commConversationsTable.status} NOT IN ('archived', 'spam')`
    );
  }

  if (mailboxId) conditions.push(eq(commConversationsTable.mailboxId, parseInt(mailboxId, 10)));
  if (campaignId) conditions.push(eq(commConversationsTable.campaignId, parseInt(campaignId, 10)));

  if (search.trim()) {
    const q = `%${search.trim()}%`;
    conditions.push(
      or(
        ilike(commConversationsTable.customerName, q),
        ilike(commConversationsTable.customerEmail, q),
        ilike(commConversationsTable.subject, q),
      )!
    );
  }

  const where = and(...conditions);

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(commConversationsTable)
    .where(where);

  const conversations = await db
    .select({
      id: commConversationsTable.id,
      leadId: commConversationsTable.leadId,
      campaignId: commConversationsTable.campaignId,
      subject: commConversationsTable.subject,
      customerName: commConversationsTable.customerName,
      customerEmail: commConversationsTable.customerEmail,
      customerPhone: commConversationsTable.customerPhone,
      status: commConversationsTable.status,
      starred: commConversationsTable.starred,
      messageCount: commConversationsTable.messageCount,
      unreadCount: commConversationsTable.unreadCount,
      lastMessageAt: commConversationsTable.lastMessageAt,
    })
    .from(commConversationsTable)
    .where(where)
    .orderBy(desc(commConversationsTable.lastMessageAt))
    .limit(limitNum)
    .offset(offset);

  return res.json({ data: conversations, total: countRow?.count ?? 0 });
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

  const notes = await db
    .select()
    .from(commNotesTable)
    .where(eq(commNotesTable.conversationId, convId))
    .orderBy(commNotesTable.createdAt);

  // Enrich with lead data if available
  let lead = null;
  if (conv.leadId) {
    const [l] = await db.select().from(leadsTable).where(eq(leadsTable.id, conv.leadId));
    lead = l ?? null;
  }

  let campaign = null;
  if (conv.campaignId) {
    const [c] = await db.select({ id: campaignsTable.id, name: campaignsTable.name }).from(campaignsTable).where(eq(campaignsTable.id, conv.campaignId));
    campaign = c ?? null;
  }

  // Mark as read
  if (conv.status === "unread") {
    await db
      .update(commConversationsTable)
      .set({ status: "read", unreadCount: 0, updatedAt: new Date() })
      .where(eq(commConversationsTable.id, convId));
  }

  return res.json({ conversation: { ...conv, status: conv.status === "unread" ? "read" : conv.status }, messages, notes, lead, campaign });
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

  return res.json({ success: true });
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

  return res.json({ note });
});

// ─── GET /api/communications/stats ───────────────────────────────────────────

router.get("/communications/stats", requireAuth, async (req, res) => {
  const userId = (req as any).user.id as number;

  const [stats] = await db
    .select({
      total: sql<number>`count(*)::int`,
      unread: sql<number>`count(*) filter (where ${commConversationsTable.status} = 'unread')::int`,
      needsReply: sql<number>`count(*) filter (where ${commConversationsTable.status} = 'needs_reply')::int`,
      starred: sql<number>`count(*) filter (where ${commConversationsTable.starred} = true)::int`,
    })
    .from(commConversationsTable)
    .where(
      and(
        eq(commConversationsTable.userId, userId),
        sql`${commConversationsTable.status} NOT IN ('archived', 'spam')`
      )
    );

  res.json(stats ?? { total: 0, unread: 0, needsReply: 0, starred: 0 });
});

// ─── GET /api/communications/mailboxes ───────────────────────────────────────
// Returns the user's connected mailboxes (Gmail + SMTP) in a unified format.

router.get("/communications/mailboxes", requireAuth, async (req, res) => {
  const user = (req as any).user;
  const result: Array<{ id: string | number; email: string; type: "gmail" | "smtp" }> = [];

  // Gmail mailbox (stored on the user record)
  if (user.gmailConnected && user.gmailEmail) {
    result.push({ id: "gmail", email: user.gmailEmail, type: "gmail" });
  }

  // SMTP mailbox (one per user)
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
