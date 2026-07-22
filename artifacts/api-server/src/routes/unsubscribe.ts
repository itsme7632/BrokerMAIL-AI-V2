/**
 * unsubscribe.ts — Public CAN-SPAM unsubscribe endpoints.
 *
 * Routes (NO auth required — these are reached from email links):
 *   GET  /api/unsubscribe?token=...      — validate token + insert suppression
 *   POST /api/unsubscribe/reason         — update unsubscribe reason after page load
 */

import { Router, type IRouter } from "express";
import {
  db,
  suppressionListTable,
  notificationsTable,
  campaignsTable,
  templatesTable,
  leadsTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { verifyUnsubscribeToken } from "../lib/unsubscribe-token";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const VALID_REASONS = new Set([
  "unsubscribe",
  "already_shipped",
  "not_interested",
  "too_many_emails",
  "spam",
  "other",
]);

// ─── Notification helper ──────────────────────────────────────────────────────

interface UnsubscribeNotificationParams {
  suppressionId: number;
  userId:        number;
  email:         string;
  campaignId:    number | null;
  leadId:        number | null;
  source:        string;
  reason:        string;
}

/**
 * Creates an "unsubscribe" notification for the account owner.
 * Non-fatal — a failure here must never surface to the unsubscribing recipient.
 */
async function createUnsubscribeNotification(params: UnsubscribeNotificationParams): Promise<void> {
  try {
    const { suppressionId, userId, email, campaignId, leadId, source, reason } = params;

    // Look up campaign + template name (best-effort; scoped to the owning user)
    let campaignName: string | null = null;
    let templateId:   number | null = null;
    let templateName: string | null = null;

    if (campaignId) {
      const [campaign] = await db
        .select({ name: campaignsTable.name, templateId: campaignsTable.templateId })
        .from(campaignsTable)
        .where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.userId, userId)));
      if (campaign) {
        campaignName = campaign.name;
        templateId   = campaign.templateId ?? null;
      }
      if (templateId) {
        const [tmpl] = await db
          .select({ name: templatesTable.name })
          .from(templatesTable)
          .where(and(eq(templatesTable.id, templateId), eq(templatesTable.userId, userId)));
        if (tmpl) templateName = tmpl.name;
      }
    }

    // Look up lead name (best-effort)
    let recipientName: string | null = null;
    if (leadId) {
      const [lead] = await db
        .select({ name: leadsTable.name })
        .from(leadsTable)
        .where(eq(leadsTable.id, leadId));
      if (lead?.name?.trim()) recipientName = lead.name.trim();
    }

    const displayName = recipientName ?? email;
    const title   = "Customer Unsubscribed";
    const message = `${displayName} (${email}) unsubscribed from your emails.`;
    const link    = `/suppression-list?highlight=${encodeURIComponent(email)}`;

    const metadata: Record<string, unknown> = {
      suppressionId,
      recipientEmail:    email,
      recipientName:     recipientName ?? null,
      campaignId:        campaignId    ?? null,
      campaignName:      campaignName  ?? null,
      templateId:        templateId    ?? null,
      templateName:      templateName  ?? null,
      unsubscribeReason: reason,
      source,
      timestamp: new Date().toISOString(),
    };

    await db.insert(notificationsTable).values({
      userId,
      type:    "unsubscribe",
      title,
      message,
      link,
      refId:   suppressionId,
      refType: "suppression",
      metadata,
    });

    logger.info({ userId, email, suppressionId }, "[UNSUBSCRIBE] Notification created");
  } catch (err) {
    // Non-fatal — the unsubscribe already succeeded; don't surface this error
    logger.warn({ err }, "[UNSUBSCRIBE] Failed to create unsubscribe notification");
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /api/unsubscribe?token=...
// Validates the token, inserts into suppression_list, returns JSON.
// The frontend /unsubscribe page calls this on load.
router.get("/unsubscribe", async (req, res): Promise<void> => {
  const token = typeof req.query.token === "string" ? req.query.token.trim() : "";
  if (!token) {
    res.status(400).json({ error: "Missing token" });
    return;
  }

  const payload = verifyUnsubscribeToken(token);
  if (!payload) {
    res.status(400).json({ error: "Invalid or expired unsubscribe token" });
    return;
  }

  const email = payload.email.trim().toLowerCase();
  if (!email) {
    res.status(400).json({ error: "Invalid token payload" });
    return;
  }

  try {
    // Use .returning() to detect whether this is a new suppression or a duplicate.
    // onConflictDoNothing() returns an empty array on conflict — no row inserted.
    const inserted = await db
      .insert(suppressionListTable)
      .values({
        userId:     payload.userId,
        email,
        reason:     "unsubscribe",
        source:     "unsubscribe_link",
        leadId:     payload.leadId    ?? null,
        campaignId: payload.campaignId ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: suppressionListTable.id });

    logger.info(
      { userId: payload.userId, email, leadId: payload.leadId, campaignId: payload.campaignId },
      "[UNSUBSCRIBE] Email unsubscribed via link",
    );

    // Only notify on a genuinely new suppression — never on a duplicate request
    if (inserted.length > 0) {
      void createUnsubscribeNotification({
        suppressionId: inserted[0].id,
        userId:        payload.userId,
        email,
        campaignId:    payload.campaignId ?? null,
        leadId:        payload.leadId     ?? null,
        source:        "unsubscribe_link",
        reason:        "unsubscribe",
      });
    }

    res.json({ success: true, email });
  } catch (err) {
    logger.error({ err, email }, "[UNSUBSCRIBE] Failed to insert suppression");
    res.status(500).json({ error: "Failed to process unsubscribe" });
  }
});

// POST /api/unsubscribe/reason
// After the unsubscribe page loads it may POST the user's selected reason.
// body: { token: string; reason: string }
router.post("/unsubscribe/reason", async (req, res): Promise<void> => {
  const token  = typeof req.body.token  === "string" ? req.body.token.trim()  : "";
  const reason = typeof req.body.reason === "string" ? req.body.reason.trim() : "";

  if (!token) { res.status(400).json({ error: "Missing token" }); return; }
  if (!VALID_REASONS.has(reason)) { res.status(400).json({ error: "Invalid reason" }); return; }

  const payload = verifyUnsubscribeToken(token);
  if (!payload) { res.status(400).json({ error: "Invalid or expired token" }); return; }

  const email = payload.email.trim().toLowerCase();

  try {
    await db
      .update(suppressionListTable)
      .set({ reason })
      .where(
        and(
          eq(suppressionListTable.userId, payload.userId),
          eq(suppressionListTable.email, email),
        ),
      );

    logger.info({ userId: payload.userId, email, reason }, "[UNSUBSCRIBE] Reason updated");
    res.json({ success: true });
  } catch (err) {
    logger.error({ err, email }, "[UNSUBSCRIBE] Failed to update reason");
    res.status(500).json({ error: "Failed to update reason" });
  }
});

export default router;
