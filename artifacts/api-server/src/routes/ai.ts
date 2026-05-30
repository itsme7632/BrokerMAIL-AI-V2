import { Router, type IRouter } from "express";
import { db, leadsTable, templatesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { GenerateEmailBody, PreviewEmailBody } from "@workspace/api-zod";
import { generatePersonalizedEmail, generateFollowupOptions, AiRateLimitError, AiQuotaError, AiConfigError } from "../lib/ai";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Per-user rate limiting (in-memory sliding window)
// ---------------------------------------------------------------------------

interface RateLimitState { timestamps: number[] }
const rateLimits = new Map<number, RateLimitState>();
const RATE_LIMIT_MAX_PREVIEW = 8;
const RATE_LIMIT_MAX_GENERATE = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;

function checkRateLimit(userId: number, max: number): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const state = rateLimits.get(userId) ?? { timestamps: [] };
  state.timestamps = state.timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  if (state.timestamps.length >= max) {
    const oldest = state.timestamps[0];
    const retryAfterMs = RATE_LIMIT_WINDOW_MS - (now - oldest);
    rateLimits.set(userId, state);
    return { allowed: false, retryAfterSec: Math.ceil(retryAfterMs / 1000) };
  }
  state.timestamps.push(now);
  rateLimits.set(userId, state);
  return { allowed: true, retryAfterSec: 0 };
}

// ---------------------------------------------------------------------------
// In-flight request deduplication
// ---------------------------------------------------------------------------
const inFlight = new Set<number>();

// ---------------------------------------------------------------------------
// Preview response cache
// ---------------------------------------------------------------------------
interface CacheEntry { subject: string; body: string; tone: string; cachedAt: number }
const previewCache = new Map<string, CacheEntry>();
const PREVIEW_CACHE_TTL_MS = 5 * 60_000;

function getPreviewCacheKey(templateId: number, tone: string, updatedAt: Date): string {
  return `${templateId}:${tone}:${updatedAt.getTime()}`;
}
function pruneCache() {
  const now = Date.now();
  for (const [key, entry] of previewCache) {
    if (now - entry.cachedAt > PREVIEW_CACHE_TTL_MS) previewCache.delete(key);
  }
}

// ---------------------------------------------------------------------------
// Map AI lib errors to HTTP responses
// ---------------------------------------------------------------------------
function handleAiError(err: unknown, res: any): void {
  if (err instanceof AiConfigError) {
    res.status(503).json({ error: err.message, config: true });
    return;
  }
  if (err instanceof AiRateLimitError) {
    res.status(429).set("Retry-After", "10").json({ error: "AI is temporarily busy. Please wait a few seconds and try again." });
    return;
  }
  if (err instanceof AiQuotaError) {
    res.status(429).set("Retry-After", "3600").json({ error: "Daily AI quota reached. Please try again later.", quota: true });
    return;
  }
  const msg = err instanceof Error ? err.message : String(err);
  res.status(500).json({ error: `AI generation failed: ${msg}` });
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

router.post("/ai/generate-email", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const rateCheck = checkRateLimit(user.id, RATE_LIMIT_MAX_GENERATE);
  if (!rateCheck.allowed) {
    res.status(429).set("Retry-After", String(rateCheck.retryAfterSec)).json({
      error: "Too many requests. Please wait a moment before generating more emails.",
    });
    return;
  }
  if (inFlight.has(user.id)) {
    res.status(429).set("Retry-After", "5").json({ error: "A generation is already in progress." });
    return;
  }
  const parsed = GenerateEmailBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [lead] = await db.select().from(leadsTable)
    .where(and(eq(leadsTable.id, parsed.data.leadId), eq(leadsTable.userId, user.id)));
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }

  const [template] = await db.select().from(templatesTable)
    .where(and(eq(templatesTable.id, parsed.data.templateId), eq(templatesTable.userId, user.id)));
  if (!template) { res.status(404).json({ error: "Template not found" }); return; }

  inFlight.add(user.id);
  try {
    const result = await generatePersonalizedEmail({
      name: lead.name, email: lead.email, vehicle: lead.vehicle, route: lead.route,
      pickup: lead.pickup, delivery: lead.delivery, price: lead.price, notes: lead.notes,
      templateSubject: template.subject, templateBody: template.body,
      tone: parsed.data.tone ?? "professional",
      customPrompt: parsed.data.customPrompt,
    });
    res.json(result);
  } catch (err) {
    handleAiError(err, res);
  } finally {
    inFlight.delete(user.id);
  }
});

router.post("/ai/preview-email", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const rateCheck = checkRateLimit(user.id, RATE_LIMIT_MAX_PREVIEW);
  if (!rateCheck.allowed) {
    res.status(429).set("Retry-After", String(rateCheck.retryAfterSec)).json({
      error: "AI is temporarily busy. Please wait a few seconds and try again.",
    });
    return;
  }
  if (inFlight.has(user.id)) {
    res.status(429).set("Retry-After", "5").json({ error: "A generation is already in progress." });
    return;
  }
  const parsed = PreviewEmailBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [template] = await db.select().from(templatesTable)
    .where(and(eq(templatesTable.id, parsed.data.templateId), eq(templatesTable.userId, user.id)));
  if (!template) { res.status(404).json({ error: "Template not found" }); return; }

  const cacheKey = getPreviewCacheKey(template.id, parsed.data.tone ?? "professional", template.updatedAt);
  pruneCache();
  const cached = previewCache.get(cacheKey);
  if (cached) {
    res.set("X-Cache", "HIT").json({ subject: cached.subject, body: cached.body, tone: cached.tone });
    return;
  }

  inFlight.add(user.id);
  try {
    const leadData = parsed.data.leadData;
    const result = await generatePersonalizedEmail({
      name: leadData.name, email: leadData.email,
      vehicle: leadData.vehicle ?? null, route: leadData.route ?? null,
      pickup: leadData.pickup ?? null, delivery: leadData.delivery ?? null,
      price: leadData.price ?? null, notes: null,
      templateSubject: template.subject, templateBody: template.body,
      tone: parsed.data.tone ?? "professional",
    });
    previewCache.set(cacheKey, { ...result, cachedAt: Date.now() });
    res.set("X-Cache", "MISS").json(result);
  } catch (err) {
    handleAiError(err, res);
  } finally {
    inFlight.delete(user.id);
  }
});

/** Generate multiple follow-up email options for a user-provided scenario */
router.post("/ai/generate-followups", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const rateCheck = checkRateLimit(user.id, RATE_LIMIT_MAX_PREVIEW);
  if (!rateCheck.allowed) {
    res.status(429).set("Retry-After", String(rateCheck.retryAfterSec)).json({
      error: "Too many requests. Please wait a moment.",
    });
    return;
  }
  const { prompt, count = 3 } = req.body as { prompt?: string; count?: number };
  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    res.status(400).json({ error: "prompt is required" });
    return;
  }
  try {
    const options = await generateFollowupOptions(prompt.trim(), Math.min(count, 5));
    res.json({ options });
  } catch (err) {
    handleAiError(err, res);
  }
});

export default router;
