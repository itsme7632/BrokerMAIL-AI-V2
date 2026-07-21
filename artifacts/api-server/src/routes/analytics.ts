import { Router, type IRouter } from "express";
import {
  db,
  emailQueueTable,
  draftsTable,
  campaignsTable,
  emailTrackingEventsTable,
  commMessagesTable,
  mailboxesTable,
  subscriptionsTable,
  plansTable,
} from "@workspace/db";
import { eq, and, count, max, sql } from "drizzle-orm";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

// ─── In-memory cache (per user, 60 s TTL) ────────────────────────────────────

const CACHE_TTL_MS = 60_000;
interface CacheEntry { data: AnalyticsOverview; expiresAt: number }
const analyticsCache = new Map<number, CacheEntry>();

export interface AnalyticsOverview {
  totalEmailsSent:    number;
  smtpEmailsSent:     number;
  gmailEmailsSent:    number;
  totalDraftsCreated: number;
  campaignsCreated:   number;
  activeCampaigns:    number;
  completedCampaigns: number;
  totalOpens:         number;
  totalClicks:        number;
  repliesReceived:    number;
  failedEmails:       number;
  bouncedEmails:      number;
  connectedMailboxes: number;
  lastEmailSent:      string | null;
  monthlyUsage:       number;
  monthlyLimit:       number;   // -1 = unlimited
  currentPlan:        string;
  currentPlanSlug:    string;
  quotaRemaining:     number;   // -1 = unlimited
  usageResetDate:     string;
}

/** Call this whenever an event that changes analytics occurs (email sent, draft created, etc.) */
export function invalidateAnalyticsCache(userId: number): void {
  analyticsCache.delete(userId);
}

// ─── GET /analytics/overview ──────────────────────────────────────────────────

router.get("/analytics/overview", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const now  = Date.now();

  // Serve from cache if still fresh
  const cached = analyticsCache.get(user.id);
  if (cached && now < cached.expiresAt) {
    res.json(cached.data);
    return;
  }

  // ── Date boundaries ───────────────────────────────────────────────────────
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const nextMonthStart = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);

  // ── Fire all queries in parallel ──────────────────────────────────────────
  const [
    [smtpSentAll],
    [gmailSentAll],
    [totalDraftsRow],
    [campaignsCreatedRow],
    [activeCampaignsRow],
    [completedCampaignsRow],
    opensAndClicks,
    [repliesRow],
    [failedRow],
    [bouncedRow],
    [mailboxRow],
    lastSentRows,
    [monthlySmtpRow],
    [monthlyGmailRow],
    subRows,
  ] = await Promise.all([

    // SMTP emails sent (email_queue status = 'sent', all time)
    db.select({ count: count() }).from(emailQueueTable)
      .where(and(eq(emailQueueTable.userId, user.id), eq(emailQueueTable.status, "sent"))),

    // Gmail emails sent (drafts status = 'success', not smtp: synthetic rows)
    db.select({ count: count() }).from(draftsTable)
      .where(and(
        eq(draftsTable.userId, user.id),
        eq(draftsTable.status, "success"),
        sql`(${draftsTable.gmailDraftId} IS NULL OR ${draftsTable.gmailDraftId} NOT LIKE 'smtp:%')`,
      )),

    // All Gmail drafts ever created (mirrors dashboard/stats logic)
    db.select({ count: count() }).from(draftsTable)
      .where(and(
        eq(draftsTable.userId, user.id),
        sql`(${draftsTable.gmailDraftId} IS NULL OR ${draftsTable.gmailDraftId} NOT LIKE 'smtp:%')`,
      )),

    // Total campaigns ever created
    db.select({ count: count() }).from(campaignsTable)
      .where(eq(campaignsTable.userId, user.id)),

    // Active campaigns (sending or pending)
    db.select({ count: count() }).from(campaignsTable)
      .where(and(
        eq(campaignsTable.userId, user.id),
        sql`${campaignsTable.status} IN ('sending', 'pending')`,
      )),

    // Completed campaigns
    db.select({ count: count() }).from(campaignsTable)
      .where(and(eq(campaignsTable.userId, user.id), eq(campaignsTable.status, "completed"))),

    // Opens + clicks (join via drafts to scope to user)
    db.select({ eventType: emailTrackingEventsTable.eventType, n: count() })
      .from(emailTrackingEventsTable)
      .innerJoin(draftsTable, eq(emailTrackingEventsTable.draftId, draftsTable.id))
      .where(and(
        eq(draftsTable.userId, user.id),
        sql`${emailTrackingEventsTable.eventType} IN ('open', 'click')`,
      ))
      .groupBy(emailTrackingEventsTable.eventType),

    // Inbound replies via comm_messages
    db.select({ count: count() }).from(commMessagesTable)
      .where(and(eq(commMessagesTable.userId, user.id), eq(commMessagesTable.direction, "inbound"))),

    // Failed emails
    db.select({ count: count() }).from(emailQueueTable)
      .where(and(eq(emailQueueTable.userId, user.id), eq(emailQueueTable.status, "failed"))),

    // Bounced emails
    db.select({ count: count() }).from(emailQueueTable)
      .where(and(eq(emailQueueTable.userId, user.id), eq(emailQueueTable.status, "bounced"))),

    // Connected SMTP mailboxes
    db.select({ count: count() }).from(mailboxesTable)
      .where(and(eq(mailboxesTable.userId, user.id), eq(mailboxesTable.isActive, true))),

    // Last SMTP email sent timestamp
    db.select({ lastSent: max(emailQueueTable.sentAt) }).from(emailQueueTable)
      .where(and(eq(emailQueueTable.userId, user.id), eq(emailQueueTable.status, "sent"))),

    // Monthly SMTP usage (since month start)
    db.select({ count: count() }).from(emailQueueTable)
      .where(and(
        eq(emailQueueTable.userId, user.id),
        eq(emailQueueTable.status, "sent"),
        sql`${emailQueueTable.sentAt} >= ${monthStart}`,
      )),

    // Monthly Gmail usage (since month start)
    db.select({ count: count() }).from(draftsTable)
      .where(and(
        eq(draftsTable.userId, user.id),
        eq(draftsTable.status, "success"),
        sql`(${draftsTable.gmailDraftId} IS NULL OR ${draftsTable.gmailDraftId} NOT LIKE 'smtp:%')`,
        sql`${draftsTable.createdAt} >= ${monthStart}`,
      )),

    // Active subscription + plan
    db.select({ sub: subscriptionsTable, plan: plansTable })
      .from(subscriptionsTable)
      .innerJoin(plansTable, eq(subscriptionsTable.planId, plansTable.id))
      .where(eq(subscriptionsTable.userId, user.id)),
  ]);

  // ── Aggregate ─────────────────────────────────────────────────────────────

  const smtpEmailsSent  = smtpSentAll.count;
  const gmailEmailsSent = gmailSentAll.count;
  const totalEmailsSent = smtpEmailsSent + gmailEmailsSent;

  const totalOpens  = opensAndClicks.find(r => r.eventType === "open")?.n  ?? 0;
  const totalClicks = opensAndClicks.find(r => r.eventType === "click")?.n ?? 0;

  const monthlyUsage = monthlySmtpRow.count + monthlyGmailRow.count;

  const plan         = subRows[0]?.plan ?? null;
  const monthlyLimit = plan?.monthlyEmailLimit ?? 100; // -1 = unlimited
  const quotaRemaining = monthlyLimit === -1 ? -1 : Math.max(0, monthlyLimit - monthlyUsage);

  const data: AnalyticsOverview = {
    totalEmailsSent,
    smtpEmailsSent,
    gmailEmailsSent,
    totalDraftsCreated: totalDraftsRow.count,
    campaignsCreated:   campaignsCreatedRow.count,
    activeCampaigns:    activeCampaignsRow.count,
    completedCampaigns: completedCampaignsRow.count,
    totalOpens,
    totalClicks,
    repliesReceived:    repliesRow.count,
    failedEmails:       failedRow.count,
    bouncedEmails:      bouncedRow.count,
    connectedMailboxes: mailboxRow.count,
    lastEmailSent:      lastSentRows[0]?.lastSent?.toISOString() ?? null,
    monthlyUsage,
    monthlyLimit,
    currentPlan:        plan?.name ?? "Free",
    currentPlanSlug:    plan?.slug ?? "free",
    quotaRemaining,
    usageResetDate:     nextMonthStart.toISOString(),
  };

  analyticsCache.set(user.id, { data, expiresAt: now + CACHE_TTL_MS });
  res.json(data);
});

export default router;
