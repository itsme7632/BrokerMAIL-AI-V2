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

/**
 * Canonical SMTP encryption modes used across the app.
 *
 *  - "starttls" → connect plain, upgrade with STARTTLS, then authenticate (secure=false, requireTLS=true)
 *  - "ssl"      → implicit TLS from the first byte (secure=true, requireTLS=false)
 *  - "none"     → plain SMTP, no forced upgrade (secure=false, requireTLS=false)
 */
export type SmtpSecureMode = "starttls" | "ssl" | "none";

/**
 * Map any stored/legacy smtp_secure value to a canonical mode.
 *
 * Backwards compatibility: the pre-existing UI/DB used "tls" to mean STARTTLS
 * ("TLS=587"), so "tls" and any case/space variant of STARTTLS map to "starttls".
 * Unknown/empty values default to "starttls" (the app's long-standing default).
 * Never throws — a bad stored value must not break mailbox loading/sending.
 */
export function normalizeSmtpSecure(value: string | null | undefined): SmtpSecureMode {
  const v = String(value ?? "").trim().toLowerCase().replace(/[\s/_-]+/g, "");
  if (v === "ssl" || v === "implicit" || v === "465" || v === "ssltls") return "ssl";
  if (v === "tls" || v === "starttls" || v === "587") return "starttls";
  if (v === "none" || v === "plain" || v === "" || v === "25") return "none";
  return "starttls";
}

// ─── Environment-configurable SMTP behavior ─────────────────────────────────
// Optional env vars (documented in replit.md):
//   SMTP_TLS_REJECT_UNAUTHORIZED  - "false" disables TLS cert validation (troubleshooting only). Default: true
//   SMTP_CONNECTION_TIMEOUT       - ms to establish the TCP connection. Default: 30000
//   SMTP_GREETING_TIMEOUT         - ms to wait for the SMTP greeting.        Default: 30000
//   SMTP_SOCKET_TIMEOUT           - ms of socket inactivity before closing.  Default: 30000

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
}

export function smtpTimeouts() {
  return {
    connectionTimeout: envInt("SMTP_CONNECTION_TIMEOUT", 30_000),
    greetingTimeout:   envInt("SMTP_GREETING_TIMEOUT",   30_000),
    socketTimeout:     envInt("SMTP_SOCKET_TIMEOUT",     30_000),
  };
}

// ─── Transporter config ───────────────────────────────────────────────────────

export function buildTransportOptions(creds: SmtpCredentials, rawPass?: string) {
  const pass = rawPass ?? decrypt(creds.smtpPassEncrypted);
  const mode = normalizeSmtpSecure(creds.smtpSecure);
  const timeouts = smtpTimeouts();
  const rejectUnauthorized = envBool("SMTP_TLS_REJECT_UNAUTHORIZED", true);

  return {
    host:               creds.smtpHost,
    port:               creds.smtpPort,
    // STARTTLS must connect plainly first, negotiate the upgrade via EHLO, and
    // only then authenticate — exactly what nodemailer does with requireTLS:true.
    // Never use secure:true for STARTTLS (that is implicit TLS from byte one).
    secure:             mode === "ssl",
    requireTLS:         mode === "starttls",
    auth:               { user: creds.smtpUser, pass },
    tls: {
      // TLS 1.2 minimum — do not allow legacy SSL/TLS protocol versions.
      minVersion:       "TLSv1.2" as const,
      // Validate certificates in production. SMTP_TLS_REJECT_UNAUTHORIZED=false
      // can temporarily disable validation for troubleshooting a specific server.
      rejectUnauthorized,
    },
    connectionTimeout:  timeouts.connectionTimeout,
    greetingTimeout:    timeouts.greetingTimeout,
    socketTimeout:      timeouts.socketTimeout,
  } as const;
}

/** Log the resolved transporter config (password NEVER logged). */
function logTransportConfig(label: string, creds: SmtpCredentials) {
  const mode = normalizeSmtpSecure(creds.smtpSecure);
  const timeouts = smtpTimeouts();
  const rejectUnauthorized = envBool("SMTP_TLS_REJECT_UNAUTHORIZED", true);
  logger.info({
    label,
    host:               creds.smtpHost,
    port:               creds.smtpPort,
    smtpUser:           creds.smtpUser,
    smtpSecureStored:   creds.smtpSecure,
    mode,
    secure:             mode === "ssl",
    requireTLS:         mode === "starttls",
    minTlsVersion:      "TLSv1.2",
    rejectUnauthorized,
    connectionTimeout:  timeouts.connectionTimeout,
    greetingTimeout:    timeouts.greetingTimeout,
    socketTimeout:      timeouts.socketTimeout,
  }, `[SMTP] Transporter config — label=${label} (password masked)`);

  // GoDaddy / Microsoft 365 detection
  const host = creds.smtpHost.toLowerCase();
  const isM365    = host.includes("office365") || host.includes("outlook.com");
  const isGoDaddy = host.includes("godaddy") || host.includes("secureserver") || host.includes("workspace365");
  if (isGoDaddy && !isM365) {
    logger.warn({
      currentHost: creds.smtpHost,
      recommended: { host: "smtp.office365.com", port: 587, encryption: "starttls" },
    }, "[SMTP] GoDaddy Microsoft 365 detected — recommended: smtp.office365.com:587 STARTTLS");
  }
  if (isM365 && (creds.smtpPort !== 587 || mode !== "starttls")) {
    logger.warn({
      currentPort:   creds.smtpPort,
      currentMode:   mode,
      recommended:   { host: "smtp.office365.com", port: 587, encryption: "starttls" },
    }, "[SMTP] Office 365 host but port/encryption may be wrong — recommended: port 587, STARTTLS");
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

// ─── SMTP failure classification ──────────────────────────────────────────────
// Maps a nodemailer error to the protocol stage where it failed and a SAFE,
// user-presentable message. The raw technical error is always logged separately
// (see friendlySmtpError) — these messages never contain passwords/secrets.

export type SmtpFailureStage =
  | "dns"
  | "tcp_connect"
  | "tcp_reset"
  | "network_unreachable"
  | "timeout"
  | "greeting"
  | "ehlo"
  | "starttls_capability"
  | "starttls_upgrade"
  | "tls_handshake"
  | "tls_certificate"
  | "auth"
  | "rejected"
  | "unknown";

export interface SmtpFailureInfo {
  stage: SmtpFailureStage;
  message: string;
}

const CERT_FAILURE_PATTERNS = [
  "self-signed",
  "self signed",
  "certificate",
  "unable to verify",
  "altnames",
  "depth_zero",
  "cert_has_expired",
  "cert has expired",
  "leaf signature",
  "verify the first certificate",
  "unable to get local issuer",
  "signed certificate",
  "err_tls_cert",
  "ssl certificate",
];

export function classifySmtpFailure(
  err: unknown,
  context: { host?: string; port?: number } = {},
): SmtpFailureInfo {
  const rawMsg = err instanceof Error ? err.message : String(err ?? "");
  const msg    = rawMsg.toLowerCase();
  const code    = (err as any)?.code        as string | undefined;
  const command = (err as any)?.command     as string | undefined;
  const responseCode = Number((err as any)?.responseCode) || 0;
  const responseLine = String((err as any)?.response ?? "")
    .split("\n")[0].trim().slice(0, 200);
  const host = context.host ?? "?";
  const port = context.port ?? "?";
  const timeoutMs = smtpTimeouts().connectionTimeout;

  // 1. DNS lookup
  if (
    code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "EDNS" ||
    msg.includes("enotfound") || msg.includes("eai_again") ||
    msg.includes("getaddrinfo") || msg.includes("nxdomain")
  ) {
    return {
      stage: "dns",
      message: `SMTP host not found — "${host}" does not resolve. Check the hostname in Mailbox Settings.`,
    };
  }

  // 2. TCP connection
  if (code === "ECONNREFUSED" || msg.includes("econnrefused") || msg.includes("connection refused")) {
    return {
      stage: "tcp_connect",
      message: `Could not connect to the SMTP server — connection refused on port ${port}. Check that the port matches the encryption mode (STARTTLS usually uses 587, SSL/TLS usually uses 465).`,
    };
  }
  if (code === "ECONNRESET" || msg.includes("econnreset") || msg.includes("connection reset")) {
    return {
      stage: "tcp_reset",
      message: `Could not connect to the SMTP server — the connection was reset. The server may be blocking this port.`,
    };
  }
  if (code === "EHOSTUNREACH" || code === "ENETUNREACH" || msg.includes("ehostunreach") || msg.includes("enetunreach")) {
    return {
      stage: "network_unreachable",
      message: `Network unreachable — check outbound network access from the server.`,
    };
  }

  // 3. SMTP greeting
  if (msg.includes("greeting")) {
    return {
      stage: "greeting",
      message: `SMTP server connected but did not send its greeting within the timeout. The server may be slow or not an SMTP endpoint.`,
    };
  }

  // 4. Timeouts (connect or socket)
  if (
    code === "ETIMEDOUT" || code === "ESOCKET" ||
    msg.includes("timeout") || msg.includes("timed out") ||
    msg.includes("esocket")
  ) {
    return {
      stage: "timeout",
      message: `Could not connect to SMTP server within ${Math.round(timeoutMs / 1000)} seconds — the server did not respond. Check the host/port, or the server may be down or firewalled.`,
    };
  }

  // 5. EHLO
  if (command === "EHLO" || msg.includes("ehlo")) {
    return {
      stage: "ehlo",
      message: `SMTP server rejected the EHLO handshake. The server may not be a standard SMTP endpoint.`,
    };
  }

  // 6. STARTTLS capability (server connected but never advertised STARTTLS)
  if (
    (command === "STARTTLS" && (msg.includes("not support") || msg.includes("missing starttls"))) ||
    (msg.includes("starttls") && (msg.includes("not support") || msg.includes("does not advertise")))
  ) {
    return {
      stage: "starttls_capability",
      message: `SMTP server connected but did not advertise STARTTLS. If the server only supports plain SMTP, select NONE; if it uses implicit TLS from the start, select SSL/TLS.`,
    };
  }

  // 7. STARTTLS upgrade failed
  if (command === "STARTTLS" || (msg.includes("starttls") && msg.includes("upgrad")) || (code === "ETLS" && msg.includes("starttls"))) {
    return {
      stage: "starttls_upgrade",
      message: `STARTTLS negotiation failed — the server could not upgrade the connection to TLS.`,
    };
  }

  // 8. TLS certificate validation
  if (CERT_FAILURE_PATTERNS.some(p => msg.includes(p))) {
    return {
      stage: "tls_certificate",
      message: `TLS certificate validation failed. If this server uses a self-signed or invalid certificate, set SMTP_TLS_REJECT_UNAUTHORIZED=false on the server to temporarily allow the connection.`,
    };
  }

  // 9. TLS handshake / protocol
  if (
    code === "ETLS" ||
    msg.includes("tls handshake") || msg.includes("handshake failure") ||
    msg.includes("wrong version") || msg.includes("protocol version") ||
    msg.includes("initiating tls") || msg.includes("ssl3") ||
    msg.includes("eproto")
  ) {
    return {
      stage: "tls_handshake",
      message: `TLS handshake failed — the server does not support the required TLS 1.2 or higher.`,
    };
  }

  // 10. SMTP authentication
  if (
    code === "EAUTH" ||
    responseCode === 535 ||
    msg.includes("invalid login") ||
    msg.includes("authentication failed") ||
    msg.includes("authentication credentials") ||
    msg.includes("535")
  ) {
    return {
      stage: "auth",
      message: `SMTP authentication failed — check your SMTP username and password.`,
    };
  }

  // 11. SMTP server rejection (4xx/5xx responses during any command)
  if (responseCode >= 400 && responseCode < 600) {
    const temp = responseCode >= 400 && responseCode < 500;
    return {
      stage: "rejected",
      message: `SMTP server ${temp ? "temporarily" : ""} rejected the connection (response ${responseCode})${responseLine ? `: ${responseLine}` : ""}.`,
    };
  }

  // 12. Fallback — never the raw technical error, but a generic safe message.
  return {
    stage: "unknown",
    message: `SMTP connection failed. Please check the host, port, encryption mode, and credentials, then try again.`,
  };
}

/**
 * Log the raw error with full detail first, then return a SAFE user-facing
 * error classified by protocol stage. The raw code/message are attached as
 * .rawCode / .rawMsg / .stage so server-side callers can still inspect them.
 */
function friendlySmtpError(err: unknown, context: Record<string, unknown> = {}): Error {
  const rawMsg = err instanceof Error ? err.message : String(err);
  const code   = (err as any)?.code    as string | undefined;

  logger.error({
    ...context,
    rawMessage:  rawMsg,
    errorCode:   code,
    smtpCommand: (err as any)?.command as string | undefined,
    responseCode: (err as any)?.responseCode as number | undefined,
    stack:       err instanceof Error ? err.stack : undefined,
  }, "[SMTP] Raw SMTP error (full technical detail — logged server-side only)");

  const info = classifySmtpFailure(err, {
    host: context.host as string | undefined,
    port: context.port as number | undefined,
  });
  logger.warn({ stage: info.stage }, `[SMTP] Failure stage: ${info.stage}`);

  const friendly = new Error(info.message);
  (friendly as any).cause   = err;
  (friendly as any).rawCode = code;
  (friendly as any).rawMsg  = rawMsg;
  (friendly as any).stage   = info.stage;
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
  const ctx   = { host: creds.smtpHost, port: creds.smtpPort, user: creds.smtpUser };
  const mode  = normalizeSmtpSecure(creds.smtpSecure);
  const timeouts = smtpTimeouts();
  logger.info({ ...ctx, mode, timeouts }, "[SMTP-TEST] Starting SMTP test connection");
  logTransportConfig("SMTP-TEST", creds);

  // TCP preflight — diagnoses network reachability before SMTP protocol starts
  logger.info(ctx, "[SMTP-TEST] 1. TCP preflight: opening connection");
  try {
    await tcpConnect(creds.smtpHost, creds.smtpPort, timeouts.connectionTimeout);
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
    logger.info(ctx, "[SMTP-TEST] 3. SMTP session: greeting → EHLO → STARTTLS (if selected) → AUTH → verify()");
    await transport.verify();
    logger.info({ ...ctx, verifySuccess: true }, "[SMTP TEST] Verify Success — host/port/encryption/auth OK");
  } catch (err) {
    logger.error({ ...ctx, verifySuccess: false }, "[SMTP TEST] Verify Failed — see raw error below");
    throw friendlySmtpError(err, ctx);
  } finally {
    transport.close();
  }
}

export interface SendOptions {
  to:          string;
  subject:     string;
  text:        string;
  html:        string;
  cc?:         string;
  bcc?:        string;
  attachments?: Array<{ filename: string; content: Buffer; contentType: string }>;
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
    logger.info({ ...ctx, from: fromAddress }, "[SMTP] Calling sendMail()");
    const info = await transport.sendMail({
      from:    fromAddress,
      to:      opts.to,
      ...(opts.cc  ? { cc:  opts.cc  } : {}),
      ...(opts.bcc ? { bcc: opts.bcc } : {}),
      subject: opts.subject,
      text:    opts.text,
      html:    opts.html,
      replyTo: mailbox.replyTo ?? undefined,
      ...(opts.attachments?.length ? {
        attachments: opts.attachments.map(a => ({
          filename:    a.filename,
          content:     a.content,
          contentType: a.contentType,
        })),
      } : {}),
    });
    logger.info({ ...ctx, messageId: info.messageId }, "[SMTP] sendMail() completed successfully");
    return { messageId: info.messageId ?? "" };
  } catch (err) {
    throw friendlySmtpError(err, ctx);
  } finally {
    transport.close();
  }
}
