import { Router, type IRouter } from "express";
import { db, templatesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import {
  CreateTemplateBody, UpdateTemplateBody, GetTemplateParams,
  UpdateTemplateParams, DeleteTemplateParams, DuplicateTemplateParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/templates", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const templates = await db.select().from(templatesTable).where(eq(templatesTable.userId, user.id));
  res.json(templates.map(t => ({ ...t, createdAt: t.createdAt.toISOString(), updatedAt: t.updatedAt.toISOString() })));
});

router.post("/templates", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const parsed = CreateTemplateBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [template] = await db.insert(templatesTable).values({ ...parsed.data, userId: user.id }).returning();
  res.status(201).json({ ...template, createdAt: template.createdAt.toISOString(), updatedAt: template.updatedAt.toISOString() });
});

router.get("/templates/:id", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const params = GetTemplateParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [template] = await db.select().from(templatesTable)
    .where(and(eq(templatesTable.id, params.data.id), eq(templatesTable.userId, user.id)));
  if (!template) { res.status(404).json({ error: "Template not found" }); return; }
  res.json({ ...template, createdAt: template.createdAt.toISOString(), updatedAt: template.updatedAt.toISOString() });
});

router.patch("/templates/:id", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const params = UpdateTemplateParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const body = UpdateTemplateBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [template] = await db.update(templatesTable)
    .set({ ...body.data, updatedAt: new Date() })
    .where(and(eq(templatesTable.id, params.data.id), eq(templatesTable.userId, user.id)))
    .returning();
  if (!template) { res.status(404).json({ error: "Template not found" }); return; }
  res.json({ ...template, createdAt: template.createdAt.toISOString(), updatedAt: template.updatedAt.toISOString() });
});

router.delete("/templates/:id", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const params = DeleteTemplateParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [template] = await db.delete(templatesTable)
    .where(and(eq(templatesTable.id, params.data.id), eq(templatesTable.userId, user.id)))
    .returning();
  if (!template) { res.status(404).json({ error: "Template not found" }); return; }
  res.json({ message: "Template deleted" });
});

router.post("/templates/:id/duplicate", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const params = DuplicateTemplateParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [source] = await db.select().from(templatesTable)
    .where(and(eq(templatesTable.id, params.data.id), eq(templatesTable.userId, user.id)));
  if (!source) { res.status(404).json({ error: "Template not found" }); return; }
  const [copy] = await db.insert(templatesTable).values({
    userId: user.id, name: `${source.name} (Copy)`, subject: source.subject, body: source.body,
    isDefault: false, ctaButtonsJson: source.ctaButtonsJson ?? null,
  }).returning();
  res.status(201).json({ ...copy, createdAt: copy.createdAt.toISOString(), updatedAt: copy.updatedAt.toISOString() });
});

export default router;
