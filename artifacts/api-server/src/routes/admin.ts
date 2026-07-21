import { Router, type IRouter } from "express";
import {
  db, usersTable, campaignsTable, leadsTable, draftsTable,
  systemLogsTable, mailboxesTable, adminSettingsTable, emailQueueTable,
  plansTable, subscriptionsTable, planRequestsTable, supportTicketsTable,
  templatesTable, suppressionListTable, processedBouncesTable,
  emailTrackingEventsTable, backupHistoryTable,
  featureRequestsTable, bugReportsTable, announcementsTable,
  commMessagesTable, commConversationsTable,
} from "@workspace/db";
import { count, desc, sql, eq, gte, lte, gt, and, or, ilike, isNotNull, isNull, inArray } from "drizzle-orm";
import { requireAdmin } from "../lib/auth";
import { logger } from "../lib/logger";
import multer from "multer";
import JSZip from "jszip";
import crypto from "crypto";
import nodemailer from "nodemailer";
import { decrypt } from "../lib/crypto";
import { buildTransportOptions } from "../lib/smtp";
import { testImap } from "../lib/imap";
import os from "os";
import fs from "fs";
import { startCampaignProcessor } from "./campaigns";
import { runBounceScanner } from "../lib/bounce-scanner";
import { getCronJobStates } from "../lib/monitoring-state";
import { stripHtmlToText, snippetOf } from "../lib/comm-sync";

const memUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const BACKUP_VERSION  = "4";
const SCHEMA_VERSION  = "1";
const APP_VERSION     = "1.0.0";

const router: IRouter = Router();

// ─── Stats ────────────────────────────────────────────────────────────────────

router.get("/admin/stats", requireAdmin, async (_req, res): Promise<void> => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  const [[totalUsers], [activeUsers], [totalCampaigns], [totalLeads],
    [totalDrafts], [failedDrafts], [emailsToday], [emailsMonth],
    [smtpMailboxes], [gmailUsers]] = await Promise.all([
    db.select({ count: count() }).from(usersTable),
    db.select({ count: count() }).from(usersTable).where(eq(usersTable.status, "active")),
    db.select({ count: count() }).from(campaignsTable),
    db.select({ count: count() }).from(leadsTable),
    db.select({ count: count() }).from(draftsTable).where(eq(draftsTable.status, "success")),
    db.select({ count: count() }).from(draftsTable).where(eq(draftsTable.status, "failed")),
    db.select({ count: count() }).from(draftsTable)
      .where(and(eq(draftsTable.status, "success"), gte(draftsTable.createdAt, today))),
    db.select({ count: count() }).from(draftsTable)
      .where(and(eq(draftsTable.status, "success"), gte(draftsTable.createdAt, monthStart))),
    db.select({ count: count() }).from(mailboxesTable).where(eq(mailboxesTable.isActive, true)),
    db.select({ count: count() }).from(usersTable).where(eq(usersTable.gmailConnected, true)),
  ]);

  res.json({
    totalUsers:         totalUsers.count,
    activeUsers:        activeUsers.count,
    emailsSentToday:    emailsToday.count,
    emailsSentMonth:    emailsMonth.count,
    smtpMailboxes:      smtpMailboxes.count,
    totalCampaigns:     totalCampaigns.count,
    totalLeads:         totalLeads.count,
    totalDraftsCreated: totalDrafts.count,
    failedSends:        failedDrafts.count,
    gmailConnectedUsers: gmailUsers.count,
  });
});

// ─── Dashboard Overview (Phase 2 command center) ──────────────────────────────
// Aggregates KPIs + recent activity feeds + system status in a single call so
// the dashboard doesn't fan out a dozen requests on load. Read-only — reuses
// the same tables the existing /admin/* endpoints already query.

const ACTIVE_CAMPAIGN_STATUSES = ["pending", "sending", "paused", "queued", "cooling_down"];

router.get("/admin/dashboard-overview", requireAdmin, async (_req, res): Promise<void> => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const since24h = new Date(Date.now() - 86_400_000);

  const [
    [totalUsers], [activeUsers], [activeCampaigns], [totalLeads],
    [emailsToday], [emailsMonth], [totalSentAllTime], [failedAllTime],
    [smtpMailboxes], [gmailUsers], [suppressedEmails],
    [openedDistinct], [bouncedRecent],
    recentSignups, recentCampaigns, recentPayments,
    openSupportTickets, openFeatureRequests, openBugReports, activeAnnouncements,
    recentActivity, queueCounts, mailboxHealth,
    [cmSendingNow], [cmCoolingDown], [cmCompletedToday], [cmFailedToday], [cmQueuedEmails],
    [mbTotal], [mbConnected], [mbDisconnected], [mbCoolingDown], [mbActiveToday], [mbFailed],
    [openTicketsCount], [openBugsCount], [openFeaturesCount],
  ] = await Promise.all([
    db.select({ count: count() }).from(usersTable),
    db.select({ count: count() }).from(usersTable).where(eq(usersTable.status, "active")),
    db.select({ count: count() }).from(campaignsTable).where(inArray(campaignsTable.status, ACTIVE_CAMPAIGN_STATUSES)),
    db.select({ count: count() }).from(leadsTable),
    db.select({ count: count() }).from(draftsTable).where(and(eq(draftsTable.status, "success"), gte(draftsTable.createdAt, today))),
    db.select({ count: count() }).from(draftsTable).where(and(eq(draftsTable.status, "success"), gte(draftsTable.createdAt, monthStart))),
    db.select({ count: count() }).from(draftsTable).where(eq(draftsTable.status, "success")),
    db.select({ count: count() }).from(draftsTable).where(eq(draftsTable.status, "failed")),
    db.select({ count: count() }).from(mailboxesTable).where(eq(mailboxesTable.isActive, true)),
    db.select({ count: count() }).from(usersTable).where(eq(usersTable.gmailConnected, true)),
    db.select({ count: count() }).from(suppressionListTable),
    db.select({ count: sql<number>`count(distinct ${emailTrackingEventsTable.draftId})` }).from(emailTrackingEventsTable).where(eq(emailTrackingEventsTable.eventType, "open")),
    db.select({ count: count() }).from(processedBouncesTable).where(gte(processedBouncesTable.processedAt, since24h)),
    db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, plan: usersTable.plan, createdAt: usersTable.createdAt })
      .from(usersTable).orderBy(desc(usersTable.createdAt)).limit(5),
    db.select({
      id: campaignsTable.id, name: campaignsTable.name, status: campaignsTable.status,
      sentCount: campaignsTable.sentCount, totalLeads: campaignsTable.totalLeads,
      userName: usersTable.name, updatedAt: campaignsTable.updatedAt,
    }).from(campaignsTable).leftJoin(usersTable, eq(campaignsTable.userId, usersTable.id))
      .orderBy(desc(campaignsTable.updatedAt)).limit(5),
    db.select({
      id: planRequestsTable.id, userName: usersTable.name, userEmail: usersTable.email,
      toPlanId: planRequestsTable.toPlanId, priceSnapshot: planRequestsTable.priceSnapshot,
      status: planRequestsTable.status, paymentStatus: planRequestsTable.paymentStatus,
      createdAt: planRequestsTable.createdAt,
    }).from(planRequestsTable).leftJoin(usersTable, eq(planRequestsTable.userId, usersTable.id))
      .orderBy(desc(planRequestsTable.createdAt)).limit(5),
    db.select({ id: supportTicketsTable.id, subject: supportTicketsTable.subject, userName: supportTicketsTable.userName, userEmail: supportTicketsTable.userEmail, priority: supportTicketsTable.priority, status: supportTicketsTable.status, createdAt: supportTicketsTable.createdAt })
      .from(supportTicketsTable).where(or(eq(supportTicketsTable.status, "open"), eq(supportTicketsTable.status, "pending")))
      .orderBy(desc(supportTicketsTable.createdAt)).limit(5),
    db.select({ id: featureRequestsTable.id, title: featureRequestsTable.title, category: featureRequestsTable.category, status: featureRequestsTable.status, createdAt: featureRequestsTable.createdAt })
      .from(featureRequestsTable).where(eq(featureRequestsTable.status, "open"))
      .orderBy(desc(featureRequestsTable.createdAt)).limit(5),
    db.select({ id: bugReportsTable.id, title: bugReportsTable.title, severity: bugReportsTable.severity, status: bugReportsTable.status, createdAt: bugReportsTable.createdAt })
      .from(bugReportsTable).where(eq(bugReportsTable.status, "open"))
      .orderBy(desc(bugReportsTable.createdAt)).limit(5),
    db.select({ id: announcementsTable.id, message: announcementsTable.message, priority: announcementsTable.priority, createdAt: announcementsTable.createdAt })
      .from(announcementsTable).where(eq(announcementsTable.isActive, true))
      .orderBy(desc(announcementsTable.priority)).limit(5),
    db.select({ id: systemLogsTable.id, type: systemLogsTable.type, severity: systemLogsTable.severity, description: systemLogsTable.description, createdAt: systemLogsTable.createdAt })
      .from(systemLogsTable).orderBy(desc(systemLogsTable.createdAt)).limit(8),
    db.select({ count: count() }).from(emailQueueTable).where(inArray(emailQueueTable.status, ["pending", "sending"])),
    db.select({
      total: count(),
      quotaReached: sql<number>`count(*) filter (where ${mailboxesTable.quotaStatus} = 'quota_reached')`,
    }).from(mailboxesTable).where(eq(mailboxesTable.isActive, true)),
    // Campaign Monitor supplemental stats
    db.select({ count: count() }).from(campaignsTable)
      .where(and(eq(campaignsTable.status, "sending"), or(isNull(campaignsTable.cooldownUntil), lte(campaignsTable.cooldownUntil, new Date())))),
    db.select({ count: count() }).from(campaignsTable)
      .where(or(
        and(eq(campaignsTable.status, "sending"), gt(campaignsTable.cooldownUntil, new Date())),
        eq(campaignsTable.status, "cooling_down"),
      )),
    db.select({ count: count() }).from(campaignsTable)
      .where(and(eq(campaignsTable.status, "completed"), gte(campaignsTable.updatedAt, today))),
    db.select({ count: count() }).from(campaignsTable)
      .where(and(eq(campaignsTable.status, "failed"), gte(campaignsTable.updatedAt, today))),
    db.select({ count: count() }).from(emailQueueTable).where(eq(emailQueueTable.status, "pending")),
    // Mailbox Monitor stats
    db.select({ count: count() }).from(mailboxesTable),
    db.select({ count: count() }).from(mailboxesTable).where(and(eq(mailboxesTable.isActive, true), isNull(mailboxesTable.quotaStatus))),
    db.select({ count: count() }).from(mailboxesTable).where(eq(mailboxesTable.isActive, false)),
    db.select({ count: count() }).from(mailboxesTable).where(eq(mailboxesTable.quotaStatus, "quota_reached")),
    db.select({ count: sql<number>`count(distinct ${emailQueueTable.mailboxId})::int` }).from(emailQueueTable).where(and(isNotNull(emailQueueTable.firstAttemptAt), gte(emailQueueTable.firstAttemptAt, today))),
    db.select({ count: count() }).from(mailboxesTable).where(and(isNotNull(mailboxesTable.quotaStatus), gt(mailboxesTable.quotaProbeCount, 2))),
    db.select({ count: count() }).from(supportTicketsTable).where(or(eq(supportTicketsTable.status, "open"), eq(supportTicketsTable.status, "in_progress"))),
    db.select({ count: count() }).from(bugReportsTable).where(eq(bugReportsTable.status, "open")),
    db.select({ count: count() }).from(featureRequestsTable).where(eq(featureRequestsTable.status, "open")),
  ]);

  const totalSent = totalSentAllTime.count;
  const bounceRate = totalSent > 0 ? Math.round((bouncedRecent.count / Math.max(totalSent, 1)) * 1000) / 10 : 0;
  const openRate   = totalSent > 0 ? Math.round((openedDistinct.count / totalSent) * 1000) / 10 : 0;
  const mbHealth = mailboxHealth[0] ?? { total: 0, quotaReached: 0 };
  const healthyMailboxPct = mbHealth.total > 0 ? Math.round(((mbHealth.total - Number(mbHealth.quotaReached)) / mbHealth.total) * 100) : 100;
  const failRatePct = totalSent + failedAllTime.count > 0 ? Math.round((failedAllTime.count / (totalSent + failedAllTime.count)) * 100) : 0;
  const platformHealth: "healthy" | "degraded" | "critical" =
    healthyMailboxPct < 50 || failRatePct > 25 ? "critical" :
    healthyMailboxPct < 85 || failRatePct > 10 ? "degraded" : "healthy";

  res.json({
    kpis: {
      totalUsers: totalUsers.count,
      activeUsers: activeUsers.count,
      activeCampaigns: activeCampaigns.count,
      emailsSentToday: emailsToday.count,
      emailsSentMonth: emailsMonth.count,
      openRate,
      bounceRate,
      suppressedEmails: suppressedEmails.count,
      connectedMailboxes: smtpMailboxes.count,
      gmailAccounts: gmailUsers.count,
      platformHealth,
    },
    recent: {
      signups: recentSignups.map(u => ({ ...u, createdAt: u.createdAt.toISOString() })),
      campaigns: recentCampaigns.map(c => ({ ...c, updatedAt: c.updatedAt?.toISOString() ?? null })),
      payments: recentPayments.map(p => ({ ...p, createdAt: p.createdAt.toISOString() })),
      supportRequests: openSupportTickets.map(t => ({ ...t, createdAt: t.createdAt.toISOString() })),
      featureRequests: openFeatureRequests.map(f => ({ ...f, createdAt: f.createdAt.toISOString() })),
      bugReports: openBugReports.map(b => ({ ...b, createdAt: b.createdAt.toISOString() })),
      announcements: activeAnnouncements.map(a => ({ ...a, createdAt: a.createdAt.toISOString() })),
      activity: recentActivity.map(a => ({ ...a, createdAt: a.createdAt.toISOString() })),
      counts: {
        openSupportTickets: openTicketsCount.count,
        openBugReports:     openBugsCount.count,
        openFeatureRequests: openFeaturesCount.count,
      },
    },
    systemStatus: {
      database: "operational",
      api: "operational",
      workers: queueCounts[0].count > 0 ? "processing" : "idle",
      queue: { pending: queueCounts[0].count },
      smtp: healthyMailboxPct >= 85 ? "operational" : healthyMailboxPct >= 50 ? "degraded" : "down",
      imap: "operational",
      mailboxHealthPct: healthyMailboxPct,
    },
    campaignMonitor: {
      activeCampaigns: activeCampaigns.count,
      sendingNow:      cmSendingNow.count,
      coolingDown:     cmCoolingDown.count,
      completedToday:  cmCompletedToday.count,
      failedToday:     cmFailedToday.count,
      queuedEmails:    cmQueuedEmails.count,
    },
    mailboxMonitor: {
      totalMailboxes:    mbTotal.count,
      connected:         mbConnected.count,
      disconnected:      mbDisconnected.count,
      coolingDown:       mbCoolingDown.count,
      smtpAccounts:      mbTotal.count,
      gmailAccounts:     gmailUsers.count,
      activeToday:       mbActiveToday.count,
      failedConnections: mbFailed.count,
    },
  });
});

// ─── Queue Status ─────────────────────────────────────────────────────────────

router.get("/admin/queue-status", requireAdmin, async (_req, res): Promise<void> => {
  const since24h = new Date(Date.now() - 86_400_000);

  const [pendingRow, sendingRow, successRow, failedRow, last24hRow] = await Promise.all([
    db.select({ count: count() }).from(emailQueueTable).where(eq(emailQueueTable.status, "pending")),
    db.select({ count: count() }).from(emailQueueTable).where(eq(emailQueueTable.status, "sending")),
    db.select({ count: count() }).from(emailQueueTable).where(eq(emailQueueTable.status, "success")),
    db.select({ count: count() }).from(emailQueueTable).where(eq(emailQueueTable.status, "failed")),
    db.select({ count: count() }).from(emailQueueTable)
      .where(and(eq(emailQueueTable.status, "success"), gte(emailQueueTable.sentAt, since24h))),
  ]);

  res.json({
    pending:    pendingRow[0]?.count  ?? 0,
    sending:    sendingRow[0]?.count  ?? 0,
    success:    successRow[0]?.count  ?? 0,
    failed:     failedRow[0]?.count   ?? 0,
    last24h:    last24hRow[0]?.count  ?? 0,
    totalJobs:  (pendingRow[0]?.count ?? 0) + (sendingRow[0]?.count ?? 0) +
                (successRow[0]?.count ?? 0) + (failedRow[0]?.count ?? 0),
  });
});

// ─── Users ────────────────────────────────────────────────────────────────────

router.get("/admin/users", requireAdmin, async (req, res): Promise<void> => {
  const page   = Math.max(parseInt(req.query.page   as string, 10) || 1, 1);
  const limit  = Math.min(parseInt(req.query.limit  as string, 10) || 20, 100);
  const search       = (req.query.search   as string) || "";
  const roleFilter   = (req.query.role     as string) || "all";
  const planFilter   = (req.query.plan     as string) || "all";
  const statusFilter = (req.query.status   as string) || "all";

  const conditions = [];
  if (search) {
    conditions.push(or(
      ilike(usersTable.name,  `%${search}%`),
      ilike(usersTable.email, `%${search}%`),
    ));
  }
  if (roleFilter   !== "all") conditions.push(eq(usersTable.role,   roleFilter));
  if (planFilter   !== "all") conditions.push(eq(usersTable.plan,   planFilter));
  if (statusFilter !== "all") conditions.push(eq(usersTable.status, statusFilter));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [totalResult] = await db.select({ count: count() }).from(usersTable).where(where);

  const users = await db.select({
    id:             usersTable.id,
    email:          usersTable.email,
    name:           usersTable.name,
    avatarUrl:      usersTable.avatarUrl,
    companyName:    usersTable.companyName,
    role:           usersTable.role,
    plan:           usersTable.plan,
    credits:        usersTable.credits,
    status:         usersTable.status,
    gmailConnected: usersTable.gmailConnected,
    createdAt:      usersTable.createdAt,
    lastActiveAt:   usersTable.lastActiveAt,
    emailsSent: sql<number>`(SELECT COUNT(*)::int FROM drafts WHERE drafts.user_id = users.id AND drafts.status = 'success')`,
    smtpConnected: sql<boolean>`EXISTS(SELECT 1 FROM mailboxes WHERE mailboxes.user_id = users.id AND mailboxes.is_active = true)`,
    campaignsCount: sql<number>`(SELECT COUNT(*)::int FROM campaigns WHERE campaigns.user_id = users.id)`,
    subscriptionPlanName:   sql<string | null>`(SELECT plans.name FROM subscriptions JOIN plans ON plans.id = subscriptions.plan_id WHERE subscriptions.user_id = users.id LIMIT 1)`,
    subscriptionBillingStatus: sql<string | null>`(SELECT subscriptions.billing_status FROM subscriptions WHERE subscriptions.user_id = users.id LIMIT 1)`,
  }).from(usersTable)
    .where(where)
    .orderBy(desc(usersTable.createdAt))
    .limit(limit)
    .offset((page - 1) * limit);

  res.json({
    data: users.map(u => ({
      ...u,
      createdAt:    u.createdAt.toISOString(),
      lastActiveAt: u.lastActiveAt?.toISOString() ?? null,
    })),
    total: totalResult.count,
    page,
    limit,
  });
});

router.patch("/admin/users/:id", requireAdmin, async (req, res): Promise<void> => {
  const targetId = parseInt((req.params.id as string), 10);
  const admin    = req.user!;
  if (targetId === admin.id && req.body.role === "user") {
    res.status(400).json({ error: "Cannot remove your own admin role." });
    return;
  }
  const { plan, credits, role, status } = req.body as Record<string, string | number>;
  await db.update(usersTable).set({
    ...(plan    !== undefined && { plan:    String(plan) }),
    ...(credits !== undefined && { credits: Number(credits) }),
    ...(role    !== undefined && { role:    String(role) }),
    ...(status  !== undefined && { status:  String(status) }),
    updatedAt: new Date(),
  }).where(eq(usersTable.id, targetId));

  await db.insert(systemLogsTable).values({
    userId:      admin.id,
    type:        "admin_user_update",
    severity:    "info",
    description: `Admin updated user #${targetId} — ${JSON.stringify({ plan, credits, role, status })}`,
  });

  res.json({ ok: true });
});

// Proxy-safe alias: POST /admin/users/save (id in body)
router.post("/admin/users/save", requireAdmin, async (req, res): Promise<void> => {
  const targetId = parseInt(req.body.id, 10);
  const admin    = req.user!;
  if (!targetId) { res.status(400).json({ error: "id is required" }); return; }
  if (targetId === admin.id && req.body.role === "user") {
    res.status(400).json({ error: "Cannot remove your own admin role." });
    return;
  }
  const { plan, credits, role, status } = req.body as Record<string, string | number>;
  await db.update(usersTable).set({
    ...(plan    !== undefined && { plan:    String(plan) }),
    ...(credits !== undefined && { credits: Number(credits) }),
    ...(role    !== undefined && { role:    String(role) }),
    ...(status  !== undefined && { status:  String(status) }),
    updatedAt: new Date(),
  }).where(eq(usersTable.id, targetId));

  await db.insert(systemLogsTable).values({
    userId:      admin.id,
    type:        "admin_user_update",
    severity:    "info",
    description: `Admin updated user #${targetId} — ${JSON.stringify({ plan, credits, role, status })}`,
  });

  res.json({ ok: true });
});

router.delete("/admin/users/:id", requireAdmin, async (req, res): Promise<void> => {
  const targetId = parseInt((req.params.id as string), 10);
  const admin    = req.user!;
  if (targetId === admin.id) {
    res.status(400).json({ error: "Cannot delete your own account from the admin panel." });
    return;
  }
  await db.delete(usersTable).where(eq(usersTable.id, targetId));
  await db.insert(systemLogsTable).values({
    userId:      admin.id,
    type:        "admin_user_delete",
    severity:    "warn",
    description: `Admin deleted user #${targetId}`,
  });
  res.json({ ok: true });
});

// ─── Admin: Login as user (impersonation) ─────────────────────────────────────

router.post("/admin/users/:id/login-as", requireAdmin, async (req, res): Promise<void> => {
  const targetId = parseInt((req.params.id as string), 10);
  const admin    = req.user!;
  if (targetId === admin.id) {
    res.status(400).json({ error: "You are already signed in as yourself." });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, targetId));
  if (!user) { res.status(404).json({ error: "User not found." }); return; }

  const { signToken } = await import("../lib/auth");
  const impersonationToken = signToken({ userId: user.id, email: user.email, role: user.role });

  await db.insert(systemLogsTable).values({
    userId:      admin.id,
    type:        "admin_login_as",
    severity:    "warn",
    description: `Admin logged in as user #${targetId} (${user.email})`,
  });

  res.json({ ok: true, token: impersonationToken });
});

// ─── Admin: Reset a user's billing-period usage ────────────────────────────────

router.post("/admin/users/:id/reset-usage", requireAdmin, async (req, res): Promise<void> => {
  const targetId = parseInt((req.params.id as string), 10);
  const admin    = req.user!;
  const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, targetId));
  if (!user) { res.status(404).json({ error: "User not found." }); return; }

  const [existingSub] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.userId, targetId));
  if (existingSub) {
    await db.update(subscriptionsTable)
      .set({ currentPeriodStart: new Date(), currentPeriodEnd: null, updatedAt: new Date() })
      .where(eq(subscriptionsTable.userId, targetId));
  }

  await db.insert(systemLogsTable).values({
    userId:      admin.id,
    type:        "admin_reset_usage",
    severity:    "info",
    description: `Admin reset billing-period usage for user #${targetId}`,
  });

  res.json({ ok: true });
});

// ─── Admin: Bulk user actions ───────────────────────────────────────────────────

router.post("/admin/users/bulk", requireAdmin, async (req, res): Promise<void> => {
  const admin = req.user!;
  const { action, ids, planId } = req.body as { action: string; ids: number[]; planId?: number };

  if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids must be a non-empty array" }); return; }
  const targetIds = ids.map(Number).filter(id => id !== admin.id);
  if (targetIds.length === 0) { res.status(400).json({ error: "No valid target users (cannot act on your own account)." }); return; }

  switch (action) {
    case "suspend":
      await db.update(usersTable).set({ status: "suspended", updatedAt: new Date() }).where(inArray(usersTable.id, targetIds));
      break;
    case "activate":
      await db.update(usersTable).set({ status: "active", updatedAt: new Date() }).where(inArray(usersTable.id, targetIds));
      break;
    case "delete":
      await db.delete(usersTable).where(inArray(usersTable.id, targetIds));
      break;
    case "upgrade": {
      if (!planId) { res.status(400).json({ error: "planId is required for bulk upgrade" }); return; }
      const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, planId));
      if (!plan) { res.status(404).json({ error: "Plan not found." }); return; }
      for (const id of targetIds) {
        const [existing] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.userId, id));
        if (existing) {
          await db.update(subscriptionsTable).set({ planId, updatedAt: new Date() }).where(eq(subscriptionsTable.userId, id));
        } else {
          await db.insert(subscriptionsTable).values({ userId: id, planId, status: "active", billingStatus: "free" });
        }
      }
      await db.update(usersTable).set({ plan: plan.slug, updatedAt: new Date() }).where(inArray(usersTable.id, targetIds));
      break;
    }
    default:
      res.status(400).json({ error: `Unknown bulk action: ${action}` });
      return;
  }

  await db.insert(systemLogsTable).values({
    userId:      admin.id,
    type:        "admin_bulk_user_action",
    severity:    action === "delete" ? "warn" : "info",
    description: `Admin performed bulk "${action}" on ${targetIds.length} user(s): [${targetIds.join(", ")}]`,
  });

  res.json({ ok: true, affected: targetIds.length });
});

// Proxy-safe alias: POST /admin/users/remove (id in body)
router.post("/admin/users/remove", requireAdmin, async (req, res): Promise<void> => {
  const targetId = parseInt(req.body.id, 10);
  const admin    = req.user!;
  if (!targetId) { res.status(400).json({ error: "id is required" }); return; }
  if (targetId === admin.id) {
    res.status(400).json({ error: "Cannot delete your own account from the admin panel." });
    return;
  }
  await db.delete(usersTable).where(eq(usersTable.id, targetId));
  await db.insert(systemLogsTable).values({
    userId:      admin.id,
    type:        "admin_user_delete",
    severity:    "warn",
    description: `Admin deleted user #${targetId}`,
  });
  res.json({ ok: true });
});

// ─── Mailboxes ────────────────────────────────────────────────────────────────

router.get("/admin/mailboxes", requireAdmin, async (req, res): Promise<void> => {
  const search   = (req.query.search   as string) ?? "";
  const userId   = (req.query.userId   as string) ?? "";
  const status   = (req.query.status   as string) ?? "all";
  const provider = (req.query.provider as string) ?? "";
  const dateFrom = (req.query.dateFrom as string) ?? "";
  const dateTo   = (req.query.dateTo   as string) ?? "";
  const page     = Math.max(1, parseInt((req.query.page  as string) ?? "1",  10));
  const limit    = Math.min(100, Math.max(1, parseInt((req.query.limit as string) ?? "25", 10)));
  const offset   = (page - 1) * limit;
  const hourAgo  = new Date(Date.now() - 3_600_000);

  const conditions: ReturnType<typeof eq>[] = [];

  if (search) {
    conditions.push(or(
      ilike(mailboxesTable.smtpUser,  `%${search}%`),
      ilike(mailboxesTable.fromName,  `%${search}%`),
      ilike(mailboxesTable.smtpHost,  `%${search}%`),
      ilike(usersTable.name,          `%${search}%`),
      ilike(usersTable.email,         `%${search}%`),
    ) as any);
  }
  if (userId) {
    const uid = parseInt(userId, 10);
    if (!isNaN(uid)) conditions.push(eq(mailboxesTable.userId, uid) as any);
  }
  if (status === "active")       conditions.push(and(eq(mailboxesTable.isActive, true),  isNull(mailboxesTable.quotaStatus)) as any);
  else if (status === "inactive")     conditions.push(eq(mailboxesTable.isActive, false) as any);
  else if (status === "cooling_down") conditions.push(eq(mailboxesTable.quotaStatus, "quota_reached") as any);
  else if (status === "recovering")   conditions.push(and(eq(mailboxesTable.quotaStatus, "quota_reached"), gt(mailboxesTable.quotaProbeCount, 0)) as any);

  if (provider === "google")    conditions.push(ilike(mailboxesTable.smtpHost, "%gmail%") as any);
  else if (provider === "microsoft") conditions.push(or(ilike(mailboxesTable.smtpHost, "%outlook%"), ilike(mailboxesTable.smtpHost, "%office365%")) as any);
  else if (provider === "sendgrid")  conditions.push(ilike(mailboxesTable.smtpHost, "%sendgrid%") as any);
  else if (provider === "mailgun")   conditions.push(ilike(mailboxesTable.smtpHost, "%mailgun%") as any);
  else if (provider === "amazon")    conditions.push(ilike(mailboxesTable.smtpHost, "%amazonaws%") as any);

  if (dateFrom) { const d = new Date(dateFrom); if (!isNaN(d.getTime())) conditions.push(gte(mailboxesTable.createdAt, d) as any); }
  if (dateTo)   { const d = new Date(dateTo); d.setHours(23, 59, 59, 999); if (!isNaN(d.getTime())) conditions.push(lte(mailboxesTable.createdAt, d) as any); }

  const where = conditions.length > 0 ? and(...(conditions as any[])) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db.select({
      id:         mailboxesTable.id,
      userId:     mailboxesTable.userId,
      userName:   usersTable.name,
      userEmail:  usersTable.email,
      smtpHost:   mailboxesTable.smtpHost,
      smtpPort:   mailboxesTable.smtpPort,
      smtpUser:   mailboxesTable.smtpUser,
      smtpSecure: mailboxesTable.smtpSecure,
      fromName:   mailboxesTable.fromName,
      replyTo:    mailboxesTable.replyTo,
      imapHost:   mailboxesTable.imapHost,
      imapPort:   mailboxesTable.imapPort,
      imapUser:   mailboxesTable.imapUser,
      isActive:   mailboxesTable.isActive,
      maxPerHour: mailboxesTable.maxPerHour,
      batchSize:  mailboxesTable.batchSize,
      quotaStatus:        mailboxesTable.quotaStatus,
      quotaCooldownUntil: mailboxesTable.quotaCooldownUntil,
      quotaProbeCount:    mailboxesTable.quotaProbeCount,
      quotaSmtpResponse:  mailboxesTable.quotaSmtpResponse,
      quotaReachedAt:     mailboxesTable.quotaReachedAt,
      cooldownMinutes:    mailboxesTable.cooldownMinutes,
      probeRetryMinutes:  mailboxesTable.probeRetryMinutes,
      createdAt:  mailboxesTable.createdAt,
      updatedAt:  mailboxesTable.updatedAt,
      emailsSent:   sql<number>`(SELECT COUNT(*)::int FROM email_queue WHERE email_queue.mailbox_id = ${mailboxesTable.id} AND email_queue.status = 'success')`,
      usedThisHour: sql<number>`(SELECT COUNT(*)::int FROM email_queue WHERE email_queue.mailbox_id = ${mailboxesTable.id} AND email_queue.first_attempt_at >= ${hourAgo})`,
      deferredCount: sql<number>`(SELECT COUNT(*)::int FROM email_queue WHERE email_queue.mailbox_id = ${mailboxesTable.id} AND email_queue.status = 'deferred')`,
      pendingCount:  sql<number>`(SELECT COUNT(*)::int FROM email_queue WHERE email_queue.mailbox_id = ${mailboxesTable.id} AND email_queue.status = 'pending')`,
      failedCount:   sql<number>`(SELECT COUNT(*)::int FROM email_queue WHERE email_queue.mailbox_id = ${mailboxesTable.id} AND email_queue.status = 'failed')`,
      lastSuccessAt: sql<string | null>`(SELECT MAX(sent_at)::text FROM email_queue WHERE email_queue.mailbox_id = ${mailboxesTable.id} AND email_queue.status = 'success')`,
      lastError:     sql<string | null>`(SELECT last_error FROM email_queue WHERE email_queue.mailbox_id = ${mailboxesTable.id} AND email_queue.status IN ('failed','deferred') ORDER BY id DESC LIMIT 1)`,
      activeCampaigns: sql<number>`(SELECT COUNT(*)::int FROM campaigns WHERE campaigns.user_id = ${mailboxesTable.userId} AND campaigns.status IN ('pending','sending','paused','queued','cooling_down'))`,
      openCount:    sql<number>`(SELECT COUNT(*)::int FROM email_tracking_events ete JOIN drafts d ON d.id = ete.draft_id WHERE d.user_id = ${mailboxesTable.userId} AND ete.event_type = 'open')`,
      suppressed:   sql<number>`(SELECT COUNT(*)::int FROM suppression_list WHERE suppression_list.user_id = ${mailboxesTable.userId})`,
      userPlan:     usersTable.plan,
      userCompany:  usersTable.companyName,
    })
      .from(mailboxesTable)
      .leftJoin(usersTable, eq(mailboxesTable.userId, usersTable.id))
      .where(where)
      .orderBy(desc(mailboxesTable.updatedAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() })
      .from(mailboxesTable)
      .leftJoin(usersTable, eq(mailboxesTable.userId, usersTable.id))
      .where(where),
  ]);

  res.json({
    data: rows.map(m => ({
      ...m,
      createdAt:          m.createdAt?.toISOString()          ?? null,
      updatedAt:          m.updatedAt?.toISOString()          ?? null,
      quotaReachedAt:     m.quotaReachedAt?.toISOString()     ?? null,
      quotaCooldownUntil: m.quotaCooldownUntil?.toISOString() ?? null,
    })),
    total,
    page,
    limit,
  });
});

// ─── Mailbox Actions ──────────────────────────────────────────────────────────

router.post("/admin/mailboxes/:id/disable", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  const [mb] = await db.select({ id: mailboxesTable.id }).from(mailboxesTable).where(eq(mailboxesTable.id, id));
  if (!mb) { res.status(404).json({ error: "Mailbox not found" }); return; }
  await db.update(mailboxesTable).set({ isActive: false, updatedAt: new Date() }).where(eq(mailboxesTable.id, id));
  res.json({ success: true });
});

router.post("/admin/mailboxes/:id/enable", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  const [mb] = await db.select({ id: mailboxesTable.id }).from(mailboxesTable).where(eq(mailboxesTable.id, id));
  if (!mb) { res.status(404).json({ error: "Mailbox not found" }); return; }
  await db.update(mailboxesTable).set({ isActive: true, updatedAt: new Date() }).where(eq(mailboxesTable.id, id));
  res.json({ success: true });
});

router.post("/admin/mailboxes/:id/force-quota-reset", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  const [mb] = await db.select({ id: mailboxesTable.id }).from(mailboxesTable).where(eq(mailboxesTable.id, id));
  if (!mb) { res.status(404).json({ error: "Mailbox not found" }); return; }
  await db.update(mailboxesTable).set({
    quotaStatus:        null,
    quotaReachedAt:     null,
    quotaCooldownUntil: null,
    quotaSmtpResponse:  null,
    quotaProbeCount:    0,
    updatedAt: new Date(),
  }).where(eq(mailboxesTable.id, id));
  await db.insert(systemLogsTable).values({
    userId: req.user!.id, type: "admin_mailbox_quota_reset", severity: "info",
    description: `Admin force-reset quota state for mailbox #${id}`,
  });
  res.json({ success: true });
});

router.post("/admin/mailboxes/:id/test-connection", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  const [mailbox] = await db.select().from(mailboxesTable).where(eq(mailboxesTable.id, id));
  if (!mailbox) { res.status(404).json({ error: "Mailbox not found" }); return; }
  const decryptedPass = decrypt(mailbox.smtpPassEncrypted);
  const transport = nodemailer.createTransport(buildTransportOptions(mailbox, decryptedPass) as any);
  try {
    await transport.verify();
    res.json({ ok: true, message: "SMTP connection verified successfully" });
  } catch (err: any) {
    res.status(502).json({ ok: false, error: err?.message ?? "SMTP verification failed", code: err?.code });
  } finally {
    transport.close();
  }
});

router.get("/admin/mailboxes/:id/queue", requireAdmin, async (req, res): Promise<void> => {
  const id     = parseInt(req.params.id as string, 10);
  const page   = Math.max(1, parseInt((req.query.page  as string) ?? "1",  10));
  const limit  = Math.min(100, parseInt((req.query.limit as string) ?? "50", 10));
  const view   = (req.query.view as string) ?? "all"; // all | retry | deferred
  const offset = (page - 1) * limit;

  const baseCondition = eq(emailQueueTable.mailboxId, id);
  // "Deferred" = items currently backed off after a soft failure (status='deferred').
  // "Retry"    = items that failed at least once and are queued for another attempt.
  const where =
    view === "deferred" ? and(baseCondition, eq(emailQueueTable.status, "deferred")) :
    view === "retry"    ? and(baseCondition, inArray(emailQueueTable.status, ["pending", "queued"]), gt(emailQueueTable.attempts, 0)) :
    baseCondition;

  const [rows, [{ total }]] = await Promise.all([
    db.select({
      id:           emailQueueTable.id,
      email:        emailQueueTable.email,
      status:       emailQueueTable.status,
      attempts:     emailQueueTable.attempts,
      deferredCount: emailQueueTable.deferredCount,
      lastError:    emailQueueTable.lastError,
      sentAt:       emailQueueTable.sentAt,
      retryAfter:   emailQueueTable.retryAfter,
      createdAt:    emailQueueTable.createdAt,
    })
      .from(emailQueueTable)
      .where(where)
      .orderBy(desc(emailQueueTable.id))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(emailQueueTable).where(where),
  ]);

  res.json({
    data: rows.map(r => ({
      ...r,
      sentAt:     r.sentAt?.toISOString()     ?? null,
      retryAfter: r.retryAfter?.toISOString() ?? null,
      createdAt:  r.createdAt.toISOString(),
    })),
    total, page, limit,
  });
});

router.get("/admin/mailboxes/:id/smtp-usage", requireAdmin, async (req, res): Promise<void> => {
  const id    = parseInt(req.params.id as string, 10);
  const since = new Date(Date.now() - 24 * 3_600_000);

  const rows = await db
    .select({
      hour:    sql<string>`date_trunc('hour', ${emailQueueTable.firstAttemptAt})::text`,
      total:   count(),
      success: sql<number>`count(*) filter (where ${emailQueueTable.status} = 'success')::int`,
      failed:  sql<number>`count(*) filter (where ${emailQueueTable.status} IN ('failed','deferred'))::int`,
    })
    .from(emailQueueTable)
    .where(and(
      eq(emailQueueTable.mailboxId, id),
      isNotNull(emailQueueTable.firstAttemptAt),
      gte(emailQueueTable.firstAttemptAt, since),
    ))
    .groupBy(sql`date_trunc('hour', ${emailQueueTable.firstAttemptAt})`)
    .orderBy(sql`date_trunc('hour', ${emailQueueTable.firstAttemptAt})`);

  const peak = rows.reduce((mx, r) => Math.max(mx, Number(r.total)), 0);
  const avg  = rows.length > 0 ? Math.round(rows.reduce((s, r) => s + Number(r.total), 0) / rows.length) : 0;

  res.json({ data: rows, peak, avg });
});

// ─── POST /admin/mailboxes/:id/test-imap ─────────────────────────────────────

router.post("/admin/mailboxes/:id/test-imap", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  const [mailbox] = await db.select().from(mailboxesTable).where(eq(mailboxesTable.id, id));
  if (!mailbox) { res.status(404).json({ error: "Mailbox not found" }); return; }
  if (!mailbox.imapHost || !mailbox.imapUser || !mailbox.imapPassEncrypted) {
    res.json({ ok: false, message: "IMAP is not configured for this mailbox" });
    return;
  }
  try {
    await testImap({
      imapHost:          mailbox.imapHost,
      imapPort:          mailbox.imapPort ?? 993,
      imapUser:          mailbox.imapUser,
      imapPassEncrypted: mailbox.imapPassEncrypted,
    });
    res.json({ ok: true, message: "IMAP connection verified successfully" });
  } catch (err: any) {
    res.status(502).json({ ok: false, error: err?.message ?? "IMAP verification failed" });
  }
});

// ─── POST /admin/mailboxes/:id/force-reconnect ────────────────────────────────

router.post("/admin/mailboxes/:id/force-reconnect", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  const [mb] = await db.select({ id: mailboxesTable.id }).from(mailboxesTable).where(eq(mailboxesTable.id, id));
  if (!mb) { res.status(404).json({ error: "Mailbox not found" }); return; }
  await db.update(mailboxesTable).set({
    isActive:           true,
    quotaStatus:        null,
    quotaReachedAt:     null,
    quotaCooldownUntil: null,
    quotaSmtpResponse:  null,
    quotaProbeCount:    0,
    updatedAt:          new Date(),
  }).where(eq(mailboxesTable.id, id));
  await db.insert(systemLogsTable).values({
    userId: req.user!.id, type: "admin_mailbox_reconnect", severity: "info",
    description: `Admin force-reconnected mailbox #${id}`,
  });
  res.json({ success: true });
});

// ─── GET /admin/mailboxes/:id/smtp-history ────────────────────────────────────

router.get("/admin/mailboxes/:id/smtp-history", requireAdmin, async (req, res): Promise<void> => {
  const id     = parseInt(req.params.id as string, 10);
  const page   = Math.max(1, parseInt((req.query.page  as string) ?? "1",  10));
  const limit  = Math.min(100, parseInt((req.query.limit as string) ?? "50", 10));
  const status = (req.query.status as string) ?? "all";
  const offset = (page - 1) * limit;

  const baseCondition = eq(emailQueueTable.mailboxId, id);
  const where = status !== "all"
    ? and(baseCondition, eq(emailQueueTable.status, status))
    : baseCondition;

  const [rows, [{ total }]] = await Promise.all([
    db.select({
      id:             emailQueueTable.id,
      email:          emailQueueTable.email,
      subject:        emailQueueTable.subject,
      status:         emailQueueTable.status,
      attempts:       emailQueueTable.attempts,
      deferredCount:  emailQueueTable.deferredCount,
      lastError:      emailQueueTable.lastError,
      sentAt:         emailQueueTable.sentAt,
      firstAttemptAt: emailQueueTable.firstAttemptAt,
      createdAt:      emailQueueTable.createdAt,
      campaignId:     emailQueueTable.campaignId,
      campaignName:   campaignsTable.name,
    })
      .from(emailQueueTable)
      .leftJoin(campaignsTable, eq(emailQueueTable.campaignId, campaignsTable.id))
      .where(where)
      .orderBy(desc(emailQueueTable.id))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(emailQueueTable).where(where),
  ]);

  res.json({
    data: rows.map(r => ({
      ...r,
      sentAt:         r.sentAt?.toISOString()         ?? null,
      firstAttemptAt: r.firstAttemptAt?.toISOString() ?? null,
      createdAt:      r.createdAt.toISOString(),
    })),
    total, page, limit,
  });
});

// ─── Campaign Monitor ──────────────────────────────────────────────────────────
// Read-only, cross-user view of campaign health for admins. Never touches
// sending/processor logic — purely aggregates existing tables.

router.get("/admin/campaigns", requireAdmin, async (req, res): Promise<void> => {
  const search         = (req.query.search    as string) ?? "";
  const statusFilter   = (req.query.status    as string) ?? "all";
  const sendModeFilter = (req.query.sendMode  as string) ?? "all";
  const userIdFilter   = (req.query.userId    as string) ?? "";
  const mailboxIdFilter = (req.query.mailboxId as string) ?? "";
  const dateFrom       = (req.query.dateFrom  as string) ?? "";
  const dateTo         = (req.query.dateTo    as string) ?? "";
  const page  = Math.max(parseInt(req.query.page  as string, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit as string, 10) || 25, 1), 100);

  const conditions = [];
  if (search) {
    conditions.push(or(
      ilike(campaignsTable.name, `%${search}%`),
      ilike(usersTable.name,     `%${search}%`),
      ilike(usersTable.email,    `%${search}%`),
    ));
  }
  if (statusFilter !== "all") {
    if (statusFilter === "active") conditions.push(inArray(campaignsTable.status, ACTIVE_CAMPAIGN_STATUSES));
    else conditions.push(eq(campaignsTable.status, statusFilter));
  }
  if (sendModeFilter !== "all") conditions.push(eq(campaignsTable.sendMode, sendModeFilter));
  if (userIdFilter) {
    const uid = parseInt(userIdFilter, 10);
    if (!isNaN(uid)) conditions.push(eq(campaignsTable.userId, uid));
  }
  if (mailboxIdFilter) {
    const mid = parseInt(mailboxIdFilter, 10);
    if (!isNaN(mid)) conditions.push(sql`EXISTS(SELECT 1 FROM mailboxes WHERE mailboxes.user_id = ${campaignsTable.userId} AND mailboxes.id = ${mid})`);
  }
  if (dateFrom) conditions.push(gte(campaignsTable.createdAt, new Date(dateFrom)));
  if (dateTo)   conditions.push(lte(campaignsTable.createdAt, new Date(dateTo)));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [totalResult] = await db.select({ count: count() })
    .from(campaignsTable)
    .leftJoin(usersTable, eq(campaignsTable.userId, usersTable.id))
    .where(where);

  const campaigns = await db.select({
    id:            campaignsTable.id,
    name:          campaignsTable.name,
    status:        campaignsTable.status,
    sendMode:      campaignsTable.sendMode,
    totalLeads:    campaignsTable.totalLeads,
    sentCount:     campaignsTable.sentCount,
    draftedCount:  campaignsTable.draftedCount,
    failedCount:   campaignsTable.failedCount,
    pauseReason:   campaignsTable.pauseReason,
    cooldownUntil: campaignsTable.cooldownUntil,
    createdAt:     campaignsTable.createdAt,
    updatedAt:     campaignsTable.updatedAt,
    userId:        campaignsTable.userId,
    userName:      usersTable.name,
    userEmail:     usersTable.email,
    mailboxHost: sql<string | null>`(SELECT smtp_host FROM mailboxes WHERE mailboxes.user_id = campaigns.user_id LIMIT 1)`,
    mailboxId:   sql<number | null>`(SELECT id FROM mailboxes WHERE mailboxes.user_id = campaigns.user_id LIMIT 1)`,
    mailboxQuotaStatus: sql<string | null>`(SELECT quota_status FROM mailboxes WHERE mailboxes.user_id = campaigns.user_id LIMIT 1)`,
    recentErrorsCount: sql<number>`(SELECT COUNT(*)::int FROM leads WHERE leads.campaign_id = campaigns.id AND leads.status = 'failed')`,
    openCount: sql<number>`(SELECT COUNT(DISTINCT ete.draft_id)::int FROM email_tracking_events ete JOIN drafts d ON d.id = ete.draft_id WHERE d.campaign_id = campaigns.id AND ete.event_type = 'open')`,
  })
    .from(campaignsTable)
    .leftJoin(usersTable, eq(campaignsTable.userId, usersTable.id))
    .where(where)
    .orderBy(desc(campaignsTable.updatedAt))
    .limit(limit)
    .offset((page - 1) * limit);

  res.json({
    data: campaigns.map(c => ({
      ...c,
      createdAt:     c.createdAt.toISOString(),
      updatedAt:     c.updatedAt.toISOString(),
      cooldownUntil: c.cooldownUntil?.toISOString() ?? null,
    })),
    total: totalResult?.count ?? 0,
    page, limit,
  });
});

// ─── GET /admin/campaigns/:id — detail: lead breakdown + recent failures ──────
router.get("/admin/campaigns/:id", requireAdmin, async (req, res): Promise<void> => {
  const campaignId = parseInt(req.params.id as string, 10);
  if (!campaignId) { res.status(400).json({ error: "Invalid campaign id" }); return; }

  const [campaign] = await db.select({
    id:            campaignsTable.id,
    name:          campaignsTable.name,
    status:        campaignsTable.status,
    sendMode:      campaignsTable.sendMode,
    totalLeads:    campaignsTable.totalLeads,
    sentCount:     campaignsTable.sentCount,
    draftedCount:  campaignsTable.draftedCount,
    failedCount:   campaignsTable.failedCount,
    pauseReason:   campaignsTable.pauseReason,
    cooldownUntil: campaignsTable.cooldownUntil,
    currentJobId:  campaignsTable.currentJobId,
    createdAt:     campaignsTable.createdAt,
    updatedAt:     campaignsTable.updatedAt,
    userId:        campaignsTable.userId,
    userName:      usersTable.name,
    userEmail:     usersTable.email,
  }).from(campaignsTable)
    .leftJoin(usersTable, eq(campaignsTable.userId, usersTable.id))
    .where(eq(campaignsTable.id, campaignId));
  if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }

  const statuses = ["new", "queued", "sending", "sent", "drafted", "failed"] as const;
  const counts: Record<string, number> = {};
  for (const s of statuses) {
    const [row] = await db.select({ count: sql<number>`count(*)::int` })
      .from(leadsTable)
      .where(and(eq(leadsTable.campaignId, campaignId), eq(leadsTable.status, s)));
    counts[s] = row?.count ?? 0;
  }

  const recentFailures = await db.select({
    id:           leadsTable.id,
    name:         leadsTable.name,
    email:        leadsTable.email,
    errorMessage: leadsTable.errorMessage,
    updatedAt:    leadsTable.updatedAt,
  }).from(leadsTable)
    .where(and(eq(leadsTable.campaignId, campaignId), eq(leadsTable.status, "failed")))
    .orderBy(desc(leadsTable.updatedAt))
    .limit(20);

  const recentQueueErrors = await db.select({
    id:        emailQueueTable.id,
    email:     emailQueueTable.email,
    lastError: emailQueueTable.lastError,
    attempts:  emailQueueTable.attempts,
    status:    emailQueueTable.status,
    createdAt: emailQueueTable.createdAt,
  }).from(emailQueueTable)
    .where(and(eq(emailQueueTable.campaignId, campaignId), isNotNull(emailQueueTable.lastError)))
    .orderBy(desc(emailQueueTable.createdAt))
    .limit(20);

  res.json({
    ...campaign,
    createdAt:     campaign.createdAt.toISOString(),
    updatedAt:     campaign.updatedAt.toISOString(),
    cooldownUntil: campaign.cooldownUntil?.toISOString() ?? null,
    leadCounts:    counts,
    recentFailures: recentFailures.map(f => ({ ...f, updatedAt: f.updatedAt.toISOString() })),
    recentQueueErrors: recentQueueErrors.map(f => ({ ...f, createdAt: f.createdAt.toISOString() })),
  });
});

// ─── Admin campaign actions: Pause / Resume / Cancel ─────────────────────────
// These update campaign status in the DB only. The running processor detects
// the status change on its next iteration poll and stops/continues accordingly.
// Resume sets status back to "sending" — if a processor was actively running
// it will continue; if it had already exited the campaign owner must restart
// from their own dashboard. This keeps admin actions safely decoupled from
// the campaign processor lifecycle.

router.post("/admin/campaigns/:id/pause", requireAdmin, async (req, res): Promise<void> => {
  const campaignId = parseInt(req.params.id as string, 10);
  if (!campaignId) { res.status(400).json({ success: false, error: "Invalid campaign id" }); return; }

  try {
    const [campaign] = await db.select({ id: campaignsTable.id, status: campaignsTable.status })
      .from(campaignsTable).where(eq(campaignsTable.id, campaignId));
    if (!campaign) { res.status(404).json({ success: false, error: "Campaign not found" }); return; }

    await db.update(campaignsTable)
      .set({ status: "paused", updatedAt: new Date() })
      .where(eq(campaignsTable.id, campaignId));

    await db.insert(systemLogsTable).values({
      userId: req.user!.id, type: "admin_campaign_pause", severity: "info",
      description: `Admin paused campaign #${campaignId}`,
    });

    res.json({ success: true, status: "paused" });
  } catch (err: any) {
    logger.error({ err, campaignId }, `Admin pause campaign error: ${err?.message}`);
    res.status(500).json({ success: false, error: err?.message ?? "Failed to pause campaign" });
  }
});

router.post("/admin/campaigns/:id/resume", requireAdmin, async (req, res): Promise<void> => {
  const campaignId = parseInt(req.params.id as string, 10);
  if (!campaignId) { res.status(400).json({ success: false, error: "Invalid campaign id" }); return; }

  try {
    const [campaign] = await db.select({ id: campaignsTable.id, status: campaignsTable.status })
      .from(campaignsTable).where(eq(campaignsTable.id, campaignId));
    if (!campaign) { res.status(404).json({ success: false, error: "Campaign not found" }); return; }
    if (campaign.status !== "paused") {
      res.status(400).json({ success: false, error: "Only paused campaigns can be resumed" }); return;
    }

    await db.update(campaignsTable)
      .set({ status: "sending", updatedAt: new Date() })
      .where(eq(campaignsTable.id, campaignId));

    await db.insert(systemLogsTable).values({
      userId: req.user!.id, type: "admin_campaign_resume", severity: "info",
      description: `Admin resumed campaign #${campaignId}`,
    });

    res.json({ success: true, status: "sending" });
  } catch (err: any) {
    logger.error({ err, campaignId }, `Admin resume campaign error: ${err?.message}`);
    res.status(500).json({ success: false, error: err?.message ?? "Failed to resume campaign" });
  }
});

router.post("/admin/campaigns/:id/cancel", requireAdmin, async (req, res): Promise<void> => {
  const campaignId = parseInt(req.params.id as string, 10);
  if (!campaignId) { res.status(400).json({ success: false, error: "Invalid campaign id" }); return; }

  try {
    const [campaign] = await db.select({ id: campaignsTable.id, status: campaignsTable.status })
      .from(campaignsTable).where(eq(campaignsTable.id, campaignId));
    if (!campaign) { res.status(404).json({ success: false, error: "Campaign not found" }); return; }
    if (campaign.status === "cancelled" || campaign.status === "completed") {
      res.status(400).json({ success: false, error: "Campaign is already finished" }); return;
    }

    await db.update(campaignsTable)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(campaignsTable.id, campaignId));

    await db.insert(systemLogsTable).values({
      userId: req.user!.id, type: "admin_campaign_cancel", severity: "warn",
      description: `Admin cancelled campaign #${campaignId}`,
    });

    res.json({ success: true, status: "cancelled" });
  } catch (err: any) {
    logger.error({ err, campaignId }, `Admin cancel campaign error: ${err?.message}`);
    res.status(500).json({ success: false, error: err?.message ?? "Failed to cancel campaign" });
  }
});

// ─── GET /admin/campaigns/:id/queue — email queue items for a campaign ─────────

router.get("/admin/campaigns/:id/queue", requireAdmin, async (req, res): Promise<void> => {
  const campaignId = parseInt(req.params.id as string, 10);
  if (!campaignId) { res.status(400).json({ error: "Invalid campaign id" }); return; }

  const page  = Math.max(parseInt(req.query.page  as string, 10) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 100);

  const [totalResult] = await db.select({ count: count() })
    .from(emailQueueTable)
    .where(eq(emailQueueTable.campaignId, campaignId));

  const items = await db.select({
    id:            emailQueueTable.id,
    email:         emailQueueTable.email,
    status:        emailQueueTable.status,
    attempts:      emailQueueTable.attempts,
    deferredCount: emailQueueTable.deferredCount,
    lastError:     emailQueueTable.lastError,
    sentAt:        emailQueueTable.sentAt,
    retryAfter:    emailQueueTable.retryAfter,
    createdAt:     emailQueueTable.createdAt,
  })
    .from(emailQueueTable)
    .where(eq(emailQueueTable.campaignId, campaignId))
    .orderBy(desc(emailQueueTable.createdAt))
    .limit(limit)
    .offset((page - 1) * limit);

  res.json({
    data: items.map(i => ({
      ...i,
      sentAt:     i.sentAt?.toISOString()     ?? null,
      retryAfter: i.retryAfter?.toISOString() ?? null,
      createdAt:  i.createdAt.toISOString(),
    })),
    total: totalResult?.count ?? 0,
    page, limit,
  });
});

// ─── TEMPORARY diagnostic: verify SMTP auth via the exact sendEmail() path ────
// Admin-only, read-only, never sends an email. Uses the same decrypt() and
// buildTransportOptions() helpers sendEmail() uses, and calls transporter.verify()
// instead of transporter.sendMail(). Delete this route once the investigation
// it supports is closed out.
router.get("/admin/debug/smtp", requireAdmin, async (_req, res): Promise<void> => {
  // Same mailbox lookup pattern used by the campaign processor (the primary
  // sender path): first active mailbox for a user, by isActive flag — NOT a
  // specific mailbox_id. See comparison notes below for how this differs from
  // composer.ts's explicit-id lookup.
  const [mailbox] = await db.select().from(mailboxesTable)
    .where(eq(mailboxesTable.isActive, true));

  if (!mailbox) {
    res.status(404).json({ error: "No active mailbox found." });
    return;
  }

  const encryptionKeyFingerprint = crypto
    .createHash("sha256")
    .update(process.env.ENCRYPTION_KEY ?? "brokermail-ai-smtp-enc-key-v1!!32")
    .digest("hex");

  // Exact same call as sendEmail(): decrypt(mailbox.smtpPassEncrypted)
  const decryptedPass = decrypt(mailbox.smtpPassEncrypted);
  const decryptedPassFingerprint = crypto.createHash("sha256").update(decryptedPass).digest("hex");

  const meta = {
    mailboxId:               mailbox.id,
    userId:                  mailbox.userId,
    smtpHost:                mailbox.smtpHost,
    smtpPort:                mailbox.smtpPort,
    smtpUser:                mailbox.smtpUser,
    smtpSecure:              mailbox.smtpSecure,
    encryptedPasswordLength: mailbox.smtpPassEncrypted?.length ?? 0,
    decryptedPasswordLength: decryptedPass.length,
    decryptedPasswordSha256: decryptedPassFingerprint,
    encryptionKeySha256:     encryptionKeyFingerprint,
    encryptionKeyEnvSet:     !!process.env.ENCRYPTION_KEY,
  };

  // Exact same transporter construction as sendEmail(): buildTransportOptions(mailbox, decryptedPass)
  const transport = nodemailer.createTransport(
    buildTransportOptions(mailbox, decryptedPass) as any,
  );

  try {
    await transport.verify();
    res.json({ ok: true, verify: "success", ...meta });
  } catch (err: any) {
    // Intentionally NOT calling friendlySmtpError() — return the raw
    // nodemailer error untouched, per diagnostic requirements.
    res.status(502).json({
      ok: false,
      verify: "failed",
      ...meta,
      error: {
        message:      err?.message,
        code:         err?.code,
        responseCode: err?.responseCode,
        response:     err?.response,
        command:      err?.command,
        stack:        err?.stack,
      },
    });
  } finally {
    transport.close();
  }
});

// ─── Analytics ────────────────────────────────────────────────────────────────

router.get("/admin/analytics", requireAdmin, async (req, res): Promise<void> => {
  const days      = Math.min(Math.max(parseInt(req.query.days as string, 10) || 30, 7), 90);
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days + 1);
  startDate.setHours(0, 0, 0, 0);

  const [sentRows, failedRows] = await Promise.all([
    db.select({
      date: sql<string>`(created_at AT TIME ZONE 'UTC')::date::text`,
      cnt:  count(),
    }).from(draftsTable)
      .where(and(eq(draftsTable.status, "success"), gte(draftsTable.createdAt, startDate)))
      .groupBy(sql`(created_at AT TIME ZONE 'UTC')::date`)
      .orderBy(sql`(created_at AT TIME ZONE 'UTC')::date`),

    db.select({
      date: sql<string>`(created_at AT TIME ZONE 'UTC')::date::text`,
      cnt:  count(),
    }).from(draftsTable)
      .where(and(eq(draftsTable.status, "failed"), gte(draftsTable.createdAt, startDate)))
      .groupBy(sql`(created_at AT TIME ZONE 'UTC')::date`)
      .orderBy(sql`(created_at AT TIME ZONE 'UTC')::date`),
  ]);

  const sentMap = Object.fromEntries(sentRows.map(r  => [r.date, r.cnt]));
  const failMap = Object.fromEntries(failedRows.map(r => [r.date, r.cnt]));

  const result = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().split("T")[0];
    result.push({ date: dateStr, sent: sentMap[dateStr] ?? 0, failed: failMap[dateStr] ?? 0 });
  }

  res.json(result);
});

// ─── Analytics Overview (Phase 11) ────────────────────────────────────────────
// Full-platform analytics: overview cards, trend charts, and leaderboard tables.
// Revenue/MRR/ARR are intentionally excluded — no billing processor is wired up
// yet, so those cards are left as explicit "billing integration required"
// placeholders on the frontend rather than computed from subscription rows.

function analyticsDateRange(req: import("express").Request): { start: Date; end: Date; label: string } {
  const range = (req.query.range as string) || "30d";
  const end = new Date();
  let start: Date;
  let label = range;

  if (range === "custom" && req.query.start && req.query.end) {
    start = new Date(req.query.start as string);
    const customEnd = new Date(req.query.end as string);
    if (!isNaN(start.getTime()) && !isNaN(customEnd.getTime())) {
      start.setHours(0, 0, 0, 0);
      customEnd.setHours(23, 59, 59, 999);
      return { start, end: customEnd, label: "custom" };
    }
  }

  switch (range) {
    case "today":
      start = new Date();
      start.setHours(0, 0, 0, 0);
      label = "today";
      break;
    case "7d":
      start = new Date(end.getTime() - 7 * 86_400_000);
      break;
    case "90d":
      start = new Date(end.getTime() - 90 * 86_400_000);
      break;
    case "30d":
    default:
      start = new Date(end.getTime() - 30 * 86_400_000);
      label = "30d";
      break;
  }
  return { start, end, label };
}

/** Buckets a start/end range into per-day labels for time-series charts (capped at 92 points). */
function dayBuckets(start: Date, end: Date): string[] {
  const days: string[] = [];
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  const last = new Date(end);
  last.setHours(0, 0, 0, 0);
  let guard = 0;
  while (cursor.getTime() <= last.getTime() && guard < 92) {
    days.push(cursor.toISOString().split("T")[0]);
    cursor.setDate(cursor.getDate() + 1);
    guard++;
  }
  return days.length > 0 ? days : [new Date().toISOString().split("T")[0]];
}

function inferMailboxProvider(host: string): string {
  const h = (host || "").toLowerCase();
  if (h.includes("gmail") || h.includes("google")) return "Google";
  if (h.includes("outlook") || h.includes("office365") || h.includes("hotmail")) return "Microsoft";
  if (h.includes("secureserver") || h.includes("godaddy")) return "GoDaddy";
  if (h.includes("titan") || h.includes("hostinger")) return "Hostinger";
  if (h.includes("privateemail") || h.includes("namecheap")) return "Namecheap";
  if (h.includes("zoho")) return "Zoho";
  if (h.includes("sendgrid")) return "SendGrid";
  if (h.includes("mailgun")) return "Mailgun";
  if (h.includes("amazonaws")) return "Amazon SES";
  if (h.includes("yahoo")) return "Yahoo";
  if (h.includes("fastmail")) return "Fastmail";
  if (h.includes("protonmail")) return "Proton";
  return host || "Unknown";
}

router.get("/admin/analytics/overview", requireAdmin, async (req, res): Promise<void> => {
  const { start, end, label: rangeLabel } = analyticsDateRange(req);
  const days = dayBuckets(start, end);
  const dayCol = (col: any) => sql<string>`(${col} AT TIME ZONE 'UTC')::date::text`;

  const [
    [totalUsers], [activeUsers], [trialUsers], [payingUsers],
    [campaignsSent], [gmailSent], [gmailFailed], [smtpSent], [smtpFailed],
    [openCount], [clickCount], [bounceCount], [unsubscribes], [suppressions],
    gmailByDay, smtpByDay, userByDay, campaignByDay, subByDay, openByDay, bounceByDay,
    activeMailboxes, planRows,
    topCustomers, mostActiveUsers, topCampaigns, largestMailboxes,
  ] = await Promise.all([
    db.select({ count: count() }).from(usersTable),
    db.select({ count: count() }).from(usersTable).where(eq(usersTable.status, "active")),
    db.select({ count: count() }).from(usersTable).where(and(eq(usersTable.status, "active"), eq(usersTable.plan, "free"))),
    db.select({ count: count() }).from(usersTable).where(and(eq(usersTable.status, "active"), sql`${usersTable.plan} != 'free'`)),
    db.select({ count: count() }).from(campaignsTable)
      .where(and(gt(campaignsTable.sentCount, 0), gte(campaignsTable.createdAt, start), lte(campaignsTable.createdAt, end))),
    db.select({ count: count() }).from(draftsTable)
      .where(and(eq(draftsTable.status, "success"), gte(draftsTable.createdAt, start), lte(draftsTable.createdAt, end))),
    db.select({ count: count() }).from(draftsTable)
      .where(and(eq(draftsTable.status, "failed"), gte(draftsTable.createdAt, start), lte(draftsTable.createdAt, end))),
    db.select({ count: count() }).from(emailQueueTable)
      .where(and(eq(emailQueueTable.status, "success"), gte(emailQueueTable.createdAt, start), lte(emailQueueTable.createdAt, end))),
    db.select({ count: count() }).from(emailQueueTable)
      .where(and(eq(emailQueueTable.status, "failed"), gte(emailQueueTable.createdAt, start), lte(emailQueueTable.createdAt, end))),
    db.select({ count: sql<number>`count(distinct ${emailTrackingEventsTable.draftId})` }).from(emailTrackingEventsTable)
      .where(and(eq(emailTrackingEventsTable.eventType, "open"), gte(emailTrackingEventsTable.createdAt, start), lte(emailTrackingEventsTable.createdAt, end))),
    db.select({ count: sql<number>`count(distinct ${emailTrackingEventsTable.draftId})` }).from(emailTrackingEventsTable)
      .where(and(eq(emailTrackingEventsTable.eventType, "click"), gte(emailTrackingEventsTable.createdAt, start), lte(emailTrackingEventsTable.createdAt, end))),
    db.select({ count: count() }).from(processedBouncesTable)
      .where(and(gte(processedBouncesTable.processedAt, start), lte(processedBouncesTable.processedAt, end))),
    db.select({ count: count() }).from(suppressionListTable)
      .where(and(eq(suppressionListTable.source, "unsubscribe_link"), gte(suppressionListTable.createdAt, start), lte(suppressionListTable.createdAt, end))),
    db.select({ count: count() }).from(suppressionListTable)
      .where(and(gte(suppressionListTable.createdAt, start), lte(suppressionListTable.createdAt, end))),

    db.select({ date: dayCol(draftsTable.createdAt), cnt: count() }).from(draftsTable)
      .where(and(eq(draftsTable.status, "success"), gte(draftsTable.createdAt, start), lte(draftsTable.createdAt, end)))
      .groupBy(sql`(${draftsTable.createdAt} AT TIME ZONE 'UTC')::date`),
    db.select({ date: dayCol(emailQueueTable.createdAt), cnt: count() }).from(emailQueueTable)
      .where(and(eq(emailQueueTable.status, "success"), gte(emailQueueTable.createdAt, start), lte(emailQueueTable.createdAt, end)))
      .groupBy(sql`(${emailQueueTable.createdAt} AT TIME ZONE 'UTC')::date`),
    db.select({ date: dayCol(usersTable.createdAt), cnt: count() }).from(usersTable)
      .where(and(gte(usersTable.createdAt, start), lte(usersTable.createdAt, end)))
      .groupBy(sql`(${usersTable.createdAt} AT TIME ZONE 'UTC')::date`),
    db.select({ date: dayCol(campaignsTable.createdAt), cnt: count() }).from(campaignsTable)
      .where(and(gte(campaignsTable.createdAt, start), lte(campaignsTable.createdAt, end)))
      .groupBy(sql`(${campaignsTable.createdAt} AT TIME ZONE 'UTC')::date`),
    db.select({ date: dayCol(subscriptionsTable.createdAt), cnt: count() }).from(subscriptionsTable)
      .where(and(gte(subscriptionsTable.createdAt, start), lte(subscriptionsTable.createdAt, end)))
      .groupBy(sql`(${subscriptionsTable.createdAt} AT TIME ZONE 'UTC')::date`),
    db.select({ date: dayCol(emailTrackingEventsTable.createdAt), cnt: sql<number>`count(distinct ${emailTrackingEventsTable.draftId})` }).from(emailTrackingEventsTable)
      .where(and(eq(emailTrackingEventsTable.eventType, "open"), gte(emailTrackingEventsTable.createdAt, start), lte(emailTrackingEventsTable.createdAt, end)))
      .groupBy(sql`(${emailTrackingEventsTable.createdAt} AT TIME ZONE 'UTC')::date`),
    db.select({ date: dayCol(processedBouncesTable.processedAt), cnt: count() }).from(processedBouncesTable)
      .where(and(gte(processedBouncesTable.processedAt, start), lte(processedBouncesTable.processedAt, end)))
      .groupBy(sql`(${processedBouncesTable.processedAt} AT TIME ZONE 'UTC')::date`),

    db.select({ smtpHost: mailboxesTable.smtpHost }).from(mailboxesTable).where(eq(mailboxesTable.isActive, true)),
    db.select({ plan: usersTable.plan, cnt: count() }).from(usersTable)
      .where(eq(usersTable.status, "active")).groupBy(usersTable.plan),

    db.select({
      userId: usersTable.id, name: usersTable.name, email: usersTable.email, plan: usersTable.plan,
      gmailSent: sql<number>`(select count(*) from ${draftsTable} where ${draftsTable.userId} = ${usersTable.id} and ${draftsTable.status} = 'success' and ${draftsTable.createdAt} between ${start} and ${end})`,
      smtpSent: sql<number>`(select count(*) from ${emailQueueTable} where ${emailQueueTable.userId} = ${usersTable.id} and ${emailQueueTable.status} = 'success' and ${emailQueueTable.createdAt} between ${start} and ${end})`,
    }).from(usersTable)
      .orderBy(sql`(
        (select count(*) from ${draftsTable} where ${draftsTable.userId} = ${usersTable.id} and ${draftsTable.status} = 'success' and ${draftsTable.createdAt} between ${start} and ${end}) +
        (select count(*) from ${emailQueueTable} where ${emailQueueTable.userId} = ${usersTable.id} and ${emailQueueTable.status} = 'success' and ${emailQueueTable.createdAt} between ${start} and ${end})
      ) desc`)
      .limit(10),

    db.select({
      userId: usersTable.id, name: usersTable.name, email: usersTable.email, lastActiveAt: usersTable.lastActiveAt,
      campaignCount: sql<number>`(select count(*) from ${campaignsTable} where ${campaignsTable.userId} = ${usersTable.id} and ${campaignsTable.createdAt} between ${start} and ${end})`,
    }).from(usersTable)
      .where(isNotNull(usersTable.lastActiveAt))
      .orderBy(desc(usersTable.lastActiveAt))
      .limit(10),

    db.select({
      id: campaignsTable.id, name: campaignsTable.name, status: campaignsTable.status,
      sentCount: campaignsTable.sentCount, totalLeads: campaignsTable.totalLeads,
      userName: usersTable.name, createdAt: campaignsTable.createdAt,
    }).from(campaignsTable).leftJoin(usersTable, eq(campaignsTable.userId, usersTable.id))
      .where(and(gte(campaignsTable.createdAt, start), lte(campaignsTable.createdAt, end)))
      .orderBy(desc(campaignsTable.sentCount))
      .limit(10),

    db.select({
      id: mailboxesTable.id, smtpHost: mailboxesTable.smtpHost, smtpUser: mailboxesTable.smtpUser,
      userName: usersTable.name,
      sendCount: sql<number>`(select count(*) from ${emailQueueTable} where ${emailQueueTable.mailboxId} = ${mailboxesTable.id} and ${emailQueueTable.status} = 'success')`,
    }).from(mailboxesTable).leftJoin(usersTable, eq(mailboxesTable.userId, usersTable.id))
      .orderBy(sql`(select count(*) from ${emailQueueTable} where ${emailQueueTable.mailboxId} = ${mailboxesTable.id} and ${emailQueueTable.status} = 'success') desc`)
      .limit(10),
  ]);

  const gmailMap = Object.fromEntries(gmailByDay.map((r: any) => [r.date, Number(r.cnt)]));
  const smtpMap  = Object.fromEntries(smtpByDay.map((r: any) => [r.date, Number(r.cnt)]));
  const userMap  = Object.fromEntries(userByDay.map((r: any) => [r.date, Number(r.cnt)]));
  const campMap  = Object.fromEntries(campaignByDay.map((r: any) => [r.date, Number(r.cnt)]));
  const subMap   = Object.fromEntries(subByDay.map((r: any) => [r.date, Number(r.cnt)]));
  const openMap  = Object.fromEntries(openByDay.map((r: any) => [r.date, Number(r.cnt)]));
  const bounceMap = Object.fromEntries(bounceByDay.map((r: any) => [r.date, Number(r.cnt)]));

  const emailByDay      = days.map(d => ({ date: d, gmail: gmailMap[d] ?? 0, smtp: smtpMap[d] ?? 0, total: (gmailMap[d] ?? 0) + (smtpMap[d] ?? 0) }));
  const userByDayOut     = days.map(d => ({ date: d, new: userMap[d] ?? 0 }));
  const campaignByDayOut = days.map(d => ({ date: d, new: campMap[d] ?? 0 }));
  const subscriptionByDayOut = days.map(d => ({ date: d, new: subMap[d] ?? 0 }));
  const openRateByDayOut = days.map(d => {
    const sent = (gmailMap[d] ?? 0) + (smtpMap[d] ?? 0);
    return { date: d, rate: sent > 0 ? Math.round(((openMap[d] ?? 0) / sent) * 1000) / 10 : 0 };
  });
  const bounceRateByDayOut = days.map(d => {
    const sent = (gmailMap[d] ?? 0) + (smtpMap[d] ?? 0);
    return { date: d, rate: sent > 0 ? Math.round(((bounceMap[d] ?? 0) / sent) * 1000) / 10 : 0 };
  });

  const providerCounts: Record<string, number> = {};
  for (const mb of activeMailboxes) {
    const p = inferMailboxProvider(mb.smtpHost);
    providerCounts[p] = (providerCounts[p] ?? 0) + 1;
  }

  const emailsSent = gmailSent.count + smtpSent.count;
  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);

  res.json({
    range: { label: rangeLabel, start: start.toISOString(), end: end.toISOString() },
    cards: {
      totalUsers: totalUsers.count,
      activeUsers: activeUsers.count,
      trialUsers: trialUsers.count,
      payingUsers: payingUsers.count,
      campaignsSent: campaignsSent.count,
      emailsSent,
      smtpSuccessRate: pct(smtpSent.count, smtpSent.count + smtpFailed.count),
      gmailSuccessRate: pct(gmailSent.count, gmailSent.count + gmailFailed.count),
      openRate: pct(openCount.count, emailsSent),
      bounceRate: pct(bounceCount.count, emailsSent),
      clickRate: pct(clickCount.count, emailsSent),
      unsubscribes: unsubscribes.count,
      suppressions: suppressions.count,
      // Revenue metrics require the billing processor (Lemon Squeezy) to be connected.
      revenue: null, mrr: null, arr: null,
    },
    charts: {
      emailVolume: emailByDay,
      userGrowth: userByDayOut,
      campaignActivity: campaignByDayOut,
      subscriptionGrowth: subscriptionByDayOut,
      openRateTrend: openRateByDayOut,
      bounceTrend: bounceRateByDayOut,
      smtpVsGmail: { smtp: smtpSent.count, gmail: gmailSent.count },
      mailboxProviders: Object.entries(providerCounts).map(([provider, cnt]) => ({ provider, count: cnt })),
      planDistribution: planRows.map(p => ({ plan: p.plan, count: p.cnt })),
      revenueGrowth: null,
    },
    tables: {
      topCustomers: topCustomers.map((c: any) => ({ ...c, totalSent: Number(c.gmailSent) + Number(c.smtpSent) })),
      mostActiveUsers: mostActiveUsers.map((u: any) => ({ ...u, lastActiveAt: u.lastActiveAt?.toISOString() ?? null })),
      topCampaigns: topCampaigns.map((c: any) => ({ ...c, createdAt: c.createdAt.toISOString() })),
      largestMailboxes: largestMailboxes.map((m: any) => ({ ...m, provider: inferMailboxProvider(m.smtpHost) })),
    },
  });
});

router.get("/admin/analytics/export", requireAdmin, async (req, res): Promise<void> => {
  const format = ((req.query.format as string) || "csv").toLowerCase();
  const { start, end, label: rangeLabel } = analyticsDateRange(req);

  // Re-fetch the same overview payload so export always matches what's on screen.
  const overviewReq = { query: req.query } as any;
  const { start: s, end: e } = analyticsDateRange(overviewReq);

  const [gmailSent, smtpSent, totalUsers, campaignsSent] = await Promise.all([
    db.select({ count: count() }).from(draftsTable).where(and(eq(draftsTable.status, "success"), gte(draftsTable.createdAt, s), lte(draftsTable.createdAt, e))),
    db.select({ count: count() }).from(emailQueueTable).where(and(eq(emailQueueTable.status, "success"), gte(emailQueueTable.createdAt, s), lte(emailQueueTable.createdAt, e))),
    db.select({ count: count() }).from(usersTable),
    db.select({ count: count() }).from(campaignsTable).where(and(gt(campaignsTable.sentCount, 0), gte(campaignsTable.createdAt, s), lte(campaignsTable.createdAt, e))),
  ]);

  const rows: [string, string | number][] = [
    ["Range", rangeLabel],
    ["Start", s.toISOString()],
    ["End", e.toISOString()],
    ["Total Users", totalUsers[0].count],
    ["Campaigns Sent", campaignsSent[0].count],
    ["Emails Sent (Gmail)", gmailSent[0].count],
    ["Emails Sent (SMTP)", smtpSent[0].count],
    ["Emails Sent (Total)", gmailSent[0].count + smtpSent[0].count],
  ];

  const filename = `analytics_${rangeLabel}_${new Date().toISOString().split("T")[0]}`;

  if (format === "xlsx") {
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.aoa_to_sheet([["Metric", "Value"], ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Analytics");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.xlsx"`);
    res.send(buf);
    return;
  }

  const csv = ["Metric,Value", ...rows.map(([k, v]) => `"${k}",${v}`)].join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}.csv"`);
  res.send(csv);
});

// ─── Platform Monitoring (Phase 12) ───────────────────────────────────────────
// Real-time operational status for the admin "System Monitoring" page.
// Read-only aggregation over existing tables/process metrics — no new schema.

function diskUsage(): { totalGb: number; usedGb: number; freeGb: number; usedPct: number } | null {
  try {
    const stats = fs.statfsSync("/");
    const totalBytes = stats.blocks * stats.bsize;
    const freeBytes  = stats.bfree  * stats.bsize;
    const usedBytes  = totalBytes - freeBytes;
    return {
      totalGb: Math.round((totalBytes / 1024 ** 3) * 10) / 10,
      freeGb:  Math.round((freeBytes  / 1024 ** 3) * 10) / 10,
      usedGb:  Math.round((usedBytes  / 1024 ** 3) * 10) / 10,
      usedPct: totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0,
    };
  } catch {
    return null;
  }
}

router.get("/admin/platform-health", requireAdmin, async (_req, res): Promise<void> => {
  const startedAt = Date.now();
  const since1h  = new Date(Date.now() - 3_600_000);
  const since24h = new Date(Date.now() - 86_400_000);

  // Database round-trip latency, measured with a trivial query
  let dbStatus = "operational";
  let dbLatencyMs = 0;
  try {
    const t0 = Date.now();
    await db.execute(sql`select 1`);
    dbLatencyMs = Date.now() - t0;
    if (dbLatencyMs > 1000) dbStatus = "degraded";
  } catch {
    dbStatus = "down";
  }

  const [
    [queuePending], [queueSending], [queueDeferred], [queueFailed], [queueSuccess],
    [sessions1h], [sessions24h], [errors1h], [errors24h],
    runningCampaigns, failedQueueRows, recentErrorLogs,
    [smtpActiveRow], [gmailActiveRow], [bounceRecentRow],
  ] = await Promise.all([
    db.select({ count: count() }).from(emailQueueTable).where(eq(emailQueueTable.status, "pending")),
    db.select({ count: count() }).from(emailQueueTable).where(eq(emailQueueTable.status, "sending")),
    db.select({ count: count() }).from(emailQueueTable).where(eq(emailQueueTable.status, "deferred")),
    db.select({ count: count() }).from(emailQueueTable).where(eq(emailQueueTable.status, "failed")),
    db.select({ count: count() }).from(emailQueueTable).where(eq(emailQueueTable.status, "success")),
    db.select({ count: count() }).from(usersTable).where(gte(usersTable.lastActiveAt, since1h)),
    db.select({ count: count() }).from(usersTable).where(gte(usersTable.lastActiveAt, since24h)),
    db.select({ count: count() }).from(systemLogsTable).where(and(eq(systemLogsTable.severity, "error"), gte(systemLogsTable.createdAt, since1h))),
    db.select({ count: count() }).from(systemLogsTable).where(and(eq(systemLogsTable.severity, "error"), gte(systemLogsTable.createdAt, since24h))),
    db.select({
      id: campaignsTable.id, name: campaignsTable.name, status: campaignsTable.status,
      sentCount: campaignsTable.sentCount, totalLeads: campaignsTable.totalLeads,
      updatedAt: campaignsTable.updatedAt,
    }).from(campaignsTable).where(inArray(campaignsTable.status, ["sending", "cooling_down"]))
      .orderBy(desc(campaignsTable.updatedAt)).limit(10),
    db.select({
      id: emailQueueTable.id, email: emailQueueTable.email, campaignId: emailQueueTable.campaignId,
      lastError: emailQueueTable.lastError, attempts: emailQueueTable.attempts, createdAt: emailQueueTable.createdAt,
    }).from(emailQueueTable).where(eq(emailQueueTable.status, "failed"))
      .orderBy(desc(emailQueueTable.id)).limit(10),
    db.select({
      id: systemLogsTable.id, type: systemLogsTable.type, description: systemLogsTable.description, createdAt: systemLogsTable.createdAt,
    }).from(systemLogsTable).where(eq(systemLogsTable.severity, "error"))
      .orderBy(desc(systemLogsTable.createdAt)).limit(10),
    db.select({ count: count() }).from(emailQueueTable).where(eq(emailQueueTable.status, "sending")),
    db.select({ count: count() }).from(draftsTable).where(and(eq(draftsTable.status, "pending"), gte(draftsTable.createdAt, since1h))),
    db.select({ count: count() }).from(processedBouncesTable).where(gte(processedBouncesTable.processedAt, since1h)),
  ]);

  const mem = process.memoryUsage();
  const loadAvg = os.loadavg();
  const totalMemMb = Math.round(os.totalmem() / 1024 / 1024);
  const freeMemMb  = Math.round(os.freemem()  / 1024 / 1024);
  const usedMemMb  = totalMemMb - freeMemMb;

  const cronStates = getCronJobStates();
  const bounceCron = cronStates.find(c => c.name === "Bounce Scanner");
  const bounceLastSuccessMs = bounceCron?.lastSuccessAt ? Date.now() - new Date(bounceCron.lastSuccessAt).getTime() : null;
  const imapStatus = bounceCron?.lastError
    ? "down"
    : bounceLastSuccessMs === null
      ? "checking"
      : bounceLastSuccessMs < 180_000 ? "operational" : "degraded";

  res.json({
    api: {
      status: "operational",
      uptimeSeconds: Math.round(process.uptime()),
      memUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
      memTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
      rssMemMb: Math.round(mem.rss / 1024 / 1024),
      nodeVersion: process.version,
      pid: process.pid,
    },
    system: {
      cpuLoad1m: Math.round(loadAvg[0] * 100) / 100,
      cpuLoad5m: Math.round(loadAvg[1] * 100) / 100,
      cpuLoad15m: Math.round(loadAvg[2] * 100) / 100,
      totalMemMb, freeMemMb, usedMemMb,
      memPct: totalMemMb > 0 ? Math.round((usedMemMb / totalMemMb) * 100) : 0,
      cpuCount: os.cpus().length,
      platform: `${os.platform()} ${os.arch()}`,
    },
    disk: diskUsage(),
    database: { status: dbStatus, latencyMs: dbLatencyMs },
    queue: {
      pending: queuePending.count, sending: queueSending.count, deferred: queueDeferred.count,
      failed: queueFailed.count, success: queueSuccess.count,
    },
    workers: {
      smtpActive: smtpActiveRow.count > 0,
      gmailActive: gmailActiveRow.count > 0,
      bounceScanner: bounceRecentRow.count > 0 || (bounceLastSuccessMs !== null && bounceLastSuccessMs < 180_000),
    },
    imap: {
      status: imapStatus,
      lastScanAt: bounceCron?.lastSuccessAt ?? null,
      detail: bounceCron?.lastError ? bounceCron.lastError : "Bounce scanner IMAP connection",
    },
    cronJobs: cronStates,
    runningJobs: runningCampaigns.map(c => ({
      id: c.id, name: c.name, status: c.status,
      progress: c.totalLeads > 0 ? Math.round((c.sentCount / c.totalLeads) * 100) : 0,
      sentCount: c.sentCount, totalLeads: c.totalLeads,
      updatedAt: c.updatedAt.toISOString(),
    })),
    failedJobs: failedQueueRows.map(f => ({
      id: f.id, email: f.email, campaignId: f.campaignId,
      lastError: f.lastError, attempts: f.attempts, createdAt: f.createdAt.toISOString(),
    })),
    recentErrors: recentErrorLogs.map(e => ({
      id: e.id, type: e.type, description: e.description, createdAt: e.createdAt.toISOString(),
    })),
    sessions: { active24h: sessions24h.count, active1h: sessions1h.count },
    errors: { last24h: errors24h.count, last1h: errors1h.count },
    checkedAt: new Date().toISOString(),
    responseMs: Date.now() - startedAt,
  });
});

// ─── Platform Monitoring — Restart Actions ────────────────────────────────────

router.post("/admin/monitoring/run-bounce-scan", requireAdmin, async (_req, res): Promise<void> => {
  try {
    runBounceScanner(startCampaignProcessor).catch(err => logger.error({ err }, "[MONITORING] Manual bounce scan failed"));
    await db.insert(systemLogsTable).values({
      type: "monitoring", severity: "info", description: "Admin manually triggered a bounce scan",
    });
    res.json({ success: true, message: "Bounce scan started" });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to start bounce scan" });
  }
});

router.post("/admin/monitoring/queue/:id/retry", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (!id) { res.status(400).json({ error: "Invalid queue id" }); return; }

  const [row] = await db.select().from(emailQueueTable).where(eq(emailQueueTable.id, id));
  if (!row) { res.status(404).json({ error: "Queue item not found" }); return; }
  if (row.status !== "failed") { res.status(400).json({ error: "Only failed items can be retried" }); return; }

  await db.update(emailQueueTable)
    .set({ status: "pending", lastError: null, retryAfter: null })
    .where(eq(emailQueueTable.id, id));

  if (row.campaignId) startCampaignProcessor(row.campaignId).catch(() => {});

  await db.insert(systemLogsTable).values({
    type: "monitoring", severity: "info", description: `Admin retried failed queue item #${id} (${row.email})`,
  });
  res.json({ success: true });
});

router.post("/admin/monitoring/queue/retry-all", requireAdmin, async (_req, res): Promise<void> => {
  const failedRows = await db.select({ id: emailQueueTable.id, campaignId: emailQueueTable.campaignId })
    .from(emailQueueTable).where(eq(emailQueueTable.status, "failed")).limit(200);

  if (failedRows.length === 0) { res.json({ success: true, retried: 0 }); return; }

  await db.update(emailQueueTable)
    .set({ status: "pending", lastError: null, retryAfter: null })
    .where(inArray(emailQueueTable.id, failedRows.map(r => r.id)));

  const campaignIds = [...new Set(failedRows.map(r => r.campaignId).filter((v): v is number => v != null))];
  campaignIds.forEach(cid => startCampaignProcessor(cid).catch(() => {}));

  await db.insert(systemLogsTable).values({
    type: "monitoring", severity: "info", description: `Admin bulk-retried ${failedRows.length} failed queue item(s)`,
  });
  res.json({ success: true, retried: failedRows.length });
});

// ─── Global Queue Management ──────────────────────────────────────────────────
// Full queue visibility + bulk actions. Admin-only, real production data only.

router.get("/admin/queue", requireAdmin, async (req, res): Promise<void> => {
  const page       = Math.max(parseInt(req.query.page       as string, 10) || 1, 1);
  const limit      = Math.min(parseInt(req.query.limit      as string, 10) || 50, 100);
  const userId     = (req.query.userId     as string) ?? "";
  const mailboxId  = (req.query.mailboxId  as string) ?? "";
  const campaignId = (req.query.campaignId as string) ?? "";
  const status     = (req.query.status     as string) ?? "all";
  const dateFrom   = (req.query.dateFrom   as string) ?? "";
  const dateTo     = (req.query.dateTo     as string) ?? "";

  const conditions: ReturnType<typeof eq>[] = [];
  if (userId)     { const uid = parseInt(userId,     10); if (!isNaN(uid)) conditions.push(eq(emailQueueTable.userId,     uid) as any); }
  if (mailboxId)  { const mid = parseInt(mailboxId,  10); if (!isNaN(mid)) conditions.push(eq(emailQueueTable.mailboxId,  mid) as any); }
  if (campaignId) { const cid = parseInt(campaignId, 10); if (!isNaN(cid)) conditions.push(eq(emailQueueTable.campaignId, cid) as any); }
  if (status !== "all") conditions.push(eq(emailQueueTable.status, status) as any);
  if (dateFrom) { const d = new Date(dateFrom); if (!isNaN(d.getTime())) conditions.push(gte(emailQueueTable.createdAt, d) as any); }
  if (dateTo)   { const d = new Date(dateTo); d.setHours(23,59,59,999); if (!isNaN(d.getTime())) conditions.push(lte(emailQueueTable.createdAt, d) as any); }

  const where = conditions.length > 0 ? and(...(conditions as any[])) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db.select({
      id:            emailQueueTable.id,
      jobId:         emailQueueTable.jobId,
      userId:        emailQueueTable.userId,
      userName:      usersTable.name,
      userEmail:     usersTable.email,
      mailboxId:     emailQueueTable.mailboxId,
      mailboxEmail:  mailboxesTable.smtpUser,
      campaignId:    emailQueueTable.campaignId,
      campaignName:  campaignsTable.name,
      email:         emailQueueTable.email,
      subject:       emailQueueTable.subject,
      status:        emailQueueTable.status,
      attempts:      emailQueueTable.attempts,
      deferredCount: emailQueueTable.deferredCount,
      lastError:     emailQueueTable.lastError,
      retryAfter:    emailQueueTable.retryAfter,
      sentAt:        emailQueueTable.sentAt,
      firstAttemptAt: emailQueueTable.firstAttemptAt,
      createdAt:     emailQueueTable.createdAt,
    })
      .from(emailQueueTable)
      .leftJoin(usersTable,     eq(emailQueueTable.userId,    usersTable.id))
      .leftJoin(mailboxesTable, eq(emailQueueTable.mailboxId, mailboxesTable.id))
      .leftJoin(campaignsTable, eq(emailQueueTable.campaignId, campaignsTable.id))
      .where(where)
      .orderBy(desc(emailQueueTable.id))
      .limit(limit)
      .offset((page - 1) * limit),
    db.select({ total: count() }).from(emailQueueTable).where(where),
  ]);

  res.json({
    data: rows.map(r => ({
      ...r,
      retryAfter:     r.retryAfter?.toISOString()     ?? null,
      sentAt:         r.sentAt?.toISOString()         ?? null,
      firstAttemptAt: r.firstAttemptAt?.toISOString() ?? null,
      createdAt:      r.createdAt.toISOString(),
    })),
    total, page, limit,
  });
});

router.get("/admin/queue/counts", requireAdmin, async (_req, res): Promise<void> => {
  const rows = await db
    .select({ status: emailQueueTable.status, count: sql<number>`count(*)::int` })
    .from(emailQueueTable)
    .groupBy(emailQueueTable.status);
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.status] = r.count;
  res.json(counts);
});

router.post("/admin/queue/retry-selected", requireAdmin, async (req, res): Promise<void> => {
  const ids: number[] = Array.isArray(req.body?.ids)
    ? req.body.ids.filter((id: unknown) => typeof id === "number")
    : [];
  if (ids.length === 0) { res.status(400).json({ error: "No IDs provided" }); return; }

  const rows = await db.select({ id: emailQueueTable.id, campaignId: emailQueueTable.campaignId })
    .from(emailQueueTable)
    .where(and(inArray(emailQueueTable.id, ids), inArray(emailQueueTable.status, ["failed", "deferred"])));
  if (rows.length === 0) { res.json({ success: true, retried: 0 }); return; }

  await db.update(emailQueueTable)
    .set({ status: "pending", lastError: null, retryAfter: null })
    .where(inArray(emailQueueTable.id, rows.map(r => r.id)));

  const campaignIds = [...new Set(rows.map(r => r.campaignId).filter((v): v is number => v != null))];
  campaignIds.forEach(cid => startCampaignProcessor(cid).catch(() => {}));

  await db.insert(systemLogsTable).values({
    userId: req.user!.id, type: "monitoring", severity: "info",
    description: `Admin retried ${rows.length} selected queue item(s)`,
  });
  res.json({ success: true, retried: rows.length });
});

router.post("/admin/queue/retry-deferred", requireAdmin, async (req, res): Promise<void> => {
  const rows = await db.select({ id: emailQueueTable.id, campaignId: emailQueueTable.campaignId })
    .from(emailQueueTable).where(eq(emailQueueTable.status, "deferred")).limit(500);
  if (rows.length === 0) { res.json({ success: true, retried: 0 }); return; }

  await db.update(emailQueueTable)
    .set({ status: "pending", retryAfter: null })
    .where(inArray(emailQueueTable.id, rows.map(r => r.id)));

  const campaignIds = [...new Set(rows.map(r => r.campaignId).filter((v): v is number => v != null))];
  campaignIds.forEach(cid => startCampaignProcessor(cid).catch(() => {}));

  await db.insert(systemLogsTable).values({
    userId: req.user!.id, type: "monitoring", severity: "info",
    description: `Admin retried ${rows.length} deferred queue item(s)`,
  });
  res.json({ success: true, retried: rows.length });
});

router.post("/admin/queue/retry-failed", requireAdmin, async (req, res): Promise<void> => {
  const rows = await db.select({ id: emailQueueTable.id, campaignId: emailQueueTable.campaignId })
    .from(emailQueueTable).where(eq(emailQueueTable.status, "failed")).limit(500);
  if (rows.length === 0) { res.json({ success: true, retried: 0 }); return; }

  await db.update(emailQueueTable)
    .set({ status: "pending", lastError: null, retryAfter: null })
    .where(inArray(emailQueueTable.id, rows.map(r => r.id)));

  const campaignIds = [...new Set(rows.map(r => r.campaignId).filter((v): v is number => v != null))];
  campaignIds.forEach(cid => startCampaignProcessor(cid).catch(() => {}));

  await db.insert(systemLogsTable).values({
    userId: req.user!.id, type: "monitoring", severity: "info",
    description: `Admin retried ${rows.length} failed queue item(s) (global)`,
  });
  res.json({ success: true, retried: rows.length });
});

router.post("/admin/queue/clear-selected", requireAdmin, async (req, res): Promise<void> => {
  const ids: number[] = Array.isArray(req.body?.ids)
    ? req.body.ids.filter((id: unknown) => typeof id === "number")
    : [];
  if (ids.length === 0) { res.status(400).json({ error: "No IDs provided" }); return; }

  // Only delete from emailQueueTable — does NOT touch campaigns, sent email history, or statistics
  const [{ removed }] = await db.select({ removed: sql<number>`count(*)::int` })
    .from(emailQueueTable)
    .where(inArray(emailQueueTable.id, ids));

  await db.delete(emailQueueTable).where(inArray(emailQueueTable.id, ids));

  await db.insert(systemLogsTable).values({
    userId: req.user!.id, type: "monitoring", severity: "warn",
    description: `Admin cleared ${removed} selected queue item(s) by ID`,
  });
  res.json({ success: true, removed });
});

router.post("/admin/queue/clear", requireAdmin, async (req, res): Promise<void> => {
  const status = (req.body?.status as string) ?? "";
  const CLEARABLE = ["pending", "deferred", "failed", "success", "cancelled", "all"];
  if (!CLEARABLE.includes(status)) {
    res.status(400).json({ error: `status must be one of: ${CLEARABLE.join(", ")}` }); return;
  }

  // Only deletes from emailQueueTable — does NOT modify campaigns, sent email history, or statistics
  const where = status === "all" ? undefined : eq(emailQueueTable.status, status);
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(emailQueueTable).where(where);

  if (where) {
    await db.delete(emailQueueTable).where(where);
  } else {
    await db.delete(emailQueueTable);
  }

  await db.insert(systemLogsTable).values({
    userId: req.user!.id, type: "monitoring", severity: "warn",
    description: `Admin cleared ${total} queue item(s) with status="${status}"`,
  });
  res.json({ success: true, removed: total });
});

// ─── Per-mailbox queue counts + actions ───────────────────────────────────────

router.get("/admin/mailboxes/:id/queue-counts", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (!id) { res.status(400).json({ error: "Invalid mailbox id" }); return; }
  const rows = await db
    .select({ status: emailQueueTable.status, count: sql<number>`count(*)::int` })
    .from(emailQueueTable)
    .where(eq(emailQueueTable.mailboxId, id))
    .groupBy(emailQueueTable.status);
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.status] = r.count;
  res.json(counts);
});

router.post("/admin/mailboxes/:id/retry-deferred", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (!id) { res.status(400).json({ error: "Invalid mailbox id" }); return; }

  const rows = await db.select({ id: emailQueueTable.id, campaignId: emailQueueTable.campaignId })
    .from(emailQueueTable)
    .where(and(eq(emailQueueTable.mailboxId, id), eq(emailQueueTable.status, "deferred")))
    .limit(500);
  if (rows.length === 0) { res.json({ success: true, retried: 0 }); return; }

  await db.update(emailQueueTable)
    .set({ status: "pending", retryAfter: null })
    .where(inArray(emailQueueTable.id, rows.map(r => r.id)));

  const campaignIds = [...new Set(rows.map(r => r.campaignId).filter((v): v is number => v != null))];
  campaignIds.forEach(cid => startCampaignProcessor(cid).catch(() => {}));

  await db.insert(systemLogsTable).values({
    userId: req.user!.id, type: "monitoring", severity: "info",
    description: `Admin retried ${rows.length} deferred items for mailbox #${id}`,
  });
  res.json({ success: true, retried: rows.length });
});

router.post("/admin/mailboxes/:id/retry-failed", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (!id) { res.status(400).json({ error: "Invalid mailbox id" }); return; }

  const rows = await db.select({ id: emailQueueTable.id, campaignId: emailQueueTable.campaignId })
    .from(emailQueueTable)
    .where(and(eq(emailQueueTable.mailboxId, id), eq(emailQueueTable.status, "failed")))
    .limit(500);
  if (rows.length === 0) { res.json({ success: true, retried: 0 }); return; }

  await db.update(emailQueueTable)
    .set({ status: "pending", lastError: null, retryAfter: null })
    .where(inArray(emailQueueTable.id, rows.map(r => r.id)));

  const campaignIds = [...new Set(rows.map(r => r.campaignId).filter((v): v is number => v != null))];
  campaignIds.forEach(cid => startCampaignProcessor(cid).catch(() => {}));

  await db.insert(systemLogsTable).values({
    userId: req.user!.id, type: "monitoring", severity: "info",
    description: `Admin retried ${rows.length} failed items for mailbox #${id}`,
  });
  res.json({ success: true, retried: rows.length });
});

router.post("/admin/mailboxes/:id/clear-queue", requireAdmin, async (req, res): Promise<void> => {
  const id     = parseInt(req.params.id as string, 10);
  if (!id) { res.status(400).json({ error: "Invalid mailbox id" }); return; }
  const status = (req.body?.status as string) ?? "";
  const CLEARABLE = ["pending", "deferred", "failed", "success", "cancelled"];
  if (!CLEARABLE.includes(status)) {
    res.status(400).json({ error: `status must be one of: ${CLEARABLE.join(", ")}` }); return;
  }

  const where = and(eq(emailQueueTable.mailboxId, id), eq(emailQueueTable.status, status));
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(emailQueueTable).where(where);
  await db.delete(emailQueueTable).where(where);

  await db.insert(systemLogsTable).values({
    userId: req.user!.id, type: "monitoring", severity: "warn",
    description: `Admin cleared ${total} ${status} queue item(s) for mailbox #${id}`,
  });
  res.json({ success: true, removed: total });
});

// ─── Logs ─────────────────────────────────────────────────────────────────────

router.get("/admin/logs", requireAdmin, async (req, res): Promise<void> => {
  const page     = Math.max(parseInt(req.query.page     as string, 10) || 1, 1);
  const limit    = Math.min(parseInt(req.query.limit    as string, 10) || 50, 200);
  const severity = (req.query.severity as string) || "all";
  const search   = (req.query.search   as string) || "";

  const conditions = [];
  if (severity !== "all") conditions.push(eq(systemLogsTable.severity, severity));
  if (search)             conditions.push(or(
    ilike(systemLogsTable.type,        `%${search}%`),
    ilike(systemLogsTable.description, `%${search}%`),
  ));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [totalResult] = await db.select({ count: count() }).from(systemLogsTable).where(where);
  const logs = await db.select().from(systemLogsTable)
    .where(where)
    .orderBy(desc(systemLogsTable.createdAt))
    .limit(limit)
    .offset((page - 1) * limit);

  res.json({
    data:  logs.map(l => ({ ...l, createdAt: l.createdAt.toISOString() })),
    total: totalResult.count,
    page,
    limit,
  });
});

// ─── Settings ─────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: Record<string, string> = {
  // General
  platformName:        "BrokerMail AI",
  legalCompanyName:    "BrokerMAIL AI LLC",
  websiteUrl:          "https://brokermail.ai",
  supportEmail:        "",
  salesEmail:          "",
  billingEmail:        "",
  contactPhone:        "",
  companyAddress:      "",
  businessHours:       "Mon–Fri, 9am–6pm EST",
  timezone:            "EST",
  supportResponseTime: "1 business day",
  facebook:            "",
  linkedin:            "",
  twitter:             "",
  whatsapp:            "",
  telegram:            "",
  footerText:          "Built for the auto transport industry.",
  maintenanceMode:      "false",
  maintenanceMessage:   "",
  maintenanceReturnTime: "",
  maintenanceStartedAt:  "",
  // Branding
  defaultAccentColor:  "#1d4ed8",
  defaultEmailSlogan:  "Your #1 Auto Transport Partner",
  defaultEmailStyle:   "clean",
  defaultButtonStyle:  "rounded",
  defaultFont:         "inter",
  // SMTP controls
  defaultBatchSize:    "10",
  defaultDelaySeconds: "15",
  defaultMaxPerHour:   "100",
  queueEnabled:        "true",
  autoRetryEnabled:    "true",
  maxRetryAttempts:    "3",
  maxEmailsPerDay:     "1000",
  maxLeadsPerUpload:   "10000",
  emailLimitPerUser:   "500",
  // AI
  aiModel:       "gpt-4o-mini",
  aiEnabled:     "true",
  aiTemperature: "0.7",
  dailyAiLimit:  "500",
  // Users
  allowRegistrations:       "true",
  requireEmailVerification: "false",
  freeMonthlyEmailLimit:    "100",
  freeBatchLimit:           "10",
  autoSuspendOnAbuse:       "false",
  // Billing
  stripePublishableKey: "",
  stripeWebhookSecret:  "",
  creditsPerDollar:     "100",
  creditSystemEnabled:  "false",
  freeTrialDays:        "0",
  // Security
  sessionTimeoutHours:   "24",
  loginRateLimit:        "10",
  failedLoginThreshold:  "5",
  requireAdminMfa:       "false",
  // CMS
  heroTitle:      "Close more transport deals with AI-powered outreach.",
  heroSubtitle:   "Upload lead sheets, personalize emails instantly, and send directly from your own business mailbox.",
  heroSlogan:     "Built specifically for auto transport brokers.",
  faqContent:     "",
  pricingContent: "",
  contactContent: "",
  // Email Provider Management
  gmailDraftsEnabled:       "true",
  smtpSendingEnabled:       "true",
  imapSyncEnabled:          "true",
  providerGmail:            "true",
  providerOutlook:          "true",
  providerHostinger:        "true",
  providerGoDaddy:          "true",
  providerZoho:             "true",
  providerNamecheap:        "true",
  providerPrivateMail:      "true",
  // Global Email Controls
  platformMaxEmailsPerHour: "500",
  minDelaySecs:             "5",
  spamScoreThreshold:       "7",
  queueCooldownMins:        "5",
  bounceRateThreshold:      "5",
  // User Plan Permissions
  planFreeMaxUploadsDay:       "3",
  planProMaxUploadsDay:        "20",
  planEnterpriseMaxUploadsDay: "100",
  planFreeMaxContactsMonth:    "500",
  planProMaxContactsMonth:     "5000",
  planEnterpriseMaxContactsMonth: "50000",
  planFreeSmtp:                "false",
  planProSmtp:                 "true",
  planEnterpriseSmtp:          "true",
  planFreeAi:                  "false",
  planProAi:                   "true",
  planEnterpriseAi:            "true",
  planFreeBranding:            "false",
  planProBranding:             "true",
  planEnterpriseBranding:      "true",
  planFreePriority:            "false",
  planProPriority:             "false",
  planEnterprisePriority:      "true",
  // Credits System
  freeTrialCredits:  "50",
  aiCreditCost:      "5",
  emailCreditCost:   "1",
  // Admin Notifications
  adminNotificationEmail: "",
  notifySmtpFailures:     "true",
  notifyBouncedEmails:    "true",
  notifyFailedPayments:   "true",
  notifySpamComplaints:   "true",
  notifyServerIssues:     "true",
  // Legal CMS
  privacyPolicy:    "",
  termsOfService:   "",
  refundPolicy:     "",
  aboutPageContent: "",
  // Feature Toggles
  featureLandingPage:        "true",
  featurePublicRegistration: "true",
  featureAiWriter:           "true",
  featureSmtpSending:        "true",
  featureGmailDrafts:        "true",
  featureQueueSystem:        "true",
  featureAnalytics:          "true",
  // Tracking & Deliverability
  appUrl:               "",
  trackingUrl:          "",
  openTrackingEnabled:  "true",
  clickTrackingEnabled: "true",
  bounceEnabled:        "false",
  bounceImapHost:       "",
  bounceImapPort:       "993",
  bounceImapUser:       "",
  bounceImapPass:       "",
  bounceImapFolder:     "INBOX",
  bounceScanInterval:   "60",
  // Super Admin Protection
  superAdminEmail:        "",
  auditAllActions:        "true",
  preventAccidentalDelete: "true",
};

router.get("/admin/settings", requireAdmin, async (_req, res): Promise<void> => {
  const rows   = await db.select().from(adminSettingsTable);
  const stored = Object.fromEntries(rows.map(r => [r.key, r.value]));
  res.json({ ...DEFAULT_SETTINGS, ...stored });
});

// Proxy-safe alias: POST /admin/settings (same as PUT)
router.post("/admin/settings", requireAdmin, async (req, res): Promise<void> => {
  const admin   = req.user!;
  const updates = req.body as Record<string, string>;

  if (updates.maintenanceMode === "true") {
    const [existing] = await db
      .select({ value: adminSettingsTable.value })
      .from(adminSettingsTable)
      .where(eq(adminSettingsTable.key, "maintenanceMode"));
    if (!existing || existing.value !== "true") {
      updates.maintenanceStartedAt = new Date().toISOString();
    }
  }
  if (updates.maintenanceMode === "false") {
    updates.maintenanceStartedAt = "";
  }

  for (const [key, value] of Object.entries(updates)) {
    await db.insert(adminSettingsTable)
      .values({ key, value: String(value), updatedAt: new Date() })
      .onConflictDoUpdate({
        target: adminSettingsTable.key,
        set:    { value: String(value), updatedAt: new Date() },
      });
  }

  const { invalidateMaintenanceCache } = await import("../lib/maintenance");
  invalidateMaintenanceCache();
  const { invalidateTrackingSettingsCache } = await import("../lib/tracking-settings");
  invalidateTrackingSettingsCache();

  await db.insert(systemLogsTable).values({
    userId:      admin.id,
    type:        "admin_settings_update",
    severity:    "info",
    description: `Admin updated platform settings: ${Object.keys(updates).join(", ")}`,
  });

  res.json({ ok: true });
});

router.put("/admin/settings", requireAdmin, async (req, res): Promise<void> => {
  const admin   = req.user!;
  const updates = req.body as Record<string, string>;

  // Auto-stamp maintenanceStartedAt the first time maintenance is switched ON
  if (updates.maintenanceMode === "true") {
    const [existing] = await db
      .select({ value: adminSettingsTable.value })
      .from(adminSettingsTable)
      .where(eq(adminSettingsTable.key, "maintenanceMode"));
    if (!existing || existing.value !== "true") {
      updates.maintenanceStartedAt = new Date().toISOString();
    }
  }
  // Clear the timestamp when turning OFF
  if (updates.maintenanceMode === "false") {
    updates.maintenanceStartedAt = "";
  }

  for (const [key, value] of Object.entries(updates)) {
    await db.insert(adminSettingsTable)
      .values({ key, value: String(value), updatedAt: new Date() })
      .onConflictDoUpdate({
        target: adminSettingsTable.key,
        set:    { value: String(value), updatedAt: new Date() },
      });
  }

  // Invalidate in-memory caches immediately
  const { invalidateMaintenanceCache } = await import("../lib/maintenance");
  invalidateMaintenanceCache();
  const { invalidateTrackingSettingsCache } = await import("../lib/tracking-settings");
  invalidateTrackingSettingsCache();

  await db.insert(systemLogsTable).values({
    userId:      admin.id,
    type:        "admin_settings_update",
    severity:    "info",
    description: `Admin updated platform settings: ${Object.keys(updates).join(", ")}`,
  });

  res.json({ ok: true });
});

// ─── Public settings endpoint (for frontend to read CMS content etc.) ─────────

router.get("/admin/public-settings", async (_req, res): Promise<void> => {
  const PUBLIC_KEYS = [
    "platformName", "legalCompanyName", "websiteUrl",
    "footerText", "defaultAccentColor", "defaultEmailSlogan",
    "heroTitle", "heroSubtitle", "heroSlogan", "faqContent",
    "pricingContent", "contactContent", "maintenanceMode",
    "maintenanceMessage", "maintenanceReturnTime", "maintenanceStartedAt",
    "supportEmail", "salesEmail", "billingEmail", "contactPhone",
    "companyAddress", "businessHours", "timezone", "supportResponseTime",
    "facebook", "linkedin", "twitter", "whatsapp", "telegram",
    "allowRegistrations",
  ];
  const rows   = await db.select().from(adminSettingsTable);
  const stored = Object.fromEntries(rows.map(r => [r.key, r.value]));
  const result: Record<string, string> = {};
  PUBLIC_KEYS.forEach(k => { result[k] = stored[k] ?? DEFAULT_SETTINGS[k] ?? ""; });
  res.json(result);
});

// ─── Billing: Plans ────────────────────────────────────────────────────────────

router.get("/admin/plans", requireAdmin, async (_req, res): Promise<void> => {
  const plans = await db.select().from(plansTable).orderBy(plansTable.sortOrder);
  res.json(plans);
});

// Parse an integer from an unknown value. Unlike `parseInt(...) || 0`, this
// correctly preserves -1 (Unlimited) and 0 as distinct valid values.
function safeInt(v: unknown, def = 0): number {
  const n = parseInt(String(v), 10);
  return isNaN(n) ? def : n;
}

router.post("/admin/plans", requireAdmin, async (req, res): Promise<void> => {
  const admin = req.user!;
  const {
    name, slug, description = "", price = 0, priceLabel = "Free",
    isPopular = false, buttonText = "Request Access", supportLevel = "Email",
    monthlyEmailLimit = 500, smtpAccountsLimit = 1, campaignsLimit = 5,
    batchSendLimit = 50, features = [], sortOrder = 0, isActive = true,
  } = req.body;

  if (!name || !slug) { res.status(400).json({ error: "name and slug are required." }); return; }

  const [plan] = await db.insert(plansTable).values({
    name, slug, description,
    price: safeInt(price),
    priceLabel,
    isPopular: !!isPopular,
    buttonText,
    supportLevel,
    monthlyEmailLimit: safeInt(monthlyEmailLimit, 500),
    smtpAccountsLimit: safeInt(smtpAccountsLimit, 1),
    campaignsLimit:    safeInt(campaignsLimit, 5),
    batchSendLimit:    safeInt(batchSendLimit, 50),
    features: Array.isArray(features) ? features : [],
    sortOrder: safeInt(sortOrder),
    isActive: !!isActive,
  }).returning();

  await db.insert(systemLogsTable).values({
    userId: admin.id,
    type: "admin_plan_create",
    severity: "info",
    description: `Admin created plan "${name}" (${slug}) — price: ${price} cents`,
  });

  res.json(plan);
});

router.put("/admin/plans/:id", requireAdmin, async (req, res): Promise<void> => {
  const id    = parseInt((req.params.id as string), 10);
  const admin = req.user!;
  const {
    name, description, price, priceLabel, isPopular, buttonText, supportLevel,
    monthlyEmailLimit, smtpAccountsLimit, campaignsLimit, batchSendLimit,
    features, sortOrder, isActive,
  } = req.body;

  await db.update(plansTable).set({
    ...(name              !== undefined && { name }),
    ...(description       !== undefined && { description }),
    ...(price             !== undefined && { price: safeInt(price) }),
    ...(priceLabel        !== undefined && { priceLabel }),
    ...(isPopular         !== undefined && { isPopular: !!isPopular }),
    ...(buttonText        !== undefined && { buttonText }),
    ...(supportLevel      !== undefined && { supportLevel }),
    ...(monthlyEmailLimit !== undefined && { monthlyEmailLimit: safeInt(monthlyEmailLimit) }),
    ...(smtpAccountsLimit !== undefined && { smtpAccountsLimit: safeInt(smtpAccountsLimit) }),
    ...(campaignsLimit    !== undefined && { campaignsLimit:    safeInt(campaignsLimit) }),
    ...(batchSendLimit    !== undefined && { batchSendLimit:    safeInt(batchSendLimit) }),
    ...(features          !== undefined && { features: Array.isArray(features) ? features : [] }),
    ...(sortOrder         !== undefined && { sortOrder: safeInt(sortOrder) }),
    ...(isActive          !== undefined && { isActive: !!isActive }),
    updatedAt: new Date(),
  }).where(eq(plansTable.id, id));

  await db.insert(systemLogsTable).values({
    userId:      admin.id,
    type:        "admin_plan_update",
    severity:    "info",
    description: `Admin updated plan #${id} — price: ${price} cents`,
  });

  res.json({ ok: true });
});

router.delete("/admin/plans/:id", requireAdmin, async (req, res): Promise<void> => {
  const admin  = req.user!;
  const planId = parseInt((req.params.id as string), 10);

  const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, planId));
  if (!plan) { res.status(404).json({ error: "Plan not found." }); return; }

  const subCount = await db.select({ c: count() }).from(subscriptionsTable)
    .where(eq(subscriptionsTable.planId, planId));
  if (subCount[0].c > 0) {
    res.status(400).json({ error: `Cannot delete: ${subCount[0].c} active subscription(s) use this plan. Hide it instead.` });
    return;
  }

  await db.delete(plansTable).where(eq(plansTable.id, planId));

  await db.insert(systemLogsTable).values({
    userId: admin.id,
    type: "admin_plan_delete",
    severity: "warn",
    description: `Admin deleted plan "${plan.name}" (${plan.slug})`,
  });

  res.json({ ok: true });
});

// ─── Billing: Subscriptions ────────────────────────────────────────────────────

router.get("/admin/subscriptions", requireAdmin, async (_req, res): Promise<void> => {
  const subs = await db.select({
    userId:               subscriptionsTable.userId,
    userName:             usersTable.name,
    userEmail:            usersTable.email,
    planId:               subscriptionsTable.planId,
    planName:             plansTable.name,
    planSlug:             plansTable.slug,
    billingStatus:        subscriptionsTable.billingStatus,
    status:               subscriptionsTable.status,
    monthlyEmailLimit:    plansTable.monthlyEmailLimit,
    smtpAccountsUsed:     sql<number>`(SELECT COUNT(*)::int FROM mailboxes WHERE mailboxes.user_id = ${subscriptionsTable.userId} AND mailboxes.is_active = true)`,
    emailsSentThisMonth:  sql<number>`(SELECT COUNT(*)::int FROM drafts WHERE drafts.user_id = ${subscriptionsTable.userId} AND drafts.status = 'success' AND drafts.created_at >= date_trunc('month', now()))`,
    currentPeriodStart:   subscriptionsTable.currentPeriodStart,
    currentPeriodEnd:     subscriptionsTable.currentPeriodEnd,
    stripeCustomerId:     subscriptionsTable.stripeCustomerId,
    stripeSubscriptionId: subscriptionsTable.stripeSubscriptionId,
  })
    .from(subscriptionsTable)
    .leftJoin(usersTable, eq(subscriptionsTable.userId, usersTable.id))
    .leftJoin(plansTable, eq(subscriptionsTable.planId, plansTable.id))
    .orderBy(desc(subscriptionsTable.createdAt));

  res.json(subs.map(s => ({
    ...s,
    currentPeriodStart: s.currentPeriodStart?.toISOString() ?? null,
    currentPeriodEnd:   s.currentPeriodEnd?.toISOString()   ?? null,
  })));
});

// ─── Billing: Plan Requests ────────────────────────────────────────────────────

router.get("/admin/plan-requests", requireAdmin, async (req, res): Promise<void> => {
  const statusFilter = (req.query.status as string) || "all";
  const fromPlans    = await db.select({ id: plansTable.id, name: plansTable.name }).from(plansTable);
  const planMap      = Object.fromEntries(fromPlans.map(p => [p.id, p.name]));

  const rows = await db.select({
    id:         planRequestsTable.id,
    userId:     planRequestsTable.userId,
    userName:   usersTable.name,
    userEmail:  usersTable.email,
    fromPlanId: planRequestsTable.fromPlanId,
    toPlanId:   planRequestsTable.toPlanId,
    toPlanName: plansTable.name,
    status:     planRequestsTable.status,
    adminNote:  planRequestsTable.adminNote,
    createdAt:  planRequestsTable.createdAt,
  })
    .from(planRequestsTable)
    .leftJoin(usersTable, eq(planRequestsTable.userId, usersTable.id))
    .leftJoin(plansTable, eq(planRequestsTable.toPlanId, plansTable.id))
    .orderBy(desc(planRequestsTable.createdAt));

  const filtered = statusFilter === "all" ? rows : rows.filter(r => r.status === statusFilter);
  res.json(filtered.map(r => ({
    ...r,
    fromPlanName: r.fromPlanId ? (planMap[r.fromPlanId] ?? "Unknown") : null,
    createdAt:    r.createdAt.toISOString(),
  })));
});

router.post("/admin/plan-requests/:id/approve", requireAdmin, async (req, res): Promise<void> => {
  const id    = parseInt((req.params.id as string), 10);
  const admin = req.user!;

  const [request] = await db.select().from(planRequestsTable).where(eq(planRequestsTable.id, id));
  if (!request) { res.status(404).json({ error: "Request not found." }); return; }

  await db.update(subscriptionsTable)
    .set({ planId: request.toPlanId, updatedAt: new Date() })
    .where(eq(subscriptionsTable.userId, request.userId));

  const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, request.toPlanId));
  if (plan) {
    await db.update(usersTable)
      .set({ plan: plan.slug, updatedAt: new Date() })
      .where(eq(usersTable.id, request.userId));
  }

  await db.update(planRequestsTable)
    .set({ status: "approved", updatedAt: new Date() })
    .where(eq(planRequestsTable.id, id));

  await db.insert(systemLogsTable).values({
    userId:      admin.id,
    type:        "admin_plan_request_approved",
    severity:    "info",
    description: `Admin approved plan request #${id} for user #${request.userId}`,
  });

  res.json({ ok: true });
});

router.post("/admin/plan-requests/:id/reject", requireAdmin, async (req, res): Promise<void> => {
  const id    = parseInt((req.params.id as string), 10);
  const admin = req.user!;
  const { note } = req.body as { note?: string };

  await db.update(planRequestsTable)
    .set({ status: "rejected", adminNote: note ?? null, updatedAt: new Date() })
    .where(eq(planRequestsTable.id, id));

  await db.insert(systemLogsTable).values({
    userId:      admin.id,
    type:        "admin_plan_request_rejected",
    severity:    "info",
    description: `Admin rejected plan request #${id}`,
  });

  res.json({ ok: true });
});

// ─── Assign plan directly to a user ───────────────────────────────────────────

// ─── Credits: Adjust credits for a user ──────────────────────────────────────

router.post("/admin/users/:id/credits", requireAdmin, async (req, res): Promise<void> => {
  const targetId = parseInt((req.params.id as string), 10);
  const admin    = req.user!;
  const { amount, reason } = req.body as { amount: number; reason?: string };

  if (typeof amount !== "number" || isNaN(amount)) {
    res.status(400).json({ error: "amount must be a number" });
    return;
  }

  const [user] = await db.select({ id: usersTable.id, credits: usersTable.credits }).from(usersTable).where(eq(usersTable.id, targetId));
  if (!user) { res.status(404).json({ error: "User not found." }); return; }

  const newCredits = Math.max(0, user.credits + amount);
  await db.update(usersTable).set({ credits: newCredits, updatedAt: new Date() }).where(eq(usersTable.id, targetId));

  await db.insert(systemLogsTable).values({
    userId:      admin.id,
    type:        "credit_adjustment",
    severity:    "info",
    description: `Admin ${amount >= 0 ? "added" : "removed"} ${Math.abs(amount)} credits ${amount >= 0 ? "to" : "from"} user #${targetId}. New balance: ${newCredits}. Reason: ${reason ?? "—"}`,
  });

  res.json({ ok: true, newCredits });
});

// ─── Credits: Credit history for a user ──────────────────────────────────────

router.get("/admin/users/:id/credit-history", requireAdmin, async (req, res): Promise<void> => {
  const targetId = parseInt((req.params.id as string), 10);
  const logs = await db.select().from(systemLogsTable)
    .where(and(eq(systemLogsTable.userId, targetId), ilike(systemLogsTable.type, "credit_adjustment")))
    .orderBy(desc(systemLogsTable.createdAt))
    .limit(50);
  res.json(logs.map(l => ({ ...l, createdAt: l.createdAt.toISOString() })));
});

// ─── Admin: Send password reset email to a user ───────────────────────────────

router.post("/admin/users/:id/send-reset-email", requireAdmin, async (req, res): Promise<void> => {
  const targetId = parseInt((req.params.id as string), 10);
  if (!targetId || isNaN(targetId)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, targetId));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  try {
    const crypto = await import("crypto");
    const { passwordResetTokensTable } = await import("@workspace/db");
    const { sendTransactionalEmail, buildPasswordResetEmail } = await import("../lib/email-service");

    const rawToken  = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 60 minutes

    await db.insert(passwordResetTokensTable).values({ userId: user.id, tokenHash, expiresAt });

    const appUrl = process.env.PUBLIC_URL
      ?? (process.env.REPLIT_DOMAINS ? `https://${process.env.REPLIT_DOMAINS.split(",")[0].trim()}` : null)
      ?? (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : null)
      ?? "http://localhost:3000";

    const resetUrl = `${appUrl}/reset-password?token=${rawToken}`;
    const { html, text } = buildPasswordResetEmail(user.name, resetUrl);

    await sendTransactionalEmail({ to: user.email, subject: "Reset your BrokerMAIL AI password", html, text });

    logger.info({ adminId: req.user?.id, targetUserId: user.id }, "Admin sent password reset email");
    res.json({ ok: true, message: `Password reset email sent to ${user.email}` });
  } catch (err: any) {
    logger.error({ err }, "admin send-reset-email error");
    res.status(500).json({ error: err?.message ?? "Failed to send reset email" });
  }
});

// ─── Admin: Set temporary password for a user ────────────────────────────────

router.post("/admin/users/:id/set-temp-password", requireAdmin, async (req, res): Promise<void> => {
  const targetId = parseInt((req.params.id as string), 10);
  if (!targetId || isNaN(targetId)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, targetId));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  try {
    const crypto = await import("crypto");
    const { hashPassword } = await import("../lib/auth");

    // Generate a cryptographically secure temporary password (20 hex chars = 80 bits of entropy)
    const tempPassword = crypto.randomBytes(10).toString("hex");

    const passwordHash = await hashPassword(tempPassword);
    await db.update(usersTable)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(usersTable.id, user.id));

    logger.info({ adminId: req.user?.id, targetUserId: user.id }, "Admin set temporary password");
    // Return the plain-text temp password once — admin must relay it to the user
    res.json({ ok: true, temporaryPassword: tempPassword });
  } catch (err: any) {
    logger.error({ err }, "admin set-temp-password error");
    res.status(500).json({ error: err?.message ?? "Failed to set temporary password" });
  }
});

// ─── Support Tickets ──────────────────────────────────────────────────────────

router.get("/admin/support", requireAdmin, async (req, res): Promise<void> => {
  const statusFilter   = (req.query.status   as string) || "all";
  const priorityFilter = (req.query.priority as string) || "all";
  const categoryFilter = (req.query.category as string) || "all";
  const search         = (req.query.search   as string) || "";

  const conditions = [];
  if (statusFilter   !== "all") conditions.push(eq(supportTicketsTable.status, statusFilter));
  if (priorityFilter !== "all") conditions.push(eq(supportTicketsTable.priority, priorityFilter));
  if (categoryFilter !== "all") conditions.push(eq(supportTicketsTable.category, categoryFilter));
  if (search) {
    conditions.push(or(
      ilike(supportTicketsTable.subject,   `%${search}%`),
      ilike(supportTicketsTable.userEmail, `%${search}%`),
    ));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const tickets = await db.select().from(supportTicketsTable)
    .where(where)
    .orderBy(desc(supportTicketsTable.createdAt))
    .limit(100);

  res.json(tickets.map(t => ({
    ...t,
    createdAt:  t.createdAt.toISOString(),
    updatedAt:  t.updatedAt.toISOString(),
    resolvedAt: t.resolvedAt?.toISOString() ?? null,
  })));
});

router.get("/admin/support/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt((req.params.id as string), 10);
  const [ticket] = await db.select().from(supportTicketsTable).where(eq(supportTicketsTable.id, id));
  if (!ticket) { res.status(404).json({ error: "Ticket not found." }); return; }
  res.json({
    ...ticket,
    createdAt:  ticket.createdAt.toISOString(),
    updatedAt:  ticket.updatedAt.toISOString(),
    resolvedAt: ticket.resolvedAt?.toISOString() ?? null,
  });
});

router.patch("/admin/support/:id", requireAdmin, async (req, res): Promise<void> => {
  const id    = parseInt((req.params.id as string), 10);
  const admin = req.user!;
  const { status, priority, adminNote, assignedTo } = req.body as Record<string, string>;

  await db.update(supportTicketsTable).set({
    ...(status     !== undefined && { status }),
    ...(priority   !== undefined && { priority }),
    ...(adminNote  !== undefined && { adminNote }),
    ...(assignedTo !== undefined && { assignedTo }),
    ...(status === "resolved" && { resolvedAt: new Date() }),
    updatedAt: new Date(),
  }).where(eq(supportTicketsTable.id, id));

  await db.insert(systemLogsTable).values({
    userId:      admin.id,
    type:        "support_ticket_update",
    severity:    "info",
    description: `Admin updated ticket #${id} — status: ${status ?? "—"}, priority: ${priority ?? "—"}`,
  });

  res.json({ ok: true });
});

// Proxy-safe aliases: POST with id in body
router.post("/admin/support/save", requireAdmin, async (req, res): Promise<void> => {
  const id    = parseInt(req.body.id, 10);
  const admin = req.user!;
  if (!id) { res.status(400).json({ error: "id is required" }); return; }
  const { status, priority, adminNote, assignedTo } = req.body as Record<string, string>;

  await db.update(supportTicketsTable).set({
    ...(status     !== undefined && { status }),
    ...(priority   !== undefined && { priority }),
    ...(adminNote  !== undefined && { adminNote }),
    ...(assignedTo !== undefined && { assignedTo }),
    ...(status === "resolved" && { resolvedAt: new Date() }),
    updatedAt: new Date(),
  }).where(eq(supportTicketsTable.id, id));

  await db.insert(systemLogsTable).values({
    userId:      admin.id,
    type:        "support_ticket_update",
    severity:    "info",
    description: `Admin updated ticket #${id} — status: ${status ?? "—"}, priority: ${priority ?? "—"}`,
  });

  res.json({ ok: true });
});

router.post("/admin/support/:id/reply", requireAdmin, async (req, res): Promise<void> => {
  const id    = parseInt((req.params.id as string), 10);
  const admin = req.user!;
  const { message } = req.body as { message: string };

  if (!message?.trim()) { res.status(400).json({ error: "Message required." }); return; }

  const [ticket] = await db.select().from(supportTicketsTable).where(eq(supportTicketsTable.id, id));
  if (!ticket) { res.status(404).json({ error: "Ticket not found." }); return; }

  const replies = (ticket.replies ?? []) as import("@workspace/db").TicketReply[];
  const newReply: import("@workspace/db").TicketReply = {
    id:         Date.now().toString(),
    author:     "admin",
    authorName: `Admin (${admin.email})`,
    message:    message.trim(),
    createdAt:  new Date().toISOString(),
  };

  await db.update(supportTicketsTable).set({
    replies:   [...replies, newReply],
    status:    ticket.status === "open" ? "in_progress" : ticket.status,
    updatedAt: new Date(),
  }).where(eq(supportTicketsTable.id, id));

  res.json({ ok: true, reply: newReply });
});

router.delete("/admin/support/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt((req.params.id as string), 10);
  await db.delete(supportTicketsTable).where(eq(supportTicketsTable.id, id));
  res.json({ ok: true });
});

router.post("/admin/support/remove", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.body.id, 10);
  if (!id) { res.status(400).json({ error: "id is required" }); return; }
  await db.delete(supportTicketsTable).where(eq(supportTicketsTable.id, id));
  res.json({ ok: true });
});

// ─── Export ───────────────────────────────────────────────────────────────────

router.get("/admin/export/users", requireAdmin, async (req, res): Promise<void> => {
  const users = await db.select({
    id:             usersTable.id,
    email:          usersTable.email,
    name:           usersTable.name,
    role:           usersTable.role,
    plan:           usersTable.plan,
    credits:        usersTable.credits,
    status:         usersTable.status,
    gmailConnected: usersTable.gmailConnected,
    createdAt:      usersTable.createdAt,
    lastActiveAt:   usersTable.lastActiveAt,
  }).from(usersTable).orderBy(desc(usersTable.createdAt));

  const csv = [
    "id,email,name,role,plan,credits,status,gmailConnected,createdAt,lastActiveAt",
    ...users.map(u =>
      `${u.id},"${u.email}","${u.name ?? ""}",${u.role},${u.plan},${u.credits},${u.status},${u.gmailConnected},${u.createdAt.toISOString()},${u.lastActiveAt?.toISOString() ?? ""}`
    ),
  ].join("\n");

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="users_${new Date().toISOString().split("T")[0]}.csv"`);
  res.send(csv);
});

router.get("/admin/export/campaigns", requireAdmin, async (_req, res): Promise<void> => {
  const campaigns = await db.select().from(campaignsTable).orderBy(desc(campaignsTable.createdAt));
  const csv = [
    "id,userId,name,status,createdAt",
    ...campaigns.map(c =>
      `${c.id},${c.userId},"${c.name}","${c.status}",${c.createdAt.toISOString()}`
    ),
  ].join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="campaigns_${new Date().toISOString().split("T")[0]}.csv"`);
  res.send(csv);
});

router.get("/admin/export/settings", requireAdmin, async (_req, res): Promise<void> => {
  const rows   = await db.select().from(adminSettingsTable);
  const stored = Object.fromEntries(rows.map(r => [r.key, r.value]));
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="settings_${new Date().toISOString().split("T")[0]}.json"`);
  res.json({ ...DEFAULT_SETTINGS, ...stored });
});

// ─── POST /admin/export/selective — module-level ZIP export ──────────────────

const VALID_EXPORT_MODULES = new Set([
  "users", "campaigns", "leads", "templates", "mailboxes", "drafts",
  "email_queue", "email_tracking", "suppression_list",
  "processed_bounces", "branding", "settings", "plans", "billing",
]);

router.post("/admin/export/selective", requireAdmin, async (req, res): Promise<void> => {
  const admin = req.user as any;
  const { modules = [] } = req.body;
  const selected = (modules as string[]).filter(m => VALID_EXPORT_MODULES.has(m));
  if (selected.length === 0) { res.status(400).json({ error: "No valid modules specified" }); return; }
  const s = new Set(selected);
  const toISO = (d: Date | null | undefined) => d?.toISOString() ?? null;
  const exportedAt = new Date().toISOString();
  try {
    const zip = new JSZip();
    const rowCounts: Record<string, number> = {};
    const fileList: string[] = [];

    if (s.has("users") || s.has("branding")) {
      const usersRaw = await db.select({
        id: usersTable.id, email: usersTable.email, name: usersTable.name,
        passwordHash: usersTable.passwordHash, role: usersTable.role, plan: usersTable.plan,
        credits: usersTable.credits, status: usersTable.status, timezone: usersTable.timezone,
        aiTone: usersTable.aiTone, companyName: usersTable.companyName,
        companyTagline: usersTable.companyTagline, companyWebsite: usersTable.companyWebsite,
        companyPhone: usersTable.companyPhone, usdot: usersTable.usdot, mcNumber: usersTable.mcNumber,
        accentColor: usersTable.accentColor, agentName: usersTable.agentName,
        useSignature: usersTable.useSignature, logoUrl: usersTable.logoUrl,
        lastLogin: usersTable.lastActiveAt, createdAt: usersTable.createdAt,
      }).from(usersTable).orderBy(usersTable.id);
      if (s.has("users")) {
        const j = usersRaw.map(u => ({ ...u, lastLogin: toISO(u.lastLogin), createdAt: toISO(u.createdAt) }));
        zip.file("users.json", JSON.stringify(j, null, 2));
        rowCounts.users = j.length; fileList.push("users.json");
      }
      if (s.has("branding")) {
        const j = usersRaw.map(u => ({
          userEmail: u.email, companyName: u.companyName, companyTagline: u.companyTagline,
          companyWebsite: u.companyWebsite, companyPhone: u.companyPhone, usdot: u.usdot,
          mcNumber: u.mcNumber, accentColor: u.accentColor, agentName: u.agentName,
          useSignature: u.useSignature, logoUrl: u.logoUrl,
        }));
        zip.file("branding.json", JSON.stringify(j, null, 2));
        rowCounts.branding = j.length; fileList.push("branding.json");
      }
    }
    if (s.has("campaigns")) {
      const rows = await db.select().from(campaignsTable).orderBy(campaignsTable.id);
      zip.file("campaigns.json", JSON.stringify(rows.map(c => ({ ...c, createdAt: toISO(c.createdAt), updatedAt: toISO(c.updatedAt), cooldownUntil: toISO(c.cooldownUntil) })), null, 2));
      rowCounts.campaigns = rows.length; fileList.push("campaigns.json");
    }
    if (s.has("leads")) {
      const rows = await db.select().from(leadsTable).orderBy(leadsTable.id);
      zip.file("campaign_leads.json", JSON.stringify(rows.map(l => ({ ...l, sentAt: toISO(l.sentAt), createdAt: toISO(l.createdAt), updatedAt: toISO(l.updatedAt) })), null, 2));
      rowCounts.leads = rows.length; fileList.push("campaign_leads.json");
    }
    if (s.has("templates")) {
      const rows = await db.select().from(templatesTable).orderBy(templatesTable.id);
      zip.file("templates.json", JSON.stringify(rows.map(t => ({ ...t, createdAt: toISO(t.createdAt), updatedAt: toISO(t.updatedAt) })), null, 2));
      rowCounts.templates = rows.length; fileList.push("templates.json");
    }
    if (s.has("mailboxes")) {
      const rows = await db.select().from(mailboxesTable).orderBy(mailboxesTable.id);
      zip.file("mailboxes.json", JSON.stringify(rows.map(m => ({ ...m, createdAt: toISO(m.createdAt), updatedAt: toISO(m.updatedAt) })), null, 2));
      rowCounts.mailboxes = rows.length; fileList.push("mailboxes.json");
    }
    if (s.has("drafts")) {
      const rows = await db.select().from(draftsTable).orderBy(draftsTable.id);
      zip.file("drafts.json", JSON.stringify(rows.map(d => ({ ...d, sentAt: toISO(d.sentAt), createdAt: toISO(d.createdAt) })), null, 2));
      rowCounts.drafts = rows.length; fileList.push("drafts.json");
    }
    if (s.has("email_queue")) {
      const rows = await db.select().from(emailQueueTable).orderBy(emailQueueTable.id);
      zip.file("email_queue.json", JSON.stringify(rows.map(e => ({ ...e, firstAttemptAt: toISO(e.firstAttemptAt), retryAfter: toISO(e.retryAfter), sentAt: toISO(e.sentAt), bounceAt: toISO(e.bounceAt), createdAt: toISO(e.createdAt) })), null, 2));
      rowCounts.emailQueue = rows.length; fileList.push("email_queue.json");
    }
    if (s.has("email_tracking")) {
      const rows = await db.select().from(emailTrackingEventsTable).orderBy(emailTrackingEventsTable.id);
      zip.file("email_tracking_events.json", JSON.stringify(rows.map(e => ({ ...e, createdAt: toISO(e.createdAt) })), null, 2));
      rowCounts.emailTracking = rows.length; fileList.push("email_tracking_events.json");
    }
    if (s.has("suppression_list")) {
      const rows = await db.select().from(suppressionListTable).orderBy(suppressionListTable.id);
      zip.file("suppression_list.json", JSON.stringify(rows.map(ss => ({ ...ss, createdAt: toISO(ss.createdAt) })), null, 2));
      rowCounts.suppressions = rows.length; fileList.push("suppression_list.json");
    }
    if (s.has("processed_bounces")) {
      const rows = await db.select().from(processedBouncesTable).orderBy(processedBouncesTable.id);
      zip.file("processed_bounces.json", JSON.stringify(rows.map(b => ({ ...b, processedAt: toISO(b.processedAt) })), null, 2));
      rowCounts.processedBounces = rows.length; fileList.push("processed_bounces.json");
    }
    if (s.has("settings")) {
      const rows = await db.select().from(adminSettingsTable);
      zip.file("settings.json", JSON.stringify(Object.fromEntries(rows.map(r => [r.key, r.value])), null, 2));
      rowCounts.settings = rows.length; fileList.push("settings.json");
    }
    if (s.has("plans")) {
      const rows = await db.select().from(plansTable).orderBy(plansTable.sortOrder);
      zip.file("plans.json", JSON.stringify(rows.map(p => ({ ...p, createdAt: toISO(p.createdAt), updatedAt: toISO(p.updatedAt) })), null, 2));
      rowCounts.plans = rows.length; fileList.push("plans.json");
    }
    if (s.has("billing")) {
      const subs = await db.select().from(subscriptionsTable);
      const reqs = await db.select().from(planRequestsTable);
      zip.file("billing.json", JSON.stringify({ subscriptions: subs, planRequests: reqs }, null, 2));
      rowCounts.billing = subs.length + reqs.length; fileList.push("billing.json");
    }

    const manifest = {
      version: BACKUP_VERSION, backupVersion: BACKUP_VERSION, appVersion: APP_VERSION,
      schemaVersion: SCHEMA_VERSION, exportType: "selective",
      selectedModules: selected, exportDate: exportedAt, exportedAt,
      exportedBy: admin?.email ?? "admin", createdBy: admin?.email ?? "admin",
      appName: "BrokerMAIL", files: ["manifest.json", ...fileList],
      counts: rowCounts, rowCounts,
    };
    zip.file("manifest.json", JSON.stringify(manifest, null, 2));
    const content = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const fname = `brokermail_export_${selected.slice(0, 3).join("-")}_${new Date().toISOString().split("T")[0]}.zip`;
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
    res.setHeader("Content-Length", String(content.length));
    res.send(content);
    await db.insert(systemLogsTable).values({
      userId: admin?.id ?? null, type: "selective_export", severity: "info",
      description: `Selective export by ${admin?.email ?? "admin"}: ${selected.join(", ")}`,
      metadata: { modules: selected, rowCounts },
    }).catch(() => {});
    logger.info({ modules: selected, rowCounts }, "Selective export completed");
  } catch (err: any) {
    logger.error({ err }, "Selective export error");
    res.status(500).json({ error: err?.message ?? "Export failed" });
  }
});

// ─── Backup Center ────────────────────────────────────────────────────────────

const MAX_BACKUPS = 15;

const VALID_MODULES = new Set([
  "users", "branding", "mailboxes", "campaigns", "leads",
  "templates", "email_queue", "email_tracking", "suppression_list",
  "processed_bounces", "drafts", "settings",
]);

/** Serialize all platform data into a JSZip. Returns the archive + manifest. */
async function buildBackupZip(createdByEmail: string) {
  const exportedAt = new Date().toISOString();
  const toISO = (d: Date | null | undefined) => d?.toISOString() ?? null;

  async function exportTable<T>(name: string, query: Promise<T>): Promise<T> {
    logger.info(`[BACKUP] Exporting ${name}...`);
    try {
      const result = await query;
      logger.info(`[BACKUP] ${name} exported successfully`);
      return result;
    } catch (err: any) {
      logger.error({
        msg: `[BACKUP] FAILED ${name}`,
        table: name,
        error: err?.message ?? String(err),
        stack: err?.stack ?? null,
        query: err?.query ?? null,
        params: err?.params ?? null,
        cause: err?.cause?.message ?? null,
      });
      throw err;
    }
  }

  const usersRaw          = await exportTable("users",                  db.select({ id: usersTable.id, email: usersTable.email, name: usersTable.name, passwordHash: usersTable.passwordHash, role: usersTable.role, plan: usersTable.plan, credits: usersTable.credits, status: usersTable.status, timezone: usersTable.timezone, aiTone: usersTable.aiTone, companyName: usersTable.companyName, companyTagline: usersTable.companyTagline, companyWebsite: usersTable.companyWebsite, companyPhone: usersTable.companyPhone, usdot: usersTable.usdot, mcNumber: usersTable.mcNumber, accentColor: usersTable.accentColor, agentName: usersTable.agentName, useSignature: usersTable.useSignature, logoUrl: usersTable.logoUrl, lastLogin: usersTable.lastActiveAt, createdAt: usersTable.createdAt }).from(usersTable).orderBy(usersTable.id));
  const campaigns         = await exportTable("campaigns",               db.select().from(campaignsTable).orderBy(campaignsTable.id));
  const templates         = await exportTable("templates",               db.select().from(templatesTable).orderBy(templatesTable.id));
  const plans             = await exportTable("plans",                   db.select().from(plansTable).orderBy(plansTable.sortOrder));
  const settingsRows      = await exportTable("admin_settings",          db.select().from(adminSettingsTable));
  const mailboxes         = await exportTable("mailboxes",               db.select().from(mailboxesTable).orderBy(mailboxesTable.id));
  const leads             = await exportTable("leads",                   db.select().from(leadsTable).orderBy(leadsTable.id));
  const emailQueue        = await exportTable("email_queue",             db.select().from(emailQueueTable).orderBy(emailQueueTable.id));
  const emailTracking     = await exportTable("email_tracking_events",   db.select().from(emailTrackingEventsTable).orderBy(emailTrackingEventsTable.id));
  const suppressions      = await exportTable("suppression_list",        db.select().from(suppressionListTable).orderBy(suppressionListTable.id));
  const processedBounces  = await exportTable("processed_bounces",       db.select().from(processedBouncesTable).orderBy(processedBouncesTable.id));
  const drafts            = await exportTable("drafts",                  db.select().from(draftsTable).orderBy(draftsTable.id));

  const settings      = Object.fromEntries(settingsRows.map(r => [r.key, r.value]));
  const usersJson     = usersRaw.map(u => ({ ...u, lastLogin: toISO(u.lastLogin), createdAt: toISO(u.createdAt) }));
  const brandingJson  = usersRaw.map(u => ({
    userEmail: u.email, companyName: u.companyName, companyTagline: u.companyTagline,
    companyWebsite: u.companyWebsite, companyPhone: u.companyPhone, usdot: u.usdot,
    mcNumber: u.mcNumber, accentColor: u.accentColor, agentName: u.agentName,
    useSignature: u.useSignature, logoUrl: u.logoUrl,
  }));
  const campaignsJson     = campaigns.map(c => ({ ...c, createdAt: toISO(c.createdAt), updatedAt: toISO(c.updatedAt), cooldownUntil: toISO(c.cooldownUntil) }));
  const leadsJson         = leads.map(l => ({ ...l, sentAt: toISO(l.sentAt), createdAt: toISO(l.createdAt), updatedAt: toISO(l.updatedAt) }));
  const templatesJson     = templates.map(t => ({ ...t, createdAt: toISO(t.createdAt), updatedAt: toISO(t.updatedAt) }));
  const plansJson         = plans.map(p => ({ ...p, createdAt: toISO(p.createdAt), updatedAt: toISO(p.updatedAt) }));
  const mailboxesJson     = mailboxes.map(m => ({ ...m, createdAt: toISO(m.createdAt), updatedAt: toISO(m.updatedAt) }));
  const emailQueueJson    = emailQueue.map(e => ({ ...e, firstAttemptAt: toISO(e.firstAttemptAt), retryAfter: toISO(e.retryAfter), sentAt: toISO(e.sentAt), bounceAt: toISO(e.bounceAt), createdAt: toISO(e.createdAt) }));
  const emailTrackingJson = emailTracking.map(e => ({ ...e, createdAt: toISO(e.createdAt) }));
  const suppressionsJson  = suppressions.map(s => ({ ...s, createdAt: toISO(s.createdAt) }));
  const bouncesJson       = processedBounces.map(b => ({ ...b, processedAt: toISO(b.processedAt) }));
  const draftsJson        = drafts.map(d => ({ ...d, sentAt: toISO(d.sentAt), createdAt: toISO(d.createdAt) }));

  const manifest = {
    version: BACKUP_VERSION,
    backupVersion: BACKUP_VERSION,
    appVersion: APP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    exportedAt,
    createdBy: createdByEmail,
    appName: "BrokerMAIL",
    files: [
      "manifest.json", "users.json", "campaigns.json", "campaign_leads.json",
      "templates.json", "branding.json", "mailboxes.json", "settings.json", "plans.json",
      "email_queue.json", "email_tracking_events.json",
      "suppression_list.json", "processed_bounces.json", "drafts.json",
    ],
    counts: {
      users: usersJson.length, campaigns: campaignsJson.length, leads: leadsJson.length,
      templates: templatesJson.length, mailboxes: mailboxesJson.length,
      plans: plansJson.length, settings: Object.keys(settings).length,
      emailQueue: emailQueueJson.length, emailTracking: emailTrackingJson.length,
      suppressions: suppressionsJson.length, processedBounces: bouncesJson.length,
      drafts: draftsJson.length,
    },
  };

  const zip = new JSZip();
  zip.file("manifest.json",              JSON.stringify(manifest,          null, 2));
  zip.file("users.json",                 JSON.stringify(usersJson,         null, 2));
  zip.file("campaigns.json",             JSON.stringify(campaignsJson,     null, 2));
  zip.file("campaign_leads.json",        JSON.stringify(leadsJson,         null, 2));
  zip.file("templates.json",             JSON.stringify(templatesJson,     null, 2));
  zip.file("branding.json",              JSON.stringify(brandingJson,      null, 2));
  zip.file("mailboxes.json",             JSON.stringify(mailboxesJson,     null, 2));
  zip.file("settings.json",              JSON.stringify(settings,          null, 2));
  zip.file("plans.json",                 JSON.stringify(plansJson,         null, 2));
  zip.file("email_queue.json",           JSON.stringify(emailQueueJson,    null, 2));
  zip.file("email_tracking_events.json", JSON.stringify(emailTrackingJson, null, 2));
  zip.file("suppression_list.json",      JSON.stringify(suppressionsJson,  null, 2));
  zip.file("processed_bounces.json",     JSON.stringify(bouncesJson,       null, 2));
  zip.file("drafts.json",                JSON.stringify(draftsJson,        null, 2));

  return { zip, manifest };
}

type AnyDb = typeof db;

/**
 * Core restore logic. Processes a ZIP and restores the specified modules.
 * mode="merge"   → skip existing records; insert only missing ones.
 * mode="replace" → delete per-user records then re-insert (run inside a transaction).
 * modules=null   → restore all modules.
 */
async function performRestore(
  zip: JSZip,
  mode: "merge" | "replace",
  modules: Set<string> | null,
  txDb: AnyDb,
): Promise<{ results: Record<string, number>; warnings: string[] }> {
  const has = (m: string) => modules === null || modules.has(m);

  async function readZipJson<T>(name: string): Promise<T | null> {
    const f = zip.file(name);
    if (!f) return null;
    try { return JSON.parse(await f.async("text")) as T; }
    catch { return null; }
  }

  const results: Record<string, number> = {
    settings: 0, plans: 0, users: 0, branding: 0, mailboxes: 0,
    campaigns: 0, leads: 0, templates: 0, emailQueue: 0,
    emailTracking: 0, suppressions: 0, processedBounces: 0, drafts: 0,
  };
  const warnings: string[] = [];

  // ── Settings + Plans ──────────────────────────────────────────────────────
  if (has("settings")) {
    const settings = await readZipJson<Record<string, string>>("settings.json");
    if (settings && typeof settings === "object") {
      if (mode === "replace") await txDb.delete(adminSettingsTable);
      for (const [key, value] of Object.entries(settings)) {
        if (typeof value !== "string") continue;
        await txDb.insert(adminSettingsTable).values({ key, value })
          .onConflictDoUpdate({ target: adminSettingsTable.key, set: { value } });
        results.settings++;
      }
    }
    const plans = await readZipJson<Record<string, any>[]>("plans.json");
    if (Array.isArray(plans)) {
      for (const p of plans) {
        if (!p.slug || !p.name) continue;
        await txDb.insert(plansTable).values({
          name: p.name, slug: p.slug, description: p.description ?? null,
          monthlyEmailLimit: p.monthlyEmailLimit ?? 100,
          smtpAccountsLimit: p.smtpAccountsLimit ?? 1,
          campaignsLimit: p.campaignsLimit ?? 5,
          batchSendLimit: p.batchSendLimit ?? 50,
          features: p.features ?? [], sortOrder: p.sortOrder ?? 0, isActive: p.isActive ?? true,
        }).onConflictDoUpdate({
          target: plansTable.slug,
          set: {
            name: p.name, description: p.description ?? null,
            monthlyEmailLimit: p.monthlyEmailLimit ?? 100,
            smtpAccountsLimit: p.smtpAccountsLimit ?? 1,
            campaignsLimit: p.campaignsLimit ?? 5, batchSendLimit: p.batchSendLimit ?? 50,
            features: p.features ?? [],
          },
        });
        results.plans++;
      }
    }
  }

  // ── Users (always build ID map, even when not restoring users) ────────────
  const emailToNewId = new Map<string, number>();
  const oldIdToNewId = new Map<number, number>();

  {
    const allUsers = await txDb.select({ id: usersTable.id, email: usersTable.email }).from(usersTable);
    for (const u of allUsers) emailToNewId.set(u.email, u.id);

    if (has("users")) {
      const users = await readZipJson<Record<string, any>[]>("users.json");
      if (Array.isArray(users)) {
        for (const u of users) {
          if (!u.email) continue;
          const existingId = emailToNewId.get(u.email);
          const sharedFields = {
            name: u.name ?? u.email, role: u.role ?? "user", plan: u.plan ?? "free",
            credits: typeof u.credits === "number" ? u.credits : 0,
            status: u.status ?? "active", timezone: u.timezone ?? "UTC",
            aiTone: u.aiTone ?? null, companyName: u.companyName ?? null,
            companyTagline: u.companyTagline ?? null, companyWebsite: u.companyWebsite ?? null,
            companyPhone: u.companyPhone ?? null, usdot: u.usdot ?? null,
            mcNumber: u.mcNumber ?? null, accentColor: u.accentColor ?? null,
            agentName: u.agentName ?? null, useSignature: u.useSignature ?? false,
            logoUrl: u.logoUrl ?? null,
            ...(u.passwordHash ? { passwordHash: u.passwordHash } : {}),
          };
          if (existingId) {
            if (mode === "replace") {
              await txDb.update(usersTable).set({ ...sharedFields, updatedAt: new Date() })
                .where(eq(usersTable.id, existingId));
            }
            emailToNewId.set(u.email, existingId);
          } else {
            const [ins] = await txDb.insert(usersTable).values({ email: u.email, ...sharedFields })
              .returning({ id: usersTable.id });
            emailToNewId.set(u.email, ins.id);
          }
          results.users++;
        }
        for (const u of users) {
          if (u.id != null && u.email && emailToNewId.has(u.email)) {
            oldIdToNewId.set(Number(u.id), emailToNewId.get(u.email)!);
          }
        }
      }
    } else {
      const users = await readZipJson<Record<string, any>[]>("users.json");
      if (Array.isArray(users)) {
        for (const u of users) {
          if (u.id != null && u.email && emailToNewId.has(u.email)) {
            oldIdToNewId.set(Number(u.id), emailToNewId.get(u.email)!);
          }
        }
      }
    }
  }

  const resolveUser = (id: number | null | undefined) =>
    id != null ? (oldIdToNewId.get(Number(id)) ?? null) : null;
  const allNewIds = [...oldIdToNewId.values()];

  // ── Branding ──────────────────────────────────────────────────────────────
  if (has("branding")) {
    const branding = await readZipJson<Record<string, any>[]>("branding.json");
    if (Array.isArray(branding)) {
      for (const b of branding) {
        if (!b.userEmail) continue;
        const userId = emailToNewId.get(b.userEmail);
        if (!userId) continue;
        await txDb.update(usersTable).set({
          companyName: b.companyName ?? null, companyTagline: b.companyTagline ?? null,
          companyWebsite: b.companyWebsite ?? null, companyPhone: b.companyPhone ?? null,
          usdot: b.usdot ?? null, mcNumber: b.mcNumber ?? null,
          accentColor: b.accentColor ?? null, agentName: b.agentName ?? null,
          useSignature: b.useSignature ?? false, logoUrl: b.logoUrl ?? null,
          updatedAt: new Date(),
        }).where(eq(usersTable.id, userId));
        results.branding++;
      }
    }
  }

  // ── Mailboxes ─────────────────────────────────────────────────────────────
  if (has("mailboxes")) {
    const mailboxes = await readZipJson<Record<string, any>[]>("mailboxes.json");
    if (Array.isArray(mailboxes)) {
      if (mode === "replace" && allNewIds.length > 0) {
        await txDb.delete(mailboxesTable).where(inArray(mailboxesTable.userId, allNewIds));
      }
      for (const m of mailboxes) {
        if (!m.smtpHost || !m.smtpUser || !m.smtpPassEncrypted) continue;
        const userId = resolveUser(m.userId);
        if (!userId) { warnings.push(`Mailbox user ${m.userId} not found`); continue; }
        if (mode === "merge") {
          const [ex] = await txDb.select({ id: mailboxesTable.id }).from(mailboxesTable)
            .where(eq(mailboxesTable.userId, userId));
          if (ex) continue;
        }
        await txDb.insert(mailboxesTable).values({
          userId, smtpHost: m.smtpHost, smtpPort: m.smtpPort ?? 587,
          smtpUser: m.smtpUser, smtpPassEncrypted: m.smtpPassEncrypted,
          smtpSecure: m.smtpSecure ?? "tls", imapHost: m.imapHost ?? null,
          imapPort: m.imapPort ?? 993, imapUser: m.imapUser ?? null,
          imapPassEncrypted: m.imapPassEncrypted ?? null, fromName: m.fromName ?? null,
          replyTo: m.replyTo ?? null, isActive: m.isActive ?? true,
          batchSize: m.batchSize ?? 10, delaySeconds: m.delaySeconds ?? 15,
          maxPerHour: m.maxPerHour ?? 100,
        });
        results.mailboxes++;
      }
    }
  }

  // ── Templates ─────────────────────────────────────────────────────────────
  if (has("templates")) {
    const templates = await readZipJson<Record<string, any>[]>("templates.json");
    if (Array.isArray(templates)) {
      if (mode === "replace" && allNewIds.length > 0) {
        await txDb.delete(templatesTable).where(inArray(templatesTable.userId, allNewIds));
      }
      for (const t of templates) {
        if (!t.name || !t.subject || !t.body) continue;
        const userId = resolveUser(t.userId);
        if (!userId) { warnings.push(`Template "${t.name}" user not found`); continue; }
        if (mode === "merge") {
          const [ex] = await txDb.select({ id: templatesTable.id }).from(templatesTable)
            .where(and(eq(templatesTable.userId, userId), eq(templatesTable.name, t.name)));
          if (ex) continue;
        }
        await txDb.insert(templatesTable).values({
          userId, name: t.name, subject: t.subject, body: t.body, isDefault: t.isDefault ?? false,
        });
        results.templates++;
      }
    }
  }

  // ── Campaigns ─────────────────────────────────────────────────────────────
  const oldCampaignToNew = new Map<number, number>();
  if (has("campaigns")) {
    const campaigns = await readZipJson<Record<string, any>[]>("campaigns.json");
    if (Array.isArray(campaigns)) {
      if (mode === "replace" && allNewIds.length > 0) {
        await txDb.delete(campaignsTable).where(inArray(campaignsTable.userId, allNewIds));
      }
      for (const c of campaigns) {
        if (!c.name) continue;
        const userId = resolveUser(c.userId);
        if (!userId) { warnings.push(`Campaign "${c.name}" user not found`); continue; }
        if (mode === "merge") {
          const [ex] = await txDb.select({ id: campaignsTable.id }).from(campaignsTable)
            .where(and(eq(campaignsTable.userId, userId), eq(campaignsTable.name, c.name)));
          if (ex) { oldCampaignToNew.set(Number(c.id), ex.id); continue; }
        }
        const [ins] = await txDb.insert(campaignsTable).values({
          userId, name: c.name,
          status: mode === "replace" ? (c.status ?? "pending") : "pending",
          sendMode: c.sendMode ?? "gmail", emailStyle: c.emailStyle ?? "clean",
          useSignature: c.useSignature ?? false,
          totalLeads: c.totalLeads ?? 0, draftedCount: c.draftedCount ?? 0,
          failedCount: c.failedCount ?? 0, sentCount: c.sentCount ?? 0,
          templateId: c.templateId ?? null, fileName: c.fileName ?? null,
          bookingUrl: c.bookingUrl ?? null, quoteUrl: c.quoteUrl ?? null,
          websiteUrl: c.websiteUrl ?? null, phoneNumber: c.phoneNumber ?? null,
        }).returning({ id: campaignsTable.id });
        oldCampaignToNew.set(Number(c.id), ins.id);
        results.campaigns++;
      }
    }
  }

  // ── Leads ─────────────────────────────────────────────────────────────────
  const oldLeadToNew = new Map<number, number>();
  if (has("leads")) {
    const leads = await readZipJson<Record<string, any>[]>("campaign_leads.json");
    if (Array.isArray(leads)) {
      if (mode === "replace" && allNewIds.length > 0) {
        await txDb.delete(leadsTable).where(inArray(leadsTable.userId, allNewIds));
      }
      for (const l of leads) {
        if (!l.name || !l.email) continue;
        const userId = resolveUser(l.userId);
        if (!userId) { warnings.push(`Lead "${l.email}" user not found`); continue; }
        const campaignId = l.campaignId != null ? (oldCampaignToNew.get(Number(l.campaignId)) ?? null) : null;
        const [ins] = await txDb.insert(leadsTable).values({
          userId, campaignId, name: l.name, email: l.email,
          vehicle: l.vehicle ?? null, route: l.route ?? null,
          pickup: l.pickup ?? null, delivery: l.delivery ?? null,
          price: l.price ?? null, notes: l.notes ?? null,
          quoteId: l.quoteId ?? null, status: l.status ?? "new",
          gmailDraftId: l.gmailDraftId ?? null, errorMessage: l.errorMessage ?? null,
          sentAt: l.sentAt ? new Date(l.sentAt) : null,
        }).returning({ id: leadsTable.id });
        oldLeadToNew.set(Number(l.id), ins.id);
        results.leads++;
      }
    }
  }

  // ── Drafts ────────────────────────────────────────────────────────────────
  const oldDraftToNew = new Map<number, number>();
  if (has("drafts")) {
    const draftsData = await readZipJson<Record<string, any>[]>("drafts.json");
    if (Array.isArray(draftsData)) {
      if (mode === "replace" && allNewIds.length > 0) {
        await txDb.delete(draftsTable).where(inArray(draftsTable.userId, allNewIds));
      }
      for (const d of draftsData) {
        if (!d.subject || !d.body) continue;
        const userId = resolveUser(d.userId);
        if (!userId) continue;
        const campaignId = d.campaignId != null ? (oldCampaignToNew.get(Number(d.campaignId)) ?? null) : null;
        const leadId     = d.leadId     != null ? (oldLeadToNew.get(Number(d.leadId))     ?? null) : null;
        try {
          const [ins] = await txDb.insert(draftsTable).values({
            userId, campaignId, leadId, gmailDraftId: d.gmailDraftId ?? null,
            email: d.email ?? null, subject: d.subject, body: d.body,
            status: d.status ?? "sent", errorMessage: d.errorMessage ?? null,
            trackingId: d.trackingId ?? null,
            sentAt: d.sentAt ? new Date(d.sentAt) : null,
          }).returning({ id: draftsTable.id });
          oldDraftToNew.set(Number(d.id), ins.id);
          results.drafts++;
        } catch { warnings.push(`Draft ${d.id ?? "?"}: skipped`); }
      }
    }
  }

  // ── Email Queue ───────────────────────────────────────────────────────────
  if (has("email_queue")) {
    const emailQueue = await readZipJson<Record<string, any>[]>("email_queue.json");
    if (Array.isArray(emailQueue)) {
      if (mode === "replace" && allNewIds.length > 0) {
        await txDb.delete(emailQueueTable).where(inArray(emailQueueTable.userId, allNewIds));
      }
      for (const e of emailQueue) {
        const userId = resolveUser(e.userId);
        if (!userId || !e.jobId || !e.email) continue;
        const campaignId = e.campaignId != null ? (oldCampaignToNew.get(Number(e.campaignId)) ?? null) : null;
        const leadId     = e.leadId     != null ? (oldLeadToNew.get(Number(e.leadId))     ?? null) : null;
        try {
          await txDb.insert(emailQueueTable).values({
            jobId: e.jobId, userId, mailboxId: e.mailboxId ?? 0,
            templateId: e.templateId ?? 0, campaignId, leadId,
            email: e.email, subject: e.subject ?? "", rowDataJson: e.rowDataJson ?? "{}",
            style: e.style ?? "clean", useSignatureBuilder: e.useSignatureBuilder ?? false,
            status: e.status ?? "success", attempts: e.attempts ?? 0,
            deferredCount: e.deferredCount ?? 0, lastError: e.lastError ?? null,
            quoteId: e.quoteId ?? null, trackingId: e.trackingId ?? null,
            firstAttemptAt: e.firstAttemptAt ? new Date(e.firstAttemptAt) : null,
            retryAfter:     e.retryAfter    ? new Date(e.retryAfter)    : null,
            sentAt:         e.sentAt        ? new Date(e.sentAt)        : null,
            bounceAt:       e.bounceAt      ? new Date(e.bounceAt)      : null,
          });
          results.emailQueue++;
        } catch { warnings.push(`Email queue ${e.jobId}: skipped (conflict)`); }
      }
    }
  }

  // ── Email Tracking Events ─────────────────────────────────────────────────
  if (has("email_tracking")) {
    const tracking = await readZipJson<Record<string, any>[]>("email_tracking_events.json");
    if (Array.isArray(tracking)) {
      for (const e of tracking) {
        const draftId = e.draftId != null ? (oldDraftToNew.get(Number(e.draftId)) ?? null) : null;
        try {
          await txDb.insert(emailTrackingEventsTable).values({
            draftId, eventType: e.eventType ?? "open",
            linkUrl: e.linkUrl ?? null, buttonLabel: e.buttonLabel ?? null,
            ipAddress: e.ipAddress ?? null, userAgent: e.userAgent ?? null,
          });
          results.emailTracking++;
        } catch { warnings.push(`Tracking event ${e.id ?? "?"}: skipped`); }
      }
    }
  }

  // ── Suppression List ──────────────────────────────────────────────────────
  if (has("suppression_list")) {
    const suppressions = await readZipJson<Record<string, any>[]>("suppression_list.json");
    if (Array.isArray(suppressions)) {
      if (mode === "replace" && allNewIds.length > 0) {
        await txDb.delete(suppressionListTable).where(inArray(suppressionListTable.userId, allNewIds));
      }
      for (const s of suppressions) {
        const userId = resolveUser(s.userId);
        if (!userId || !s.email) continue;
        try {
          await txDb.insert(suppressionListTable).values({
            userId, email: s.email, reason: s.reason ?? "restored",
            bounceCode: s.bounceCode ?? null, campaignId: null,
          }).onConflictDoNothing();
          results.suppressions++;
        } catch { warnings.push(`Suppression ${s.email}: skipped`); }
      }
    }
  }

  // ── Processed Bounces ─────────────────────────────────────────────────────
  if (has("processed_bounces")) {
    const bouncesData = await readZipJson<Record<string, any>[]>("processed_bounces.json");
    if (Array.isArray(bouncesData)) {
      for (const b of bouncesData) {
        if (!b.mailboxId || !b.messageId) continue;
        try {
          await txDb.insert(processedBouncesTable).values({
            mailboxId: b.mailboxId, messageId: b.messageId, recipient: b.recipient ?? null,
          }).onConflictDoNothing();
          results.processedBounces++;
        } catch { warnings.push(`Bounce ${b.messageId}: skipped`); }
      }
    }
  }

  return { results, warnings };
}

// ─── GET /admin/backup/verify — pre-backup health check ──────────────────────

router.get("/admin/backup/verify", requireAdmin, async (_req, res): Promise<void> => {
  const startedAt = Date.now();
  try {
    const tableChecks = await Promise.all([
      db.select({ n: count() }).from(usersTable).then(([r]) => ({ table: "users", rows: Number(r.n), ok: true })).catch((e: any) => ({ table: "users", rows: 0, ok: false, error: String(e?.message) })),
      db.select({ n: count() }).from(campaignsTable).then(([r]) => ({ table: "campaigns", rows: Number(r.n), ok: true })).catch((e: any) => ({ table: "campaigns", rows: 0, ok: false, error: String(e?.message) })),
      db.select({ n: count() }).from(leadsTable).then(([r]) => ({ table: "leads", rows: Number(r.n), ok: true })).catch((e: any) => ({ table: "leads", rows: 0, ok: false, error: String(e?.message) })),
      db.select({ n: count() }).from(templatesTable).then(([r]) => ({ table: "templates", rows: Number(r.n), ok: true })).catch((e: any) => ({ table: "templates", rows: 0, ok: false, error: String(e?.message) })),
      db.select({ n: count() }).from(mailboxesTable).then(([r]) => ({ table: "mailboxes", rows: Number(r.n), ok: true })).catch((e: any) => ({ table: "mailboxes", rows: 0, ok: false, error: String(e?.message) })),
      db.select({ n: count() }).from(adminSettingsTable).then(([r]) => ({ table: "admin_settings", rows: Number(r.n), ok: true })).catch((e: any) => ({ table: "admin_settings", rows: 0, ok: false, error: String(e?.message) })),
      db.select({ n: count() }).from(emailQueueTable).then(([r]) => ({ table: "email_queue", rows: Number(r.n), ok: true })).catch((e: any) => ({ table: "email_queue", rows: 0, ok: false, error: String(e?.message) })),
      db.select({ n: count() }).from(emailTrackingEventsTable).then(([r]) => ({ table: "email_tracking_events", rows: Number(r.n), ok: true })).catch((e: any) => ({ table: "email_tracking_events", rows: 0, ok: false, error: String(e?.message) })),
      db.select({ n: count() }).from(suppressionListTable).then(([r]) => ({ table: "suppression_list", rows: Number(r.n), ok: true })).catch((e: any) => ({ table: "suppression_list", rows: 0, ok: false, error: String(e?.message) })),
      db.select({ n: count() }).from(processedBouncesTable).then(([r]) => ({ table: "processed_bounces", rows: Number(r.n), ok: true })).catch((e: any) => ({ table: "processed_bounces", rows: 0, ok: false, error: String(e?.message) })),
      db.select({ n: count() }).from(draftsTable).then(([r]) => ({ table: "drafts", rows: Number(r.n), ok: true })).catch((e: any) => ({ table: "drafts", rows: 0, ok: false, error: String(e?.message) })),
      db.select({ n: count() }).from(plansTable).then(([r]) => ({ table: "plans", rows: Number(r.n), ok: true })).catch((e: any) => ({ table: "plans", rows: 0, ok: false, error: String(e?.message) })),
    ]);
    const failed = tableChecks.filter(t => !t.ok);
    const totalRows = tableChecks.reduce((s, t) => s + t.rows, 0);
    const ok = failed.length === 0;
    logger.info({ ok, tables: tableChecks.length, failed: failed.length, totalRows }, "[BACKUP-VERIFY] Pre-backup verification complete");
    res.json({
      ok,
      backupVersion: BACKUP_VERSION,
      appVersion: APP_VERSION,
      schemaVersion: SCHEMA_VERSION,
      totalRows,
      tables: Object.fromEntries(tableChecks.map(t => [t.table, { rows: t.rows, ok: t.ok, ...(!t.ok ? { error: (t as any).error } : {}) }])),
      failed: failed.map(t => ({ table: t.table, error: (t as any).error })),
      verifiedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
    });
  } catch (err: any) {
    logger.error({ err }, "[BACKUP-VERIFY] Verification failed");
    res.status(500).json({ error: err?.message ?? "Verification failed" });
  }
});

// ─── GET /admin/backup/full — direct download (backward compat) ───────────────

router.get("/admin/backup/full", requireAdmin, async (req, res): Promise<void> => {
  try {
    const admin = req.user as any;
    const { zip, manifest } = await buildBackupZip(admin?.email ?? "admin");
    const content = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const date = manifest.exportedAt.split("T")[0];
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="brokermail_backup_${date}.zip"`);
    res.send(content);
  } catch (err: any) {
    logger.error({ err }, "Full backup error");
    res.status(500).json({ error: err?.message ?? "Backup failed" });
  }
});

// ─── POST /admin/backup/create — create & store in history ────────────────────

router.post("/admin/backup/create", requireAdmin, async (req, res): Promise<void> => {
  try {
    const admin = req.user as any;
    const name = (req.body?.name as string) || `backup_${new Date().toISOString().replace(/[:.]/g, "-")}`;
    const { zip, manifest } = await buildBackupZip(admin?.email ?? "admin");
    const content = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });

    const existing = await db.select({ id: backupHistoryTable.id })
      .from(backupHistoryTable).orderBy(desc(backupHistoryTable.createdAt));
    if (existing.length >= MAX_BACKUPS) {
      const toDelete = existing.slice(MAX_BACKUPS - 1).map(r => r.id);
      if (toDelete.length > 0) await db.delete(backupHistoryTable).where(inArray(backupHistoryTable.id, toDelete));
    }

    const [record] = await db.insert(backupHistoryTable).values({
      name,
      createdById: admin?.id ?? null,
      createdByEmail: admin?.email ?? "admin",
      sizeBytes: content.length,
      zipData: content.toString("base64"),
      manifestSummary: JSON.stringify({ counts: manifest.counts, backupVersion: BACKUP_VERSION, schemaVersion: SCHEMA_VERSION, appVersion: APP_VERSION, restoreType: "manual" }),
    }).returning({
      id: backupHistoryTable.id,
      name: backupHistoryTable.name,
      createdByEmail: backupHistoryTable.createdByEmail,
      sizeBytes: backupHistoryTable.sizeBytes,
      manifestSummary: backupHistoryTable.manifestSummary,
      createdAt: backupHistoryTable.createdAt,
    });

    logger.info({ id: record.id, name, sizeBytes: content.length }, "Backup created and stored");
    await db.insert(systemLogsTable).values({
      userId: admin?.id ?? null, type: "backup_created", severity: "info",
      description: `Full backup created by ${admin?.email ?? "admin"}: ${name}`,
      metadata: { backupId: record.id, name, sizeBytes: content.length, counts: manifest.counts },
    }).catch(() => {});
    res.json({ success: true, backup: { ...record, createdAt: record.createdAt.toISOString() } });
  } catch (err: any) {
    logger.error({ err }, "Backup create error");
    res.status(500).json({ error: err?.message ?? "Backup failed" });
  }
});

// ─── GET /admin/backup/history ────────────────────────────────────────────────

router.get("/admin/backup/history", requireAdmin, async (_req, res): Promise<void> => {
  try {
    const rows = await db.select({
      id: backupHistoryTable.id,
      name: backupHistoryTable.name,
      createdByEmail: backupHistoryTable.createdByEmail,
      sizeBytes: backupHistoryTable.sizeBytes,
      manifestSummary: backupHistoryTable.manifestSummary,
      createdAt: backupHistoryTable.createdAt,
    }).from(backupHistoryTable).orderBy(desc(backupHistoryTable.createdAt));
    res.json(rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })));
  } catch (err: any) {
    logger.error({ err }, "Backup history error");
    res.status(500).json({ error: err?.message ?? "Failed to load backup history" });
  }
});

// ─── GET /admin/backup/download/:id ───────────────────────────────────────────

router.get("/admin/backup/download/:id", requireAdmin, async (req, res): Promise<void> => {
  try {
    const id = Number((req.params.id as string));
    const [row] = await db.select({
      name: backupHistoryTable.name,
      zipData: backupHistoryTable.zipData,
    }).from(backupHistoryTable).where(eq(backupHistoryTable.id, id));
    if (!row) { res.status(404).json({ error: "Backup not found" }); return; }
    const content = Buffer.from(row.zipData, "base64");
    const filename = row.name.endsWith(".zip") ? row.name : `${row.name}.zip`;
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(content);
  } catch (err: any) {
    logger.error({ err }, "Backup download error");
    res.status(500).json({ error: err?.message ?? "Download failed" });
  }
});

// ─── DELETE /admin/backup/:id ─────────────────────────────────────────────────

router.delete("/admin/backup/:id", requireAdmin, async (req, res): Promise<void> => {
  try {
    const id = Number((req.params.id as string));
    await db.delete(backupHistoryTable).where(eq(backupHistoryTable.id, id));
    res.json({ success: true });
  } catch (err: any) {
    logger.error({ err }, "Backup delete error");
    res.status(500).json({ error: err?.message ?? "Delete failed" });
  }
});

// ─── POST /admin/restore/validate — read manifest; no writes ─────────────────

router.post("/admin/restore/validate", requireAdmin, memUpload.single("file"), async (req, res): Promise<void> => {
  if (!req.file?.buffer) { res.status(400).json({ error: "No file uploaded" }); return; }
  try {
    const zip = await JSZip.loadAsync(req.file.buffer);
    const mf = zip.file("manifest.json");
    if (!mf) { res.status(400).json({ error: "Invalid backup: manifest.json missing" }); return; }
    let manifest: any;
    try { manifest = JSON.parse(await mf.async("text")); }
    catch { res.status(400).json({ error: "manifest.json is not valid JSON" }); return; }
    if (!manifest.version) { res.status(400).json({ error: "Invalid manifest: missing version" }); return; }
    const presentFiles  = Object.keys(zip.files).filter(f => !f.endsWith("/"));
    const missingFiles  = (manifest.files ?? []).filter((f: string) => !zip.file(f));
    const backupVer = manifest.backupVersion ?? manifest.version ?? "unknown";
    const backupMajor = parseInt(String(backupVer), 10);
    const currentMajor = parseInt(BACKUP_VERSION, 10);
    const compatible = !isNaN(backupMajor) && backupMajor <= currentMajor;
    const compatibilityWarnings: string[] = [];
    if (!compatible) compatibilityWarnings.push(`Backup version ${backupVer} is newer than current ${BACKUP_VERSION} — restore may fail`);
    if (manifest.schemaVersion && manifest.schemaVersion !== SCHEMA_VERSION) {
      compatibilityWarnings.push(`Schema version mismatch: backup=${manifest.schemaVersion}, current=${SCHEMA_VERSION}`);
    }
    res.json({
      valid: missingFiles.length === 0,
      compatible,
      compatibilityWarnings,
      version: manifest.version ?? null,
      backupVersion: manifest.backupVersion ?? manifest.version ?? null,
      appVersion: manifest.appVersion ?? null,
      schemaVersion: manifest.schemaVersion ?? null,
      exportedAt: manifest.exportedAt ?? null,
      createdBy: manifest.createdBy ?? null,
      appName: manifest.appName ?? null,
      counts: manifest.counts ?? {},
      files: presentFiles,
      missingFiles,
    });
  } catch (err: any) {
    logger.error({ err }, "Restore validate error");
    res.status(400).json({ error: `Invalid backup file: ${err?.message}` });
  }
});

// ─── POST /admin/restore/merge — insert missing records only ─────────────────

router.post("/admin/restore/merge", requireAdmin, memUpload.single("file"), async (req, res): Promise<void> => {
  if (!req.file?.buffer) { res.status(400).json({ error: "No file uploaded" }); return; }
  const admin = req.user as any;
  const startedAt = Date.now();
  let snapshotId: number | null = null;
  try {
    // Pre-restore snapshot (best-effort — never blocks the restore)
    try {
      const rpName = `pre_merge_snapshot_${new Date().toISOString().replace(/[:.]/g, "-")}`;
      const { zip: rpZip, manifest: rpMf } = await buildBackupZip(admin?.email ?? "admin");
      const rpContent = await rpZip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
      const existing = await db.select({ id: backupHistoryTable.id }).from(backupHistoryTable).orderBy(desc(backupHistoryTable.createdAt));
      if (existing.length >= MAX_BACKUPS) {
        const toDel = existing.slice(MAX_BACKUPS - 1).map(r => r.id);
        if (toDel.length) await db.delete(backupHistoryTable).where(inArray(backupHistoryTable.id, toDel));
      }
      const [rpRec] = await db.insert(backupHistoryTable).values({
        name: rpName, createdById: admin?.id ?? null, createdByEmail: admin?.email ?? "admin",
        sizeBytes: rpContent.length, zipData: rpContent.toString("base64"),
        manifestSummary: JSON.stringify({ counts: rpMf.counts, backupVersion: BACKUP_VERSION, schemaVersion: SCHEMA_VERSION, appVersion: APP_VERSION, restoreType: "restore_point" }),
      }).returning({ id: backupHistoryTable.id });
      snapshotId = rpRec.id;
      logger.info({ snapshotId, name: rpName }, "[RESTORE] Pre-merge snapshot created");
    } catch (snapshotErr) {
      logger.warn({ err: snapshotErr }, "[RESTORE] Pre-merge snapshot failed (non-fatal)");
    }
    await db.insert(systemLogsTable).values({
      userId: admin?.id ?? null, type: "restore_started", severity: "info",
      description: `Merge restore started by ${admin?.email ?? "admin"}`,
      metadata: { mode: "merge", snapshotId },
    }).catch(() => {});
    const zip = await JSZip.loadAsync(req.file.buffer);
    const { results, warnings } = await performRestore(zip, "merge", null, db);
    await db.insert(systemLogsTable).values({
      userId: admin?.id ?? null, type: "restore_completed", severity: "info",
      description: `Merge restore completed by ${admin?.email ?? "admin"} in ${Date.now() - startedAt}ms`,
      metadata: { mode: "merge", results, snapshotId },
    }).catch(() => {});
    logger.info({ results, warnings, snapshotId }, "Merge restore completed");
    res.json({ success: true, message: "Merge restore complete.", results, warnings: warnings.length ? warnings : undefined, snapshotId });
  } catch (err: any) {
    await db.insert(systemLogsTable).values({
      userId: admin?.id ?? null, type: "restore_failed", severity: "error",
      description: `Merge restore failed: ${err?.message ?? "unknown"}`,
      metadata: { mode: "merge", snapshotId, error: err?.message },
    }).catch(() => {});
    logger.error({ err }, "Merge restore error");
    res.status(500).json({ error: err?.message ?? "Merge restore failed", snapshotId });
  }
});

// ─── POST /admin/restore/replace — auto restore-point then full replace ───────

router.post("/admin/restore/replace", requireAdmin, memUpload.single("file"), async (req, res): Promise<void> => {
  if (!req.file?.buffer) { res.status(400).json({ error: "No file uploaded" }); return; }
  const admin = req.user as any;
  let restorePointId: number | null = null;
  try {
    // Step 1: Create automatic restore point before any destructive changes
    const rpName = `restore_point_${new Date().toISOString().replace(/[:.]/g, "-")}`;
    const { zip: rpZip, manifest: rpManifest } = await buildBackupZip(admin?.email ?? "admin");
    const rpContent = await rpZip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const existing = await db.select({ id: backupHistoryTable.id })
      .from(backupHistoryTable).orderBy(desc(backupHistoryTable.createdAt));
    if (existing.length >= MAX_BACKUPS) {
      const toDelete = existing.slice(MAX_BACKUPS - 1).map(r => r.id);
      if (toDelete.length > 0) await db.delete(backupHistoryTable).where(inArray(backupHistoryTable.id, toDelete));
    }
    const [rpRecord] = await db.insert(backupHistoryTable).values({
      name: rpName, createdById: admin?.id ?? null, createdByEmail: admin?.email ?? "admin",
      sizeBytes: rpContent.length, zipData: rpContent.toString("base64"),
      manifestSummary: JSON.stringify({ counts: rpManifest.counts, backupVersion: BACKUP_VERSION, schemaVersion: SCHEMA_VERSION, appVersion: APP_VERSION, restoreType: "restore_point" }),
    }).returning({ id: backupHistoryTable.id });
    restorePointId = rpRecord.id;
    logger.info({ restorePointId, name: rpName }, "Auto restore point created");

    // Step 2: Perform replace restore inside a DB transaction (auto-rollback on error)
    const fileBuffer = req.file!.buffer;
    const zip = await JSZip.loadAsync(fileBuffer);
    const { results, warnings } = await db.transaction(async (tx) => {
      return performRestore(zip, "replace", null, tx as unknown as AnyDb);
    });

    logger.info({ results, warnings, restorePointId }, "Replace restore completed");
    res.json({
      success: true,
      message: "Replace restore complete. Users can log in immediately.",
      results,
      warnings: warnings.length ? warnings : undefined,
      restorePointId,
    });
  } catch (err: any) {
    logger.error({ err, restorePointId }, "Replace restore error — transaction rolled back");
    res.status(500).json({
      error: err?.message ?? "Replace restore failed",
      restorePointId,
      note: restorePointId
        ? `Restore point id=${restorePointId} was saved. The transaction was rolled back — your data was NOT changed.`
        : "Restore failed before any data was modified.",
    });
  }
});

// ─── POST /admin/restore/selective — restore selected modules only ────────────

router.post("/admin/restore/selective", requireAdmin, memUpload.single("file"), async (req, res): Promise<void> => {
  if (!req.file?.buffer) { res.status(400).json({ error: "No file uploaded" }); return; }
  const admin = req.user as any;
  const rawModules: unknown = req.body?.modules;
  let moduleList: string[] = [];
  try {
    moduleList = Array.isArray(rawModules)
      ? rawModules
      : JSON.parse(typeof rawModules === "string" ? rawModules : "[]");
  } catch {
    res.status(400).json({ error: "modules must be a JSON array of module names" });
    return;
  }
  const validatedModules = new Set(moduleList.filter(m => VALID_MODULES.has(m)));
  if (validatedModules.size === 0) {
    res.status(400).json({ error: "No valid modules specified", validModules: [...VALID_MODULES] });
    return;
  }
  const startedAt = Date.now();
  let snapshotId: number | null = null;
  try {
    // Pre-restore snapshot (best-effort)
    try {
      const rpName = `pre_selective_snapshot_${new Date().toISOString().replace(/[:.]/g, "-")}`;
      const { zip: rpZip, manifest: rpMf } = await buildBackupZip(admin?.email ?? "admin");
      const rpContent = await rpZip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
      const existing = await db.select({ id: backupHistoryTable.id }).from(backupHistoryTable).orderBy(desc(backupHistoryTable.createdAt));
      if (existing.length >= MAX_BACKUPS) {
        const toDel = existing.slice(MAX_BACKUPS - 1).map(r => r.id);
        if (toDel.length) await db.delete(backupHistoryTable).where(inArray(backupHistoryTable.id, toDel));
      }
      const [rpRec] = await db.insert(backupHistoryTable).values({
        name: rpName, createdById: admin?.id ?? null, createdByEmail: admin?.email ?? "admin",
        sizeBytes: rpContent.length, zipData: rpContent.toString("base64"),
        manifestSummary: JSON.stringify({ counts: rpMf.counts, backupVersion: BACKUP_VERSION, schemaVersion: SCHEMA_VERSION, appVersion: APP_VERSION, restoreType: "restore_point" }),
      }).returning({ id: backupHistoryTable.id });
      snapshotId = rpRec.id;
      logger.info({ snapshotId, name: rpName }, "[RESTORE] Pre-selective snapshot created");
    } catch (snapshotErr) {
      logger.warn({ err: snapshotErr }, "[RESTORE] Pre-selective snapshot failed (non-fatal)");
    }
    await db.insert(systemLogsTable).values({
      userId: admin?.id ?? null, type: "restore_started", severity: "info",
      description: `Selective restore started by ${admin?.email ?? "admin"} for: ${[...validatedModules].join(", ")}`,
      metadata: { mode: "selective", modules: [...validatedModules], snapshotId },
    }).catch(() => {});
    const zip = await JSZip.loadAsync(req.file.buffer);
    const { results, warnings } = await performRestore(zip, "merge", validatedModules, db);
    await db.insert(systemLogsTable).values({
      userId: admin?.id ?? null, type: "restore_completed", severity: "info",
      description: `Selective restore completed by ${admin?.email ?? "admin"} in ${Date.now() - startedAt}ms`,
      metadata: { mode: "selective", modules: [...validatedModules], results, snapshotId },
    }).catch(() => {});
    logger.info({ results, warnings, modules: [...validatedModules], snapshotId }, "Selective restore completed");
    res.json({
      success: true,
      message: `Selective restore complete for: ${[...validatedModules].join(", ")}.`,
      results,
      warnings: warnings.length ? warnings : undefined,
      snapshotId,
    });
  } catch (err: any) {
    await db.insert(systemLogsTable).values({
      userId: admin?.id ?? null, type: "restore_failed", severity: "error",
      description: `Selective restore failed: ${err?.message ?? "unknown"}`,
      metadata: { mode: "selective", modules: [...validatedModules], snapshotId, error: err?.message },
    }).catch(() => {});
    logger.error({ err }, "Selective restore error");
    res.status(500).json({ error: err?.message ?? "Selective restore failed", snapshotId });
  }
});

// ─── POST /admin/restore/full — legacy endpoint (backward compat) ─────────────

router.post("/admin/restore/full", requireAdmin, memUpload.single("file"), async (req, res): Promise<void> => {
  if (!req.file?.buffer) {
    res.status(400).json({ error: "No backup file uploaded. Send as multipart/form-data field 'file'." });
    return;
  }
  try {
    const zip = await JSZip.loadAsync(req.file.buffer);
    const { results, warnings } = await performRestore(zip, "merge", null, db);
    logger.info({ results, warnings }, "Legacy ZIP backup restored");
    res.json({
      success: true,
      message: "Backup restored successfully. Users can log in immediately using original passwords.",
      results,
      warnings: warnings.length ? warnings : undefined,
    });
  } catch (err: any) {
    logger.error({ err }, "Restore ZIP backup error");
    res.status(500).json({ error: err?.message ?? "Restore failed" });
  }
});

// ─── Migration Verification ───────────────────────────────────────────────────

router.get("/admin/migration/verify", requireAdmin, async (_req, res): Promise<void> => {
  try {
    const [
      [usersTotal],
      [usersWithHash],
      [usersWithBranding],
      [campaignsTotal],
      [templatesTotal],
      [mailboxesTotal],
      [settingsTotal],
      [plansTotal],
    ] = await Promise.all([
      db.select({ count: count() }).from(usersTable),
      db.select({ count: count() }).from(usersTable).where(isNotNull(usersTable.passwordHash)),
      db.select({ count: count() }).from(usersTable).where(isNotNull(usersTable.companyName)),
      db.select({ count: count() }).from(campaignsTable),
      db.select({ count: count() }).from(templatesTable),
      db.select({ count: count() }).from(mailboxesTable),
      db.select({ count: count() }).from(adminSettingsTable),
      db.select({ count: count() }).from(plansTable),
    ]);

    const checks = {
      users: {
        label: "User Accounts",
        count: usersTotal.count,
        ok: usersTotal.count > 0,
        detail: `${usersTotal.count} users`,
      },
      passwordHashes: {
        label: "Password Hashes",
        count: usersWithHash.count,
        ok: usersWithHash.count > 0 && usersWithHash.count === usersTotal.count,
        partial: usersWithHash.count > 0 && usersWithHash.count < usersTotal.count,
        detail: `${usersWithHash.count} / ${usersTotal.count} users have hashes`,
      },
      templates: {
        label: "Email Templates",
        count: templatesTotal.count,
        ok: templatesTotal.count > 0,
        detail: `${templatesTotal.count} templates`,
      },
      campaigns: {
        label: "Campaigns",
        count: campaignsTotal.count,
        ok: campaignsTotal.count > 0,
        detail: `${campaignsTotal.count} campaigns`,
      },
      mailboxes: {
        label: "Mailboxes (SMTP)",
        count: mailboxesTotal.count,
        ok: mailboxesTotal.count > 0,
        detail: `${mailboxesTotal.count} mailboxes`,
      },
      branding: {
        label: "Branding Profiles",
        count: usersWithBranding.count,
        ok: usersWithBranding.count > 0,
        detail: `${usersWithBranding.count} users with branding`,
      },
      settings: {
        label: "Platform Settings",
        count: settingsTotal.count,
        ok: settingsTotal.count > 0,
        detail: `${settingsTotal.count} settings keys`,
      },
      plans: {
        label: "Subscription Plans",
        count: plansTotal.count,
        ok: plansTotal.count > 0,
        detail: `${plansTotal.count} plans`,
      },
    };

    const allOk = Object.values(checks).every(c => c.ok || ("partial" in c && c.partial));
    res.json({ ok: allOk, checks, verifiedAt: new Date().toISOString() });
  } catch (err: any) {
    logger.error({ err }, "Migration verify error");
    res.status(500).json({ error: err?.message ?? "Verification failed" });
  }
});

// ─── Import Users ─────────────────────────────────────────────────────────────

router.post("/admin/import/users", requireAdmin, async (req, res): Promise<void> => {
  const users = req.body as Record<string, any>[];
  if (!Array.isArray(users)) { res.status(400).json({ error: "Expected a JSON array of users." }); return; }

  let imported = 0, skipped = 0;
  try {
    for (const u of users) {
      if (!u.email) { skipped++; continue; }
      const [existing] = await db.select({ id: usersTable.id })
        .from(usersTable).where(eq(usersTable.email, u.email));
      if (existing) {
        await db.update(usersTable).set({
          name: u.name ?? undefined,
          role: u.role ?? undefined,
          plan: u.plan ?? undefined,
          credits: u.credits ?? undefined,
          status: u.status ?? undefined,
          updatedAt: new Date(),
        }).where(eq(usersTable.id, existing.id));
        imported++;
      } else {
        await db.insert(usersTable).values({
          email: u.email, name: u.name ?? u.email,
          role: u.role ?? "user", plan: u.plan ?? "free",
          credits: u.credits ?? 0, status: u.status ?? "active",
          timezone: u.timezone ?? "UTC",
        });
        imported++;
      }
    }
    res.json({ success: true, message: `${imported} users imported, ${skipped} skipped.`, imported, skipped });
  } catch (err: any) {
    logger.error({ err }, "Import users error");
    res.status(500).json({ error: err?.message ?? "Import failed" });
  }
});

// ─── Import Campaigns ─────────────────────────────────────────────────────────

router.post("/admin/import/campaigns", requireAdmin, async (req, res): Promise<void> => {
  const { campaigns, targetUserId } = req.body as {
    campaigns: Record<string, any>[];
    targetUserId?: number;
  };
  if (!Array.isArray(campaigns)) { res.status(400).json({ error: "Expected { campaigns: [...] }." }); return; }

  let imported = 0, skipped = 0;
  try {
    for (const c of campaigns) {
      if (!c.name) { skipped++; continue; }
      const userId = targetUserId ?? c.userId;
      if (!userId) { skipped++; continue; }
      const [userExists] = await db.select({ id: usersTable.id })
        .from(usersTable).where(eq(usersTable.id, userId));
      if (!userExists) { skipped++; continue; }

      const [existing] = await db.select({ id: campaignsTable.id })
        .from(campaignsTable)
        .where(and(eq(campaignsTable.userId, userId), eq(campaignsTable.name, c.name)));
      if (existing) { skipped++; continue; }

      await db.insert(campaignsTable).values({
        userId, name: c.name,
        status: "pending",
        sendMode: c.sendMode ?? "gmail",
        emailStyle: c.emailStyle ?? "clean",
        useSignature: c.useSignature ?? false,
        totalLeads: 0, draftedCount: 0, failedCount: 0, sentCount: 0,
      });
      imported++;
    }
    res.json({ success: true, message: `${imported} campaigns imported, ${skipped} skipped.`, imported, skipped });
  } catch (err: any) {
    logger.error({ err }, "Import campaigns error");
    res.status(500).json({ error: err?.message ?? "Import failed" });
  }
});

// ─── Import Settings ──────────────────────────────────────────────────────────

router.post("/admin/import/settings", requireAdmin, async (req, res): Promise<void> => {
  const settings = req.body as Record<string, string>;
  if (typeof settings !== "object" || Array.isArray(settings)) {
    res.status(400).json({ error: "Expected a JSON object of settings." }); return;
  }

  let imported = 0;
  try {
    for (const [key, value] of Object.entries(settings)) {
      if (typeof value !== "string") continue;
      await db.insert(adminSettingsTable).values({ key, value })
        .onConflictDoUpdate({ target: adminSettingsTable.key, set: { value } });
      imported++;
    }
    res.json({ success: true, message: `${imported} settings imported.`, imported });
  } catch (err: any) {
    logger.error({ err }, "Import settings error");
    res.status(500).json({ error: err?.message ?? "Import failed" });
  }
});

// ─── Audit log: all admin actions ────────────────────────────────────────────

router.get("/admin/audit", requireAdmin, async (req, res): Promise<void> => {
  const page  = Math.max(parseInt(req.query.page  as string, 10) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);

  const adminTypes = ["admin_user_update", "admin_user_delete", "admin_settings_update",
    "admin_plan_update", "admin_plan_assigned", "admin_plan_request_approved",
    "admin_plan_request_rejected", "credit_adjustment", "support_ticket_update"];

  const [totalResult] = await db.select({ count: count() }).from(systemLogsTable)
    .where(or(...adminTypes.map(t => eq(systemLogsTable.type, t))));

  const logs = await db.select().from(systemLogsTable)
    .where(or(...adminTypes.map(t => eq(systemLogsTable.type, t))))
    .orderBy(desc(systemLogsTable.createdAt))
    .limit(limit).offset((page - 1) * limit);

  res.json({
    data:  logs.map(l => ({ ...l, createdAt: l.createdAt.toISOString() })),
    total: totalResult.count,
    page,
    limit,
  });
});

router.post("/admin/users/:id/assign-plan", requireAdmin, async (req, res): Promise<void> => {
  const targetId = parseInt((req.params.id as string), 10);
  const admin    = req.user!;
  const { planId } = req.body as { planId: number };

  const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, planId));
  if (!plan) { res.status(404).json({ error: "Plan not found." }); return; }

  const [existing] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.userId, targetId));
  if (existing) {
    await db.update(subscriptionsTable)
      .set({ planId, updatedAt: new Date() })
      .where(eq(subscriptionsTable.userId, targetId));
  } else {
    await db.insert(subscriptionsTable).values({ userId: targetId, planId, status: "active", billingStatus: "free" });
  }

  await db.update(usersTable)
    .set({ plan: plan.slug, updatedAt: new Date() })
    .where(eq(usersTable.id, targetId));

  await db.insert(systemLogsTable).values({
    userId:      admin.id,
    type:        "admin_plan_assigned",
    severity:    "info",
    description: `Admin assigned plan "${plan.name}" to user #${targetId}`,
  });

  res.json({ ok: true });
});

// ─── Tracking & Deliverability Test Endpoints ────────────────────────────────

router.post("/admin/test-open-tracking", requireAdmin, async (req, res): Promise<void> => {
  try {
    const rows = await db.select().from(adminSettingsTable)
      .where(inArray(adminSettingsTable.key, ["trackingUrl", "appUrl"]));
    const map     = Object.fromEntries(rows.map(r => [r.key, r.value]));
    const envBase = process.env.PUBLIC_URL
      ?? (process.env.REPLIT_DOMAINS ? `https://${process.env.REPLIT_DOMAINS.split(",")[0].trim()}` : null)
      ?? (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : null)
      ?? "http://localhost:3000";
    const trackingBase = (map.trackingUrl || map.appUrl || envBase).replace(/\/+$/, "");
    const testUrl      = `${trackingBase}/api/track/open/_admin_test_`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    try {
      const resp = await fetch(testUrl, { signal: controller.signal });
      clearTimeout(timer);
      const ok = resp.status >= 200 && resp.status < 400;
      res.json({ ok, trackingBase, testUrl, status: resp.status,
        message: ok ? `Endpoint reachable — HTTP ${resp.status}` : `Unexpected status: ${resp.status}` });
    } catch (fetchErr: any) {
      clearTimeout(timer);
      const timedOut = (fetchErr as Error).name === "AbortError";
      res.json({ ok: false, trackingBase, testUrl, status: null,
        message: timedOut
          ? "Request timed out — verify the Tracking URL is correct and the server is reachable"
          : `Connection error: ${(fetchErr as Error).message}` });
    }
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message });
  }
});

router.post("/admin/test-click-tracking", requireAdmin, async (req, res): Promise<void> => {
  try {
    const rows = await db.select().from(adminSettingsTable)
      .where(inArray(adminSettingsTable.key, ["trackingUrl", "appUrl"]));
    const map     = Object.fromEntries(rows.map(r => [r.key, r.value]));
    const envBase = process.env.PUBLIC_URL
      ?? (process.env.REPLIT_DOMAINS ? `https://${process.env.REPLIT_DOMAINS.split(",")[0].trim()}` : null)
      ?? (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : null)
      ?? "http://localhost:3000";
    const trackingBase = (map.trackingUrl || map.appUrl || envBase).replace(/\/+$/, "");
    const testUrl      = `${trackingBase}/api/track/click/_admin_test_?url=https%3A%2F%2Fexample.com`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    try {
      const resp = await fetch(testUrl, { redirect: "manual", signal: controller.signal });
      clearTimeout(timer);
      // Expect a redirect (302) or a 400/404 (if trackingId not in DB) — both mean the endpoint exists
      const ok = resp.status === 302 || resp.status === 400 || resp.status === 404;
      res.json({ ok, trackingBase, testUrl, status: resp.status,
        message: ok
          ? "Click endpoint is reachable and responding correctly"
          : `Unexpected status: ${resp.status}` });
    } catch (fetchErr: any) {
      clearTimeout(timer);
      const timedOut = (fetchErr as Error).name === "AbortError";
      res.json({ ok: false, trackingBase, testUrl, status: null,
        message: timedOut
          ? "Request timed out — verify the Tracking URL is correct"
          : `Connection error: ${(fetchErr as Error).message}` });
    }
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message });
  }
});

router.post("/admin/test-bounce-imap", requireAdmin, async (req, res): Promise<void> => {
  const { host, port, username, password, folder } = req.body as {
    host?: string; port?: number; username?: string; password?: string; folder?: string;
  };
  if (!host || !username || !password) {
    res.status(400).json({ ok: false, message: "host, username, and password are required" });
    return;
  }
  const imapPort   = Number(port) || 993;
  const imapFolder = folder || "INBOX";

  const { ImapFlow } = await import("imapflow");
  const client = new ImapFlow({
    host,
    port: imapPort,
    secure: imapPort === 993,
    auth: { user: username, pass: password },
    tls:  { rejectUnauthorized: false },
    logger: false,
    connectionTimeout: 10_000,
    socketTimeout:     15_000,
  });
  client.on("error", () => {});

  try {
    await client.connect();
    const lock = await client.getMailboxLock(imapFolder);
    let messageCount = 0;
    try {
      const st = await client.status(imapFolder, { messages: true });
      messageCount = st?.messages ?? 0;
    } finally { lock.release(); }
    client.logout().catch(() => {});
    res.json({
      ok: true,
      message: `Connected successfully. "${imapFolder}" has ${messageCount} message(s).`,
      host, port: imapPort, username, folder: imapFolder, messageCount,
    });
  } catch (err: any) {
    client.logout().catch(() => {});
    const msg = String(err?.message ?? "Connection failed");
    const category =
      /auth|login|credential|password/i.test(msg) ? "Authentication failed" :
      /timeout/i.test(msg)                         ? "Connection timed out" :
      /ENOTFOUND|getaddrinfo/i.test(msg)           ? "Host not found" :
      /mailbox|folder|no such/i.test(msg)          ? "Folder not found" :
      "Connection failed";
    res.json({ ok: false, message: category, detail: msg, host, port: imapPort, username, folder: imapFolder });
  }
});

// ─── Tracking URL diagnostic endpoint ─────────────────────────────────────────
// GET /api/admin/tracking-url-check
// Returns the fully-resolved tracking base URL so operators can verify what
// value is actually used for open-tracking pixels without grepping logs.
router.get("/admin/tracking-url-check", requireAdmin, async (_req, res): Promise<void> => {
  const { getTrackingSettings, isLocalhostUrl } = await import("../lib/tracking-settings");
  const settings = await getTrackingSettings();
  const isLocalhost = isLocalhostUrl(settings.trackingUrl);
  res.json({
    trackingUrl:          settings.trackingUrl,
    openTrackingEnabled:  settings.openTrackingEnabled,
    clickTrackingEnabled: settings.clickTrackingEnabled,
    isLocalhost,
    warning: isLocalhost
      ? "CRITICAL: trackingUrl resolves to localhost. Tracking pixels in sent emails will point to the recipient's own machine and never reach this server. Set PUBLIC_URL=https://yourdomain.com in your PM2 environment, or set Tracking URL in Admin → Settings."
      : null,
    envSources: {
      PUBLIC_URL:         process.env.PUBLIC_URL        ?? "(not set)",
      REPLIT_DOMAINS:     process.env.REPLIT_DOMAINS    ?? "(not set)",
      REPLIT_DEV_DOMAIN:  process.env.REPLIT_DEV_DOMAIN ?? "(not set)",
    },
    examplePixelUrl: `${settings.trackingUrl}/api/track/open/<trackingId>`,
  });
});

// ─── POST /admin/comm/reparse ─────────────────────────────────────────────────
//
// Cursor-based maintenance endpoint: regenerates body/snippet for comm_messages
// ONE BATCH PER REQUEST so no single HTTP call ever hits a proxy timeout.
//
// HOW TO USE
// ----------
// Call repeatedly, passing `nextCursor` from each response back as `cursor`,
// until `completed: true` is returned.
//
//   1st call  → POST /api/admin/comm/reparse  { clearUnparseable?: bool, batchSize?: 50–200 }
//   Nth call  → POST /api/admin/comm/reparse  { cursor: "<nextCursor>" }
//
// PHASES (order is fixed; one batch of ≤batchSize rows per request)
// ─────────────────────────────────────────────────────────────────
//   "html"    – htmlBody IS NOT NULL  → re-derive body (stripHtmlToText) + snippet
//   "snippet" – htmlBody IS NULL, valid body → re-derive snippet only
//   "clear"   – htmlBody IS NULL, body=(empty)|raw-MIME → DELETE + fix conv counters
//               (only runs when clearUnparseable=true)
//
// CURSOR (opaque base64url-encoded JSON carried by caller between requests)
//   { phase, lastId, batchSize, clearUnparseable,
//     tot: { htmlReparsed, snippetOnly, unparseableCleared, unparseableRemaining } }
//
// IN-PROGRESS RESPONSE
//   { completed:false, processed:<cumulative>, remaining:<estimate>,
//     nextCursor:"...", batch:{ phase, rowsThisBatch, durationMs, ... } }
//
// COMPLETED RESPONSE
//   { completed:true, processed:<total>,
//     htmlReparsed, snippetOnly, unparseableCleared, unparseableRemaining,
//     nextStep?:"..." }
//

type ReparsePhase = "html" | "snippet" | "clear";

interface ReparseCursor {
  phase:            ReparsePhase;
  lastId:           number;
  batchSize:        number;
  clearUnparseable: boolean;
  tot: {
    htmlReparsed:         number;
    snippetOnly:          number;
    unparseableCleared:   number;
    unparseableRemaining: number;
  };
}

function encodeReparseCursor(c: ReparseCursor): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

function decodeReparseCursor(s: string): ReparseCursor {
  return JSON.parse(Buffer.from(s, "base64url").toString("utf8")) as ReparseCursor;
}

function isUnparseableBody(body: string): boolean {
  const head = body.slice(0, 200);
  return (
    body === "(empty)" ||
    /^content-type:\s/i.test(head) ||
    /^content-transfer-encoding:\s/i.test(head)
  );
}

function nextReparsePhase(
  current: ReparsePhase,
  clearUnparseable: boolean,
): ReparsePhase | null {
  if (current === "html")    return "snippet";
  if (current === "snippet") return clearUnparseable ? "clear" : null;
  return null; // "clear" is always last
}

async function countReparseRemaining(
  phase:            ReparsePhase,
  lastId:           number,
  clearUnparseable: boolean,
): Promise<number> {
  // Count all rows still to process across every remaining phase.
  // Runs three lightweight index-range COUNT queries in parallel.
  const [htmlCount, snippetCount, clearCount] = await Promise.all([
    // html phase: htmlBody IS NOT NULL, id > lastId (0 when phase has passed)
    phase === "html"
      ? db.select({ n: sql<number>`count(*)::int` })
           .from(commMessagesTable)
           .where(and(isNotNull(commMessagesTable.htmlBody), gt(commMessagesTable.id, lastId)))
           .then(r => r[0]?.n ?? 0)
      : phase === "snippet" || phase === "clear"
        ? db.select({ n: sql<number>`count(*)::int` })
             .from(commMessagesTable)
             .where(isNotNull(commMessagesTable.htmlBody))
             .then(r => r[0]?.n ?? 0)
        : Promise.resolve(0 as number),

    // snippet phase: htmlBody IS NULL, body valid, id > lastId (0 when phase has passed)
    phase === "html" || phase === "snippet"
      ? db.select({ n: sql<number>`count(*)::int` })
           .from(commMessagesTable)
           .where(and(
             isNull(commMessagesTable.htmlBody),
             phase === "snippet" ? gt(commMessagesTable.id, lastId) : sql`true`,
             sql`NOT (
               ${commMessagesTable.body} = '(empty)' OR
               ${commMessagesTable.body} ilike 'Content-Type: %' OR
               ${commMessagesTable.body} ilike 'Content-Transfer-Encoding: %'
             )`,
           ))
           .then(r => r[0]?.n ?? 0)
      : Promise.resolve(0 as number),

    // clear phase: unparseable rows — only relevant when opt-in
    clearUnparseable
      ? db.select({ n: sql<number>`count(*)::int` })
           .from(commMessagesTable)
           .where(and(
             isNull(commMessagesTable.htmlBody),
             phase === "clear" ? gt(commMessagesTable.id, lastId) : sql`true`,
             or(
               eq(commMessagesTable.body, "(empty)"),
               sql`${commMessagesTable.body} ilike 'Content-Type: %'`,
               sql`${commMessagesTable.body} ilike 'Content-Transfer-Encoding: %'`,
             ),
           ))
           .then(r => r[0]?.n ?? 0)
      : Promise.resolve(0 as number),
  ]);

  return (htmlCount ?? 0) + (snippetCount ?? 0) + (clearCount ?? 0);
}

router.post("/admin/comm/reparse", requireAdmin, async (req, res): Promise<void> => {
  const reqStart = Date.now();

  // ── Decode or initialise cursor ───────────────────────────────────────────
  const body = (req.body ?? {}) as {
    cursor?:           string;
    clearUnparseable?: boolean;
    batchSize?:        number;
  };

  let cursor: ReparseCursor;
  if (body.cursor) {
    try {
      cursor = decodeReparseCursor(body.cursor);
    } catch {
      res.status(400).json({ error: "Invalid cursor — start a fresh run by omitting cursor." });
      return;
    }
  } else {
    cursor = {
      phase:            "html",
      lastId:           0,
      batchSize:        Math.min(200, Math.max(50, body.batchSize ?? 150)),
      clearUnparseable: body.clearUnparseable ?? false,
      tot: { htmlReparsed: 0, snippetOnly: 0, unparseableCleared: 0, unparseableRemaining: 0 },
    };
  }

  const { phase, lastId, batchSize, clearUnparseable, tot } = cursor;
  const phaseStart = Date.now();
  let rowsThisBatch      = 0;
  let batchHtmlReparsed  = 0;
  let batchSnippetOnly   = 0;
  let batchCleared       = 0;
  let batchUnparseable   = 0;

  // ── Run one batch for the current phase ──────────────────────────────────

  if (phase === "html") {
    // Re-derive body (plain text) + snippet for rows that have htmlBody stored.
    const rows = await db
      .select({ id: commMessagesTable.id, htmlBody: commMessagesTable.htmlBody })
      .from(commMessagesTable)
      .where(and(isNotNull(commMessagesTable.htmlBody), gt(commMessagesTable.id, lastId)))
      .orderBy(commMessagesTable.id)
      .limit(batchSize);

    for (const row of rows) {
      const html    = row.htmlBody!;
      const newBody = stripHtmlToText(html).replace(/\s+/g, " ").trim() || "(empty)";
      const newSnip = snippetOf(newBody, html);
      await db
        .update(commMessagesTable)
        .set({ body: newBody, snippet: newSnip })
        .where(eq(commMessagesTable.id, row.id));
      batchHtmlReparsed++;
    }
    rowsThisBatch = rows.length;
    if (rows.length > 0) cursor.lastId = rows[rows.length - 1]!.id;

  } else if (phase === "snippet") {
    // Re-derive snippet for plain-text-only rows; tally unparseable ones.
    const rows = await db
      .select({ id: commMessagesTable.id, body: commMessagesTable.body })
      .from(commMessagesTable)
      .where(and(isNull(commMessagesTable.htmlBody), gt(commMessagesTable.id, lastId)))
      .orderBy(commMessagesTable.id)
      .limit(batchSize);

    for (const row of rows) {
      if (isUnparseableBody(row.body)) {
        batchUnparseable++;
      } else {
        const newSnip = snippetOf(row.body, "");
        await db
          .update(commMessagesTable)
          .set({ snippet: newSnip })
          .where(eq(commMessagesTable.id, row.id));
        batchSnippetOnly++;
      }
    }
    rowsThisBatch = rows.length;
    if (rows.length > 0) cursor.lastId = rows[rows.length - 1]!.id;

  } else {
    // phase === "clear"
    // Delete rows whose content cannot be recovered; decrement conv counters.
    const rows = await db
      .select({
        id:             commMessagesTable.id,
        conversationId: commMessagesTable.conversationId,
        direction:      commMessagesTable.direction,
        isRead:         commMessagesTable.isRead,
      })
      .from(commMessagesTable)
      .where(and(
        isNull(commMessagesTable.htmlBody),
        gt(commMessagesTable.id, lastId),
        or(
          eq(commMessagesTable.body, "(empty)"),
          sql`${commMessagesTable.body} ilike 'Content-Type: %'`,
          sql`${commMessagesTable.body} ilike 'Content-Transfer-Encoding: %'`,
        ),
      ))
      .orderBy(commMessagesTable.id)
      .limit(batchSize);

    if (rows.length > 0) {
      // Accumulate per-conversation counter deltas before deleting
      const convDeltas = new Map<number, { total: number; unreadInbound: number }>();
      for (const r of rows) {
        const d = convDeltas.get(r.conversationId) ?? { total: 0, unreadInbound: 0 };
        d.total++;
        if (r.direction === "inbound" && !r.isRead) d.unreadInbound++;
        convDeltas.set(r.conversationId, d);
      }

      // Delete rows — removes the externalId dedup lock so next sync re-imports
      await db
        .delete(commMessagesTable)
        .where(inArray(commMessagesTable.id, rows.map(r => r.id)));

      // Decrement conversation counters (floor at 0 to guard against drift)
      for (const [convId, { total, unreadInbound }] of convDeltas) {
        await db
          .update(commConversationsTable)
          .set({
            messageCount: sql`GREATEST(0, ${commConversationsTable.messageCount} - ${total})`,
            unreadCount:  sql`GREATEST(0, ${commConversationsTable.unreadCount} - ${unreadInbound})`,
            updatedAt:    new Date(),
          })
          .where(eq(commConversationsTable.id, convId));
      }

      batchCleared  = rows.length;
      cursor.lastId = rows[rows.length - 1]!.id;
    }
    rowsThisBatch = rows.length;
  }

  const batchMs = Date.now() - phaseStart;

  // ── Update running totals ─────────────────────────────────────────────────
  tot.htmlReparsed         += batchHtmlReparsed;
  tot.snippetOnly          += batchSnippetOnly;
  tot.unparseableCleared   += batchCleared;
  tot.unparseableRemaining += batchUnparseable;
  cursor.tot = tot;

  const cumulative = tot.htmlReparsed + tot.snippetOnly + tot.unparseableCleared;

  logger.info(
    `[COMM-REPARSE] phase=${phase} lastId=${cursor.lastId} rows=${rowsThisBatch} ` +
    `batchMs=${batchMs} totalMs=${Date.now() - reqStart} ` +
    `cumulative=${cumulative} html=${tot.htmlReparsed} snip=${tot.snippetOnly} ` +
    `cleared=${tot.unparseableCleared} unparseable=${tot.unparseableRemaining}`,
  );

  // ── Determine whether to continue, advance phase, or finish ──────────────
  const batchWasFull = rowsThisBatch >= batchSize;

  if (batchWasFull) {
    // Current phase has more rows — return cursor at same phase, advanced lastId
    const remaining = await countReparseRemaining(cursor.phase, cursor.lastId, clearUnparseable);
    res.json({
      completed:  false,
      processed:  cumulative,
      remaining,
      nextCursor: encodeReparseCursor(cursor),
      batch: {
        phase,
        rowsThisBatch,
        durationMs:     batchMs,
        totalRequestMs: Date.now() - reqStart,
        htmlReparsed:   batchHtmlReparsed,
        snippetOnly:    batchSnippetOnly,
        cleared:        batchCleared,
        unparseable:    batchUnparseable,
      },
    });
    return;
  }

  // Phase is exhausted — advance to next phase
  const next = nextReparsePhase(phase, clearUnparseable);
  if (next !== null) {
    cursor.phase  = next;
    cursor.lastId = 0;
    const remaining = await countReparseRemaining(next, 0, clearUnparseable);
    res.json({
      completed:  false,
      processed:  cumulative,
      remaining,
      nextCursor: encodeReparseCursor(cursor),
      batch: {
        phase,
        rowsThisBatch,
        durationMs:     batchMs,
        totalRequestMs: Date.now() - reqStart,
        htmlReparsed:   batchHtmlReparsed,
        snippetOnly:    batchSnippetOnly,
        cleared:        batchCleared,
        unparseable:    batchUnparseable,
        phaseComplete:  true,
        nextPhase:      next,
      },
    });
    return;
  }

  // All phases done
  logger.info(
    `[COMM-REPARSE] Complete — html=${tot.htmlReparsed} snip=${tot.snippetOnly} ` +
    `cleared=${tot.unparseableCleared} unparseable=${tot.unparseableRemaining}`,
  );

  const needsSync =
    clearUnparseable && tot.unparseableCleared > 0
      ? `${tot.unparseableCleared} messages cleared — trigger a Communications sync ` +
        `(POST /api/communications/sync) or wait for the cron to re-import them.`
      : !clearUnparseable && tot.unparseableRemaining > 0
        ? `${tot.unparseableRemaining} messages have raw MIME or (empty) body and cannot ` +
          `be repaired from stored data. Re-run with { clearUnparseable: true } to delete ` +
          `them so the next sync re-fetches them through the fixed parser.`
        : undefined;

  res.json({
    completed:            true,
    processed:            cumulative,
    htmlReparsed:         tot.htmlReparsed,
    snippetOnly:          tot.snippetOnly,
    unparseableCleared:   tot.unparseableCleared,
    unparseableRemaining: tot.unparseableRemaining,
    ...(needsSync ? { nextStep: needsSync } : {}),
  });
});

export default router;
