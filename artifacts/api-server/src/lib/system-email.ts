/**
 * Transactional email sender for system-generated emails (password reset, etc.)
 * Configure via env vars: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_SECURE
 */
import nodemailer from "nodemailer";
import { logger } from "./logger";

function getSystemTransport() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;

  const port   = parseInt(process.env.SMTP_PORT ?? "587", 10);
  const secure = process.env.SMTP_SECURE === "true" || port === 465;

  // Only bypass certificate validation in non-production environments.
  // In production, require a valid TLS chain to prevent MITM on reset emails.
  const isDev = process.env.NODE_ENV !== "production";

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    tls: { rejectUnauthorized: !isDev },
    connectionTimeout: 20_000,
    greetingTimeout:   30_000,
  });
}

export interface SystemEmailOptions {
  to:      string;
  subject: string;
  html:    string;
  text:    string;
}

export async function sendSystemEmail(opts: SystemEmailOptions): Promise<void> {
  const fromEmail = process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "noreply@brokermail.ai";
  const transport = getSystemTransport();

  if (!transport) {
    logger.warn(
      { to: opts.to, subject: opts.subject },
      "[SystemEmail] No system SMTP configured — set SMTP_HOST, SMTP_USER, SMTP_PASS env vars. Email NOT sent.",
    );
    // In dev, log the email body so developers can still test reset flows
    if (process.env.NODE_ENV !== "production") {
      logger.info({ to: opts.to, subject: opts.subject, body: opts.text }, "[SystemEmail] DEV: would-be email body");
    }
    return;
  }

  try {
    await transport.sendMail({
      from:    `"BrokerMAIL AI" <${fromEmail}>`,
      to:      opts.to,
      subject: opts.subject,
      html:    opts.html,
      text:    opts.text,
    });
    logger.info({ to: opts.to, subject: opts.subject }, "[SystemEmail] Sent successfully");
  } finally {
    transport.close?.();
  }
}

// ─── Branded email templates ──────────────────────────────────────────────────

export function buildPasswordResetEmail(name: string, resetUrl: string): { html: string; text: string } {
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
              Hi ${name}, we received a request to reset your BrokerMAIL AI password.
              Click the button below to choose a new one.
            </p>

            <!-- CTA button -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
              <tr>
                <td align="center">
                  <a href="${resetUrl}"
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
              ${resetUrl}
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
              © ${new Date().getFullYear()} BrokerMAIL AI · AI-powered outreach for auto transport brokers
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
