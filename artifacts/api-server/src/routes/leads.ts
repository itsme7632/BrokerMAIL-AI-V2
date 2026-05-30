import { Router, type IRouter } from "express";
import { db, leadsTable, draftsTable, templatesTable, activityTable } from "@workspace/db";
import { eq, and, count, ilike, desc, or } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import {
  CreateLeadBody, UpdateLeadBody, GetLeadParams, UpdateLeadParams, DeleteLeadParams,
  BulkImportLeadsBody, RetryLeadDraftParams,
} from "@workspace/api-zod";
import { generatePersonalizedEmail } from "../lib/ai";
import { createGmailDraft } from "../lib/gmail";

const router: IRouter = Router();

router.get("/leads", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const page = parseInt(req.query.page as string, 10) || 1;
  const limit = parseInt(req.query.limit as string, 10) || 50;
  const search = req.query.search as string | undefined;
  const status = req.query.status as string | undefined;
  const campaignId = req.query.campaignId ? parseInt(req.query.campaignId as string, 10) : undefined;

  let query = db.select().from(leadsTable).where(eq(leadsTable.userId, user.id));

  const conditions: Parameters<typeof and>[0][] = [eq(leadsTable.userId, user.id)];
  if (status) conditions.push(eq(leadsTable.status, status));
  if (campaignId) conditions.push(eq(leadsTable.campaignId, campaignId));
  if (search) {
    conditions.push(or(
      ilike(leadsTable.name, `%${search}%`),
      ilike(leadsTable.email, `%${search}%`),
    ) as Parameters<typeof and>[0]);
  }

  const [totalResult] = await db.select({ count: count() }).from(leadsTable)
    .where(and(...conditions));
  const leads = await db.select().from(leadsTable)
    .where(and(...conditions))
    .orderBy(desc(leadsTable.createdAt))
    .limit(limit)
    .offset((page - 1) * limit);

  res.json({
    data: leads.map(l => ({ ...l, createdAt: l.createdAt.toISOString(), updatedAt: l.updatedAt.toISOString() })),
    total: totalResult.count, page, limit,
  });
});

router.post("/leads", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const parsed = CreateLeadBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [lead] = await db.insert(leadsTable).values({ ...parsed.data, userId: user.id }).returning();
  res.status(201).json({ ...lead, createdAt: lead.createdAt.toISOString(), updatedAt: lead.updatedAt.toISOString() });
});

router.get("/leads/:id", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const params = GetLeadParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [lead] = await db.select().from(leadsTable)
    .where(and(eq(leadsTable.id, params.data.id), eq(leadsTable.userId, user.id)));
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }
  res.json({ ...lead, createdAt: lead.createdAt.toISOString(), updatedAt: lead.updatedAt.toISOString() });
});

router.patch("/leads/:id", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const params = UpdateLeadParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const body = UpdateLeadBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [lead] = await db.update(leadsTable)
    .set({ ...body.data, updatedAt: new Date() })
    .where(and(eq(leadsTable.id, params.data.id), eq(leadsTable.userId, user.id)))
    .returning();
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }
  res.json({ ...lead, createdAt: lead.createdAt.toISOString(), updatedAt: lead.updatedAt.toISOString() });
});

router.delete("/leads/:id", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const params = DeleteLeadParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [lead] = await db.delete(leadsTable)
    .where(and(eq(leadsTable.id, params.data.id), eq(leadsTable.userId, user.id)))
    .returning();
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }
  res.json({ message: "Lead deleted" });
});

router.post("/leads/bulk-import", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const parsed = BulkImportLeadsBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { leads, campaignId } = parsed.data;
  let imported = 0;
  let skipped = 0;
  let duplicates = 0;
  const errors: string[] = [];

  for (const lead of leads) {
    if (!lead.email) { skipped++; continue; }
    const [existing] = await db.select({ id: leadsTable.id }).from(leadsTable)
      .where(and(eq(leadsTable.userId, user.id), eq(leadsTable.email, lead.email)));
    if (existing) { duplicates++; continue; }
    try {
      await db.insert(leadsTable).values({ ...lead, userId: user.id, campaignId: campaignId ?? null });
      imported++;
    } catch (err) {
      errors.push(`${lead.email}: ${err instanceof Error ? err.message : String(err)}`);
      skipped++;
    }
  }

  if (imported > 0 && campaignId) {
    await db.insert(activityTable).values({
      userId: user.id, type: "leads_imported",
      description: `Imported ${imported} leads`,
      metadata: { campaignId, imported, duplicates },
    });
  }

  res.json({ imported, skipped, duplicates, errors });
});

router.post("/leads/:id/retry-draft", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const params = RetryLeadDraftParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  if (!user.gmailConnected || !user.gmailAccessToken) {
    res.status(400).json({ error: "Gmail not connected" });
    return;
  }

  const [lead] = await db.select().from(leadsTable)
    .where(and(eq(leadsTable.id, params.data.id), eq(leadsTable.userId, user.id)));
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }

  const [template] = lead.campaignId
    ? await db.select().from(templatesTable).where(eq(templatesTable.userId, user.id)).limit(1)
    : await db.select().from(templatesTable)
        .where(and(eq(templatesTable.userId, user.id), eq(templatesTable.isDefault, true))).limit(1);

  if (!template) { res.status(400).json({ error: "No template found" }); return; }

  try {
    const generated = await generatePersonalizedEmail({
      name: lead.name, email: lead.email, vehicle: lead.vehicle, route: lead.route,
      pickup: lead.pickup, delivery: lead.delivery, price: lead.price, notes: lead.notes,
      templateSubject: template.subject, templateBody: template.body, tone: "professional",
    });
    const gmailDraftId = await createGmailDraft(user, lead.email, generated.subject, generated.body);
    await db.update(leadsTable).set({ status: "drafted", gmailDraftId, errorMessage: null, updatedAt: new Date() }).where(eq(leadsTable.id, lead.id));
    res.json({ success: true, gmailDraftId, error: null });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    res.json({ success: false, gmailDraftId: null, error: errMsg });
  }
});

export default router;
