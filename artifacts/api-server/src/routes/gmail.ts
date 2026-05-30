import { Router, type IRouter } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { getGmailAuthUrl } from "../lib/gmail";

const router: IRouter = Router();

router.get("/gmail/status", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  res.json({
    connected: user.gmailConnected,
    email: user.gmailEmail ?? null,
    lastSynced: null,
  });
});

/**
 * Return the Google OAuth URL for connecting Gmail.
 *
 * The frontend must call this endpoint with the JWT Authorization header,
 * then redirect the browser to the returned `authUrl`. A direct browser
 * navigation to this route would fail with 401 because no auth header is sent.
 *
 *   const { authUrl } = await fetch('/api/gmail/connect', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json());
 *   window.location.href = authUrl;
 */
router.get("/gmail/connect", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const authUrl = getGmailAuthUrl(user.id);
  res.json({ authUrl });
});

router.post("/gmail/disconnect", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  await db.update(usersTable).set({
    gmailConnected: false,
    gmailEmail: null,
    gmailAccessToken: null,
    gmailRefreshToken: null,
    gmailTokenExpiry: null,
    updatedAt: new Date(),
  }).where(eq(usersTable.id, user.id));
  res.json({ message: "Gmail disconnected" });
});

export default router;
