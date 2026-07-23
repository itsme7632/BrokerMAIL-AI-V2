/**
 * Centralized error classification for send failures.
 * Used by campaign processor, draft retry, compose send, and upload-send flows.
 */

export type ErrorCategory =
  | "auth_gmail"
  | "auth_smtp"
  | "rate_limit"
  | "quota"
  | "invalid_recipient"
  | "mailbox_disabled"
  | "smtp_connection"
  | "dns"
  | "timeout"
  | "network"
  | "unknown";

export interface ErrorClassification {
  category: ErrorCategory;
  friendlyTitle: string;
  friendlyMessage: string;
  recoveryAction?: string;
  recoveryRoute?: string;
  canRetry: boolean;
}

export function classifyError(err: Error | string): ErrorClassification {
  const raw = typeof err === "string" ? err : (err.message ?? "");
  const msg = raw.toLowerCase();

  // ── Gmail / OAuth auth errors ─────────────────────────────────────────────
  if (
    msg.includes("invalid_grant") ||
    msg.includes("token has been expired") ||
    msg.includes("token_revoked") ||
    msg.includes("invalid credentials") ||
    msg.includes("authorizationerror") ||
    (msg.includes("unauthorized") && !msg.includes("eauth"))
  ) {
    return {
      category: "auth_gmail",
      friendlyTitle: "Gmail Authorization Expired",
      friendlyMessage:
        "Your Gmail authorization has expired or been revoked. Please reconnect your Gmail account to continue.",
      recoveryAction: "Reconnect Gmail",
      recoveryRoute: "/settings",
      canRetry: false,
    };
  }

  // ── SMTP auth errors ──────────────────────────────────────────────────────
  if (
    msg.includes("eauth") ||
    msg.includes("authentication failed") ||
    msg.includes("authentication credentials") ||
    msg.includes("invalid login") ||
    msg.includes("535") ||
    msg.includes("username and password") ||
    msg.includes("login failed") ||
    msg.includes("535 5.7")
  ) {
    return {
      category: "auth_smtp",
      friendlyTitle: "SMTP Authentication Failed",
      friendlyMessage:
        "SMTP authentication failed. Possible causes: wrong username, wrong password, or the mail server rejected the login.",
      recoveryAction: "Go to Mailbox Settings",
      recoveryRoute: "/mailbox",
      canRetry: false,
    };
  }

  // ── Rate limit / quota ────────────────────────────────────────────────────
  if (
    msg.includes("rate limit") ||
    msg.includes("too many") ||
    msg.includes("quota") ||
    msg.includes("allowed per") ||
    msg.includes("daily limit") ||
    msg.includes("hourly limit") ||
    msg.includes("451") ||
    msg.includes("452")
  ) {
    return {
      category: "rate_limit",
      friendlyTitle: "Rate Limit Reached",
      friendlyMessage:
        "Your email provider is rate-limiting sends. BrokerMAIL will automatically retry after the quota resets.",
      canRetry: true,
    };
  }

  // ── Invalid recipient ─────────────────────────────────────────────────────
  if (
    msg.includes("no such user") ||
    msg.includes("user not found") ||
    msg.includes("invalid address") ||
    msg.includes("does not exist") ||
    msg.includes("mailbox unavailable") ||
    msg.includes("550 5.1.1") ||
    msg.includes("5.1.1") ||
    (msg.includes("550") && msg.includes("user"))
  ) {
    return {
      category: "invalid_recipient",
      friendlyTitle: "Invalid Recipient",
      friendlyMessage:
        "The recipient's email address was rejected by their mail server. The address may not exist.",
      canRetry: false,
    };
  }

  // ── Mailbox disabled ──────────────────────────────────────────────────────
  if (
    msg.includes("mailbox disabled") ||
    msg.includes("account suspended") ||
    msg.includes("account disabled") ||
    msg.includes("5.2.1")
  ) {
    return {
      category: "mailbox_disabled",
      friendlyTitle: "Recipient Mailbox Disabled",
      friendlyMessage:
        "The recipient's mailbox has been disabled or suspended by their mail provider.",
      canRetry: false,
    };
  }

  // ── DNS errors ────────────────────────────────────────────────────────────
  if (
    msg.includes("enotfound") ||
    msg.includes("getaddrinfo") ||
    msg.includes("nxdomain") ||
    (msg.includes("dns") && msg.includes("fail"))
  ) {
    return {
      category: "dns",
      friendlyTitle: "DNS Error",
      friendlyMessage:
        "Could not resolve the mail server hostname. Check that the SMTP host in your mailbox settings is correct.",
      recoveryAction: "Go to Mailbox Settings",
      recoveryRoute: "/mailbox",
      canRetry: true,
    };
  }

  // ── SMTP connection errors ────────────────────────────────────────────────
  if (
    msg.includes("econnrefused") ||
    msg.includes("connection refused") ||
    msg.includes("connect etimedout") ||
    msg.includes("econnreset")
  ) {
    return {
      category: "smtp_connection",
      friendlyTitle: "SMTP Connection Failed",
      friendlyMessage:
        "Could not connect to the mail server. The server may be down or the host/port settings may be incorrect.",
      recoveryAction: "Go to Mailbox Settings",
      recoveryRoute: "/mailbox",
      canRetry: true,
    };
  }

  // ── Timeout ───────────────────────────────────────────────────────────────
  if (
    msg.includes("timeout") ||
    msg.includes("esocket") ||
    msg.includes("timed out")
  ) {
    return {
      category: "timeout",
      friendlyTitle: "Connection Timeout",
      friendlyMessage:
        "The mail server did not respond in time. This is usually a temporary issue — retrying should work.",
      canRetry: true,
    };
  }

  // ── Network ───────────────────────────────────────────────────────────────
  if (
    msg.includes("enetunreach") ||
    msg.includes("ehostunreach") ||
    msg.includes("network error")
  ) {
    return {
      category: "network",
      friendlyTitle: "Network Error",
      friendlyMessage:
        "A network error occurred. Please check your internet connection and try again.",
      canRetry: true,
    };
  }

  // ── Unknown ───────────────────────────────────────────────────────────────
  return {
    category: "unknown",
    friendlyTitle: "Send Failed",
    friendlyMessage: raw || "An unknown error occurred.",
    canRetry: true,
  };
}

export function isGmailAuthError(err: Error | string): boolean {
  return classifyError(err).category === "auth_gmail";
}

export function isSmtpAuthError(err: Error | string): boolean {
  return classifyError(err).category === "auth_smtp";
}

export function isAuthError(err: Error | string): boolean {
  const c = classifyError(err).category;
  return c === "auth_gmail" || c === "auth_smtp";
}
