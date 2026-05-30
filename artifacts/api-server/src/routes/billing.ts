import { Router, type IRouter } from "express";
import {
  db, usersTable, plansTable, subscriptionsTable, planRequestsTable,
  systemLogsTable, draftsTable, mailboxesTable, campaignsTable,
} from "@workspace/db";
import { eq, and, count, desc, sql, ne } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../lib/auth";

const router: IRouter = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getOrCreateSubscription(userId: number) {
  const rows = await db.select({
    sub: subscriptionsTable,
    plan: plansTable,
  }).from(subscriptionsTable)
    .innerJoin(plansTable, eq(subscriptionsTable.planId, plansTable.id))
    .where(eq(subscriptionsTable.userId, userId));

  if (rows.length > 0) return rows[0];

  // Auto-create free subscription
  const [freePlan] = await db.select().from(plansTable).where(eq(plansTable.slug, "free"));
  if (!freePlan) return null;

  await db.insert(subscriptionsTable).values({
    userId,
    planId: freePlan.id,
    status: "active",
    billingStatus: "free",
    currentPeriodStart: new Date(),
  });
  await db.update(usersTable).set({ plan: "free" }).where(eq(usersTable.id, userId));

  const [created] = await db.select({
    sub: subscriptionsTable,
    plan: plansTable,
  }).from(subscriptionsTable)
    .innerJoin(plansTable, eq(subscriptionsTable.planId, plansTable.id))
    .where(eq(subscriptionsTable.userId, userId));

  return created ?? null;
}

async function getCurrentUsage(userId: number) {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [[emailsSent], [smtpUsed], [campaigns]] = await Promise.all([
    db.select({ count: count() }).from(draftsTable)
      .where(and(eq(draftsTable.userId, userId), eq(draftsTable.status, "success"),
        sql`${draftsTable.createdAt} >= ${monthStart}`)),
    db.select({ count: count() }).from(mailboxesTable)
      .where(and(eq(mailboxesTable.userId, userId), eq(mailboxesTable.isActive, true))),
    db.select({ count: count() }).from(campaignsTable)
      .where(eq(campaignsTable.userId, userId)),
  ]);

  return {
    emailsSentThisMonth: emailsSent.count,
    smtpAccountsUsed: smtpUsed.count,
    campaignsCount: campaigns.count,
  };
}

// ─── Public: list plans ───────────────────────────────────────────────────────

router.get("/billing/plans", async (_req, res): Promise<void> => {
  const plans = await db.select().from(plansTable)
    .where(eq(plansTable.isActive, true))
    .orderBy(plansTable.sortOrder);
  res.json(plans);
});

// ─── User: my subscription + usage ───────────────────────────────────────────

router.get("/billing/subscription", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const row = await getOrCreateSubscription(user.id);
  if (!row) { res.status(500).json({ error: "No free plan found. Contact admin." }); return; }

  const usage = await getCurrentUsage(user.id);

  // Pending request
  const [pending] = await db.select({
    id: planRequestsTable.id,
    toPlanId: planRequestsTable.toPlanId,
    toPlanName: plansTable.name,
    status: planRequestsTable.status,
    createdAt: planRequestsTable.createdAt,
  }).from(planRequestsTable)
    .innerJoin(plansTable, eq(planRequestsTable.toPlanId, plansTable.id))
    .where(and(eq(planRequestsTable.userId, user.id), eq(planRequestsTable.status, "pending")));

  res.json({
    subscription: {
      ...row.sub,
      currentPeriodStart: row.sub.currentPeriodStart.toISOString(),
      currentPeriodEnd: row.sub.currentPeriodEnd?.toISOString() ?? null,
      createdAt: row.sub.createdAt.toISOString(),
      updatedAt: row.sub.updatedAt.toISOString(),
    },
    plan: row.plan,
    usage,
    pendingRequest: pending
      ? { ...pending, createdAt: pending.createdAt.toISOString() }
      : null,
  });
});

// ─── User: request plan upgrade ───────────────────────────────────────────────

router.post("/billing/request-upgrade", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const { toPlanId } = req.body as { toPlanId: number };

  if (!toPlanId) { res.status(400).json({ error: "toPlanId is required." }); return; }

  // Check plan exists
  const [targetPlan] = await db.select().from(plansTable).where(eq(plansTable.id, toPlanId));
  if (!targetPlan) { res.status(404).json({ error: "Plan not found." }); return; }

  // Cancel any existing pending requests
  await db.update(planRequestsTable)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(and(eq(planRequestsTable.userId, user.id), eq(planRequestsTable.status, "pending")));

  // Get current plan
  const row = await getOrCreateSubscription(user.id);
  const fromPlanId = row?.sub.planId ?? null;

  // Can't request current plan
  if (fromPlanId === toPlanId) { res.status(400).json({ error: "You are already on this plan." }); return; }

  await db.insert(planRequestsTable).values({
    userId: user.id,
    fromPlanId,
    toPlanId,
    status: "pending",
  });

  await db.insert(systemLogsTable).values({
    userId: user.id,
    type: "plan_upgrade_request",
    severity: "info",
    description: `User ${user.email} requested upgrade to plan "${targetPlan.name}" (#${toPlanId})`,
  });

  res.json({ ok: true, message: "Upgrade request submitted. An admin will review it shortly." });
});

// ─── Admin: list plan requests ────────────────────────────────────────────────

router.get("/admin/plan-requests", requireAdmin, async (req, res): Promise<void> => {
  const status = (req.query.status as string) || "all";

  const rows = await db.select({
    id: planRequestsTable.id,
    userId: planRequestsTable.userId,
    userName: usersTable.name,
    userEmail: usersTable.email,
    fromPlanId: planRequestsTable.fromPlanId,
    toPlanId: planRequestsTable.toPlanId,
    toPlanName: plansTable.name,
    status: planRequestsTable.status,
    adminNote: planRequestsTable.adminNote,
    createdAt: planRequestsTable.createdAt,
    updatedAt: planRequestsTable.updatedAt,
  }).from(planRequestsTable)
    .innerJoin(usersTable, eq(planRequestsTable.userId, usersTable.id))
    .innerJoin(plansTable, eq(planRequestsTable.toPlanId, plansTable.id))
    .where(status !== "all" ? eq(planRequestsTable.status, status) : undefined)
    .orderBy(desc(planRequestsTable.createdAt));

  // Enrich with fromPlanName
  const planIds = [...new Set(rows.map(r => r.fromPlanId).filter(Boolean) as number[])];
  const fromPlans = planIds.length > 0
    ? await db.select({ id: plansTable.id, name: plansTable.name }).from(plansTable)
    : [];
  const fromPlanMap = Object.fromEntries(fromPlans.map(p => [p.id, p.name]));

  res.json(rows.map(r => ({
    ...r,
    fromPlanName: r.fromPlanId ? (fromPlanMap[r.fromPlanId] ?? "Unknown") : "None",
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  })));
});

// ─── Admin: approve plan request ──────────────────────────────────────────────

router.post("/admin/plan-requests/:id/approve", requireAdmin, async (req, res): Promise<void> => {
  const admin = req.user!;
  const requestId = parseInt(req.params.id, 10);

  const [request] = await db.select().from(planRequestsTable)
    .where(eq(planRequestsTable.id, requestId));
  if (!request) { res.status(404).json({ error: "Request not found." }); return; }
  if (request.status !== "pending") { res.status(400).json({ error: "Request is no longer pending." }); return; }

  const [targetPlan] = await db.select().from(plansTable).where(eq(plansTable.id, request.toPlanId));
  if (!targetPlan) { res.status(404).json({ error: "Target plan not found." }); return; }

  // Upsert subscription
  const existing = await db.select().from(subscriptionsTable)
    .where(eq(subscriptionsTable.userId, request.userId));

  if (existing.length > 0) {
    await db.update(subscriptionsTable).set({
      planId: request.toPlanId,
      billingStatus: targetPlan.slug === "free" ? "free" : "paid",
      updatedAt: new Date(),
    }).where(eq(subscriptionsTable.userId, request.userId));
  } else {
    await db.insert(subscriptionsTable).values({
      userId: request.userId,
      planId: request.toPlanId,
      status: "active",
      billingStatus: targetPlan.slug === "free" ? "free" : "paid",
      currentPeriodStart: new Date(),
    });
  }

  // Update user.plan field
  await db.update(usersTable).set({ plan: targetPlan.slug }).where(eq(usersTable.id, request.userId));

  // Approve the request
  await db.update(planRequestsTable).set({
    status: "approved",
    updatedAt: new Date(),
  }).where(eq(planRequestsTable.id, requestId));

  await db.insert(systemLogsTable).values({
    userId: admin.id,
    type: "plan_request_approved",
    severity: "info",
    description: `Admin approved plan upgrade to "${targetPlan.name}" for user #${request.userId}`,
  });

  res.json({ ok: true });
});

// ─── Admin: reject plan request ───────────────────────────────────────────────

router.post("/admin/plan-requests/:id/reject", requireAdmin, async (req, res): Promise<void> => {
  const admin = req.user!;
  const requestId = parseInt(req.params.id, 10);
  const { note } = req.body as { note?: string };

  const [request] = await db.select().from(planRequestsTable)
    .where(eq(planRequestsTable.id, requestId));
  if (!request) { res.status(404).json({ error: "Request not found." }); return; }

  await db.update(planRequestsTable).set({
    status: "rejected",
    adminNote: note ?? null,
    updatedAt: new Date(),
  }).where(eq(planRequestsTable.id, requestId));

  await db.insert(systemLogsTable).values({
    userId: admin.id,
    type: "plan_request_rejected",
    severity: "warn",
    description: `Admin rejected plan upgrade request #${requestId}${note ? `: ${note}` : ""}`,
  });

  res.json({ ok: true });
});

// ─── Admin: list all subscriptions ───────────────────────────────────────────

router.get("/admin/subscriptions", requireAdmin, async (_req, res): Promise<void> => {
  const subs = await db.select({
    userId: usersTable.id,
    userName: usersTable.name,
    userEmail: usersTable.email,
    planName: plansTable.name,
    planSlug: plansTable.slug,
    planId: plansTable.id,
    monthlyEmailLimit: plansTable.monthlyEmailLimit,
    smtpAccountsLimit: plansTable.smtpAccountsLimit,
    billingStatus: subscriptionsTable.billingStatus,
    status: subscriptionsTable.status,
    currentPeriodStart: subscriptionsTable.currentPeriodStart,
    currentPeriodEnd: subscriptionsTable.currentPeriodEnd,
    stripeCustomerId: subscriptionsTable.stripeCustomerId,
    stripeSubscriptionId: subscriptionsTable.stripeSubscriptionId,
    emailsSentThisMonth: sql<number>`(
      SELECT COUNT(*)::int FROM drafts
      WHERE drafts.user_id = ${usersTable.id}
        AND drafts.status = 'success'
        AND drafts.created_at >= date_trunc('month', CURRENT_DATE)
    )`,
    smtpAccountsUsed: sql<number>`(
      SELECT COUNT(*)::int FROM mailboxes
      WHERE mailboxes.user_id = ${usersTable.id}
        AND mailboxes.is_active = true
    )`,
  }).from(subscriptionsTable)
    .innerJoin(usersTable, eq(subscriptionsTable.userId, usersTable.id))
    .innerJoin(plansTable, eq(subscriptionsTable.planId, plansTable.id))
    .orderBy(desc(subscriptionsTable.createdAt));

  res.json(subs.map(s => ({
    ...s,
    currentPeriodStart: s.currentPeriodStart.toISOString(),
    currentPeriodEnd: s.currentPeriodEnd?.toISOString() ?? null,
  })));
});

// ─── Admin: edit plan ─────────────────────────────────────────────────────────

router.get("/admin/plans", requireAdmin, async (_req, res): Promise<void> => {
  const plans = await db.select().from(plansTable).orderBy(plansTable.sortOrder);
  res.json(plans);
});

router.put("/admin/plans/:id", requireAdmin, async (req, res): Promise<void> => {
  const admin = req.user!;
  const planId = parseInt(req.params.id, 10);
  const { monthlyEmailLimit, smtpAccountsLimit, campaignsLimit, batchSendLimit, name, description } = req.body;

  await db.update(plansTable).set({
    ...(name               !== undefined && { name }),
    ...(description        !== undefined && { description }),
    ...(monthlyEmailLimit  !== undefined && { monthlyEmailLimit:  parseInt(String(monthlyEmailLimit), 10) }),
    ...(smtpAccountsLimit  !== undefined && { smtpAccountsLimit:  parseInt(String(smtpAccountsLimit), 10) }),
    ...(campaignsLimit     !== undefined && { campaignsLimit:     parseInt(String(campaignsLimit), 10) }),
    ...(batchSendLimit     !== undefined && { batchSendLimit:     parseInt(String(batchSendLimit), 10) }),
    updatedAt: new Date(),
  }).where(eq(plansTable.id, planId));

  await db.insert(systemLogsTable).values({
    userId: admin.id,
    type: "admin_plan_update",
    severity: "info",
    description: `Admin updated plan #${planId} limits`,
  });

  res.json({ ok: true });
});

// ─── Admin: manually assign plan to user ──────────────────────────────────────

router.post("/admin/users/:id/assign-plan", requireAdmin, async (req, res): Promise<void> => {
  const admin = req.user!;
  const targetUserId = parseInt(req.params.id, 10);
  const { planId } = req.body as { planId: number };

  const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, planId));
  if (!plan) { res.status(404).json({ error: "Plan not found." }); return; }

  const existing = await db.select().from(subscriptionsTable)
    .where(eq(subscriptionsTable.userId, targetUserId));

  if (existing.length > 0) {
    await db.update(subscriptionsTable).set({
      planId,
      billingStatus: plan.slug === "free" ? "free" : "paid",
      updatedAt: new Date(),
    }).where(eq(subscriptionsTable.userId, targetUserId));
  } else {
    await db.insert(subscriptionsTable).values({
      userId: targetUserId,
      planId,
      status: "active",
      billingStatus: plan.slug === "free" ? "free" : "paid",
      currentPeriodStart: new Date(),
    });
  }

  await db.update(usersTable).set({ plan: plan.slug }).where(eq(usersTable.id, targetUserId));

  await db.insert(systemLogsTable).values({
    userId: admin.id,
    type: "admin_plan_assigned",
    severity: "info",
    description: `Admin assigned plan "${plan.name}" to user #${targetUserId}`,
  });

  res.json({ ok: true });
});

export default router;
