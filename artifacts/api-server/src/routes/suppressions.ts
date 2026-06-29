/**
 * suppressions.ts — REST routes for managing the per-user suppression list.
 *
 * Approved scope: "Suppression list functionality"
 *
 * Routes:
 *   GET  /api/suppressions        — paginated list
 *   GET  /api/suppressions/stats  — dashboard summary counts
 *   POST /api/suppressions/remove — delete one entry (proxy-safe alias for DELETE)
 */

import { Router, type IRouter } from "express";
import { db, suppressionListTable } from "@workspace/db";
import { eq, desc, count, sql, and, ilike } from "drizzle-orm";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

// GET /api/suppressions
router.get("/suppressions", requireAuth, async (req, res): Promise<void> => {
  const user   = req.user!;
  const page   = Math.max(1, parseInt(req.query.page  as string, 10) || 1);
  const limit  = Math.min(200, parseInt(req.query.limit as string, 10) || 50);
  const q      = typeof req.query.q === "string" ? req.query.q.trim() : "";

  const baseWhere = q
    ? and(eq(suppressionListTable.userId, user.id), ilike(suppressionListTable.email, `%${q}%`))
    : eq(suppressionListTable.userId, user.id);

  const [totalRow] = await db
    .select({ count: count() })
    .from(suppressionListTable)
    .where(baseWhere);

  const rows = await db
    .select()
    .from(suppressionListTable)
    .where(baseWhere)
    .orderBy(desc(suppressionListTable.createdAt))
    .limit(limit)
    .offset((page - 1) * limit);

  res.json({
    data:  rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })),
    total: totalRow.count,
    page,
    limit,
  });
});

// GET /api/suppressions/stats  — lightweight summary for the dashboard widget
router.get("/suppressions/stats", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;

  const [totalRow] = await db
    .select({ count: count() })
    .from(suppressionListTable)
    .where(eq(suppressionListTable.userId, user.id));

  const [lastRow] = await db
    .select({ createdAt: suppressionListTable.createdAt })
    .from(suppressionListTable)
    .where(eq(suppressionListTable.userId, user.id))
    .orderBy(desc(suppressionListTable.createdAt))
    .limit(1);

  const reasons = await db
    .select({
      reason: suppressionListTable.reason,
      cnt:    sql<number>`count(*)::int`,
    })
    .from(suppressionListTable)
    .where(eq(suppressionListTable.userId, user.id))
    .groupBy(suppressionListTable.reason)
    .orderBy(desc(sql<number>`count(*)`))
    .limit(5);

  res.json({
    totalSuppressed:   totalRow.count,
    lastSuppressionAt: lastRow?.createdAt.toISOString() ?? null,
    topReasons:        reasons.map(r => ({ reason: r.reason, count: r.cnt })),
  });
});

// POST /api/suppressions/add — manually add an email to the suppression list
router.post("/suppressions/add", requireAuth, async (req, res): Promise<void> => {
  const user   = req.user!;
  const email  = typeof req.body.email  === "string" ? req.body.email.trim().toLowerCase()  : "";
  const reason = typeof req.body.reason === "string" ? req.body.reason.trim() : "manual";

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: "Valid email address is required" });
    return;
  }

  try {
    await db.insert(suppressionListTable).values({ userId: user.id, email, reason }).onConflictDoNothing();
    res.status(201).json({ message: "Added to suppression list", email, reason });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to add email to suppression list" });
  }
});

// POST /api/suppressions/remove — proxy-safe alias; removes one email
router.post("/suppressions/remove", requireAuth, async (req, res): Promise<void> => {
  const user  = req.user!;
  const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (!email) { res.status(400).json({ error: "email is required" }); return; }

  const [deleted] = await db
    .delete(suppressionListTable)
    .where(and(eq(suppressionListTable.userId, user.id), eq(suppressionListTable.email, email)))
    .returning();

  if (!deleted) { res.status(404).json({ error: "Email not in suppression list" }); return; }
  res.json({ message: "Removed from suppression list", email });
});

export default router;
