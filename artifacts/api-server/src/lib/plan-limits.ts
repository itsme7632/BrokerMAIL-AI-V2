import {
  db, plansTable, subscriptionsTable, draftsTable, mailboxesTable, campaignsTable,
} from "@workspace/db";
import { eq, and, count, sql } from "drizzle-orm";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LimitError {
  error: string;
  detail: string;
  resetDate: string;
  upgradeRequired: true;
}

interface PlanLimits {
  planId: number;
  planName: string;
  monthlyEmailLimit: number;
  smtpAccountsLimit: number;
  campaignsLimit: number;
}

interface Usage {
  emailsSentThisMonth: number;
  smtpAccountsUsed: number;
  campaignsCount: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function nextMonthStart(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 1, 0, 0, 0, 0);
}

function daysUntil(date: Date): number {
  return Math.max(1, Math.ceil((date.getTime() - Date.now()) / 86_400_000));
}

async function getPlanLimits(userId: number): Promise<PlanLimits | null> {
  const [row] = await db.select({
    planId: plansTable.id,
    planName: plansTable.name,
    monthlyEmailLimit: plansTable.monthlyEmailLimit,
    smtpAccountsLimit: plansTable.smtpAccountsLimit,
    campaignsLimit: plansTable.campaignsLimit,
  }).from(subscriptionsTable)
    .innerJoin(plansTable, eq(subscriptionsTable.planId, plansTable.id))
    .where(eq(subscriptionsTable.userId, userId));

  if (row) return row;

  // Fallback: no subscription yet — read free plan limits (read-only, no auto-create)
  const [freePlan] = await db.select({
    planId: plansTable.id,
    planName: plansTable.name,
    monthlyEmailLimit: plansTable.monthlyEmailLimit,
    smtpAccountsLimit: plansTable.smtpAccountsLimit,
    campaignsLimit: plansTable.campaignsLimit,
  }).from(plansTable).where(eq(plansTable.slug, "free"));

  return freePlan ?? null;
}

async function getCurrentUsage(userId: number): Promise<Usage> {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [[emailsSent], [smtpUsed], [campaigns]] = await Promise.all([
    db.select({ count: count() }).from(draftsTable)
      .where(and(
        eq(draftsTable.userId, userId),
        eq(draftsTable.status, "success"),
        sql`${draftsTable.createdAt} >= ${monthStart}`,
      )),
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

// ─── Public limit checks ──────────────────────────────────────────────────────
// Return a LimitError object if the user is at or over the limit, null if OK.
// limit === -1 always means unlimited.

export async function checkEmailLimit(userId: number): Promise<LimitError | null> {
  const [limits, usage] = await Promise.all([getPlanLimits(userId), getCurrentUsage(userId)]);
  if (!limits) return null;
  if (limits.monthlyEmailLimit === -1) return null;
  if (usage.emailsSentThisMonth < limits.monthlyEmailLimit) return null;

  const reset = nextMonthStart();
  const days  = daysUntil(reset);
  return {
    error: "Monthly email limit reached.",
    detail:
      `Your plan limit has been exhausted. ` +
      `(${usage.emailsSentThisMonth.toLocaleString()} / ${limits.monthlyEmailLimit.toLocaleString()} emails used on ${limits.planName} plan.) ` +
      `Resets in ${days} day${days !== 1 ? "s" : ""}.`,
    resetDate: reset.toISOString(),
    upgradeRequired: true,
  };
}

export async function checkCampaignLimit(userId: number): Promise<LimitError | null> {
  const [limits, usage] = await Promise.all([getPlanLimits(userId), getCurrentUsage(userId)]);
  if (!limits) return null;
  if (limits.campaignsLimit === -1) return null;
  if (usage.campaignsCount < limits.campaignsLimit) return null;

  const reset = nextMonthStart();
  const days  = daysUntil(reset);
  return {
    error: "Campaign limit reached.",
    detail:
      `Your ${limits.planName} plan allows ${limits.campaignsLimit} campaign${limits.campaignsLimit !== 1 ? "s" : ""}. ` +
      `Upgrade your plan or wait for the next billing cycle.`,
    resetDate: reset.toISOString(),
    upgradeRequired: true,
  };
}

export async function checkMailboxLimit(userId: number): Promise<LimitError | null> {
  const [limits, usage] = await Promise.all([getPlanLimits(userId), getCurrentUsage(userId)]);
  if (!limits) return null;
  if (limits.smtpAccountsLimit === -1) return null;
  if (usage.smtpAccountsUsed < limits.smtpAccountsLimit) return null;

  return {
    error: "Mailbox limit reached.",
    detail:
      `Your ${limits.planName} plan allows ${limits.smtpAccountsLimit} mailbox${limits.smtpAccountsLimit !== 1 ? "es" : ""}. ` +
      `Upgrade your plan to add more mailboxes.`,
    resetDate: new Date().toISOString(),
    upgradeRequired: true,
  };
}
