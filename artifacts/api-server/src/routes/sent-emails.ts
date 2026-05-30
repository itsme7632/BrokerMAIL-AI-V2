import { Router, type IRouter } from "express";
import {
  db, emailQueueTable, draftsTable, mailboxesTable, usersTable, templatesTable,
  emailTrackingEventsTable,
} from "@workspace/db";
import { eq, and, count, desc, sql, inArray } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import {
  buildHtmlEmail, replaceVarsText, formatPrice, type EmailStyle, type BrandingSettings,
} from "../lib/email-html";
import { sendEmail } from "../lib/smtp";
import { randomUUID } from "crypto";
import type { User } from "@workspace/db";

const router: IRouter = Router();

/** Decode MIME quoted-printable encoding (e.g. =E2=80=99 → ') */
function decodeQuotedPrintable(str: string): string {
  return str
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function userBranding(user: User): BrandingSettings {
  return {
    agentName:      user.agentName      ?? null,
    companyName:    user.companyName    ?? null,
    companyTagline: user.companyTagline ?? null,
    companyPhone:   user.companyPhone   ?? null,
    companyWebsite: user.companyWebsite ?? null,
    usdot:          user.usdot          ?? null,
    mcNumber:       user.mcNumber       ?? null,
    accentColor:    user.accentColor    ?? null,
    logoUrl:        (user as any).logoUrl ?? null,
  };
}

function validStyle(s?: string | null): EmailStyle {
  const valid = ["clean","modern","minimal","luxury","corporate","urgent","dispatch","friendly","mobile","dark"] as const;
  return valid.includes(s as EmailStyle) ? (s as EmailStyle) : "clean";
}

/** Human-readable SMTP error label — decodes MIME quoted-printable before matching */
export function parseSMTPError(raw?: string | null): string {
  if (!raw) return "Unknown error";
  const decoded = decodeQuotedPrintable(raw);
  const s = decoded.toLowerCase();
  if (s.includes("mailbox full") || s.includes("over quota") || s.includes("user over") || s.includes("452")) return "Mailbox full";
  if (s.includes("user not found") || s.includes("user unknown") || s.includes("no such user") || s.includes("does not exist") || /\b550\b/.test(s)) return "Invalid email address";
  if (s.includes("blocked") || s.includes("banned") || s.includes("blacklist") || s.includes("dnsbl")) return "Blocked by provider";
  if (s.includes("rate limit") || s.includes("too many") || s.includes("slow down") || /\b421\b/.test(s) || s.includes("max emails per hour") || s.includes("sending limit")) return "Rate limit exceeded";
  if (s.includes("spam") || s.includes("junk") || s.includes("content filter")) return "Flagged as spam";
  if (s.includes("temporary") || /\b451\b/.test(s)) return "Temporary failure — retry later";
  if (s.includes("connection timed out") || s.includes("etimedout")) return "Connection timeout";
  if (s.includes("connection refused") || s.includes("econnrefused")) return "Connection refused";
  if (s.includes("auth") || s.includes("535") || s.includes("credentials")) return "SMTP authentication failed";
  if (s.includes("relay") || s.includes("relaying denied")) return "Relay denied";
  if (s.includes("ssl") || s.includes("tls") || s.includes("certificate")) return "TLS/SSL error";
  return decoded.length > 80 ? decoded.slice(0, 80) + "…" : decoded;
}

async function getTrackingStatsForIds(
  trackingIds: string[]
): Promise<Record<string, { openCount: number; firstOpenedAt: string | null; lastOpenedAt: string | null }>> {
  if (trackingIds.length === 0) return {};

  const drafts = await db
    .select({ id: draftsTable.id, trackingId: draftsTable.trackingId })
    .from(draftsTable)
    .where(inArray(draftsTable.trackingId, trackingIds));

  if (drafts.length === 0) return {};

  const draftIds = drafts.map(d => d.id);
  const draftIdToTrackingId: Record<number, string> = {};
  for (const d of drafts) {
    if (d.trackingId) draftIdToTrackingId[d.id] = d.trackingId;
  }

  const events = await db
    .select({
      draftId:   emailTrackingEventsTable.draftId,
      cnt:       sql<number>`count(*)::int`,
      firstAt:   sql<string>`min(${emailTrackingEventsTable.createdAt})::text`,
      lastAt:    sql<string>`max(${emailTrackingEventsTable.createdAt})::text`,
    })
    .from(emailTrackingEventsTable)
    .where(
      and(
        inArray(emailTrackingEventsTable.draftId, draftIds),
        eq(emailTrackingEventsTable.eventType, "open"),
      )
    )
    .groupBy(emailTrackingEventsTable.draftId);

  const stats: Record<string, { openCount: number; firstOpenedAt: string | null; lastOpenedAt: string | null }> = {};
  for (const e of events) {
    if (!e.draftId) continue;
    const tId = draftIdToTrackingId[e.draftId];
    if (tId) stats[tId] = { openCount: e.cnt, firstOpenedAt: e.firstAt, lastOpenedAt: e.lastAt };
  }
  return stats;
}

function retryMinutesRemaining(retryAfter: Date | null | undefined): number | null {
  if (!retryAfter) return null;
  const ms = retryAfter.getTime() - Date.now();
  return ms > 0 ? Math.ceil(ms / 60_000) : 0;
}

function formatItem(item: any, tracking: Record<string, any>) {
  let row: Record<string, string> = {};
  try { row = JSON.parse(item.rowDataJson); } catch { }
  const stats = item.trackingId ? (tracking[item.trackingId] ?? null) : null;
  const isDeferred = item.status === "deferred";
  const isFailed   = item.status === "failed";
  const retryMins  = isDeferred ? retryMinutesRemaining(item.retryAfter) : null;
  return {
    id:              item.id,
    campaignId:      item.campaignId,
    leadId:          item.leadId,
    email:           item.email,
    customerName:    row.name ?? row.companyName ?? null,
    quoteId:         item.quoteId ?? row.quote_id ?? null,
    subject:         item.subject,
    sentAt:          item.sentAt?.toISOString() ?? null,
    mailboxEmail:    item.mailboxEmail ?? null,
    mailboxFromName: item.mailboxFromName ?? null,
    status:          item.status,
    lastError:       item.lastError ?? null,
    errorLabel:      (isFailed || isDeferred) ? parseSMTPError(item.lastError) : null,
    retryAfter:      item.retryAfter?.toISOString() ?? null,
    retryMinutes:    retryMins,
    deferredCount:   item.deferredCount ?? 0,
    trackingId:      item.trackingId ?? null,
    templateId:      item.templateId,
    style:           item.style,
    openCount:       stats?.openCount ?? 0,
    firstOpenedAt:   stats?.firstOpenedAt ?? null,
    lastOpenedAt:    stats?.lastOpenedAt ?? null,
  };
}

// ─── List sent/failed emails ──────────────────────────────────────────────────

router.get("/sent-emails", requireAuth, async (req, res): Promise<void> => {
  const user         = req.user!;
  const page         = parseInt(req.query.page as string, 10) || 1;
  const limit        = Math.min(parseInt(req.query.limit as string, 10) || 25, 100);
  const campaignId   = req.query.campaignId ? parseInt(req.query.campaignId as string, 10) : undefined;
  const search       = typeof req.query.search === "string" ? req.query.search.trim().toLowerCase() : "";
  const statusFilter = (req.query.statusFilter as string) || "delivered";

  // Build status condition
  let statusCond: any;
  if (statusFilter === "failed") {
    statusCond = eq(emailQueueTable.status, "failed");
  } else if (statusFilter === "all") {
    statusCond = inArray(emailQueueTable.status, ["success", "failed"]);
  } else {
    // "delivered", "opened", "unopened" — all start from success
    statusCond = eq(emailQueueTable.status, "success");
  }

  const baseConditions: any[] = [eq(emailQueueTable.userId, user.id), statusCond];
  if (campaignId) baseConditions.push(eq(emailQueueTable.campaignId, campaignId));

  const selectCols = {
    id: emailQueueTable.id, jobId: emailQueueTable.jobId, campaignId: emailQueueTable.campaignId,
    leadId: emailQueueTable.leadId, email: emailQueueTable.email, subject: emailQueueTable.subject,
    rowDataJson: emailQueueTable.rowDataJson, templateId: emailQueueTable.templateId,
    style: emailQueueTable.style, useSignatureBuilder: emailQueueTable.useSignatureBuilder,
    status: emailQueueTable.status, lastError: emailQueueTable.lastError,
    sentAt: emailQueueTable.sentAt, quoteId: emailQueueTable.quoteId,
    trackingId: emailQueueTable.trackingId,
    mailboxEmail: mailboxesTable.smtpUser, mailboxFromName: mailboxesTable.fromName,
  };

  // For opened/unopened/search we need in-memory filtering
  const needsMemFilter = !!search || statusFilter === "opened" || statusFilter === "unopened";

  let items: any[];
  let totalCount: number;

  if (needsMemFilter) {
    const allItems = await db
      .select(selectCols)
      .from(emailQueueTable)
      .leftJoin(mailboxesTable, eq(mailboxesTable.id, emailQueueTable.mailboxId))
      .where(and(...baseConditions))
      .orderBy(desc(emailQueueTable.sentAt))
      .limit(5000);

    // Get tracking stats
    const trackingIds = allItems.filter((i: any) => i.trackingId).map((i: any) => i.trackingId!);
    const tracking    = await getTrackingStatsForIds(trackingIds);

    const formatted = allItems.map((i: any) => formatItem(i, tracking));

    const filtered = formatted.filter(item => {
      if (search) {
        const nameMatch = (item.customerName ?? "").toLowerCase().includes(search);
        const emailMatch = item.email.toLowerCase().includes(search);
        const quoteMatch = (item.quoteId ?? "").toLowerCase().includes(search);
        if (!nameMatch && !emailMatch && !quoteMatch) return false;
      }
      if (statusFilter === "opened")   return item.openCount > 0;
      if (statusFilter === "unopened") return item.openCount === 0;
      return true;
    });

    totalCount = filtered.length;
    items      = filtered.slice((page - 1) * limit, page * limit);
  } else {
    const [totalRow] = await db.select({ count: count() }).from(emailQueueTable).where(and(...baseConditions));
    totalCount = totalRow.count;

    const rawItems = await db
      .select(selectCols)
      .from(emailQueueTable)
      .leftJoin(mailboxesTable, eq(mailboxesTable.id, emailQueueTable.mailboxId))
      .where(and(...baseConditions))
      .orderBy(desc(emailQueueTable.sentAt))
      .limit(limit)
      .offset((page - 1) * limit);

    const trackingIds = rawItems.filter((i: any) => i.trackingId).map((i: any) => i.trackingId!);
    const tracking    = await getTrackingStatsForIds(trackingIds);
    items = rawItems.map((i: any) => formatItem(i, tracking));
  }

  res.json({ data: items, total: totalCount, page, limit });
});

// ─── Preview a sent email ─────────────────────────────────────────────────────

router.get("/sent-emails/:id/preview", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const id   = parseInt(req.params.id, 10);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }

  const [item] = await db.select().from(emailQueueTable)
    .where(and(eq(emailQueueTable.id, id), eq(emailQueueTable.userId, user.id)));
  if (!item) { res.status(404).json({ error: "Email not found" }); return; }

  const [template] = await db.select().from(templatesTable)
    .where(and(eq(templatesTable.id, item.templateId), eq(templatesTable.userId, user.id)));
  if (!template) { res.status(404).json({ error: "Template not found" }); return; }

  const [freshUser] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
  if (!freshUser) { res.status(404).json({ error: "User not found" }); return; }

  let row: Record<string, string> = {};
  try { row = JSON.parse(item.rowDataJson); } catch { }

  const branding = userBranding(freshUser);
  const html     = buildHtmlEmail(template.body, row, branding, {
    style: validStyle(item.style),
    useSignatureBuilder: item.useSignatureBuilder,
  });
  const subject = replaceVarsText(template.subject, row);

  res.json({
    html, subject, to: item.email,
    sentAt: item.sentAt?.toISOString() ?? null,
    customerName: row.name ?? row.companyName ?? null,
    rawBody: template.body,
  });
});

// ─── Activity timeline for a sent email ──────────────────────────────────────

router.get("/sent-emails/:id/timeline", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const id   = parseInt(req.params.id, 10);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }

  const [item] = await db.select({
    id: emailQueueTable.id, email: emailQueueTable.email,
    trackingId: emailQueueTable.trackingId, sentAt: emailQueueTable.sentAt,
    status: emailQueueTable.status, subject: emailQueueTable.subject,
    lastError: emailQueueTable.lastError,
  }).from(emailQueueTable)
    .where(and(eq(emailQueueTable.id, id), eq(emailQueueTable.userId, user.id)));
  if (!item) { res.status(404).json({ error: "Email not found" }); return; }

  const events: { type: string; timestamp: string; detail?: string }[] = [];

  if (item.status === "failed" && item.lastError) {
    events.push({ type: "failed", timestamp: new Date().toISOString(), detail: parseSMTPError(item.lastError) });
  } else if (item.sentAt) {
    events.push({ type: "sent",      timestamp: item.sentAt.toISOString() });
    events.push({ type: "delivered", timestamp: item.sentAt.toISOString() });
  }

  if (item.trackingId) {
    const [draft] = await db.select({ id: draftsTable.id }).from(draftsTable)
      .where(eq(draftsTable.trackingId, item.trackingId));

    if (draft) {
      const openEvts = await db.select().from(emailTrackingEventsTable)
        .where(and(eq(emailTrackingEventsTable.draftId, draft.id), eq(emailTrackingEventsTable.eventType, "open")))
        .orderBy(emailTrackingEventsTable.createdAt);

      for (const e of openEvts) {
        events.push({ type: "opened", timestamp: e.createdAt.toISOString(), detail: e.userAgent ?? undefined });
      }
    }
  }

  res.json({ events, email: item.email, subject: item.subject });
});

// ─── Retry a failed email ─────────────────────────────────────────────────────

router.post("/sent-emails/:id/retry", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const id   = parseInt(req.params.id, 10);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }

  const [item] = await db.select().from(emailQueueTable)
    .where(and(eq(emailQueueTable.id, id), eq(emailQueueTable.userId, user.id)));
  if (!item) { res.status(404).json({ error: "Email not found" }); return; }
  if (!["failed", "success"].includes(item.status)) {
    res.status(400).json({ error: "Email cannot be retried in its current state" }); return;
  }

  const [mailbox] = await db.select().from(mailboxesTable)
    .where(and(eq(mailboxesTable.id, item.mailboxId), eq(mailboxesTable.userId, user.id)));
  if (!mailbox?.smtpHost) { res.status(400).json({ error: "Mailbox not configured" }); return; }

  const [template] = await db.select().from(templatesTable)
    .where(and(eq(templatesTable.id, item.templateId), eq(templatesTable.userId, user.id)));
  if (!template) { res.status(404).json({ error: "Template not found" }); return; }

  const [freshUser] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
  if (!freshUser) { res.status(404).json({ error: "User not found" }); return; }

  const branding  = userBranding(freshUser);
  const row       = JSON.parse(item.rowDataJson) as Record<string, string>;
  if (row.price) row.price = formatPrice(row.price);

  const subject   = replaceVarsText(template.subject, row);
  const bodyText  = replaceVarsText(template.body, row);
  const bodyHtml  = buildHtmlEmail(template.body, row, branding, {
    style: validStyle(item.style), useSignatureBuilder: item.useSignatureBuilder,
  });

  const trackingId = randomUUID();
  const publicBase = process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : (process.env.PUBLIC_URL ?? "http://localhost:3000");
  const pixelTag   = `<img src="${publicBase}/api/track/open/${trackingId}" width="1" height="1" alt="" style="display:none!important;width:1px!important;height:1px!important;border:0;" />`;
  const trackedHtml = bodyHtml.includes("</body>")
    ? bodyHtml.replace(/<\/body>/i, `${pixelTag}</body>`)
    : bodyHtml + pixelTag;

  try {
    await sendEmail(mailbox, { to: item.email, subject, text: bodyText, html: trackedHtml });

    await db.insert(draftsTable).values({
      userId: user.id, campaignId: item.campaignId ?? null, leadId: item.leadId ?? null,
      email: item.email, subject, body: bodyText, status: "success",
      trackingId, gmailDraftId: `smtp:retry:${id}`,
    });

    const now = new Date();
    await db.update(emailQueueTable)
      .set({ status: "success", sentAt: now, trackingId, lastError: null, attempts: item.attempts + 1 })
      .where(eq(emailQueueTable.id, id));

    res.json({ ok: true, sentAt: now.toISOString(), trackingId });
  } catch (err: any) {
    const errMsg = String(err?.message ?? "Send failed");
    await db.update(emailQueueTable)
      .set({ attempts: item.attempts + 1, lastError: errMsg })
      .where(eq(emailQueueTable.id, id));
    res.status(500).json({ error: errMsg, errorLabel: parseSMTPError(errMsg) });
  }
});

// ─── Edit & Re-send ───────────────────────────────────────────────────────────

router.post("/sent-emails/:id/edit-resend", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const id   = parseInt(req.params.id, 10);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }

  const { toEmail, subject: editedSubject, note } = req.body as {
    toEmail?: string;
    subject?: string;
    note?: string;
  };

  const [item] = await db.select().from(emailQueueTable)
    .where(and(eq(emailQueueTable.id, id), eq(emailQueueTable.userId, user.id)));
  if (!item) { res.status(404).json({ error: "Email not found" }); return; }

  const [mailbox] = await db.select().from(mailboxesTable)
    .where(and(eq(mailboxesTable.id, item.mailboxId), eq(mailboxesTable.userId, user.id)));
  if (!mailbox?.smtpHost) { res.status(400).json({ error: "Mailbox not configured" }); return; }

  const [template] = await db.select().from(templatesTable)
    .where(and(eq(templatesTable.id, item.templateId), eq(templatesTable.userId, user.id)));
  if (!template) { res.status(404).json({ error: "Template not found" }); return; }

  const [freshUser] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
  if (!freshUser) { res.status(404).json({ error: "User not found" }); return; }

  const recipientEmail = toEmail?.trim() || item.email;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
    res.status(400).json({ error: "Invalid email address" }); return;
  }

  const branding  = userBranding(freshUser);
  const row       = JSON.parse(item.rowDataJson) as Record<string, string>;
  if (row.price) row.price = formatPrice(row.price);

  const finalSubject = editedSubject?.trim() || replaceVarsText(template.subject, row);

  // Build note prefix if provided
  const notePrefix = note?.trim()
    ? `${note.trim()}\n\n`
    : "";
  const bodyWithNote = notePrefix + template.body;
  const bodyText = notePrefix + replaceVarsText(template.body, row);
  const bodyHtml = buildHtmlEmail(bodyWithNote, row, branding, {
    style: validStyle(item.style), useSignatureBuilder: item.useSignatureBuilder,
  });

  const trackingId = randomUUID();
  const publicBase = process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : (process.env.PUBLIC_URL ?? "http://localhost:3000");
  const pixelTag  = `<img src="${publicBase}/api/track/open/${trackingId}" width="1" height="1" alt="" style="display:none!important;" />`;
  const trackedHtml = bodyHtml.includes("</body>")
    ? bodyHtml.replace(/<\/body>/i, `${pixelTag}</body>`)
    : bodyHtml + pixelTag;

  try {
    await sendEmail(mailbox, { to: recipientEmail, subject: finalSubject, text: bodyText, html: trackedHtml });

    await db.insert(draftsTable).values({
      userId: user.id, campaignId: item.campaignId ?? null, leadId: item.leadId ?? null,
      email: recipientEmail, subject: finalSubject, body: bodyText, status: "success",
      trackingId, gmailDraftId: `smtp:edit-resend:${id}`,
    });

    // Insert new queue entry to track this resend
    const newEntry = await db.insert(emailQueueTable).values({
      jobId: `resend-${id}-${Date.now()}`,
      userId: user.id, mailboxId: item.mailboxId, templateId: item.templateId,
      campaignId: item.campaignId ?? undefined, leadId: item.leadId ?? undefined,
      email: recipientEmail, subject: finalSubject,
      rowDataJson: item.rowDataJson, style: item.style,
      useSignatureBuilder: item.useSignatureBuilder,
      status: "success", sentAt: new Date(), trackingId,
    }).returning();

    // Mark original as ignored so it doesn't re-appear in failed list
    await db.update(emailQueueTable)
      .set({ status: "ignored" })
      .where(eq(emailQueueTable.id, id));

    res.json({ ok: true, newId: newEntry[0]?.id ?? null, sentAt: new Date().toISOString() });
  } catch (err: any) {
    const errMsg = String(err?.message ?? "Send failed");
    res.status(500).json({ error: errMsg, errorLabel: parseSMTPError(errMsg) });
  }
});

// ─── Mark as ignored ──────────────────────────────────────────────────────────

router.patch("/sent-emails/:id/ignore", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const id   = parseInt(req.params.id, 10);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }

  const [item] = await db.select({ id: emailQueueTable.id }).from(emailQueueTable)
    .where(and(eq(emailQueueTable.id, id), eq(emailQueueTable.userId, user.id)));
  if (!item) { res.status(404).json({ error: "Email not found" }); return; }

  await db.update(emailQueueTable)
    .set({ status: "ignored" })
    .where(eq(emailQueueTable.id, id));

  res.json({ ok: true });
});

export default router;
