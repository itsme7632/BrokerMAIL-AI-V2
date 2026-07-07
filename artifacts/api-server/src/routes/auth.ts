import crypto from "crypto";
import { Router, type IRouter } from "express";
import { db, usersTable, passwordResetTokensTable } from "@workspace/db";
import { eq, and, gt, isNull } from "drizzle-orm";
import { LoginBody, RegisterBody } from "@workspace/api-zod";
import { signToken, hashPassword, comparePassword, requireAuth } from "../lib/auth";
import { getGoogleAuthUrl, getGmailAuthUrl, exchangeCode, getOAuthUserInfo, getOAuthRedirectUri } from "../lib/gmail";
import { sendTransactionalEmail, buildPasswordResetEmail } from "../lib/email-service";

const router: IRouter = Router();

// ─── Simple in-memory rate limiter for auth-sensitive endpoints ───────────────
// Keyed by IP. Resets every WINDOW_MS.
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 5;

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true; // allowed
  }
  entry.count += 1;
  return entry.count <= MAX_ATTEMPTS;
}

// Clean up stale entries every 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of rateLimitMap.entries()) {
    if (now > val.resetAt) rateLimitMap.delete(key);
  }
}, 30 * 60 * 1000);

// ─── Helper: resolve app base URL ─────────────────────────────────────────────
function getAppBaseUrl(): string {
  return (
    process.env.PUBLIC_URL ??
    (process.env.REPLIT_DOMAINS
      ? `https://${process.env.REPLIT_DOMAINS.split(",")[0].trim()}`
      : null) ??
    (process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : null) ??
    "http://localhost:3000"
  );
}

// ─── Login ────────────────────────────────────────────────────────────────────

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { email, password } = parsed.data;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (!user || !user.passwordHash) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  const valid = await comparePassword(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  const token = signToken({ userId: user.id, email: user.email, role: user.role });
  res.json({
    token,
    user: {
      id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl,
      role: user.role, gmailConnected: user.gmailConnected, gmailEmail: user.gmailEmail,
      timezone: user.timezone, aiTone: user.aiTone, createdAt: user.createdAt.toISOString(),
    },
  });
});

// ─── Register ─────────────────────────────────────────────────────────────────

router.post("/auth/register", async (req, res): Promise<void> => {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { email, password, name } = parsed.data;
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (existing) {
    res.status(400).json({ error: "Email already in use" });
    return;
  }
  const passwordHash = await hashPassword(password);
  const [user] = await db.insert(usersTable).values({ email, name, passwordHash }).returning();
  const token = signToken({ userId: user.id, email: user.email, role: user.role });
  res.status(201).json({
    token,
    user: {
      id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl,
      role: user.role, gmailConnected: user.gmailConnected, gmailEmail: user.gmailEmail,
      timezone: user.timezone, aiTone: user.aiTone, createdAt: user.createdAt.toISOString(),
    },
  });
});

// ─── Logout ───────────────────────────────────────────────────────────────────

router.post("/auth/logout", async (_req, res): Promise<void> => {
  res.json({ message: "Logged out successfully" });
});

// ─── Me ───────────────────────────────────────────────────────────────────────

router.get("/auth/me", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  res.json({
    id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl,
    role: user.role, gmailConnected: user.gmailConnected, gmailEmail: user.gmailEmail,
    timezone: user.timezone, aiTone: user.aiTone, createdAt: user.createdAt.toISOString(),
  });
});

// ─── Google OAuth: initiate sign-in ──────────────────────────────────────────

router.get("/auth/google", (_req, res): void => {
  const url = getGoogleAuthUrl();
  res.redirect(url);
});

// ─── Google OAuth: unified callback ──────────────────────────────────────────

/**
 * Single redirect URI registered in Google Cloud Console.
 * The `state` query param routes the flow:
 *   - "google-login"            → sign-in / register
 *   - "gmail-connect:<userId>"  → Gmail account connection for existing user
 */
router.get("/auth/callback", async (req, res): Promise<void> => {
  const code       = req.query.code as string | undefined;
  const state      = (req.query.state as string | undefined) ?? "";
  const oauthError = req.query.error as string | undefined;

  if (oauthError) {
    req.log.warn({ oauthError, state }, "OAuth denied by user");
    res.redirect(state.startsWith("gmail-connect:") ? "/settings?error=oauth_denied" : "/login?error=oauth_denied");
    return;
  }

  if (!code) {
    req.log.warn({ state }, "OAuth callback missing code");
    res.redirect(state.startsWith("gmail-connect:") ? "/settings?error=no_code" : "/login?error=no_code");
    return;
  }

  try {
    const tokens = await exchangeCode(code);

    if (!tokens.access_token) {
      req.log.error({ state }, "OAuth token exchange returned no access token");
      res.redirect("/login?error=no_token");
      return;
    }

    // ── Gmail connect ────────────────────────────────────────────────────────
    if (state.startsWith("gmail-connect:")) {
      const userId = parseInt(state.split(":")[1], 10);
      if (!userId || isNaN(userId)) {
        res.redirect("/settings?error=invalid_state");
        return;
      }
      const userInfo = await getOAuthUserInfo(tokens.access_token);
      await db.update(usersTable).set({
        gmailConnected:   true,
        gmailEmail:       userInfo.email ?? null,
        gmailAccessToken: tokens.access_token,
        gmailRefreshToken: tokens.refresh_token ?? null,
        gmailTokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        updatedAt:        new Date(),
      }).where(eq(usersTable.id, userId));
      req.log.info({ userId, gmailEmail: userInfo.email }, "Gmail connected");
      res.redirect("/settings?gmail=connected");
      return;
    }

    // ── Google sign-in / register ────────────────────────────────────────────
    const userInfo = await getOAuthUserInfo(tokens.access_token);
    if (!userInfo.email) {
      req.log.error({ state }, "Google OAuth returned no email");
      res.redirect("/login?error=no_email");
      return;
    }

    let [user] = await db.select().from(usersTable).where(eq(usersTable.email, userInfo.email));
    if (!user) {
      [user] = await db.insert(usersTable).values({
        email:     userInfo.email,
        name:      userInfo.name ?? userInfo.email,
        avatarUrl: userInfo.picture ?? null,
        googleId:  userInfo.id ?? null,
      }).returning();
      req.log.info({ email: userInfo.email }, "New user created via Google OAuth");
    } else {
      if (!user.googleId || !user.avatarUrl) {
        await db.update(usersTable).set({
          googleId:  user.googleId ?? userInfo.id ?? null,
          avatarUrl: user.avatarUrl ?? userInfo.picture ?? null,
          updatedAt: new Date(),
        }).where(eq(usersTable.id, user.id));
      }
      req.log.info({ email: userInfo.email }, "Existing user signed in via Google OAuth");
    }

    const jwtToken = signToken({ userId: user.id, email: user.email, role: user.role });
    res.redirect(`/auth/callback?token=${jwtToken}`);
  } catch (err) {
    req.log.error({ err, state }, "OAuth callback error");
    res.redirect(state.startsWith("gmail-connect:") ? "/settings?error=oauth_failed" : "/login?error=oauth_failed");
  }
});

// ─── OAuth redirect URI (for UI hints) ───────────────────────────────────────

router.get("/auth/oauth-redirect-uri", (_req, res): void => {
  res.json({ redirectUri: getOAuthRedirectUri() });
});

// ─── Forgot Password ──────────────────────────────────────────────────────────

router.post("/auth/forgot-password", async (req, res): Promise<void> => {
  // Always return same message to prevent email enumeration
  const successMsg = { message: "If an account exists, we've sent a password reset email." };

  const ip = (req.ip ?? "unknown").split(":").pop() ?? "unknown";
  if (!checkRateLimit(ip)) {
    res.status(429).json({ error: "Too many requests. Please try again later." });
    return;
  }

  const email = (req.body as { email?: string })?.email?.trim().toLowerCase();
  if (!email) {
    res.json(successMsg);
    return;
  }

  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));

    if (!user) {
      // Deliberate: do not reveal whether the email exists
      res.json(successMsg);
      return;
    }

    // Generate a cryptographically secure random token
    const rawToken  = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 60 minutes

    await db.insert(passwordResetTokensTable).values({ userId: user.id, tokenHash, expiresAt });

    const resetUrl = `${getAppBaseUrl()}/reset-password?token=${rawToken}`;
    const { html, text } = buildPasswordResetEmail(user.name, resetUrl);

    await sendTransactionalEmail({ to: user.email, subject: "Reset your BrokerMAIL AI password", html, text });

    req.log.info({ userId: user.id }, "Password reset email dispatched");
  } catch (err) {
    req.log.error({ err }, "forgot-password error");
    // Fall through — still return success to prevent enumeration
  }

  res.json(successMsg);
});

// ─── Verify Reset Token (GET — used by frontend to pre-validate token) ───────

router.get("/auth/verify-reset-token", async (req, res): Promise<void> => {
  const token = req.query.token as string | undefined;
  if (!token) {
    res.json({ valid: false, reason: "missing" });
    return;
  }

  const tokenHash   = crypto.createHash("sha256").update(token).digest("hex");
  const [resetToken] = await db
    .select()
    .from(passwordResetTokensTable)
    .where(
      and(
        eq(passwordResetTokensTable.tokenHash, tokenHash),
        isNull(passwordResetTokensTable.usedAt),
      ),
    );

  if (!resetToken) {
    res.json({ valid: false, reason: "invalid" });
    return;
  }

  if (resetToken.expiresAt < new Date()) {
    res.json({ valid: false, reason: "expired" });
    return;
  }

  res.json({ valid: true });
});

// ─── Reset Password ───────────────────────────────────────────────────────────

router.post("/auth/reset-password", async (req, res): Promise<void> => {
  const { token, password } = req.body as { token?: string; password?: string };

  if (!token || !password) {
    res.status(400).json({ error: "Token and password are required" });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }

  const tokenHash    = crypto.createHash("sha256").update(token).digest("hex");
  const [resetToken] = await db
    .select()
    .from(passwordResetTokensTable)
    .where(
      and(
        eq(passwordResetTokensTable.tokenHash, tokenHash),
        isNull(passwordResetTokensTable.usedAt),
      ),
    );

  if (!resetToken) {
    res.status(400).json({ error: "invalid_token" });
    return;
  }

  if (resetToken.expiresAt < new Date()) {
    res.status(400).json({ error: "expired_token" });
    return;
  }

  const newHash = await hashPassword(password);

  // Consume token + update password in one transaction.
  // The conditional WHERE on usedAt IS NULL prevents replay even under
  // concurrent requests — only the first writer wins the token row.
  await db.transaction(async (tx) => {
    const now = new Date();
    const [consumed] = await tx
      .update(passwordResetTokensTable)
      .set({ usedAt: now })
      .where(
        and(
          eq(passwordResetTokensTable.id, resetToken.id),
          isNull(passwordResetTokensTable.usedAt),
        ),
      )
      .returning({ id: passwordResetTokensTable.id });

    if (!consumed) {
      // Another request consumed this token first
      throw Object.assign(new Error("Token already used"), { alreadyUsed: true });
    }

    await tx
      .update(usersTable)
      .set({ passwordHash: newHash, updatedAt: now })
      .where(eq(usersTable.id, resetToken.userId));
  }).catch((err: any) => {
    if (err?.alreadyUsed) {
      res.status(400).json({ error: "invalid_token" });
    } else {
      throw err;
    }
  });

  // If we already replied via the catch block, don't send another response
  if (res.headersSent) return;

  req.log.info({ userId: resetToken.userId }, "Password reset successfully");
  res.json({ message: "Password updated successfully" });
});

export default router;
