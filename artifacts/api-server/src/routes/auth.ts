import crypto from "crypto";
import { Router, type IRouter } from "express";
import { db, usersTable, passwordResetTokensTable, emailVerificationCodesTable } from "@workspace/db";
import { eq, and, isNull, sql } from "drizzle-orm";
import { LoginBody, RegisterBody } from "@workspace/api-zod";
import { signToken, hashPassword, comparePassword, requireAuth } from "../lib/auth";
import { getGoogleAuthUrl, getGmailAuthUrl, exchangeCode, getOAuthUserInfo, getOAuthRedirectUri } from "../lib/gmail";
import {
  sendTransactionalEmail,
  buildPasswordResetEmail,
  buildVerificationEmail,
  buildWelcomeEmail,
  buildPasswordChangedEmail,
} from "../lib/email-service";

const router: IRouter = Router();

// ─── Shared user response shape ───────────────────────────────────────────────

function userShape(user: typeof usersTable.$inferSelect) {
  return {
    id:             user.id,
    email:          user.email,
    name:           user.name,
    avatarUrl:      user.avatarUrl,
    role:           user.role,
    gmailConnected: user.gmailConnected,
    gmailEmail:     user.gmailEmail,
    timezone:       user.timezone,
    aiTone:         user.aiTone,
    emailVerified:  user.emailVerified,
    createdAt:      user.createdAt.toISOString(),
  };
}

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

// ─── Verification code helpers ─────────────────────────────────────────────────

function generateVerificationCode(): string {
  // 6-digit cryptographically random number (Node 15.8+)
  return crypto.randomInt(100_000, 1_000_000).toString();
}

function hashVerificationCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

function timingSafeHashCompare(a: string, b: string): boolean {
  // Both are SHA-256 hex strings (64 chars / 32 bytes)
  try {
    const bufA = Buffer.from(a, "hex");
    const bufB = Buffer.from(b, "hex");
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

// ─── In-memory rate limiters ──────────────────────────────────────────────────

// General auth rate limiter (IP-based, for forgot-password)
const WINDOW_MS  = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  entry.count += 1;
  return entry.count <= MAX_ATTEMPTS;
}

// Resend verification code limiter (userId-based, 5 per hour)
const RESEND_MAX = 5;
const HOUR_MS    = 60 * 60 * 1000;
const resendLimiter = new Map<number, { count: number; resetAt: number }>();

function checkResendLimit(userId: number): boolean {
  const now = Date.now();
  const entry = resendLimiter.get(userId);
  if (!entry || now > entry.resetAt) {
    resendLimiter.set(userId, { count: 1, resetAt: now + HOUR_MS });
    return true;
  }
  entry.count += 1;
  return entry.count <= RESEND_MAX;
}

// Verification attempt limiter (userId-based, 10 per hour — brute-force guard)
const VERIFY_ATTEMPT_MAX = 10;
const verifyAttemptLimiter = new Map<number, { count: number; resetAt: number }>();

function checkVerifyAttemptLimit(userId: number): boolean {
  const now = Date.now();
  const entry = verifyAttemptLimiter.get(userId);
  if (!entry || now > entry.resetAt) {
    verifyAttemptLimiter.set(userId, { count: 1, resetAt: now + HOUR_MS });
    return true;
  }
  entry.count += 1;
  return entry.count <= VERIFY_ATTEMPT_MAX;
}

// Clean up stale map entries every 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateLimitMap.entries())      if (now > v.resetAt) rateLimitMap.delete(k);
  for (const [k, v] of resendLimiter.entries())     if (now > v.resetAt) resendLimiter.delete(k);
  for (const [k, v] of verifyAttemptLimiter.entries()) if (now > v.resetAt) verifyAttemptLimiter.delete(k);
}, 30 * 60 * 1000);

// ─── Internal: issue and send a verification code ─────────────────────────────

async function issueVerificationCode(
  userId: number,
  name: string,
  email: string,
  isResend = false,
): Promise<Date> {
  const code     = generateVerificationCode();
  const codeHash = hashVerificationCode(code);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  if (isResend) {
    // Update existing record, incrementing resendCount
    await db.update(emailVerificationCodesTable)
      .set({
        codeHash,
        expiresAt,
        usedAt:      null,
        lastSentAt:  new Date(),
        resendCount: sql`${emailVerificationCodesTable.resendCount} + 1`,
      })
      .where(eq(emailVerificationCodesTable.userId, userId));
  } else {
    // Insert on registration (or upsert as safety net)
    await db.insert(emailVerificationCodesTable)
      .values({ userId, codeHash, expiresAt, lastSentAt: new Date(), resendCount: 0 })
      .onConflictDoUpdate({
        target: emailVerificationCodesTable.userId,
        set: { codeHash, expiresAt, usedAt: null, lastSentAt: new Date() },
      });
  }

  const { html, text } = buildVerificationEmail(name, code);
  await sendTransactionalEmail({ to: email, subject: "Verify your BrokerMAIL AI email", html, text });

  return expiresAt;
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
  res.json({ token, user: userShape(user) });
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
  const [user] = await db
    .insert(usersTable)
    .values({ email, name, passwordHash, emailVerified: false })
    .returning();

  // Send verification email (non-blocking on failure — user can resend)
  try {
    await issueVerificationCode(user.id, user.name, user.email, false);
  } catch (err) {
    req.log.warn({ err, userId: user.id }, "Failed to send verification email on register");
  }

  const token = signToken({ userId: user.id, email: user.email, role: user.role });
  res.status(201).json({
    token,
    requiresVerification: true,
    user: userShape(user),
  });
});

// ─── Logout ───────────────────────────────────────────────────────────────────

router.post("/auth/logout", async (_req, res): Promise<void> => {
  res.json({ message: "Logged out successfully" });
});

// ─── Me ───────────────────────────────────────────────────────────────────────

router.get("/auth/me", requireAuth, async (req, res): Promise<void> => {
  res.json(userShape(req.user!));
});

// ─── Send Verification Code ───────────────────────────────────────────────────

router.post("/auth/send-verification-code", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;

  if (user.emailVerified) {
    res.status(400).json({ error: "Email is already verified" });
    return;
  }

  // Look up existing code record
  const [record] = await db
    .select()
    .from(emailVerificationCodesTable)
    .where(eq(emailVerificationCodesTable.userId, user.id));

  if (record) {
    // Enforce 60-second cooldown between sends
    const msSinceLast = Date.now() - record.lastSentAt.getTime();
    if (msSinceLast < 60_000) {
      const remainingSeconds = Math.ceil((60_000 - msSinceLast) / 1000);
      res.status(429).json({
        error:            "Please wait before requesting another code.",
        remainingSeconds,
        expiresAt:        record.expiresAt.toISOString(),
      });
      return;
    }
  }

  // Hourly resend cap (5 per hour per user)
  if (!checkResendLimit(user.id)) {
    res.status(429).json({ error: "Too many resend attempts. Please try again in an hour." });
    return;
  }

  try {
    const expiresAt = await issueVerificationCode(user.id, user.name, user.email, !!record);
    res.json({ message: "Verification code sent", expiresAt: expiresAt.toISOString() });
  } catch (err: any) {
    req.log.error({ err }, "send-verification-code error");
    res.status(500).json({ error: err?.message ?? "Failed to send verification code" });
  }
});

// ─── Verify Email ─────────────────────────────────────────────────────────────

router.post("/auth/verify-email", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;

  if (user.emailVerified) {
    res.json({ message: "Email already verified" });
    return;
  }

  const { code } = req.body as { code?: string };
  if (!code || !/^\d{6}$/.test(code)) {
    res.status(400).json({ error: "Please enter a valid 6-digit code." });
    return;
  }

  // Brute-force protection
  if (!checkVerifyAttemptLimit(user.id)) {
    res.status(429).json({ error: "Too many attempts. Please request a new code and try again." });
    return;
  }

  const [record] = await db
    .select()
    .from(emailVerificationCodesTable)
    .where(eq(emailVerificationCodesTable.userId, user.id));

  if (!record || record.usedAt) {
    res.status(400).json({ error: "No valid code found. Please request a new one." });
    return;
  }

  if (record.expiresAt < new Date()) {
    res.status(400).json({ error: "Code has expired. Please request a new one." });
    return;
  }

  const computedHash = hashVerificationCode(code);
  if (!timingSafeHashCompare(record.codeHash, computedHash)) {
    res.status(400).json({ error: "Incorrect code. Please check and try again." });
    return;
  }

  // Mark code used + set emailVerified in one transaction
  await db.transaction(async (tx) => {
    await tx
      .update(emailVerificationCodesTable)
      .set({ usedAt: new Date() })
      .where(eq(emailVerificationCodesTable.id, record.id));
    await tx
      .update(usersTable)
      .set({ emailVerified: true, updatedAt: new Date() })
      .where(eq(usersTable.id, user.id));
  });

  // Send welcome email (non-fatal)
  try {
    const { html, text } = buildWelcomeEmail(user.name, `${getAppBaseUrl()}/dashboard`);
    await sendTransactionalEmail({
      to:      user.email,
      subject: "Welcome to BrokerMAIL AI! 🎉",
      html,
      text,
    });
  } catch (err) {
    req.log.warn({ err }, "Failed to send welcome email");
  }

  req.log.info({ userId: user.id }, "Email verified successfully");
  res.json({ message: "Email verified successfully" });
});

// ─── Google OAuth: initiate sign-in ──────────────────────────────────────────

router.get("/auth/google", (_req, res): void => {
  const url = getGoogleAuthUrl();
  res.redirect(url);
});

// ─── Google OAuth: unified callback ──────────────────────────────────────────

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
        gmailConnected:    true,
        gmailEmail:        userInfo.email ?? null,
        gmailAccessToken:  tokens.access_token,
        gmailRefreshToken: tokens.refresh_token ?? null,
        gmailTokenExpiry:  tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        updatedAt:         new Date(),
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
      // Google OAuth users have their email verified by Google
      [user] = await db.insert(usersTable).values({
        email:         userInfo.email,
        name:          userInfo.name ?? userInfo.email,
        avatarUrl:     userInfo.picture ?? null,
        googleId:      userInfo.id ?? null,
        emailVerified: true,
      }).returning();
      req.log.info({ email: userInfo.email }, "New user created via Google OAuth");
    } else {
      const updates: Partial<typeof usersTable.$inferSelect> = { updatedAt: new Date() };
      if (!user.googleId)  updates.googleId  = userInfo.id ?? null;
      if (!user.avatarUrl) updates.avatarUrl  = userInfo.picture ?? null;
      // If existing user authenticates via Google, also verify their email
      if (!user.emailVerified) updates.emailVerified = true;
      await db.update(usersTable).set(updates).where(eq(usersTable.id, user.id));
      req.log.info({ email: userInfo.email }, "Existing user signed in via Google OAuth");
    }

    const jwtToken = signToken({ userId: user.id, email: user.email, role: user.role });
    res.redirect(`/auth/callback?token=${jwtToken}`);
  } catch (err) {
    req.log.error({ err, state }, "OAuth callback error");
    res.redirect(state.startsWith("gmail-connect:") ? "/settings?error=oauth_failed" : "/login?error=oauth_failed");
  }
});

// ─── OAuth redirect URI ───────────────────────────────────────────────────────

router.get("/auth/oauth-redirect-uri", (_req, res): void => {
  res.json({ redirectUri: getOAuthRedirectUri() });
});

// ─── Forgot Password ──────────────────────────────────────────────────────────

router.post("/auth/forgot-password", async (req, res): Promise<void> => {
  const successMsg = { message: "If an account exists, we've sent a password reset email." };

  const ip = (req.ip ?? "unknown").split(":").pop() ?? "unknown";
  if (!checkRateLimit(ip)) {
    res.status(429).json({ error: "Too many requests. Please try again later." });
    return;
  }

  const email = (req.body as { email?: string })?.email?.trim().toLowerCase();
  if (!email) { res.json(successMsg); return; }

  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
    if (!user) { res.json(successMsg); return; }

    const rawToken  = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 60 min

    await db.insert(passwordResetTokensTable).values({ userId: user.id, tokenHash, expiresAt });

    const resetUrl = `${getAppBaseUrl()}/reset-password?token=${rawToken}`;
    const { html, text } = buildPasswordResetEmail(user.name, resetUrl);
    await sendTransactionalEmail({ to: user.email, subject: "Reset your BrokerMAIL AI password", html, text });

    req.log.info({ userId: user.id }, "Password reset email dispatched");
  } catch (err) {
    req.log.error({ err }, "forgot-password error");
  }

  res.json(successMsg);
});

// ─── Verify Reset Token ───────────────────────────────────────────────────────

router.get("/auth/verify-reset-token", async (req, res): Promise<void> => {
  const token = req.query.token as string | undefined;
  if (!token) { res.json({ valid: false, reason: "missing" }); return; }

  const tokenHash    = crypto.createHash("sha256").update(token).digest("hex");
  const [resetToken] = await db
    .select()
    .from(passwordResetTokensTable)
    .where(and(eq(passwordResetTokensTable.tokenHash, tokenHash), isNull(passwordResetTokensTable.usedAt)));

  if (!resetToken)                        { res.json({ valid: false, reason: "invalid" }); return; }
  if (resetToken.expiresAt < new Date())  { res.json({ valid: false, reason: "expired" }); return; }

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
    .where(and(eq(passwordResetTokensTable.tokenHash, tokenHash), isNull(passwordResetTokensTable.usedAt)));

  if (!resetToken)                        { res.status(400).json({ error: "invalid_token" }); return; }
  if (resetToken.expiresAt < new Date())  { res.status(400).json({ error: "expired_token" }); return; }

  const newHash = await hashPassword(password);
  let targetUser: typeof usersTable.$inferSelect | undefined;

  await db.transaction(async (tx) => {
    const now = new Date();
    const [consumed] = await tx
      .update(passwordResetTokensTable)
      .set({ usedAt: now })
      .where(and(eq(passwordResetTokensTable.id, resetToken.id), isNull(passwordResetTokensTable.usedAt)))
      .returning({ id: passwordResetTokensTable.id });

    if (!consumed) throw Object.assign(new Error("Token already used"), { alreadyUsed: true });

    const [updated] = await tx
      .update(usersTable)
      .set({ passwordHash: newHash, updatedAt: now })
      .where(eq(usersTable.id, resetToken.userId))
      .returning();

    targetUser = updated;
  }).catch((err: any) => {
    if (err?.alreadyUsed) {
      res.status(400).json({ error: "invalid_token" });
    } else {
      throw err;
    }
  });

  if (res.headersSent) return;

  // Send password-changed notification (non-fatal)
  if (targetUser) {
    const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
      ?? req.ip
      ?? null;
    const ua = req.headers["user-agent"] ?? null;
    try {
      const { html, text } = buildPasswordChangedEmail(targetUser.name, new Date(), ip, ua);
      await sendTransactionalEmail({
        to:      targetUser.email,
        subject: "Your BrokerMAIL AI password was changed",
        html,
        text,
      });
    } catch (err) {
      req.log.warn({ err }, "Failed to send password-changed email");
    }
  }

  req.log.info({ userId: resetToken.userId }, "Password reset successfully");
  res.json({ message: "Password updated successfully" });
});

export default router;
