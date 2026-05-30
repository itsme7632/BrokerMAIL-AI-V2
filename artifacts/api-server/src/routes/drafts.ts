import { Router, type IRouter } from "express";
import { db, draftsTable, usersTable, templatesTable, activityTable, emailTrackingEventsTable } from "@workspace/db";
import { eq, and, count, desc, inArray } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { GetDraftParams } from "@workspace/api-zod";
import { createGmailDraft } from "../lib/gmail";
import {
  formatPrice,
  replaceVarsText,
  buildHtmlEmail,
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

  const subject = replaceVarsText(templateSubject, row);
  const html    = buildHtmlEmail(templateBody, row, branding, {
    style:               emailStyle,
    useSignatureBuilder: useSig,
    ctaButtons:          Array.isArray(ctaButtons) ? ctaButtons : [],
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

  const branding  = userBranding(freshUser);
  // useSignatureBuilder: explicit request value → user's saved default
  const useSig    = useSignatureBuilder !== undefined
    ? useSignatureBuilder
    : (freshUser.useSignature ?? false);
  const buildOpts = { style: emailStyle, useSignatureBuilder: useSig };
  const baseUrl   = `${req.protocol}://${req.get("host")}`;

  const results: {
    email: string; subject: string; status: string; gmailDraftId?: string; error?: string;
  }[] = [];
  let succeeded = 0;
  let failed    = 0;

  for (const rawRow of rows) {
    const email = rawRow.email ?? "";
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      results.push({ email, subject: "", status: "failed", error: "Missing or invalid email" });
      failed++;
      continue;
    }

    const row: Record<string, string> = { ...rawRow };
    if (row.price) row.price = formatPrice(row.price);

    const subject  = replaceVarsText(template.subject, row);
    const bodyText = replaceVarsText(template.body, row);
    const bodyHtml = buildHtmlEmail(template.body, row, branding, buildOpts);

    const trackingId  = randomUUID();
    const trackedHtml = injectTracking(bodyHtml, trackingId, baseUrl);

    try {
      const gmailDraftId = await createGmailDraft(freshUser, email, subject, bodyText, trackedHtml);
      await db.insert(draftsTable).values({
        userId: user.id, gmailDraftId, email, subject, body: bodyText, status: "success", trackingId,
      });
      results.push({ email, subject, status: "success", gmailDraftId });
      succeeded++;
    } catch (err: any) {
      const errMsg = String(err?.message ?? "Unknown error");
      await db.insert(draftsTable).values({
        userId: user.id, subject, body: bodyText, status: "failed", errorMessage: errMsg, trackingId,
      });
      results.push({ email, subject, status: "failed", error: errMsg });
      failed++;
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

export default router;
