/**
 * unsubscribe.ts — Public CAN-SPAM unsubscribe endpoints.
 *
 * Routes (NO auth required — these are reached from email links):
 *   GET  /api/unsubscribe?token=...      — validate token + insert suppression
 *   POST /api/unsubscribe/reason         — update unsubscribe reason after page load
 */

import { Router, type IRouter } from "express";
import { db, suppressionListTable } from "@workspace/db";
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
    await db
      .insert(suppressionListTable)
      .values({
        userId:     payload.userId,
        email,
        reason:     "unsubscribe",
        source:     "unsubscribe_link",
        leadId:     payload.leadId   ?? null,
        campaignId: payload.campaignId ?? null,
      })
      .onConflictDoNothing();

    logger.info(
      { userId: payload.userId, email, leadId: payload.leadId, campaignId: payload.campaignId },
      "[UNSUBSCRIBE] Email unsubscribed via link",
    );

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
