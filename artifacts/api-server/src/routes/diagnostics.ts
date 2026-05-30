import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { testAiConnection } from "../lib/ai";
import { getOAuthRedirectUri } from "../lib/gmail";
import { requireAdmin } from "../lib/auth";

const router: IRouter = Router();

/** Admin-only health / diagnostics endpoint */
router.get("/diagnostics", requireAdmin, async (req, res): Promise<void> => {
  const results: Record<string, any> = {};

  // Database
  try {
    await db.execute(sql`SELECT 1`);
    results.database = { ok: true };
  } catch (err: any) {
    results.database = { ok: false, error: err.message };
  }

  // Environment variables (only check presence, never expose values)
  results.env = {
    OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
    SESSION_SECRET: !!process.env.SESSION_SECRET,
    DATABASE_URL: !!process.env.DATABASE_URL,
    GMAIL_CLIENT_ID: !!process.env.GMAIL_CLIENT_ID,
    GMAIL_CLIENT_SECRET: !!process.env.GMAIL_CLIENT_SECRET,
  };

  // Gmail OAuth config
  results.gmail = {
    configured: !!(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET),
    redirectUri: getOAuthRedirectUri(),
  };

  const allOk = results.database.ok;
  res.status(allOk ? 200 : 503).json(results);
});

/** Admin-only AI connection test */
router.get("/diagnostics/ai", requireAdmin, async (req, res): Promise<void> => {
  const result = await testAiConnection();
  res.status(result.ok ? 200 : 503).json(result);
});

/** Admin-only full diagnostics (includes AI test) */
router.get("/diagnostics/full", requireAdmin, async (req, res): Promise<void> => {
  const results: Record<string, any> = {};

  // Database
  try {
    await db.execute(sql`SELECT 1`);
    results.database = { ok: true };
  } catch (err: any) {
    results.database = { ok: false, error: err.message };
  }

  // AI
  results.ai = await testAiConnection();

  // Gmail OAuth
  results.gmail = {
    configured: !!(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET),
    redirectUri: getOAuthRedirectUri(),
  };

  // User Gmail status
  const user = req.user!;
  results.userGmail = {
    connected: user.gmailConnected,
    email: user.gmailEmail,
    hasAccessToken: !!user.gmailAccessToken,
    hasRefreshToken: !!user.gmailRefreshToken,
    tokenExpiry: user.gmailTokenExpiry?.toISOString() ?? null,
    tokenExpired: user.gmailTokenExpiry ? user.gmailTokenExpiry < new Date() : null,
  };

  // Environment
  results.env = {
    OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
    SESSION_SECRET: !!process.env.SESSION_SECRET,
    DATABASE_URL: !!process.env.DATABASE_URL,
    GMAIL_CLIENT_ID: !!process.env.GMAIL_CLIENT_ID,
    GMAIL_CLIENT_SECRET: !!process.env.GMAIL_CLIENT_SECRET,
  };

  const allOk = results.database.ok && results.ai.ok;
  res.status(allOk ? 200 : 207).json(results);
});

export default router;
