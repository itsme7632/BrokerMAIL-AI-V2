import nodemailer, { type Transporter } from "nodemailer";
import net from "net";
import type { Mailbox } from "@workspace/db";
import { decrypt } from "./crypto";
import { logger } from "./logger";

export interface SmtpCredentials {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassEncrypted: string;
  smtpSecure: string;
}

// ─── Transporter config ───────────────────────────────────────────────────────

function buildTransportOptions(creds: SmtpCredentials, rawPass?: string) {
  const pass  = rawPass ?? decrypt(creds.smtpPassEncrypted);
  const isSSL = creds.smtpSecure === "ssl";
  const isTLS = creds.smtpSecure === "tls";
  return {
    host:               creds.smtpHost,
    port:               creds.smtpPort,
    secure:             isSSL,   // true = implicit TLS from start (port 465)
    requireTLS:         isTLS,   // true = STARTTLS upgrade required (port 587)
    auth:               { user: creds.smtpUser, pass },
    tls:                { rejectUnauthorized: false },
    connectionTimeout:  20_000,  // ms to establish TCP connection
    greetingTimeout:    30_000,  // ms to wait for SMTP greeting after connect
    socketTimeout:      60_000,  // ms inactivity before socket is killed
  } as const;
}

/** Log the full transporter config (password masked) for diagnostics. */
function logTransportConfig(label: string, creds: SmtpCredentials) {
  const isSSL = creds.smtpSecure === "ssl";
  const isTLS = creds.smtpSecure === "tls";
  logger.info({
    label,
    host:               creds.smtpHost,
    port:               creds.smtpPort,
    smtpUser:           creds.smtpUser,
    smtpSecure:         creds.smtpSecure,
    secure:             isSSL,
    requireTLS:         isTLS,
    connectionTimeout:  20_000,
    greetingTimeout:    30_000,
    socketTimeout:      60_000,
    rejectUnauthorized: false,
  }, `[SMTP] 4. Transporter config — label=${label} (password masked)`);

  // GoDaddy / Microsoft 365 detection
  const host = creds.smtpHost.toLowerCase();
  const isM365    = host.includes("office365") || host.includes("outlook.com");
  const isGoDaddy = host.includes("godaddy") || host.includes("secureserver") || host.includes("workspace365");
  if (isGoDaddy && !isM365) {
    logger.warn({
      currentHost: creds.smtpHost,
      recommended: { host: "smtp.office365.com", port: 587, encryption: "tls" },
    }, "[SMTP] GoDaddy Microsoft 365 detected — recommended: smtp.office365.com:587 TLS");
  }
  if (isM365 && (creds.smtpPort !== 587 || creds.smtpSecure !== "tls")) {
    logger.warn({
      currentPort:   creds.smtpPort,
      currentSecure: creds.smtpSecure,
      recommended:   { host: "smtp.office365.com", port: 587, encryption: "tls" },
    }, "[SMTP] Office 365 host but port/encryption may be wrong — recommended: port 587, TLS");
  }
}

// ─── TCP preflight (diagnostic only — used in testSmtp, NOT in sendEmail) ────

function tcpConnect(host: string, port: number, timeoutMs = 10_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const timer  = setTimeout(() => {
      socket.destroy();
      reject(new Error(`TCP preflight timed out connecting to ${host}:${port} after ${timeoutMs}ms`));
    }, timeoutMs);
    socket.once("connect", () => { clearTimeout(timer); socket.destroy(); resolve(); });
    socket.once("error",   (err) => { clearTimeout(timer); reject(err); });
  });
}

// ─── Nodemailer debug logger ──────────────────────────────────────────────────

function makeSmtpLogger(prefix: string) {
  return {
    level()                          { return true; },
    trace(msg: string, ...a: any[]) { logger.debug({ smtpTrace: true }, `${prefix} TRACE: ${msg} ${a.join(" ")}`); },
    debug(msg: string, ...a: any[]) { logger.debug({ smtpTrace: true }, `${prefix} DEBUG: ${msg} ${a.join(" ")}`); },
    info(msg: string,  ...a: any[]) { logger.info({ smtpTrace: true },  `${prefix} INFO:  ${msg} ${a.join(" ")}`); },
    warn(msg: string,  ...a: any[]) { logger.warn({ smtpTrace: true },  `${prefix} WARN:  ${msg} ${a.join(" ")}`); },
    error(msg: string, ...a: any[]) { logger.error({ smtpTrace: true }, `${prefix} ERROR: ${msg} ${a.join(" ")}`); },
    fatal(msg: string, ...a: any[]) { logger.error({ smtpTrace: true }, `${prefix} FATAL: ${msg} ${a.join(" ")}`); },
  };
}

// ─── Error mapping ────────────────────────────────────────────────────────────

/**
 * Log the raw error with full detail first, then return a user-friendly version.
 * The raw code and message are attached as .rawCode / .rawMsg so callers can
 * still inspect them.
 */
function friendlySmtpError(err: unknown, context: Record<string, unknown> = {}): Error {
  const rawMsg  = err instanceof Error ? err.message : String(err);
  const code    = (err as any)?.code    as string | undefined;
  const command = (err as any)?.command as string | undefined;

  logger.error({
    ...context,
    rawMessage:  rawMsg,
    errorCode:   code,
    smtpCommand: command,
    stack:       err instanceof Error ? err.stack : undefined,
  }, "[SMTP] 7. Raw SMTP error (full detail before friendly transform)");

  let friendly: Error;

  if (
    code === "ETIMEDOUT" || code === "ESOCKET" ||
    rawMsg.toLowerCase().includes("greeting") ||
    rawMsg.toLowerCase().includes("timeout")
  ) {
    friendly = new Error(
      `Connection timeout — the SMTP server did not respond within the time limit. ` +
      `For GoDaddy Microsoft 365 use: host smtp.office365.com, port 587, encryption TLS. ` +
      `For cPanel/Hostinger use: host mail.yourdomain.com (not yourdomain.com).`
    );
  } else if (code === "ECONNREFUSED") {
    friendly = new Error(
      `Connection refused on port ${(err as any)?.port ?? context.port ?? "?"}. ` +
      `SSL uses port 465, STARTTLS/TLS uses port 587.`
    );
  } else if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    friendly = new Error(
      `SMTP host not found — "${(err as any)?.hostname ?? context.host ?? "?"}" does not resolve. ` +
      `Check the hostname in Mailbox Settings.`
    );
  } else if (
    rawMsg.toLowerCase().includes("invalid login") ||
    rawMsg.toLowerCase().includes("authentication")
  ) {
    friendly = new Error(`Authentication failed — check your SMTP username and password.`);
  } else {
    friendly = err instanceof Error ? err : new Error(rawMsg);
  }

  (friendly as any).cause   = err;
  (friendly as any).rawCode = code;
  (friendly as any).rawMsg  = rawMsg;
  return friendly;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Create a reusable Nodemailer transporter (used externally). */
export function createSmtpTransport(mailbox: SmtpCredentials): Transporter {
  return nodemailer.createTransport(buildTransportOptions(mailbox));
}

/**
 * Verify SMTP credentials without sending a message.
 * Used by the "Test Connection" UI. Runs a TCP preflight first to give
 * clear network-vs-SMTP distinction in the logs.
 */
export async function testSmtp(creds: SmtpCredentials & { rawPass?: string }): Promise<void> {
  const ctx = { host: creds.smtpHost, port: creds.smtpPort, user: creds.smtpUser };
  logger.info(ctx, "[SMTP-TEST] Starting SMTP test connection");
  logTransportConfig("SMTP-TEST", creds);

  // TCP preflight — diagnoses network reachability before SMTP protocol starts
  logger.info(ctx, "[SMTP-TEST] 1. TCP preflight: opening connection");
  try {
    await tcpConnect(creds.smtpHost, creds.smtpPort, 10_000);
    logger.info(ctx, "[SMTP-TEST] 2. TCP preflight: connection established — port is reachable");
  } catch (tcpErr: any) {
    logger.error({ ...ctx, tcpError: tcpErr.message },
      "[SMTP-TEST] 2. TCP preflight FAILED — port unreachable (continuing to let nodemailer confirm)");
  }

  const transport = nodemailer.createTransport({
    ...buildTransportOptions(creds, creds.rawPass),
    debug:  true,
    logger: makeSmtpLogger("[SMTP-TEST]"),
  } as any);

  try {
    logger.info(ctx, "[SMTP-TEST] 3. Calling transport.verify()");
    await transport.verify();
    logger.info(ctx, "[SMTP-TEST] transport.verify() succeeded — authentication OK");
  } catch (err) {
    throw friendlySmtpError(err, ctx);
  } finally {
    transport.close();
  }
}

export interface SendOptions {
  to:      string;
  subject: string;
  text:    string;
  html:    string;
}

/**
 * Send a single email via a stored mailbox.
 *
 * NOTE: No TCP preflight here — that would eat into the campaign processor's
 * sendEmailWithTimeout budget. TCP preflight is test-only diagnostic.
 */
export async function sendEmail(
  mailbox: Mailbox,
  opts: SendOptions,
): Promise<{ messageId: string }> {
  const ctx = {
    host:    mailbox.smtpHost,
    port:    mailbox.smtpPort,
    user:    mailbox.smtpUser,
    to:      opts.to,
    subject: opts.subject,
  };

  logger.info(ctx, "[SMTP] Starting sendEmail()");
  logTransportConfig("SMTP-SEND", mailbox);

  const pass = decrypt(mailbox.smtpPassEncrypted);
  const transport = nodemailer.createTransport({
    ...buildTransportOptions(mailbox, pass),
    debug:  true,
    logger: makeSmtpLogger("[SMTP]"),
  } as any);

  const fromAddress = mailbox.fromName
    ? `"${mailbox.fromName.replace(/"/g, "")}" <${mailbox.smtpUser}>`
    : mailbox.smtpUser;

  try {
    logger.info({ ...ctx, from: fromAddress }, "[SMTP] 5. Calling sendMail()");
    const info = await transport.sendMail({
      from:    fromAddress,
      to:      opts.to,
      subject: opts.subject,
      text:    opts.text,
      html:    opts.html,
      replyTo: mailbox.replyTo ?? undefined,
    });
    logger.info({ ...ctx, messageId: info.messageId }, "[SMTP] 6. sendMail() completed successfully");
    return { messageId: info.messageId ?? "" };
  } catch (err) {
    throw friendlySmtpError(err, ctx);
  } finally {
    transport.close();
  }
}
