/**
 * product-hub.ts — Product Hub API
 *
 * User routes:   /api/product-hub/*    (requireAuth)
 * Admin routes:  /api/product-hub/admin/* (requireAuth + admin role)
 * Public routes: /api/product-hub/announcements/active (no auth — shown in-app)
 */

import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { db } from "@workspace/db";
import {
  productReleasesTable, roadmapItemsTable, featureVotesTable,
  feedbackTable, featureRequestsTable, bugReportsTable,
  announcementsTable, userReleaseReadsTable, notificationsTable,
  usersTable,
} from "@workspace/db";
import { eq, and, desc, asc, sql, count, inArray, gte, lte, or, isNull } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ─── Admin guard ──────────────────────────────────────────────────────────────

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}

// ─── File uploads (bug screenshots/videos) ───────────────────────────────────

const uploadDir = path.join(process.cwd(), "../../data/bug-report-uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const bugUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename:    (_req, file,  cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-z0-9._-]/gi, "_")}`),
  }),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (_req, file, cb) => {
    const ok = /^(image\/(png|jpeg|gif|webp)|video\/(mp4|webm|quicktime))$/.test(file.mimetype);
    cb(ok ? null : new Error("Unsupported file type"), ok);
  },
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function createNotification(
  userId: number, type: string, title: string, message: string,
  link?: string, refId?: number, refType?: string,
) {
  try {
    await db.insert(notificationsTable).values({ userId, type, title, message, link, refId, refType });
  } catch (err) {
    logger.warn({ err }, "[PRODUCT-HUB] Failed to create notification");
  }
}

async function broadcastNotification(
  type: string, title: string, message: string, link?: string, refId?: number, refType?: string,
) {
  try {
    const users = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.status, "active"));
    if (users.length > 0) {
      await db.insert(notificationsTable).values(
        users.map(u => ({ userId: u.id, type, title, message, link, refId, refType }))
      );
    }
  } catch (err) {
    logger.warn({ err }, "[PRODUCT-HUB] Failed to broadcast notification");
  }
}

const APP_VERSION = "1.0.0";

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/product-hub/announcements/active
router.get("/product-hub/announcements/active", async (req, res): Promise<void> => {
  try {
    const now = new Date();
    const rows = await db.select().from(announcementsTable)
      .where(and(
        eq(announcementsTable.isActive, true),
        or(isNull(announcementsTable.startDate), lte(announcementsTable.startDate, now)),
        or(isNull(announcementsTable.endDate),   gte(announcementsTable.endDate,   now)),
      ))
      .orderBy(desc(announcementsTable.priority))
      .limit(1);
    res.json(rows[0] ?? null);
  } catch (err) {
    logger.error({ err }, "[PRODUCT-HUB] Failed to fetch announcement");
    res.status(500).json({ error: "Failed to fetch announcement" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// USER ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/product-hub/releases?page=1&limit=20&q=&category=
router.get("/product-hub/releases", requireAuth, async (req, res): Promise<void> => {
  try {
    const page     = Math.max(1, parseInt(req.query.page  as string) || 1);
    const limit    = Math.min(50, parseInt(req.query.limit as string) || 20);
    const q        = typeof req.query.q        === "string" ? req.query.q.trim()        : "";
    const category = typeof req.query.category === "string" ? req.query.category.trim() : "";

    const userId = req.user!.id;

    const rows = await db.select().from(productReleasesTable)
      .where(eq(productReleasesTable.isPublished, true))
      .orderBy(desc(productReleasesTable.releaseDate))
      .limit(500); // fetch broadly; filter in memory

    // Which ones has this user read?
    const readRows = await db.select({ releaseId: userReleaseReadsTable.releaseId })
      .from(userReleaseReadsTable).where(eq(userReleaseReadsTable.userId, userId));
    const readSet = new Set(readRows.map(r => r.releaseId));

    let filtered = rows;
    if (q) {
      const lq = q.toLowerCase();
      filtered = filtered.filter(r =>
        r.title.toLowerCase().includes(lq) ||
        r.description.toLowerCase().includes(lq) ||
        r.version.toLowerCase().includes(lq)
      );
    }
    if (category) {
      filtered = filtered.filter(r => r.category === category);
    }

    const paginated = filtered.slice((page - 1) * limit, page * limit);
    const data = paginated.map(r => ({ ...r, isRead: readSet.has(r.id) }));

    // Unread count across all published releases (regardless of filter)
    const unreadCount = rows.filter(r => !readSet.has(r.id)).length;

    res.json({ data, unreadCount, page, limit });
  } catch (err) {
    logger.error({ err }, "[PRODUCT-HUB] Failed to fetch releases");
    res.status(500).json({ error: "Failed to fetch releases" });
  }
});

// GET /api/product-hub/releases/unread-count
router.get("/product-hub/releases/unread-count", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = req.user!.id;
    const allPublished = await db.select({ id: productReleasesTable.id })
      .from(productReleasesTable).where(eq(productReleasesTable.isPublished, true));
    const readRows = await db.select({ releaseId: userReleaseReadsTable.releaseId })
      .from(userReleaseReadsTable).where(eq(userReleaseReadsTable.userId, userId));
    const readSet = new Set(readRows.map(r => r.releaseId));
    const unreadCount = allPublished.filter(r => !readSet.has(r.id)).length;
    res.json({ unreadCount });
  } catch {
    res.json({ unreadCount: 0 });
  }
});

// POST /api/product-hub/releases/:id/read
router.post("/product-hub/releases/:id/read", requireAuth, async (req, res): Promise<void> => {
  const id     = parseInt(req.params.id);
  const userId = req.user!.id;
  try {
    await db.insert(userReleaseReadsTable).values({ userId, releaseId: id }).onConflictDoNothing();
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "[PRODUCT-HUB] Failed to mark release as read");
    res.status(500).json({ error: "Failed to mark as read" });
  }
});

// GET /api/product-hub/roadmap?status=&q=
router.get("/product-hub/roadmap", requireAuth, async (req, res): Promise<void> => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status.trim() : "";
    const q      = typeof req.query.q      === "string" ? req.query.q.trim()      : "";
    const userId = req.user!.id;

    let rows = await db.select().from(roadmapItemsTable)
      .where(eq(roadmapItemsTable.isPublished, true))
      .orderBy(desc(roadmapItemsTable.voteCount), asc(roadmapItemsTable.sortOrder));

    if (status) rows = rows.filter(r => r.status === status);
    if (q)      rows = rows.filter(r =>
      r.title.toLowerCase().includes(q.toLowerCase()) ||
      r.description.toLowerCase().includes(q.toLowerCase())
    );

    const myVotes = await db.select({ roadmapItemId: featureVotesTable.roadmapItemId })
      .from(featureVotesTable).where(eq(featureVotesTable.userId, userId));
    const votedSet = new Set(myVotes.map(v => v.roadmapItemId));

    const data = rows.map(r => ({ ...r, hasVoted: votedSet.has(r.id) }));
    res.json(data);
  } catch (err) {
    logger.error({ err }, "[PRODUCT-HUB] Failed to fetch roadmap");
    res.status(500).json({ error: "Failed to fetch roadmap" });
  }
});

// POST /api/product-hub/roadmap/:id/vote  (toggle)
router.post("/product-hub/roadmap/:id/vote", requireAuth, async (req, res): Promise<void> => {
  const itemId = parseInt(req.params.id);
  const userId = req.user!.id;
  try {
    const existing = await db.select().from(featureVotesTable)
      .where(and(eq(featureVotesTable.roadmapItemId, itemId), eq(featureVotesTable.userId, userId)));

    if (existing.length > 0) {
      // Unvote
      await db.delete(featureVotesTable)
        .where(and(eq(featureVotesTable.roadmapItemId, itemId), eq(featureVotesTable.userId, userId)));
      await db.update(roadmapItemsTable)
        .set({ voteCount: sql`greatest(vote_count - 1, 0)`, updatedAt: new Date() })
        .where(eq(roadmapItemsTable.id, itemId));
      res.json({ voted: false });
    } else {
      // Vote
      await db.insert(featureVotesTable).values({ roadmapItemId: itemId, userId });
      await db.update(roadmapItemsTable)
        .set({ voteCount: sql`vote_count + 1`, updatedAt: new Date() })
        .where(eq(roadmapItemsTable.id, itemId));
      res.json({ voted: true });
    }
  } catch (err) {
    logger.error({ err }, "[PRODUCT-HUB] Failed to toggle vote");
    res.status(500).json({ error: "Failed to vote" });
  }
});

// POST /api/product-hub/feedback
router.post("/product-hub/feedback", requireAuth, async (req, res): Promise<void> => {
  const { type, title, description, category, priority, currentPage, browser, os } = req.body;
  if (!type || !title?.trim() || !description?.trim()) {
    res.status(400).json({ error: "type, title, and description are required" });
    return;
  }
  try {
    const [row] = await db.insert(feedbackTable).values({
      userId: req.user!.id, type, title: title.trim(), description: description.trim(),
      category: category ?? "general", priority: priority ?? "medium",
      currentPage, browser, os, platformVersion: APP_VERSION,
      embeddingText: `${title} ${description}`,
    }).returning();
    res.status(201).json(row);
  } catch (err) {
    logger.error({ err }, "[PRODUCT-HUB] Failed to submit feedback");
    res.status(500).json({ error: "Failed to submit feedback" });
  }
});

// POST /api/product-hub/feature-requests
router.post("/product-hub/feature-requests", requireAuth, async (req, res): Promise<void> => {
  const { title, description, category, businessImpact, currentPage, browser, os } = req.body;
  if (!title?.trim() || !description?.trim()) {
    res.status(400).json({ error: "title and description are required" });
    return;
  }
  try {
    const [row] = await db.insert(featureRequestsTable).values({
      userId: req.user!.id, title: title.trim(), description: description.trim(),
      category: category ?? "general", businessImpact, currentPage, browser, os,
      embeddingText: `${title} ${description} ${businessImpact ?? ""}`,
    }).returning();
    res.status(201).json(row);
  } catch (err) {
    logger.error({ err }, "[PRODUCT-HUB] Failed to submit feature request");
    res.status(500).json({ error: "Failed to submit feature request" });
  }
});

// POST /api/product-hub/bug-reports/upload
router.post("/product-hub/bug-reports/upload", requireAuth,
  bugUpload.single("file"),
  async (req, res): Promise<void> => {
    if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }
    const fileUrl = `/data/bug-report-uploads/${req.file.filename}`;
    res.json({ url: fileUrl, name: req.file.originalname, type: req.file.mimetype });
  },
);

// POST /api/product-hub/bug-reports
router.post("/product-hub/bug-reports", requireAuth, async (req, res): Promise<void> => {
  const {
    title, description, stepsToReproduce, expectedResult, actualResult,
    severity, currentUrl, browser, os, screenResolution, screenshotUrl, videoUrl,
  } = req.body;
  if (!title?.trim() || !description?.trim() || !stepsToReproduce?.trim() ||
      !expectedResult?.trim() || !actualResult?.trim()) {
    res.status(400).json({ error: "All required fields must be filled" });
    return;
  }
  try {
    const [row] = await db.insert(bugReportsTable).values({
      userId: req.user!.id, title: title.trim(), description: description.trim(),
      stepsToReproduce: stepsToReproduce.trim(), expectedResult: expectedResult.trim(),
      actualResult: actualResult.trim(), severity: severity ?? "medium",
      currentUrl, browser, os, screenResolution, platformVersion: APP_VERSION,
      screenshotUrl, videoUrl,
      embeddingText: `${title} ${description} ${stepsToReproduce}`,
    }).returning();
    res.status(201).json(row);
  } catch (err) {
    logger.error({ err }, "[PRODUCT-HUB] Failed to submit bug report");
    res.status(500).json({ error: "Failed to submit bug report" });
  }
});

// GET /api/product-hub/notifications?limit=50&type=
router.get("/product-hub/notifications", requireAuth, async (req, res): Promise<void> => {
  try {
    const limit    = Math.min(100, parseInt(req.query.limit as string) || 50);
    const typeFilter = typeof req.query.type === "string" ? req.query.type.trim() : "";

    const rows = await db.select().from(notificationsTable)
      .where(eq(notificationsTable.userId, req.user!.id))
      .orderBy(desc(notificationsTable.createdAt))
      .limit(500);

    const filtered = typeFilter ? rows.filter(n => n.type === typeFilter) : rows;
    const data = filtered.slice(0, limit);
    const unreadCount = rows.filter(n => !n.isRead).length;

    res.json({ data, unreadCount, total: filtered.length });
  } catch (err) {
    logger.error({ err }, "[PRODUCT-HUB] Failed to fetch notifications");
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

// POST /api/product-hub/notifications/read-all
router.post("/product-hub/notifications/read-all", requireAuth, async (req, res): Promise<void> => {
  try {
    await db.update(notificationsTable).set({ isRead: true })
      .where(and(eq(notificationsTable.userId, req.user!.id), eq(notificationsTable.isRead, false)));
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "[PRODUCT-HUB] Failed to mark notifications read");
    res.status(500).json({ error: "Failed to mark notifications" });
  }
});

// POST /api/product-hub/notifications/:id/read
router.post("/product-hub/notifications/:id/read", requireAuth, async (req, res): Promise<void> => {
  try {
    await db.update(notificationsTable).set({ isRead: true })
      .where(and(eq(notificationsTable.id, parseInt(req.params.id)), eq(notificationsTable.userId, req.user!.id)));
    res.json({ success: true });
  } catch {
    res.json({ success: false });
  }
});

// DELETE /api/product-hub/notifications/:id
router.delete("/product-hub/notifications/:id", requireAuth, async (req, res): Promise<void> => {
  try {
    await db.delete(notificationsTable)
      .where(and(eq(notificationsTable.id, parseInt(req.params.id)), eq(notificationsTable.userId, req.user!.id)));
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "[PRODUCT-HUB] Failed to delete notification");
    res.status(500).json({ error: "Failed to delete notification" });
  }
});

// DELETE /api/product-hub/notifications — clear all for user
router.delete("/product-hub/notifications", requireAuth, async (req, res): Promise<void> => {
  try {
    await db.delete(notificationsTable).where(eq(notificationsTable.userId, req.user!.id));
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "[PRODUCT-HUB] Failed to clear notifications");
    res.status(500).json({ error: "Failed to clear notifications" });
  }
});

// GET /api/product-hub/version-popup — returns latest unread major release or null
router.get("/product-hub/version-popup", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = req.user!.id;
    const [latest] = await db.select().from(productReleasesTable)
      .where(and(eq(productReleasesTable.isPublished, true), eq(productReleasesTable.isMajor, true)))
      .orderBy(desc(productReleasesTable.releaseDate))
      .limit(1);
    if (!latest) { res.json(null); return; }

    const read = await db.select().from(userReleaseReadsTable)
      .where(and(eq(userReleaseReadsTable.userId, userId), eq(userReleaseReadsTable.releaseId, latest.id)));
    if (read.length > 0) { res.json(null); return; }

    res.json(latest);
  } catch {
    res.json(null);
  }
});

// GET /api/product-hub/dashboard-summary
router.get("/product-hub/dashboard-summary", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = req.user!.id;

    const [latestRelease] = await db.select({ id: productReleasesTable.id, version: productReleasesTable.version, title: productReleasesTable.title, releaseDate: productReleasesTable.releaseDate })
      .from(productReleasesTable).where(eq(productReleasesTable.isPublished, true))
      .orderBy(desc(productReleasesTable.releaseDate)).limit(1);

    const [topFeature] = await db.select({ id: featureRequestsTable.id, title: featureRequestsTable.title, status: featureRequestsTable.status })
      .from(featureRequestsTable).where(eq(featureRequestsTable.status, "open"))
      .orderBy(desc(featureRequestsTable.createdAt)).limit(1);

    const [upcoming] = await db.select({ id: roadmapItemsTable.id, title: roadmapItemsTable.title, status: roadmapItemsTable.status, voteCount: roadmapItemsTable.voteCount })
      .from(roadmapItemsTable)
      .where(and(eq(roadmapItemsTable.isPublished, true), eq(roadmapItemsTable.status, "in_development")))
      .orderBy(desc(roadmapItemsTable.voteCount)).limit(1);

    const [latestAnnouncement] = await db.select({ id: announcementsTable.id, message: announcementsTable.message })
      .from(announcementsTable).where(eq(announcementsTable.isActive, true))
      .orderBy(desc(announcementsTable.createdAt)).limit(1);

    const readRows = await db.select({ releaseId: userReleaseReadsTable.releaseId })
      .from(userReleaseReadsTable).where(eq(userReleaseReadsTable.userId, userId));
    const readSet = new Set(readRows.map(r => r.releaseId));
    const allPublished = await db.select({ id: productReleasesTable.id }).from(productReleasesTable).where(eq(productReleasesTable.isPublished, true));
    const unreadCount = allPublished.filter(r => !readSet.has(r.id)).length;

    res.json({ latestRelease: latestRelease ?? null, topFeature: topFeature ?? null, upcoming: upcoming ?? null, latestAnnouncement: latestAnnouncement ?? null, unreadCount });
  } catch (err) {
    logger.error({ err }, "[PRODUCT-HUB] Failed to fetch dashboard summary");
    res.status(500).json({ error: "Failed to fetch summary" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// ── Releases ─────────────────────────────────────────────────────────────────

router.get("/product-hub/admin/releases", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  try {
    const rows = await db.select().from(productReleasesTable).orderBy(desc(productReleasesTable.releaseDate));
    res.json(rows);
  } catch { res.status(500).json({ error: "Failed" }); }
});

router.post("/product-hub/admin/releases", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const { version, releaseDate, category, title, description, imageUrl, videoUrl, docUrl, highlights, isMajor, isPublished } = req.body;
  if (!version || !title || !description || !category || !releaseDate) {
    res.status(400).json({ error: "Missing required fields" }); return;
  }
  try {
    const [row] = await db.insert(productReleasesTable).values({
      version, releaseDate: new Date(releaseDate), category, title, description,
      imageUrl, videoUrl, docUrl, highlights: highlights ?? [], isMajor: isMajor ?? false,
      isPublished: isPublished ?? false,
    }).returning();
    // Broadcast notification if published
    if (row.isPublished) {
      await broadcastNotification("new_version", `🚀 v${row.version} Released`, row.title, "/whats-new", row.id, "release");
    }
    res.status(201).json(row);
  } catch (err) {
    logger.error({ err }, "[PRODUCT-HUB] Failed to create release");
    res.status(500).json({ error: "Failed to create release" });
  }
});

router.put("/product-hub/admin/releases/:id", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  const { version, releaseDate, category, title, description, imageUrl, videoUrl, docUrl, highlights, isMajor, isPublished } = req.body;
  try {
    const [before] = await db.select().from(productReleasesTable).where(eq(productReleasesTable.id, id));
    const [row] = await db.update(productReleasesTable).set({
      version, releaseDate: releaseDate ? new Date(releaseDate) : undefined,
      category, title, description, imageUrl, videoUrl, docUrl,
      highlights: highlights ?? [], isMajor, isPublished, updatedAt: new Date(),
    }).where(eq(productReleasesTable.id, id)).returning();
    // Broadcast if just published
    if (!before?.isPublished && row?.isPublished) {
      await broadcastNotification("new_version", `🚀 v${row.version} Released`, row.title, "/whats-new", row.id, "release");
    }
    res.json(row);
  } catch (err) {
    logger.error({ err }, "[PRODUCT-HUB] Failed to update release");
    res.status(500).json({ error: "Failed to update release" });
  }
});

router.delete("/product-hub/admin/releases/:id", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  try {
    await db.delete(productReleasesTable).where(eq(productReleasesTable.id, parseInt(req.params.id)));
    res.json({ success: true });
  } catch { res.status(500).json({ error: "Failed" }); }
});

// ── Roadmap ───────────────────────────────────────────────────────────────────

router.get("/product-hub/admin/roadmap", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  try {
    const rows = await db.select().from(roadmapItemsTable).orderBy(asc(roadmapItemsTable.sortOrder), desc(roadmapItemsTable.voteCount));
    res.json(rows);
  } catch { res.status(500).json({ error: "Failed" }); }
});

router.post("/product-hub/admin/roadmap", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const { title, description, status, category, progress, estimatedRelease, sortOrder, isPublished } = req.body;
  if (!title || !description) { res.status(400).json({ error: "title and description required" }); return; }
  try {
    const [row] = await db.insert(roadmapItemsTable).values({
      title, description, status: status ?? "planned", category: category ?? "general",
      progress: progress ?? 0, estimatedRelease, sortOrder: sortOrder ?? 0,
      isPublished: isPublished ?? true, embeddingText: `${title} ${description}`,
    }).returning();
    res.status(201).json(row);
  } catch (err) {
    logger.error({ err }, "[PRODUCT-HUB] Failed to create roadmap item");
    res.status(500).json({ error: "Failed" });
  }
});

router.put("/product-hub/admin/roadmap/:id", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  const { title, description, status, category, progress, estimatedRelease, sortOrder, isPublished } = req.body;
  try {
    const [before] = await db.select().from(roadmapItemsTable).where(eq(roadmapItemsTable.id, id));
    const [row] = await db.update(roadmapItemsTable).set({
      title, description, status, category, progress, estimatedRelease, sortOrder, isPublished,
      embeddingText: `${title} ${description}`, updatedAt: new Date(),
    }).where(eq(roadmapItemsTable.id, id)).returning();
    // Notify voters if status changed
    if (before && row && before.status !== row.status) {
      const voters = await db.select({ userId: featureVotesTable.userId })
        .from(featureVotesTable).where(eq(featureVotesTable.roadmapItemId, id));
      for (const { userId } of voters) {
        await createNotification(userId, "roadmap_update", `📋 Roadmap Update: ${row.title}`,
          `Status changed to ${row.status.replace(/_/g, " ")}`, "/roadmap", id, "roadmap_item");
      }
    }
    res.json(row);
  } catch (err) {
    logger.error({ err }, "[PRODUCT-HUB] Failed to update roadmap item");
    res.status(500).json({ error: "Failed" });
  }
});

router.delete("/product-hub/admin/roadmap/:id", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  try {
    await db.delete(roadmapItemsTable).where(eq(roadmapItemsTable.id, parseInt(req.params.id)));
    res.json({ success: true });
  } catch { res.status(500).json({ error: "Failed" }); }
});

// ── Announcements ─────────────────────────────────────────────────────────────

router.get("/product-hub/admin/announcements", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  try {
    const rows = await db.select().from(announcementsTable).orderBy(desc(announcementsTable.createdAt));
    res.json(rows);
  } catch { res.status(500).json({ error: "Failed" }); }
});

router.post("/product-hub/admin/announcements", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const { message, backgroundColor, priority, startDate, endDate, isDismissible, link, linkLabel, isActive } = req.body;
  if (!message?.trim()) { res.status(400).json({ error: "message required" }); return; }
  try {
    const [row] = await db.insert(announcementsTable).values({
      message: message.trim(), backgroundColor: backgroundColor ?? "#3b82f6",
      priority: priority ?? 0, startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null, isDismissible: isDismissible ?? true,
      link, linkLabel, isActive: isActive ?? true,
    }).returning();
    if (row.isActive) {
      await broadcastNotification("announcement", "📢 Announcement", row.message, undefined, row.id, "announcement");
    }
    res.status(201).json(row);
  } catch (err) {
    logger.error({ err }, "[PRODUCT-HUB] Failed to create announcement");
    res.status(500).json({ error: "Failed" });
  }
});

router.put("/product-hub/admin/announcements/:id", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  const { message, backgroundColor, priority, startDate, endDate, isDismissible, link, linkLabel, isActive } = req.body;
  try {
    const [row] = await db.update(announcementsTable).set({
      message, backgroundColor, priority,
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      isDismissible, link, linkLabel, isActive, updatedAt: new Date(),
    }).where(eq(announcementsTable.id, id)).returning();
    res.json(row);
  } catch { res.status(500).json({ error: "Failed" }); }
});

router.delete("/product-hub/admin/announcements/:id", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  try {
    await db.delete(announcementsTable).where(eq(announcementsTable.id, parseInt(req.params.id)));
    res.json({ success: true });
  } catch { res.status(500).json({ error: "Failed" }); }
});

// ── Feedback ──────────────────────────────────────────────────────────────────

router.get("/product-hub/admin/feedback", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const { status, type, page = "1", limit = "30", q = "" } = req.query as Record<string, string>;
  try {
    let rows = await db.select().from(feedbackTable).orderBy(desc(feedbackTable.createdAt)).limit(500);
    if (status) rows = rows.filter(r => r.status === status);
    if (type)   rows = rows.filter(r => r.type === type);
    if (q)      rows = rows.filter(r => r.title.toLowerCase().includes(q.toLowerCase()) || r.description.toLowerCase().includes(q.toLowerCase()));
    const p = Math.max(1, parseInt(page));
    const l = Math.min(100, parseInt(limit));
    const total = rows.length;
    res.json({ data: rows.slice((p - 1) * l, p * l), total, page: p, limit: l });
  } catch { res.status(500).json({ error: "Failed" }); }
});

router.put("/product-hub/admin/feedback/:id", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  const { status, adminReply } = req.body;
  try {
    const [before] = await db.select().from(feedbackTable).where(eq(feedbackTable.id, id));
    const [row] = await db.update(feedbackTable).set({
      status, adminReply, adminReplyAt: adminReply ? new Date() : undefined, updatedAt: new Date(),
    }).where(eq(feedbackTable.id, id)).returning();
    if (adminReply && before?.adminReply !== adminReply && row?.userId) {
      await createNotification(row.userId, "feedback_reply", "💬 Reply on your feedback",
        `Admin replied to: ${row.title}`, "/feedback", id, "feedback");
    }
    res.json(row);
  } catch { res.status(500).json({ error: "Failed" }); }
});

// ── Feature requests ──────────────────────────────────────────────────────────

router.get("/product-hub/admin/feature-requests", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const { status, page = "1", limit = "30", q = "" } = req.query as Record<string, string>;
  try {
    let rows = await db.select().from(featureRequestsTable).orderBy(desc(featureRequestsTable.createdAt)).limit(500);
    if (status) rows = rows.filter(r => r.status === status);
    if (q)      rows = rows.filter(r => r.title.toLowerCase().includes(q.toLowerCase()));
    const p = Math.max(1, parseInt(page));
    const l = Math.min(100, parseInt(limit));
    res.json({ data: rows.slice((p - 1) * l, p * l), total: rows.length, page: p, limit: l });
  } catch { res.status(500).json({ error: "Failed" }); }
});

router.put("/product-hub/admin/feature-requests/:id", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  const { status, adminReply } = req.body;
  try {
    const [before] = await db.select().from(featureRequestsTable).where(eq(featureRequestsTable.id, id));
    const [row] = await db.update(featureRequestsTable).set({
      status, adminReply, adminReplyAt: adminReply ? new Date() : undefined, updatedAt: new Date(),
    }).where(eq(featureRequestsTable.id, id)).returning();
    if (adminReply && before?.adminReply !== adminReply && row?.userId) {
      await createNotification(row.userId, "feature_reply", "💡 Reply on your feature request",
        `Admin replied to: ${row.title}`, "/product-hub/feedback", id, "feature_request");
    }
    res.json(row);
  } catch { res.status(500).json({ error: "Failed" }); }
});

// ── Bug reports ───────────────────────────────────────────────────────────────

router.get("/product-hub/admin/bug-reports", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const { status, severity, page = "1", limit = "30", q = "" } = req.query as Record<string, string>;
  try {
    let rows = await db.select().from(bugReportsTable).orderBy(desc(bugReportsTable.createdAt)).limit(500);
    if (status)   rows = rows.filter(r => r.status === status);
    if (severity) rows = rows.filter(r => r.severity === severity);
    if (q)        rows = rows.filter(r => r.title.toLowerCase().includes(q.toLowerCase()));
    const p = Math.max(1, parseInt(page));
    const l = Math.min(100, parseInt(limit));
    res.json({ data: rows.slice((p - 1) * l, p * l), total: rows.length, page: p, limit: l });
  } catch { res.status(500).json({ error: "Failed" }); }
});

router.put("/product-hub/admin/bug-reports/:id", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  const { status, adminReply, assignedTo } = req.body;
  try {
    const [before] = await db.select().from(bugReportsTable).where(eq(bugReportsTable.id, id));
    const [row] = await db.update(bugReportsTable).set({
      status, adminReply, assignedTo, adminReplyAt: adminReply ? new Date() : undefined, updatedAt: new Date(),
    }).where(eq(bugReportsTable.id, id)).returning();
    if (adminReply && before?.adminReply !== adminReply && row?.userId) {
      await createNotification(row.userId, "bug_reply", "🐛 Reply on your bug report",
        `Admin replied to: ${row.title}`, "/report-bug", id, "bug_report");
    }
    res.json(row);
  } catch { res.status(500).json({ error: "Failed" }); }
});

// ── Admin search ──────────────────────────────────────────────────────────────

router.get("/product-hub/admin/search", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const q = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
  if (!q) { res.json({ releases: [], roadmap: [], feedback: [], bugs: [], features: [] }); return; }
  try {
    const [releases, roadmap, feedback, bugs, features] = await Promise.all([
      db.select().from(productReleasesTable).limit(100),
      db.select().from(roadmapItemsTable).limit(100),
      db.select().from(feedbackTable).limit(100),
      db.select().from(bugReportsTable).limit(100),
      db.select().from(featureRequestsTable).limit(100),
    ]);
    res.json({
      releases: releases.filter(r => r.title.toLowerCase().includes(q) || r.version.includes(q)).slice(0, 10),
      roadmap:  roadmap.filter(r => r.title.toLowerCase().includes(q)).slice(0, 10),
      feedback: feedback.filter(r => r.title.toLowerCase().includes(q)).slice(0, 10),
      bugs:     bugs.filter(r => r.title.toLowerCase().includes(q)).slice(0, 10),
      features: features.filter(r => r.title.toLowerCase().includes(q)).slice(0, 10),
    });
  } catch { res.status(500).json({ error: "Search failed" }); }
});

export default router;
