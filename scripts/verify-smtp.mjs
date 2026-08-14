#!/usr/bin/env node
/**
 * TEMPORARY production diagnostic — verify SMTP auth for mailbox id 1
 * using the exact decrypt + transporter logic from lib/smtp.ts / lib/crypto.ts.
 *
 * - Does NOT send any email (uses transporter.verify() only)
 * - Does NOT modify the database or any application code
 * - Never prints the plaintext password — only length + SHA-256 fingerprint
 *
 * Usage (run ON THE PRODUCTION SERVER, in the app directory):
 *   node scripts/verify-smtp.mjs
 *
 * Delete this file after use — it is a temporary diagnostic only.
 */
import "dotenv/config"; // reads production .env in the current directory
import crypto from "node:crypto";
import pg from "pg";
import nodemailer from "nodemailer";

// ─── Same key derivation as lib/crypto.ts ───────────────────────────────────
function getKey() {
  const raw = process.env.ENCRYPTION_KEY ?? "brokermail-ai-smtp-enc-key-v1!!32";
  return crypto.createHash("sha256").update(raw).digest();
}

// ─── Same decrypt() as lib/crypto.ts ────────────────────────────────────────
function decrypt(ciphertext) {
  if (!ciphertext) return "";
  try {
    const [ivHex, encHex] = ciphertext.split(":");
    const key = getKey();
    const iv = Buffer.from(ivHex, "hex");
    const enc = Buffer.from(encHex, "hex");
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}

// ─── Same transport option shape as buildTransportOptions() in lib/smtp.ts ──
// (kept in sync with the app's canonical starttls/ssl/none modes)
function normalizeSecure(value) {
  const v = String(value ?? "").trim().toLowerCase().replace(/[\s/_-]+/g, "");
  if (v === "ssl" || v === "implicit" || v === "465" || v === "ssltls") return "ssl";
  if (v === "tls" || v === "starttls" || v === "587") return "starttls";
  if (v === "none" || v === "plain" || v === "" || v === "25") return "none";
  return "starttls";
}

function envInt(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}

function buildTransportOptions(mailbox, pass) {
  const mode = normalizeSecure(mailbox.smtp_secure);
  const rejectUnauthorized = String(process.env.SMTP_TLS_REJECT_UNAUTHORIZED ?? "").toLowerCase() === "false" ? false : true;
  return {
    host: mailbox.smtp_host,
    port: mailbox.smtp_port,
    secure: mode === "ssl",
    requireTLS: mode === "starttls",
    auth: { user: mailbox.smtp_user, pass },
    tls: { minVersion: "TLSv1.2", rejectUnauthorized },
    connectionTimeout: envInt("SMTP_CONNECTION_TIMEOUT", 30_000),
    greetingTimeout:   envInt("SMTP_GREETING_TIMEOUT",   30_000),
    socketTimeout:     envInt("SMTP_SOCKET_TIMEOUT",     30_000),
  };
}

function sha256(str) {
  return crypto.createHash("sha256").update(str).digest("hex");
}

async function main() {
  console.log("=== SMTP verify diagnostic (mailbox id 1) ===");
  console.log("ENCRYPTION_KEY set:", !!process.env.ENCRYPTION_KEY);
  console.log("ENCRYPTION_KEY fingerprint:", sha256(process.env.ENCRYPTION_KEY ?? "brokermail-ai-smtp-enc-key-v1!!32"));

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const { rows } = await client.query(
    "SELECT id, user_id, smtp_host, smtp_port, smtp_user, smtp_pass_encrypted, smtp_secure, from_name, reply_to, is_active FROM mailboxes WHERE id = 1;"
  );
  await client.end();

  const mailbox = rows[0];
  if (!mailbox) {
    console.error("No mailbox with id 1 found. Aborting.");
    process.exit(1);
  }

  console.log("\nmailbox:", {
    id: mailbox.id,
    user_id: mailbox.user_id,
    smtp_host: mailbox.smtp_host,
    smtp_port: mailbox.smtp_port,
    smtp_user: mailbox.smtp_user,
    smtp_secure: mailbox.smtp_secure,
    is_active: mailbox.is_active,
  });

  const pass = decrypt(mailbox.smtp_pass_encrypted);
  console.log("\ndecrypted password length:", pass.length);
  console.log("decrypted password SHA-256 fingerprint:", sha256(pass));

  const transport = nodemailer.createTransport(buildTransportOptions(mailbox, pass));

  console.log("\nCalling transporter.verify() — no email will be sent...");
  try {
    const ok = await transport.verify();
    console.log("\nVERIFY SUCCESS:", ok);
  } catch (error) {
    console.log("\nVERIFY FAILED. Full error object fields:");
    console.log("error.code:", error.code);
    console.log("error.responseCode:", error.responseCode);
    console.log("error.response:", error.response);
    console.log("error.command:", error.command);
    console.log("error.message:", error.message);
    console.log("error.stack:", error.stack);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Diagnostic failed unexpectedly:", e);
  process.exit(1);
});
