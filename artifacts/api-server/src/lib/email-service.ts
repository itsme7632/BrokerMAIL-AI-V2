/**
 * Transactional email service for BrokerMAIL AI.
 *
 * Provider: Resend (https://resend.com)
 * Requires: RESEND_API_KEY env var
 * From address: configure RESEND_FROM (defaults to "BrokerMAIL AI <noreply@brokermail.ai>")
 *
 * Dev fallback: when RESEND_API_KEY is absent, emails are logged to stdout instead of sent.
 *
 * NOTE: Campaign emails go through per-user Gmail/SMTP mailboxes (smtp.ts). This service
 * is ONLY for system-generated transactional emails (auth, billing, security).
 */
import { Resend } from "resend";
import { logger } from "./logger";

// ─── Provider singleton ───────────────────────────────────────────────────────

let _resend: Resend | null = null;

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  if (!_resend) _resend = new Resend(key);
  return _resend;
}

function getFromAddress(): string {
  return process.env.RESEND_FROM ?? "BrokerMAIL AI <noreply@brokermail.ai>";
}

// ─── HTML escaping ────────────────────────────────────────────────────────────

/** Escape user-controlled strings before embedding them in HTML email templates. */
function escHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ─── Core send function ───────────────────────────────────────────────────────

export interface TransactionalEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export async function sendTransactionalEmail(opts: TransactionalEmail): Promise<void> {
  const resend = getResend();
  const isProd = process.env.NODE_ENV === "production";

  if (!resend) {
    if (isProd) {
      // Hard failure in production: a missing API key must never silently drop auth emails.
      throw new Error(
        "[EmailService] RESEND_API_KEY is not set. Cannot send transactional email in production.",
      );
    }
    // Dev/test: log so developers can still test reset flows without a real key.
    logger.warn(
      { to: opts.to, subject: opts.subject },
      "[EmailService] RESEND_API_KEY not set — logging email instead of sending.",
    );
    logger.info(
      { to: opts.to, subject: opts.subject, body: opts.text },
      "[EmailService] DEV: would-be email body",
    );
    return;
  }

  let data: { id?: string } | null = null;
  let resendError: { message: string; name: string } | null = null;

  try {
    const result = await resend.emails.send({
      from:    getFromAddress(),
      to:      opts.to,
      subject: opts.subject,
      html:    opts.html,
      text:    opts.text,
    });
    data        = result.data;
    resendError = result.error;
  } catch (sdkErr: unknown) {
    // Network errors, TLS failures, or unexpected SDK throws
    const message = sdkErr instanceof Error ? sdkErr.message : String(sdkErr);
    logger.error({ to: opts.to, subject: opts.subject, sdkErr }, "[EmailService] SDK/network error");
    throw new Error(`[EmailService] Failed to reach Resend: ${message}`);
  }

  if (resendError) {
    logger.error(
      { to: opts.to, subject: opts.subject, resendError },
      "[EmailService] Resend API error",
    );
    throw new Error(`[EmailService] Resend rejected the request: ${resendError.message}`);
  }

  logger.info({ to: opts.to, subject: opts.subject, messageId: data?.id }, "[EmailService] Sent via Resend");
}

// ─── Typed template builders ──────────────────────────────────────────────────

/**
 * Password reset email — sent when a user requests a password reset or when
 * an admin triggers one on their behalf.
 */
export function buildPasswordResetEmail(name: string, resetUrl: string): { html: string; text: string } {
  const year  = new Date().getFullYear();
  const eName = escHtml(name);
  const eUrl  = escHtml(resetUrl);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Reset your password</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:48px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

        <!-- Header -->
        <tr>
          <td align="center" style="padding-bottom:32px;">
            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="background:#1d4ed8;border-radius:12px;padding:10px 20px;">
                  <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:-0.3px;">BrokerMAIL AI</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Card -->
        <tr>
          <td style="background:#ffffff;border-radius:16px;padding:40px 40px 36px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">

            <!-- Lock icon -->
            <p style="margin:0 0 24px;text-align:center;">
              <span style="display:inline-flex;align-items:center;justify-content:center;width:56px;height:56px;background:#eff6ff;border-radius:14px;font-size:28px;">🔐</span>
            </p>

            <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0f172a;text-align:center;">Reset your password</h1>
            <p style="margin:0 0 28px;font-size:15px;color:#64748b;text-align:center;line-height:1.6;">
              Hi ${eName}, we received a request to reset your BrokerMAIL AI password.
              Click the button below to choose a new one.
            </p>

            <!-- CTA button -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
              <tr>
                <td align="center">
                  <a href="${eUrl}"
                     style="display:inline-block;background:#1d4ed8;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:10px;padding:14px 32px;letter-spacing:-0.1px;">
                    Reset Password
                  </a>
                </td>
              </tr>
            </table>

            <!-- Expiry notice -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:10px;margin-bottom:24px;">
              <tr>
                <td style="padding:14px 18px;">
                  <p style="margin:0;font-size:13px;color:#64748b;line-height:1.5;">
                    ⏱ <strong>This link expires in 60 minutes</strong> and can only be used once.
                  </p>
                </td>
              </tr>
            </table>

            <!-- Fallback URL -->
            <p style="margin:0 0 8px;font-size:12px;color:#94a3b8;text-align:center;line-height:1.5;">
              If the button doesn't work, copy and paste this URL into your browser:
            </p>
            <p style="margin:0 0 24px;font-size:11px;color:#94a3b8;text-align:center;word-break:break-all;">
              ${eUrl}
            </p>

            <!-- Didn't request this -->
            <p style="margin:0;font-size:13px;color:#94a3b8;text-align:center;line-height:1.5;">
              If you didn't request a password reset, you can safely ignore this email.
              Your password will remain unchanged.
            </p>

          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td align="center" style="padding-top:24px;">
            <p style="margin:0;font-size:12px;color:#94a3b8;">
              © ${year} BrokerMAIL AI · AI-powered outreach for auto transport brokers
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `Hi ${name},

We received a request to reset your BrokerMAIL AI password.

Reset your password here:
${resetUrl}

This link expires in 60 minutes and can only be used once.

If you didn't request this, you can safely ignore this email.

— BrokerMAIL AI Team`;

  return { html, text };
}

/**
 * Welcome email — sent after a new user registers.
 * Extend as needed (onboarding tips, verification link, etc.)
 */
export function buildWelcomeEmail(name: string, loginUrl: string): { html: string; text: string } {
  const year   = new Date().getFullYear();
  const eName  = escHtml(name);
  const eUrl   = escHtml(loginUrl);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Welcome to BrokerMAIL AI</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:48px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

        <tr>
          <td align="center" style="padding-bottom:32px;">
            <table cellpadding="0" cellspacing="0"><tr>
              <td style="background:#1d4ed8;border-radius:12px;padding:10px 20px;">
                <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:-0.3px;">BrokerMAIL AI</span>
              </td>
            </tr></table>
          </td>
        </tr>

        <tr>
          <td style="background:#ffffff;border-radius:16px;padding:40px 40px 36px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
            <p style="margin:0 0 24px;text-align:center;">
              <span style="font-size:40px;">🚀</span>
            </p>
            <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0f172a;text-align:center;">Welcome, ${eName}!</h1>
            <p style="margin:0 0 28px;font-size:15px;color:#64748b;text-align:center;line-height:1.6;">
              Your BrokerMAIL AI account is ready. Start connecting your mailbox and
              launching AI-powered outreach campaigns for your auto transport brokerage.
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
              <tr>
                <td align="center">
                  <a href="${eUrl}"
                     style="display:inline-block;background:#1d4ed8;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:10px;padding:14px 32px;">
                    Go to Dashboard
                  </a>
                </td>
              </tr>
            </table>
            <p style="margin:0;font-size:13px;color:#94a3b8;text-align:center;line-height:1.5;">
              Questions? Reply to this email and we'll be happy to help.
            </p>
          </td>
        </tr>

        <tr>
          <td align="center" style="padding-top:24px;">
            <p style="margin:0;font-size:12px;color:#94a3b8;">
              © ${year} BrokerMAIL AI · AI-powered outreach for auto transport brokers
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `Welcome to BrokerMAIL AI, ${name}!

Your account is ready. Start connecting your mailbox and launching campaigns.

Go to your dashboard: ${loginUrl}

Questions? Just reply to this email.

— BrokerMAIL AI Team`;

  return { html, text };
}

/**
 * Security alert email — sent when a significant account event occurs
 * (e.g. password changed, new login from unknown location).
 */
export function buildSecurityAlertEmail(
  name: string,
  event: string,
  details: string,
  timestamp: Date,
): { html: string; text: string } {
  const year          = new Date().getFullYear();
  const formattedTime = timestamp.toUTCString();
  const eName         = escHtml(name);
  const eEvent        = escHtml(event);
  const eDetails      = escHtml(details);
  const eTime         = escHtml(formattedTime);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Security Alert</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:48px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

        <tr>
          <td align="center" style="padding-bottom:32px;">
            <table cellpadding="0" cellspacing="0"><tr>
              <td style="background:#1d4ed8;border-radius:12px;padding:10px 20px;">
                <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:-0.3px;">BrokerMAIL AI</span>
              </td>
            </tr></table>
          </td>
        </tr>

        <tr>
          <td style="background:#ffffff;border-radius:16px;padding:40px 40px 36px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
            <p style="margin:0 0 24px;text-align:center;">
              <span style="display:inline-flex;align-items:center;justify-content:center;width:56px;height:56px;background:#fef2f2;border-radius:14px;font-size:28px;">🔔</span>
            </p>
            <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0f172a;text-align:center;">Security Alert</h1>
            <p style="margin:0 0 28px;font-size:15px;color:#64748b;text-align:center;line-height:1.6;">
              Hi ${eName}, we detected a security event on your account.
            </p>

            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:10px;margin-bottom:24px;">
              <tr>
                <td style="padding:18px 20px;">
                  <p style="margin:0 0 6px;font-size:14px;font-weight:600;color:#0f172a;">${eEvent}</p>
                  <p style="margin:0 0 6px;font-size:13px;color:#64748b;line-height:1.5;">${eDetails}</p>
                  <p style="margin:0;font-size:12px;color:#94a3b8;">${eTime}</p>
                </td>
              </tr>
            </table>

            <p style="margin:0;font-size:13px;color:#94a3b8;text-align:center;line-height:1.5;">
              If this wasn't you, please reset your password immediately and contact support.
            </p>
          </td>
        </tr>

        <tr>
          <td align="center" style="padding-top:24px;">
            <p style="margin:0;font-size:12px;color:#94a3b8;">
              © ${year} BrokerMAIL AI · AI-powered outreach for auto transport brokers
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `Hi ${name},

Security Alert: ${event}
${details}
Time: ${formattedTime}

If this wasn't you, please reset your password immediately.

— BrokerMAIL AI Team`;

  return { html, text };
}
