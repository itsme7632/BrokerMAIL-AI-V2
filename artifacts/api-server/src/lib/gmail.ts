import { google } from "googleapis";
import { db, usersTable } from "@workspace/db";
import type { User } from "@workspace/db";
import { eq } from "drizzle-orm";

const OAUTH_CLIENT_ID = process.env.GMAIL_CLIENT_ID ?? "";
const OAUTH_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET ?? "";

/**
 * The single redirect URI used for ALL OAuth flows (Google login + Gmail connect).
 * Must be registered in Google Cloud Console.
 */
export function getOAuthRedirectUri(): string {
  if (process.env.OAUTH_REDIRECT_URI) {
    return process.env.OAUTH_REDIRECT_URI;
  }
  const domains = process.env.REPLIT_DOMAINS;
  if (domains) {
    const first = domains.split(",")[0].trim();
    return `https://${first}/api/auth/callback`;
  }
  return "http://localhost:5000/api/auth/callback";
}

export function getOAuth2Client() {
  return new google.auth.OAuth2(OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET, getOAuthRedirectUri());
}

/** Generate the Google OAuth URL for SIGN-IN (basic profile scopes only). */
export function getGoogleAuthUrl(): string {
  const client = getOAuth2Client();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
    ],
    state: "google-login",
  });
}

/** Generate the Gmail OAuth URL for connecting an existing account. */
export function getGmailAuthUrl(userId: number): string {
  const client = getOAuth2Client();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/gmail.compose",
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
    ],
    state: `gmail-connect:${userId}`,
  });
}

export async function exchangeCode(code: string) {
  const client = getOAuth2Client();
  const { tokens } = await client.getToken(code);
  return tokens;
}

/**
 * Build an authenticated Gmail client for `user`.
 * Automatically refreshes the access token if expired and persists the new
 * token back to the database so the next request also works.
 */
export async function getGmailClient(user: User) {
  const client = getOAuth2Client();
  client.setCredentials({
    access_token: user.gmailAccessToken,
    refresh_token: user.gmailRefreshToken,
    expiry_date: user.gmailTokenExpiry?.getTime(),
  });

  // Persist refreshed tokens automatically — googleapis fires this event
  // whenever the library silently refreshes an expired access token.
  client.on("tokens", (tokens) => {
    db.update(usersTable)
      .set({
        gmailAccessToken: tokens.access_token ?? user.gmailAccessToken,
        ...(tokens.refresh_token ? { gmailRefreshToken: tokens.refresh_token } : {}),
        gmailTokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        updatedAt: new Date(),
      })
      .where(eq(usersTable.id, user.id))
      .catch(() => {
        // Non-fatal — token refresh still succeeds for this request
      });
  });

  return google.gmail({ version: "v1", auth: client });
}

/**
 * Create a Gmail draft for `to` from the authenticated `user`.
 * If `bodyHtml` is provided, creates a multipart/alternative MIME message
 * with both plain-text and HTML parts (HTML is rendered in Gmail).
 * Returns the Gmail draft ID or throws a descriptive error.
 */
export async function createGmailDraft(
  user: User,
  to: string,
  subject: string,
  bodyText: string,
  bodyHtml?: string
): Promise<string> {
  if (!user.gmailAccessToken) {
    throw new Error("Gmail not connected — please reconnect Gmail in Settings.");
  }
  if (!user.gmailRefreshToken) {
    throw new Error(
      "Gmail refresh token missing — please reconnect Gmail in Settings (click Reconnect)."
    );
  }

  const gmail = await getGmailClient(user);
  const subjectEncoded = `=?UTF-8?B?${Buffer.from(subject, "utf-8").toString("base64")}?=`;
  const boundary = "====VERTEX_MAILER_BOUNDARY====";

  let rawMessage: string;

  if (bodyHtml) {
    // Multipart/alternative: text first (fallback), then HTML (preferred)
    const textB64 = Buffer.from(bodyText, "utf-8").toString("base64");
    const htmlB64 = Buffer.from(bodyHtml, "utf-8").toString("base64");

    rawMessage = [
      `To: ${to}`,
      `Subject: ${subjectEncoded}`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      textB64,
      "",
      `--${boundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      htmlB64,
      "",
      `--${boundary}--`,
    ].join("\r\n");
  } else {
    rawMessage = [
      `To: ${to}`,
      `Subject: ${subjectEncoded}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      bodyText,
    ].join("\r\n");
  }

  const encoded = Buffer.from(rawMessage)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  try {
    const draft = await gmail.users.drafts.create({
      userId: "me",
      requestBody: {
        message: { raw: encoded },
      },
    });
    return draft.data.id ?? "";
  } catch (err: any) {
    const status = err?.response?.status ?? err?.status;
    const reason = err?.response?.data?.error?.message ?? err?.message ?? String(err);

    if (status === 401) {
      throw new Error("Gmail authentication expired — please reconnect Gmail in Settings.");
    }
    if (status === 403) {
      throw new Error(
        `Gmail permission denied — make sure the Gmail Compose scope was granted. Detail: ${reason}`
      );
    }
    if (status === 429) {
      throw new Error("Gmail API rate limit reached — please try again in a few minutes.");
    }
    throw new Error(`Gmail API error (${status ?? "unknown"}): ${reason}`);
  }
}

export async function getOAuthUserInfo(accessToken: string) {
  const client = getOAuth2Client();
  client.setCredentials({ access_token: accessToken });
  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const { data } = await oauth2.userinfo.get();
  return data;
}

/** @deprecated Use getOAuthUserInfo instead */
export const getGmailUserInfo = getOAuthUserInfo;
