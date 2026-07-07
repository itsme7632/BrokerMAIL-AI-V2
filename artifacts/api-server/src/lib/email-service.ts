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
      throw new Error(
        "[EmailService] RESEND_API_KEY is not set. Cannot send transactional email in production.",
      );
    }
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
    const message = sdkErr instanceof Error ? sdkErr.message : String(sdkErr);
    logger.error({ to: opts.to, subject: opts.subject, sdkErr }, "[EmailService] SDK/network error");
    throw new Error(`[EmailService] Failed to reach Resend: ${message}`);
  }

  if (resendError) {
    logger.error({ to: opts.to, subject: opts.subject, resendError }, "[EmailService] Resend API error");
    throw new Error(`[EmailService] Resend rejected the request: ${resendError.message}`);
  }

  logger.info({ to: opts.to, subject: opts.subject, messageId: data?.id }, "[EmailService] Sent via Resend");
}

// ─── Shared layout helpers ────────────────────────────────────────────────────

function emailHeader(): string {
  return `
    <tr>
      <td align="center" style="padding-bottom:32px;">
        <table cellpadding="0" cellspacing="0">
          <tr>
            <td style="background:linear-gradient(135deg,#1d4ed8,#2563eb);border-radius:12px;padding:10px 22px;">
              <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:-0.3px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">BrokerMAIL AI</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

function emailFooter(year: number): string {
  return `
    <tr>
      <td align="center" style="padding-top:28px;">
        <p style="margin:0 0 6px;font-size:12px;color:#94a3b8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
          © ${year} BrokerMAIL AI · AI-powered outreach for auto transport brokers
        </p>
        <p style="margin:0;font-size:12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
          <a href="mailto:support@brokermail.ai" style="color:#94a3b8;text-decoration:none;">support@brokermail.ai</a>
        </p>
      </td>
    </tr>`;
}

function emailWrapper(content: string, year: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:48px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
        ${emailHeader()}
        ${content}
        ${emailFooter(year)}
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── Email Verification ───────────────────────────────────────────────────────

/**
 * Verification email — sent on registration and on every resend.
 * The code is displayed prominently with individual digit boxes.
 */
export function buildVerificationEmail(name: string, code: string): { html: string; text: string } {
  const year    = new Date().getFullYear();
  const eName   = escHtml(name);
  const digits  = code.split("").map(escHtml);

  const digitCells = digits.map(d =>
    `<td style="width:52px;height:64px;background:#eff6ff;border:2px solid #bfdbfe;border-radius:12px;
               font-size:30px;font-weight:800;color:#1d4ed8;text-align:center;vertical-align:middle;
               font-family:'Courier New',Courier,monospace;" align="center">${d}</td>
     <td style="width:6px;"></td>`,
  ).join("");

  const html = emailWrapper(`
    <tr>
      <td style="background:#ffffff;border-radius:16px;padding:40px 40px 36px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">

        <p style="margin:0 0 20px;text-align:center;">
          <span style="display:inline-block;width:56px;height:56px;background:#eff6ff;border-radius:14px;
                       font-size:28px;text-align:center;line-height:56px;">✉️</span>
        </p>

        <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0f172a;text-align:center;">
          Verify your email address
        </h1>
        <p style="margin:0 0 28px;font-size:15px;color:#64748b;text-align:center;line-height:1.6;">
          Hi ${eName}, enter the code below to verify your BrokerMAIL AI account.
        </p>

        <!-- Code display -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
          <tr>
            <td align="center">
              <table cellpadding="0" cellspacing="0">
                <tr>${digitCells}</tr>
              </table>
            </td>
          </tr>
        </table>

        <!-- Expiry notice -->
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#fefce8;border:1px solid #fde68a;border-radius:10px;margin-bottom:24px;">
          <tr>
            <td style="padding:12px 16px;">
              <p style="margin:0;font-size:13px;color:#92400e;line-height:1.5;text-align:center;">
                ⏱ <strong>This code expires in 10 minutes</strong> and can only be used once.
              </p>
            </td>
          </tr>
        </table>

        <!-- Security notice -->
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:10px;margin-bottom:8px;">
          <tr>
            <td style="padding:14px 18px;">
              <p style="margin:0;font-size:13px;color:#64748b;line-height:1.5;">
                🔒 <strong>Security tip:</strong> BrokerMAIL AI will never ask for this code via phone or chat.
                If you didn't create an account, you can safely ignore this email.
              </p>
            </td>
          </tr>
        </table>

      </td>
    </tr>`, year);

  const text = `Hi ${name},

Verify your BrokerMAIL AI email address.

Your verification code: ${code}

Enter this code on the verification page. It expires in 10 minutes and can only be used once.

If you didn't create a BrokerMAIL AI account, you can safely ignore this email.

— BrokerMAIL AI Team
support@brokermail.ai`;

  return { html, text };
}

// ─── Welcome Email ────────────────────────────────────────────────────────────

/**
 * Welcome email — sent after successful email verification.
 * Includes a Getting Started checklist with the first item already checked.
 */
export function buildWelcomeEmail(name: string, dashboardUrl: string): { html: string; text: string } {
  const year  = new Date().getFullYear();
  const eName = escHtml(name);
  const eUrl  = escHtml(dashboardUrl);

  const checkItem = (checked: boolean, label: string) => `
    <tr>
      <td style="padding:5px 0;">
        <table cellpadding="0" cellspacing="0">
          <tr>
            <td style="width:24px;vertical-align:top;padding-top:1px;">
              <span style="font-size:14px;">${checked ? "✅" : "⬜"}</span>
            </td>
            <td style="font-size:13px;color:${checked ? "#64748b" : "#374151"};
                       text-decoration:${checked ? "line-through" : "none"};
                       font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
                       padding-left:6px;">
              ${label}
            </td>
          </tr>
        </table>
      </td>
    </tr>`;

  const html = emailWrapper(`
    <tr>
      <td style="background:#ffffff;border-radius:16px;padding:40px 40px 36px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">

        <p style="margin:0 0 20px;text-align:center;font-size:40px;">🎉</p>

        <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0f172a;text-align:center;">
          Welcome to BrokerMAIL AI, ${eName}!
        </h1>
        <p style="margin:0 0 28px;font-size:15px;color:#64748b;text-align:center;line-height:1.6;">
          Your email is verified and your account is ready. Start connecting your mailbox
          and launching AI-powered outreach campaigns for your auto transport brokerage.
        </p>

        <!-- Getting Started checklist -->
        <table width="100%" cellpadding="0" cellspacing="0"
               style="background:#f8fafc;border-radius:12px;margin-bottom:28px;">
          <tr>
            <td style="padding:18px 22px;">
              <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#0f172a;
                         text-transform:uppercase;letter-spacing:0.5px;">
                Getting Started
              </p>
              <table width="100%" cellpadding="0" cellspacing="0">
                ${checkItem(true,  "Verify Email")}
                ${checkItem(false, "Connect Gmail or SMTP mailbox")}
                ${checkItem(false, "Upload your leads")}
                ${checkItem(false, "Create your first campaign")}
                ${checkItem(false, "Send your first outreach batch")}
              </table>
            </td>
          </tr>
        </table>

        <!-- CTA -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
          <tr>
            <td align="center">
              <a href="${eUrl}"
                 style="display:inline-block;background:linear-gradient(135deg,#1d4ed8,#2563eb);
                        color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;
                        border-radius:10px;padding:14px 40px;letter-spacing:-0.1px;">
                Go to Dashboard →
              </a>
            </td>
          </tr>
        </table>

        <p style="margin:0;font-size:13px;color:#94a3b8;text-align:center;line-height:1.5;">
          Questions? Reply to this email or contact
          <a href="mailto:support@brokermail.ai" style="color:#64748b;">support@brokermail.ai</a>
        </p>

      </td>
    </tr>`, year);

  const text = `Welcome to BrokerMAIL AI, ${name}! 🎉

Your email is verified and your account is ready.

Getting Started:
✅ Verify Email
⬜ Connect Gmail or SMTP mailbox
⬜ Upload your leads
⬜ Create your first campaign
⬜ Send your first outreach batch

Go to your dashboard: ${dashboardUrl}

Questions? Reply to this email or contact support@brokermail.ai

— BrokerMAIL AI Team`;

  return { html, text };
}

// ─── Password Reset ───────────────────────────────────────────────────────────

/**
 * Password reset email — sent when a user requests a password reset or when
 * an admin triggers one on their behalf.
 */
export function buildPasswordResetEmail(name: string, resetUrl: string): { html: string; text: string } {
  const year  = new Date().getFullYear();
  const eName = escHtml(name);
  const eUrl  = escHtml(resetUrl);

  const html = emailWrapper(`
    <tr>
      <td style="background:#ffffff;border-radius:16px;padding:40px 40px 36px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">

        <p style="margin:0 0 20px;text-align:center;">
          <span style="display:inline-block;width:56px;height:56px;background:#eff6ff;border-radius:14px;
                       font-size:28px;text-align:center;line-height:56px;">🔐</span>
        </p>

        <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0f172a;text-align:center;">
          Reset your password
        </h1>
        <p style="margin:0 0 28px;font-size:15px;color:#64748b;text-align:center;line-height:1.6;">
          Hi ${eName}, we received a request to reset your BrokerMAIL AI password.
          Click the button below to choose a new one.
        </p>

        <!-- CTA button -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
          <tr>
            <td align="center">
              <a href="${eUrl}"
                 style="display:inline-block;background:linear-gradient(135deg,#1d4ed8,#2563eb);
                        color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;
                        border-radius:10px;padding:14px 40px;letter-spacing:-0.1px;">
                Reset Password
              </a>
            </td>
          </tr>
        </table>

        <!-- Expiry notice -->
        <table width="100%" cellpadding="0" cellspacing="0"
               style="background:#fefce8;border:1px solid #fde68a;border-radius:10px;margin-bottom:20px;">
          <tr>
            <td style="padding:12px 16px;">
              <p style="margin:0;font-size:13px;color:#92400e;line-height:1.5;text-align:center;">
                ⏱ <strong>This link expires in 60 minutes</strong> and can only be used once.
              </p>
            </td>
          </tr>
        </table>

        <!-- Fallback URL -->
        <p style="margin:0 0 6px;font-size:12px;color:#94a3b8;text-align:center;">
          If the button doesn't work, copy and paste this URL:
        </p>
        <p style="margin:0 0 20px;font-size:11px;color:#94a3b8;text-align:center;word-break:break-all;">
          ${eUrl}
        </p>

        <!-- Security notice -->
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:10px;">
          <tr>
            <td style="padding:14px 18px;">
              <p style="margin:0;font-size:13px;color:#64748b;line-height:1.5;text-align:center;">
                🔒 If you didn't request a password reset, you can safely ignore this email.
                Your password will remain unchanged.
              </p>
            </td>
          </tr>
        </table>

      </td>
    </tr>`, year);

  const text = `Hi ${name},

We received a request to reset your BrokerMAIL AI password.

Reset your password here:
${resetUrl}

This link expires in 60 minutes and can only be used once.

If you didn't request this, you can safely ignore this email.

— BrokerMAIL AI Team
support@brokermail.ai`;

  return { html, text };
}

// ─── Password Changed ─────────────────────────────────────────────────────────

/**
 * Password changed confirmation email — sent after a successful password reset.
 * Includes timestamp, IP, and device info if available.
 */
export function buildPasswordChangedEmail(
  name: string,
  timestamp: Date,
  ip?: string | null,
  device?: string | null,
): { html: string; text: string } {
  const year         = new Date().getFullYear();
  const eName        = escHtml(name);
  const formattedAt  = timestamp.toUTCString();
  const eTime        = escHtml(formattedAt);
  const eIp          = ip     ? escHtml(ip)     : null;
  const eDevice      = device ? escHtml(device) : null;

  const detailRows = [
    ["Time",   eTime],
    ...(eIp     ? [["IP Address", eIp]]     : []),
    ...(eDevice ? [["Device",     eDevice]] : []),
  ].map(([label, value]) => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-size:13px;font-weight:600;color:#374151;width:100px;
                       font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
              ${label}
            </td>
            <td style="font-size:13px;color:#64748b;
                       font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
              ${value}
            </td>
          </tr>
        </table>
      </td>
    </tr>`).join("");

  const html = emailWrapper(`
    <tr>
      <td style="background:#ffffff;border-radius:16px;padding:40px 40px 36px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">

        <p style="margin:0 0 20px;text-align:center;">
          <span style="display:inline-block;width:56px;height:56px;background:#f0fdf4;border-radius:14px;
                       font-size:28px;text-align:center;line-height:56px;">🛡️</span>
        </p>

        <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0f172a;text-align:center;">
          Password Changed
        </h1>
        <p style="margin:0 0 28px;font-size:15px;color:#64748b;text-align:center;line-height:1.6;">
          Hi ${eName}, your BrokerMAIL AI password was successfully changed.
        </p>

        <!-- Details table -->
        <table width="100%" cellpadding="0" cellspacing="0"
               style="background:#f8fafc;border-radius:12px;margin-bottom:24px;">
          <tr>
            <td style="padding:16px 20px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                ${detailRows}
              </table>
            </td>
          </tr>
        </table>

        <!-- Security notice -->
        <table width="100%" cellpadding="0" cellspacing="0"
               style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;margin-bottom:16px;">
          <tr>
            <td style="padding:14px 18px;">
              <p style="margin:0;font-size:13px;color:#991b1b;line-height:1.5;text-align:center;">
                🚨 <strong>Didn't make this change?</strong> Reset your password immediately and
                contact <a href="mailto:support@brokermail.ai" style="color:#991b1b;">support@brokermail.ai</a>
              </p>
            </td>
          </tr>
        </table>

      </td>
    </tr>`, year);

  const text = `Hi ${name},

Your BrokerMAIL AI password was successfully changed.

Time: ${formattedAt}
${ip ? `IP Address: ${ip}\n` : ""}${device ? `Device: ${device}\n` : ""}
If you didn't make this change, reset your password immediately and contact support@brokermail.ai

— BrokerMAIL AI Team`;

  return { html, text };
}

// ─── Security Alert ───────────────────────────────────────────────────────────

/**
 * Security alert email — sent when a significant account event occurs.
 */
export function buildSecurityAlertEmail(
  name: string,
  event: string,
  details: string,
  timestamp: Date,
): { html: string; text: string } {
  const year         = new Date().getFullYear();
  const eName        = escHtml(name);
  const eEvent       = escHtml(event);
  const eDetails     = escHtml(details);
  const formattedAt  = timestamp.toUTCString();
  const eTime        = escHtml(formattedAt);

  const html = emailWrapper(`
    <tr>
      <td style="background:#ffffff;border-radius:16px;padding:40px 40px 36px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">

        <p style="margin:0 0 20px;text-align:center;">
          <span style="display:inline-block;width:56px;height:56px;background:#fef2f2;border-radius:14px;
                       font-size:28px;text-align:center;line-height:56px;">🔔</span>
        </p>

        <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0f172a;text-align:center;">
          Security Alert
        </h1>
        <p style="margin:0 0 28px;font-size:15px;color:#64748b;text-align:center;line-height:1.6;">
          Hi ${eName}, we detected a security event on your account.
        </p>

        <table width="100%" cellpadding="0" cellspacing="0"
               style="background:#f8fafc;border-radius:10px;margin-bottom:24px;">
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
    </tr>`, year);

  const text = `Hi ${name},

Security Alert: ${event}
${details}
Time: ${formattedAt}

If this wasn't you, please reset your password immediately.

— BrokerMAIL AI Team`;

  return { html, text };
}
