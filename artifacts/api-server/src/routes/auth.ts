import { Router, type IRouter } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { LoginBody, RegisterBody } from "@workspace/api-zod";
import { signToken, hashPassword, comparePassword, requireAuth } from "../lib/auth";
import { getGoogleAuthUrl, getGmailAuthUrl, exchangeCode, getOAuthUserInfo, getOAuthRedirectUri } from "../lib/gmail";

const router: IRouter = Router();

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

router.post("/auth/logout", async (_req, res): Promise<void> => {
  res.json({ message: "Logged out successfully" });
});

router.get("/auth/me", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  res.json({
    id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl,
    role: user.role, gmailConnected: user.gmailConnected, gmailEmail: user.gmailEmail,
    timezone: user.timezone, aiTone: user.aiTone, createdAt: user.createdAt.toISOString(),
  });
});

/**
 * Kick off the Google sign-in flow. Redirects to Google with state="google-login".
 */
router.get("/auth/google", (_req, res): void => {
  const url = getGoogleAuthUrl();
  res.redirect(url);
});

/**
 * Unified OAuth callback for ALL Google OAuth flows.
 *
 * This is the single redirect URI registered in Google Cloud Console.
 * The `state` query param tells us which flow triggered the callback:
 *   - "google-login"          → sign-in / register flow
 *   - "gmail-connect:<userId>" → Gmail account connection for an existing user
 *
 * On success the server issues a redirect to a frontend route:
 *   - Login:         /auth/callback?token=<jwt>
 *   - Gmail connect: /settings?gmail=connected
 *
 * Because the frontend SPA and the API are served from the same origin in
 * both dev (Vite proxy) and production (Replit reverse proxy), relative
 * redirects work correctly — no FRONTEND_URL variable needed.
 */
router.get("/auth/callback", async (req, res): Promise<void> => {
  const code = req.query.code as string | undefined;
  const state = (req.query.state as string | undefined) ?? "";
  const oauthError = req.query.error as string | undefined;

  // Google may return an error (e.g. user denied access)
  if (oauthError) {
    req.log.warn({ oauthError, state }, "OAuth denied by user");
    if (state.startsWith("gmail-connect:")) {
      res.redirect("/settings?error=oauth_denied");
    } else {
      res.redirect("/login?error=oauth_denied");
    }
    return;
  }

  if (!code) {
    req.log.warn({ state }, "OAuth callback missing code");
    if (state.startsWith("gmail-connect:")) {
      res.redirect("/settings?error=no_code");
    } else {
      res.redirect("/login?error=no_code");
    }
    return;
  }

  try {
    const tokens = await exchangeCode(code);

    if (!tokens.access_token) {
      req.log.error({ state }, "OAuth token exchange returned no access token");
      res.redirect("/login?error=no_token");
      return;
    }

    // ── Gmail connect flow ───────────────────────────────────────────────────
    if (state.startsWith("gmail-connect:")) {
      const userId = parseInt(state.split(":")[1], 10);
      if (!userId || isNaN(userId)) {
        res.redirect("/settings?error=invalid_state");
        return;
      }
      const userInfo = await getOAuthUserInfo(tokens.access_token);
      await db.update(usersTable).set({
        gmailConnected: true,
        gmailEmail: userInfo.email ?? null,
        gmailAccessToken: tokens.access_token,
        gmailRefreshToken: tokens.refresh_token ?? null,
        gmailTokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        updatedAt: new Date(),
      }).where(eq(usersTable.id, userId));
      req.log.info({ userId, gmailEmail: userInfo.email }, "Gmail connected");
      res.redirect("/settings?gmail=connected");
      return;
    }

    // ── Google sign-in / register flow ──────────────────────────────────────
    const userInfo = await getOAuthUserInfo(tokens.access_token);
    if (!userInfo.email) {
      req.log.error({ state }, "Google OAuth returned no email");
      res.redirect("/login?error=no_email");
      return;
    }

    let [user] = await db.select().from(usersTable).where(eq(usersTable.email, userInfo.email));
    if (!user) {
      [user] = await db.insert(usersTable).values({
        email: userInfo.email,
        name: userInfo.name ?? userInfo.email,
        avatarUrl: userInfo.picture ?? null,
        googleId: userInfo.id ?? null,
      }).returning();
      req.log.info({ email: userInfo.email }, "New user created via Google OAuth");
    } else {
      // Keep avatar / googleId in sync
      if (!user.googleId || !user.avatarUrl) {
        await db.update(usersTable).set({
          googleId: user.googleId ?? userInfo.id ?? null,
          avatarUrl: user.avatarUrl ?? userInfo.picture ?? null,
          updatedAt: new Date(),
        }).where(eq(usersTable.id, user.id));
      }
      req.log.info({ email: userInfo.email }, "Existing user signed in via Google OAuth");
    }

    const jwtToken = signToken({ userId: user.id, email: user.email, role: user.role });
    // Redirect to the dedicated frontend handler page that stores the token
    res.redirect(`/auth/callback?token=${jwtToken}`);
  } catch (err) {
    req.log.error({ err, state }, "OAuth callback error");
    if (state.startsWith("gmail-connect:")) {
      res.redirect("/settings?error=oauth_failed");
    } else {
      res.redirect("/login?error=oauth_failed");
    }
  }
});

/**
 * Expose the OAuth redirect URI so the frontend can display it as a hint
 * in the settings / admin UI (helps with Google Console configuration).
 */
router.get("/auth/oauth-redirect-uri", (_req, res): void => {
  res.json({ redirectUri: getOAuthRedirectUri() });
});

export default router;
