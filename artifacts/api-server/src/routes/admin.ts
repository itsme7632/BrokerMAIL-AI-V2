import { Router, type IRouter } from "express";
import {
  db, usersTable, campaignsTable, leadsTable, draftsTable,
  systemLogsTable, mailboxesTable, adminSettingsTable, emailQueueTable,
  plansTable, subscriptionsTable, planRequestsTable, supportTicketsTable,
  templatesTable, suppressionListTable, processedBouncesTable,
  emailTrackingEventsTable, backupHistoryTable,
} from "@workspace/db";
import { count, desc, sql, eq, gte, and, or, ilike, isNotNull, inArray } from "drizzle-orm";
import { requireAdmin } from "../lib/auth";
import { logger } from "../lib/logger";
import multer from "multer";
import JSZip from "jszip";

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
    role:           usersTable.role,
    plan:           usersTable.plan,
    credits:        usersTable.credits,
    status:         usersTable.status,
    gmailConnected: usersTable.gmailConnected,
    createdAt:      usersTable.createdAt,
    lastActiveAt:   usersTable.lastActiveAt,
    emailsSent: sql<number>`(SELECT COUNT(*)::int FROM drafts WHERE drafts.user_id = users.id AND drafts.status = 'success')`,
    smtpConnected: sql<boolean>`EXISTS(SELECT 1 FROM mailboxes WHERE mailboxes.user_id = users.id AND mailboxes.is_active = true)`,
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

router.get("/admin/mailboxes", requireAdmin, async (_req, res): Promise<void> => {
  const mailboxes = await db.select({
    id:         mailboxesTable.id,
    userId:     mailboxesTable.userId,
    userName:   usersTable.name,
    userEmail:  usersTable.email,
    smtpHost:   mailboxesTable.smtpHost,
    smtpPort:   mailboxesTable.smtpPort,
    smtpUser:   mailboxesTable.smtpUser,
    smtpSecure: mailboxesTable.smtpSecure,
    fromName:   mailboxesTable.fromName,
    isActive:   mailboxesTable.isActive,
    createdAt:  mailboxesTable.createdAt,
    emailsSent: sql<number>`(SELECT COUNT(*)::int FROM drafts WHERE drafts.user_id = ${mailboxesTable.userId} AND drafts.status = 'success' AND drafts.gmail_draft_id LIKE 'smtp:%')`,
  })
    .from(mailboxesTable)
    .leftJoin(usersTable, eq(mailboxesTable.userId, usersTable.id))
    .orderBy(desc(mailboxesTable.createdAt));

  res.json(mailboxes.map(m => ({ ...m, createdAt: m.createdAt?.toISOString() ?? null })));
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
  const search         = (req.query.search   as string) || "";

  const conditions = [];
  if (statusFilter   !== "all") conditions.push(eq(supportTicketsTable.status, statusFilter));
  if (priorityFilter !== "all") conditions.push(eq(supportTicketsTable.priority, priorityFilter));
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

export default router;
