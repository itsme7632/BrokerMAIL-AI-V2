/**
 * Frontend error classification for send failures.
 * Mirrors the backend error-classifier but runs in the browser.
 */

export type ErrorCategory =
  | "auth_gmail"
  | "auth_smtp"
  | "rate_limit"
  | "invalid_recipient"
  | "mailbox_disabled"
  | "smtp_connection"
  | "dns"
  | "timeout"
  | "network"
  | "unknown";

export interface SendErrorDetail {
  category: ErrorCategory;
  title: string;
  message: string;
  recoveryAction?: string;
  recoveryRoute?: string;
  canRetry: boolean;
}

export function classifySendError(errMessage: string): SendErrorDetail {
  const msg = errMessage.toLowerCase();

  if (
    msg.includes("invalid_grant") ||
    msg.includes("token has been expired") ||
    msg.includes("token_revoked") ||
    msg.includes("invalid credentials") ||
    msg.includes("gmail authorization") ||
    msg.includes("reconnect your gmail") ||
    msg.includes("gmail not connected")
  ) {
    return {
      category: "auth_gmail",
      title: "Gmail Authorization Expired",
      message:
        "Your Gmail authorization has expired. Please reconnect your Gmail account to continue sending.",
      recoveryAction: "Reconnect Gmail",
      recoveryRoute: "/settings",
      canRetry: false,
    };
  }

  if (
    msg.includes("eauth") ||
    msg.includes("authentication failed") ||
    msg.includes("smtp authentication") ||
    msg.includes("invalid login") ||
    msg.includes("535") ||
    msg.includes("username and password")
  ) {
    return {
      category: "auth_smtp",
      title: "SMTP Authentication Failed",
      message:
        "SMTP authentication failed. Possible causes: wrong username, wrong password, or the mail server rejected the login.",
      recoveryAction: "Go to Mailbox Settings",
      recoveryRoute: "/mailbox",
      canRetry: false,
    };
  }

  if (
    msg.includes("rate limit") ||
    msg.includes("quota") ||
    msg.includes("too many") ||
    msg.includes("hourly limit") ||
    msg.includes("daily limit")
  ) {
    return {
      category: "rate_limit",
      title: "Rate Limit Reached",
      message: "Your email provider is rate-limiting sends. Wait a moment and try again.",
      canRetry: true,
    };
  }

  if (
    msg.includes("no such user") ||
    msg.includes("invalid address") ||
    msg.includes("does not exist") ||
    msg.includes("5.1.1")
  ) {
    return {
      category: "invalid_recipient",
      title: "Invalid Recipient",
      message: "The recipient's email address was rejected. The address may not exist.",
      canRetry: false,
    };
  }

  if (msg.includes("enotfound") || msg.includes("getaddrinfo")) {
    return {
      category: "dns",
      title: "DNS Error",
      message: "Could not resolve the mail server. Check your mailbox SMTP settings.",
      recoveryAction: "Go to Mailbox Settings",
      recoveryRoute: "/mailbox",
      canRetry: true,
    };
  }

  if (
    msg.includes("econnrefused") ||
    msg.includes("connection refused") ||
    msg.includes("econnreset")
  ) {
    return {
      category: "smtp_connection",
      title: "Connection Failed",
      message: "Could not connect to the mail server. The server may be down or misconfigured.",
      recoveryAction: "Go to Mailbox Settings",
      recoveryRoute: "/mailbox",
      canRetry: true,
    };
  }

  if (msg.includes("timeout") || msg.includes("timed out")) {
    return {
      category: "timeout",
      title: "Connection Timeout",
      message: "The mail server did not respond in time. This is usually temporary.",
      canRetry: true,
    };
  }

  return {
    category: "unknown",
    title: "Send Failed",
    message: errMessage || "An unknown error occurred. Please try again.",
    canRetry: true,
  };
}
