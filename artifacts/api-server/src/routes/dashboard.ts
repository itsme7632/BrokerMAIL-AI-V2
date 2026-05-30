import { Router, type IRouter } from "express";
import { db, usersTable, campaignsTable, leadsTable, draftsTable, activityTable } from "@workspace/db";
import { eq, count, sql, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

router.get("/dashboard/stats", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const [campaigns] = await db.select({ count: count() }).from(campaignsTable).where(eq(campaignsTable.userId, user.id));
  const [leads] = await db.select({ count: count() }).from(leadsTable).where(eq(leadsTable.userId, user.id));
  const [draftsCreated] = await db.select({ count: count() }).from(draftsTable)
    .where(eq(draftsTable.userId, user.id));
  const [successDrafts] = await db.select({ count: count() }).from(draftsTable)
    .where(sql`${draftsTable.userId} = ${user.id} AND ${draftsTable.status} = 'success'`);
  const [aiCalls] = await db.select({ count: count() }).from(draftsTable)
    .where(eq(draftsTable.userId, user.id));
  const [activeCampaigns] = await db.select({ count: count() }).from(campaignsTable)
    .where(sql`${campaignsTable.userId} = ${user.id} AND ${campaignsTable.status} = 'pending'`);

  const totalDrafts = draftsCreated.count;
  const successCount = successDrafts.count;
  const successRate = totalDrafts > 0 ? successCount / totalDrafts : 0;

  res.json({
    totalCampaigns: campaigns.count,
    totalLeads: leads.count,
    totalDraftsCreated: totalDrafts,
    draftSuccessRate: successRate,
    aiEmailsGenerated: aiCalls.count,
    activeCampaigns: activeCampaigns.count,
  });
});

router.get("/dashboard/recent-campaigns", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const limit = parseInt(req.query.limit as string, 10) || 5;
  const campaigns = await db.select().from(campaignsTable)
    .where(eq(campaignsTable.userId, user.id))
    .orderBy(desc(campaignsTable.createdAt))
    .limit(limit);
  res.json(campaigns.map(c => ({
    ...c,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  })));
});

router.get("/dashboard/activity", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const limit = parseInt(req.query.limit as string, 10) || 10;
  const items = await db.select().from(activityTable)
    .where(eq(activityTable.userId, user.id))
    .orderBy(desc(activityTable.createdAt))
    .limit(limit);
  res.json(items.map(a => ({
    id: a.id,
    type: a.type,
    description: a.description,
    createdAt: a.createdAt.toISOString(),
    metadata: a.metadata ?? {},
  })));
});

export default router;
