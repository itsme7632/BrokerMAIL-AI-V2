import { Router, type IRouter } from "express";
import {
  db, draftsTable, usersTable, templatesTable, activityTable, emailTrackingEventsTable,
  campaignsTable, leadsTable, notificationsTable,
} from "@workspace/db";
import { eq, and, count, desc, inArray, sql, isNotNull } from "drizzle-orm";
import { getTrackingSettings } from "../lib/tracking-settings";
import { checkEmailLimit } from "../lib/plan-limits";
import { logger } from "../lib/logger";
import { requireAuth } from "../lib/auth";
import { GetDraftParams } from "@workspace/api-zod";
import { createGmailDraft } from "../lib/gmail";
import { syncSentDrafts } from "../lib/gmail-draft-sync";
import { isSuppressed, filterSuppressed } from "../lib/suppression";
import {
  formatPrice,
  replaceVarsText,
  buildHtmlEmail,
  extractLogoAttachment,
  type EmailStyle,
  type BrandingSettings,
} from "../lib/email-html";
import type { User } from "@workspace/db";
import { randomUUID } from "crypto";

const router: IRouter = Router();

function userBranding(user: User): BrandingSettings {
  return {
    companyName:    user.companyName    ?? null,
    companyTagline: user.companyTagline ?? null,
    companyPhone:   user.companyPhone   ?? null,
    companyWebsite: user.companyWebsite ?? null,
    usdot:          user.usdot          ?? null,
    mcNumber:       user.mcNumber       ?? null,
    accentColor:    user.accentColor    ?? null,
  };
}

function validStyle(s?: string): EmailStyle {
  const ALL_STYLES: EmailStyle[] = [
    "clean", "modern", "minimal", "luxury",
    "corporate", "urgent", "dispatch", "friendly", "mobile", "dark",
  ];
  return ALL_STYLES.includes(s as EmailStyle) ? (s as EmailStyle) : "clean";
}

function injectTracking(html: string, trackingId: string, baseUrl: string): string {
  const pixel = `<img src="${baseUrl}/api/track/open/${trackingId}" width="1" height="1" alt="" style="display:none!important;width:1px!important;height:1px!important;border:0;" />`;
  const tracked = html.replace(
    /(<a\s[^>]*href=["'])(https?:\/\/[^"']+)(["'])/gi,
    (_match, pre, url, post) => {
      const encoded = encodeURIComponent(url);
      return `${pre}${baseUrl}/api/track/click/${trackingId}?url=${encoded}${post}`;
    }
  );
  return tracked.replace(/<\/body>/i, `${pixel}</body>`);
}

async function getTrackingStats(
  draftIds: number[]
): Promise<Record<number, { opens: number; clicks: number }>> {
  if (draftIds.length === 0) return {};
  const events = await db
    .select({
      draftId: emailTrackingEventsTable.draftId,
      eventType: emailTrackingEventsTable.eventType,
      cnt: count(),
    })
    .from(emailTrackingEventsTable)
    .where(inArray(emailTrackingEventsTable.draftId, draftIds))
    .groupBy(emailTrackingEventsTable.draftId, emailTrackingEventsTable.eventType);

  const stats: Record<number, { opens: number; clicks: number }> = {};
  for (const e of events) {
    if (!e.draftId) continue;
    if (!stats[e.draftId]) stats[e.draftId] = { opens: 0, clicks: 0 };
    if (e.eventType === "open") stats[e.draftId].opens = e.cnt;
    if (e.eventType === "click") stats[e.draftId].clicks = e.cnt;
  }
  return stats;
}

// ─── List / get drafts ────────────────────────────────────────────────────────

router.get("/drafts", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const page       = parseInt(req.query.page as string, 10) || 1;
  const limit      = parseInt(req.query.limit as string, 10) || 20;
  const status     = req.query.status as string | undefined;
  const campaignId = req.query.campaignId ? parseInt(req.query.campaignId as string, 10) : undefined;

  const conditions: Parameters<typeof and>[0][] = [eq(draftsTable.userId, user.id)];
  if (status)     conditions.push(eq(draftsTable.status, status));
  if (campaignId) conditions.push(eq(draftsTable.campaignId, campaignId));
  // Exclude SMTP-sent records (gmailDraftId starts with 'smtp:') — those belong to Sent Emails, not Gmail Drafts
  conditions.push(sql`(${draftsTable.gmailDraftId} IS NULL OR ${draftsTable.gmailDraftId} NOT LIKE 'smtp:%')`);

  const [totalResult] = await db
    .select({ count: count() })
    .from(draftsTable)
    .where(and(...conditions));

  const drafts = await db
    .select()
    .from(draftsTable)
    .where(and(...conditions))
    .orderBy(desc(draftsTable.createdAt))
    .limit(limit)
    .offset((page - 1) * limit);

  const stats = await getTrackingStats(drafts.map(d => d.id));

  res.json({
    data: drafts.map(d => ({
      ...d,
      createdAt: d.createdAt.toISOString(),
      opens: stats[d.id]?.opens ?? 0,
      clicks: stats[d.id]?.clicks ?? 0,
    })),
    total: totalResult.count,
    page,
    limit,
  });
});

router.get("/drafts/:id", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const params = GetDraftParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [draft] = await db
    .select()
    .from(draftsTable)
    .where(and(eq(draftsTable.id, params.data.id), eq(draftsTable.userId, user.id)));

  if (!draft) { res.status(404).json({ error: "Draft not found" }); return; }
  res.json({ ...draft, createdAt: draft.createdAt.toISOString() });
});

// ─── Auto-sync: detect which drafts were already sent from Gmail ──────────────
/**
 * POST /api/drafts/sync-sent
 *
 * Checks every unsent Gmail draft for the authenticated user by calling
 * gmail.users.drafts.get(). If Gmail returns 404 the draft no longer exists
 * in the Drafts folder — the user sent it from Gmail — so we auto-set sentAt.
 *
 * Safe to call repeatedly; idempotent (already-marked drafts are skipped via
 * the WHERE sentAt IS NULL filter).
 */
router.post("/drafts/sync-sent", requireAuth, async (req, res): Promise<void> => {
  const result = await syncSentDrafts(req.user!.id);
  res.json(result);
});

// ─── Mark as sent (activates open tracking) ───────────────────────────────────
/**
 * PATCH /api/drafts/:id/mark-sent  — REST form
 * POST  /api/drafts/mark-sent      — proxy-safe form (id in body)
 */
router.post("/drafts/mark-sent", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const id   = parseInt(req.body.id, 10);
  if (!id) { res.status(400).json({ error: "id is required" }); return; }

  const [draft] = await db.update(draftsTable)
    .set({ sentAt: new Date() })
    .where(and(eq(draftsTable.id, id), eq(draftsTable.userId, user.id)))
    .returning();

  if (!draft) { res.status(404).json({ error: "Draft not found" }); return; }
  res.json({ ok: true, draftId: id, sentAt: draft.sentAt?.toISOString() });
});

router.patch("/drafts/:id/mark-sent", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const id   = parseInt(req.params.id as string, 10);
  if (!id) { res.status(400).json({ error: "Invalid draft id" }); return; }

  const [draft] = await db.update(draftsTable)
    .set({ sentAt: new Date() })
    .where(and(eq(draftsTable.id, id), eq(draftsTable.userId, user.id)))
    .returning();

  if (!draft) { res.status(404).json({ error: "Draft not found" }); return; }
  res.json({ ok: true, draftId: id, sentAt: draft.sentAt?.toISOString() });
});

// ─── Direct draft creation ────────────────────────────────────────────────────

router.post("/drafts/create-direct", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const { to, subject, body } = req.body as { to?: string; subject?: string; body?: string };

  if (!to || !subject || !body) {
    res.status(400).json({ error: "to, subject, and body are required" });
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    res.status(400).json({ error: "Invalid email address" });
    return;
  }

  const [freshUser] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
  if (!freshUser) { res.status(404).json({ error: "User not found" }); return; }

  if (!freshUser.gmailConnected || !freshUser.gmailAccessToken) {
    res.status(400).json({
      error: "Gmail not connected. Please connect Gmail in Settings before creating drafts.",
    });
    return;
  }

  if (await isSuppressed(user.id, to)) {
    res.status(409).json({
      error: `${to} is on your suppression list (previously bounced or unsubscribed) and cannot be emailed. Remove it from Suppressions first if this was a mistake.`,
    });
    return;
  }

  try {
    const gmailDraftId = await createGmailDraft(freshUser, to, subject, body);
    res.status(201).json({ gmailDraftId, to, subject });
  } catch (err: any) {
    req.log.warn({ err: err.message, to }, "Direct draft creation failed");
    res.status(502).json({ error: err.message ?? "Failed to create Gmail draft" });
  }
});

// ─── Preview ─────────────────────────────────────────────────────────────────
/**
 * POST /api/drafts/preview
 *
 * Accepts EITHER:
 *   { templateId, row, style, useSignatureBuilder }  — loads template from DB
 *   { body, subject, row, style, useSignatureBuilder } — uses raw body/subject directly
 *
 * Always applies the authenticated user's saved branding settings.
 * This is the single source of truth for how a rendered email looks.
 */
router.post("/drafts/preview", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const {
    templateId,
    body: rawBody,
    subject: rawSubject,
    row,
    style,
    useSignatureBuilder,
    ctaButtons,
  } = req.body as {
    templateId?:          number;
    body?:                string;
    subject?:             string;
    row?:                 Record<string, string>;
    style?:               string;
    useSignatureBuilder?: boolean;
    ctaButtons?:          any[];
  };

  if (!row || typeof row !== "object") {
    res.status(400).json({ error: "row is required" });
    return;
  }

  let templateBody: string;
  let templateSubject: string;
  let templateCtaButtons: any[] = [];

  if (rawBody !== undefined && rawSubject !== undefined) {
    templateBody    = rawBody;
    templateSubject = rawSubject;
  } else if (templateId) {
    const [template] = await db
      .select()
      .from(templatesTable)
      .where(and(eq(templatesTable.id, templateId), eq(templatesTable.userId, user.id)));
    if (!template) { res.status(404).json({ error: "Template not found" }); return; }
    templateBody    = template.body;
    templateSubject = template.subject;
    // Load CTA buttons from the template — callers that don't send ctaButtons will get them automatically
    try {
      templateCtaButtons = template.ctaButtonsJson ? JSON.parse(template.ctaButtonsJson) : [];
    } catch {
      templateCtaButtons = [];
    }
    req.log?.info({ templateId, ctaCount: templateCtaButtons.length }, "[TEMPLATE] Loaded ctaButtonsJson from DB");
  } else {
    res.status(400).json({ error: "Provide either templateId or body+subject" });
    return;
  }

  const [freshUser] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
  if (!freshUser) { res.status(404).json({ error: "User not found" }); return; }

  const branding   = userBranding(freshUser);
  const emailStyle = validStyle(style);

  // useSignatureBuilder: explicit request value → user's saved default
  const useSig = useSignatureBuilder !== undefined
    ? useSignatureBuilder
    : (freshUser.useSignature ?? false);

  // CTA priority: explicit ctaButtons in request body → template's stored ctaButtonsJson
  const resolvedCtaButtons = Array.isArray(ctaButtons) ? ctaButtons : templateCtaButtons;

  req.log?.info({ templateId, ctaCount: resolvedCtaButtons.length }, "[CAMPAIGN PREVIEW] Rendering preview with CTA buttons");

  const subject = replaceVarsText(templateSubject, row);
  const html    = buildHtmlEmail(templateBody, row, branding, {
    style:               emailStyle,
    useSignatureBuilder: useSig,
    ctaButtons:          resolvedCtaButtons,
  });

  res.json({ html, subject });
});

// ─── Batch from template ─────────────────────────────────────────────────────

router.post("/drafts/from-template", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const { templateId, rows, style, useSignatureBuilder } = req.body as {
    templateId?:          number;
    rows?:                Record<string, string>[];
    style?:               string;
    useSignatureBuilder?: boolean;
  };

  if (!templateId || !Array.isArray(rows) || rows.length === 0) {
    res.status(400).json({ error: "templateId and a non-empty rows[] are required" });
    return;
  }

  const emailStyle = validStyle(style);

  const [template] = await db
    .select()
    .from(templatesTable)
    .where(and(eq(templatesTable.id, templateId), eq(templatesTable.userId, user.id)));
  if (!template) { res.status(404).json({ error: "Template not found" }); return; }

  const [freshUser] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
  if (!freshUser?.gmailConnected || !freshUser.gmailAccessToken) {
    res.status(400).json({
      error: "Gmail not connected. Connect Gmail in Settings before creating drafts.",
    });
    return;
  }

  // Fix 2: Enforce monthly email limit before creating drafts
  const emailLimitErr = await checkEmailLimit(user.id);
  if (emailLimitErr) { res.status(429).json(emailLimitErr); return; }

  const branding  = userBranding(freshUser);
  // useSignatureBuilder: explicit request value → user's saved default
  const useSig    = useSignatureBuilder !== undefined
    ? useSignatureBuilder
    : (freshUser.useSignature ?? false);
  const ctaButtonsFromTemplate = (() => {
    try { return template.ctaButtonsJson ? JSON.parse(template.ctaButtonsJson) : []; }
    catch { return []; }
  })();
  logger.info({ templateId, ctaCount: ctaButtonsFromTemplate.length }, "[CTA LOAD] Gmail drafts from-template — loading CTA buttons");

  // Load admin tracking settings so pixel/click URLs use the configured domain
  const trackingSettings = await getTrackingSettings();
  const publicBase = trackingSettings.trackingUrl;

  const results: {
    email: string; subject: string; status: string; gmailDraftId?: string; error?: string;
  }[] = [];
  let succeeded = 0;
  let failed    = 0;

  const suppressedEmails = await filterSuppressed(user.id, rows.map(r => r.email ?? ""));

  for (const rawRow of rows) {
    const email = rawRow.email ?? "";
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      results.push({ email, subject: "", status: "failed", error: "Missing or invalid email" });
      failed++;
      continue;
    }

    if (suppressedEmails.has(email.trim().toLowerCase())) {
      results.push({ email, subject: "", status: "failed", error: "Recipient is on the suppression list" });
      failed++;
      continue;
    }

    const row: Record<string, string> = { ...rawRow };
    if (row.price) row.price = formatPrice(row.price);

    const subject  = replaceVarsText(template.subject, row);
    const bodyText = replaceVarsText(template.body, row);

    const trackingId = randomUUID();
    const draftLogoAttachment = extractLogoAttachment(branding.logoUrl);
    const draftBranding = draftLogoAttachment ? { ...branding, logoUrl: `cid:${draftLogoAttachment.cid}` } : branding;
    const bodyHtml = buildHtmlEmail(template.body, row, draftBranding, {
      style: emailStyle,
      useSignatureBuilder: useSig,
      ctaButtons: ctaButtonsFromTemplate,
      trackingId: trackingSettings.clickTrackingEnabled ? trackingId : undefined,
      publicBase: trackingSettings.clickTrackingEnabled ? publicBase : undefined,
    });
    const pixelTag = trackingSettings.openTrackingEnabled
      ? `<img src="${publicBase}/api/track/open/${trackingId}" width="1" height="1" alt="" style="display:none!important;width:1px!important;height:1px!important;border:0;" />`
      : "";
    const trackedHtml = pixelTag
      ? (bodyHtml.includes("</body>") ? bodyHtml.replace(/<\/body>/i, `${pixelTag}</body>`) : bodyHtml + pixelTag)
      : bodyHtml;

    // Phase 1: create the draft in Gmail
    let gmailDraftId: string | null = null;
    let phase1Err: string | null = null;
    try {
      gmailDraftId = await createGmailDraft(freshUser, email, subject, bodyText, trackedHtml, draftLogoAttachment);
    } catch (err: any) {
      phase1Err = String(err?.message ?? "Unknown error");
    }

    // Phase 2: record outcome — DB failures here must never flip a created draft to "failed"
    if (phase1Err !== null || gmailDraftId === null) {
      try {
        await db.insert(draftsTable).values({
          userId: user.id, subject, body: bodyText, status: "failed",
          errorMessage: phase1Err ?? "Unknown error", trackingId,
        });
      } catch { /* non-fatal */ }
      results.push({ email, subject, status: "failed", error: phase1Err ?? "Unknown error" });
      failed++;
    } else {
      // sentAt left null intentionally — broker must click "Mark Sent" in BrokerMAIL after
      // sending the draft from Gmail. This prevents the broker's own preview from firing
      // a false "opened" event on the tracking pixel.
      try {
        await db.insert(draftsTable).values({
          userId: user.id, gmailDraftId, email, subject, body: bodyText, status: "success", trackingId,
        });
      } catch (draftErr: any) {
        logger.warn({ draftErr, email }, "[DRAFTS] Non-fatal: drafts table insert failed — draft WAS created in Gmail");
      }
      results.push({ email, subject, status: "success", gmailDraftId });
      succeeded++;
    }
  }

  try {
    await db.insert(activityTable).values({
      userId: user.id,
      type:   "drafts_generated",
      description: `Created ${succeeded} Gmail draft${succeeded !== 1 ? "s" : ""} from template "${template.name}"${
        failed > 0 ? ` (${failed} failed)` : ""
      }`,
      metadata: { templateId, total: rows.length, succeeded, failed, style: emailStyle },
    });
  } catch { }

  res.json({ total: rows.length, succeeded, failed, results });
});

// ─── Retry a single failed draft ─────────────────────────────────────────────
/**
 * POST /api/drafts/:id/retry
 *
 * Retries a failed Gmail draft.
 * - Standalone drafts: re-creates using stored subject + body.
 * - Campaign-linked drafts: re-creates using stored subject + body and updates
 *   lead/campaign counters. If stored body is empty (failed before render),
 *   returns { requiresCampaignRetry: true, campaignId, leadId } so the caller
 *   can fall back to the richer /api/campaigns/:id/leads/:leadId/retry endpoint.
 */
router.post("/drafts/:id/retry", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const id   = parseInt(req.params.id as string, 10);
  if (!id) { res.status(400).json({ error: "Invalid draft id" }); return; }

  const [draft] = await db.select().from(draftsTable)
    .where(and(eq(draftsTable.id, id), eq(draftsTable.userId, user.id)));
  if (!draft)                       { res.status(404).json({ error: "Draft not found" }); return; }
  if (draft.status !== "failed")    { res.status(400).json({ error: "Only failed drafts can be retried" }); return; }
  if (!draft.email)                 { res.status(400).json({ error: "Draft has no recipient email" }); return; }

  // If stored body is empty (AI generation failed before render) and this is
  // campaign-linked, the caller should use the richer campaign retry endpoint
  // which re-runs AI personalization and email rendering.
  if ((!draft.subject || !draft.body) && draft.campaignId && draft.leadId) {
    res.json({
      requiresCampaignRetry: true,
      campaignId: draft.campaignId,
      leadId:     draft.leadId,
    });
    return;
  }

  if (!draft.subject) { res.status(400).json({ error: "Draft has no subject stored" }); return; }

  const [freshUser] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
  if (!freshUser?.gmailConnected || !freshUser.gmailAccessToken) {
    res.status(401).json({
      error:         "Gmail not connected. Please reconnect your Gmail account from Settings → Brand Settings.",
      errorCategory: "auth_gmail",
    });
    return;
  }

  if (await isSuppressed(user.id, draft.email)) {
    res.status(409).json({ error: "Recipient is on your suppression list and cannot be retried" });
    return;
  }

  const trackingId = draft.trackingId ?? randomUUID();

  try {
    const gmailDraftId = await createGmailDraft(
      freshUser, draft.email, draft.subject, draft.body ?? "",
    );

    await db.update(draftsTable)
      .set({ status: "success", gmailDraftId, errorMessage: null, trackingId })
      .where(eq(draftsTable.id, id));

    // Update campaign/lead counters if campaign-linked
    if (draft.campaignId && draft.leadId) {
      await db.update(leadsTable)
        .set({ status: "drafted", gmailDraftId, errorMessage: null, updatedAt: new Date() })
        .where(eq(leadsTable.id, draft.leadId));
      await db.update(campaignsTable).set({
        draftedCount: sql`${campaignsTable.draftedCount} + 1`,
        failedCount:  sql`GREATEST(${campaignsTable.failedCount} - 1, 0)`,
        updatedAt: new Date(),
      }).where(eq(campaignsTable.id, draft.campaignId));
    }

    logger.info({ draftId: id, gmailDraftId }, "[DRAFT-RETRY] Draft retried successfully");
    res.json({ ok: true, gmailDraftId, trackingId });
  } catch (err: any) {
    const errMsg = String(err?.message ?? "Draft creation failed");
    await db.update(draftsTable).set({ errorMessage: errMsg }).where(eq(draftsTable.id, id));
    logger.error({ draftId: id, errMsg }, "[DRAFT-RETRY] Draft retry failed");

    // Detect Gmail auth errors so the frontend can show the reconnect prompt
    const isGmailAuth = errMsg.includes("invalid_grant") || errMsg.includes("Invalid Credentials") || errMsg.includes("Token has been expired");
    res.status(500).json({
      error:         isGmailAuth
        ? "Gmail authorization has expired. Please reconnect your Gmail account from Settings → Brand Settings."
        : errMsg,
      errorCategory: isGmailAuth ? "auth_gmail" : "unknown",
    });
  }
});

// ─── Retry selected failed drafts ─────────────────────────────────────────────
/**
 * POST /api/drafts/retry-selected
 * Body: { ids: number[] }
 */
router.post("/drafts/retry-selected", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const ids: number[] = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
  if (ids.length === 0) { res.status(400).json({ error: "ids[] is required" }); return; }

  const [freshUser] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
  if (!freshUser?.gmailConnected || !freshUser.gmailAccessToken) {
    res.status(401).json({
      error:         "Gmail not connected. Please reconnect your Gmail account from Settings → Brand Settings.",
      errorCategory: "auth_gmail",
    });
    return;
  }

  const failedDrafts = await db.select().from(draftsTable)
    .where(and(
      eq(draftsTable.userId, user.id),
      eq(draftsTable.status, "failed"),
      inArray(draftsTable.id, ids),
    ));

  let succeeded = 0, failed = 0;
  const errors: string[] = [];

  for (const draft of failedDrafts) {
    if (!draft.email || !draft.subject) {
      // Campaign draft with no stored content — skip; user must retry from campaign page
      failed++;
      continue;
    }

    // Idempotency guard: if the lead already succeeded via a prior retry, skip.
    if (draft.campaignId && draft.leadId) {
      const [currentLead] = await db.select({ status: leadsTable.status })
        .from(leadsTable)
        .where(eq(leadsTable.id, draft.leadId))
        .limit(1);
      if (currentLead?.status === "drafted" || currentLead?.status === "sent") {
        await db.update(draftsTable)
          .set({ status: "success", errorMessage: null })
          .where(eq(draftsTable.id, draft.id))
          .catch(() => {});
        failed++;
        continue;
      }
    }

    if (await isSuppressed(user.id, draft.email)) { failed++; continue; }

    try {
      const trackingId   = draft.trackingId ?? randomUUID();
      const gmailDraftId = await createGmailDraft(freshUser, draft.email, draft.subject, draft.body ?? "");

      await db.update(draftsTable)
        .set({ status: "success", gmailDraftId, errorMessage: null, trackingId })
        .where(eq(draftsTable.id, draft.id));

      if (draft.campaignId && draft.leadId) {
        await db.update(leadsTable)
          .set({ status: "drafted", gmailDraftId, errorMessage: null, updatedAt: new Date() })
          .where(eq(leadsTable.id, draft.leadId));
        await db.update(campaignsTable).set({
          draftedCount: sql`${campaignsTable.draftedCount} + 1`,
          failedCount:  sql`GREATEST(${campaignsTable.failedCount} - 1, 0)`,
          updatedAt: new Date(),
        }).where(eq(campaignsTable.id, draft.campaignId));
      }
      succeeded++;
    } catch (err: any) {
      errors.push(String(err?.message ?? "retry failed"));
      failed++;
    }
  }

  res.json({ total: failedDrafts.length, succeeded, failed, errors });
});

// ─── Retry ALL failed drafts ──────────────────────────────────────────────────
/**
 * POST /api/drafts/retry-all-failed
 *
 * Retries all failed Gmail drafts for the authenticated user.
 * Drafts with no stored content (campaign drafts that failed before rendering)
 * are skipped with a count returned in the response.
 */
router.post("/drafts/retry-all-failed", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;

  const [freshUser] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
  if (!freshUser?.gmailConnected || !freshUser.gmailAccessToken) {
    res.status(401).json({
      error:         "Gmail not connected. Please reconnect your Gmail account from Settings → Brand Settings.",
      errorCategory: "auth_gmail",
    });
    return;
  }

  const failedDrafts = await db.select().from(draftsTable)
    .where(and(
      eq(draftsTable.userId, user.id),
      eq(draftsTable.status, "failed"),
      // Exclude SMTP records (they belong to Sent Emails retry flow)
      sql`(${draftsTable.gmailDraftId} IS NULL OR ${draftsTable.gmailDraftId} NOT LIKE 'smtp:%')`,
      isNotNull(draftsTable.email),
    ))
    .orderBy(desc(draftsTable.id)); // most recent first for dedup

  // Deduplicate by (campaignId, leadId): keep only the most recent failed draft
  // per lead. The campaign processor inserts a fresh failed row on every internal
  // retry attempt, so a single lead can accumulate multiple failed rows. Iterating
  // all of them would call createGmailDraft once per row — creating duplicate drafts.
  const seenLeadKeys = new Set<string>();
  const dedupedDrafts = failedDrafts.filter(d => {
    if (d.campaignId && d.leadId) {
      const key = `${d.campaignId}:${d.leadId}`;
      if (seenLeadKeys.has(key)) return false;
      seenLeadKeys.add(key);
    }
    return true;
  });

  let succeeded = 0, failed = 0, skipped = 0;
  const errors: string[] = [];

  for (const draft of dedupedDrafts) {
    if (!draft.email) { skipped++; continue; }
    if (!draft.subject) {
      // Campaign draft with no stored content — user must retry from campaign page
      skipped++;
      continue;
    }

    // Idempotency guard: if the lead already succeeded (via a prior retry from the
    // campaign page), skip creating another draft and clean up the stale failed row.
    if (draft.campaignId && draft.leadId) {
      const [currentLead] = await db.select({ status: leadsTable.status })
        .from(leadsTable)
        .where(eq(leadsTable.id, draft.leadId))
        .limit(1);
      if (currentLead?.status === "drafted" || currentLead?.status === "sent") {
        await db.update(draftsTable)
          .set({ status: "success", errorMessage: null })
          .where(eq(draftsTable.id, draft.id))
          .catch(() => {});
        skipped++;
        continue;
      }
    }

    if (await isSuppressed(user.id, draft.email)) { failed++; continue; }

    try {
      const trackingId   = draft.trackingId ?? randomUUID();
      const gmailDraftId = await createGmailDraft(freshUser, draft.email, draft.subject, draft.body ?? "");

      await db.update(draftsTable)
        .set({ status: "success", gmailDraftId, errorMessage: null, trackingId })
        .where(eq(draftsTable.id, draft.id));

      if (draft.campaignId && draft.leadId) {
        await db.update(leadsTable)
          .set({ status: "drafted", gmailDraftId, errorMessage: null, updatedAt: new Date() })
          .where(eq(leadsTable.id, draft.leadId));
        await db.update(campaignsTable).set({
          draftedCount: sql`${campaignsTable.draftedCount} + 1`,
          failedCount:  sql`GREATEST(${campaignsTable.failedCount} - 1, 0)`,
          updatedAt: new Date(),
        }).where(eq(campaignsTable.id, draft.campaignId));
      }
      succeeded++;
    } catch (err: any) {
      const errMsg = String(err?.message ?? "retry failed");
      errors.push(errMsg);
      failed++;
      // Stop retrying if auth expired — all subsequent attempts will fail too
      const isGmailAuth = errMsg.includes("invalid_grant") || errMsg.includes("Invalid Credentials") || errMsg.includes("Token has been expired");
      if (isGmailAuth) break;
    }
  }

  logger.info({ userId: user.id, total: failedDrafts.length, succeeded, failed, skipped }, "[DRAFT-RETRY-ALL] Bulk retry completed");
  res.json({ total: failedDrafts.length, succeeded, failed, skipped, errors });
});

export default router;
