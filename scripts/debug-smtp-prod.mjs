#!/usr/bin/env node
/**
 * TEMPORARY production diagnostic — trace the exact sendEmail() SMTP path
 * for the active mailbox, using the same mailbox-lookup query, decrypt(),
 * and buildTransportOptions() logic as processCampaignFully() in campaigns.ts.
 *
 * - Does NOT send any email (uses transporter.verify() only).
 * - Does NOT modify the database or any application code.
 * - Never prints the plaintext password — only length + SHA-256 fingerprint.
 * - Does NOT modify SMTP logic; this is a read-only, standalone diagnostic.
 *
 * Mailbox selection: mirrors campaigns.ts's lookup —
 *   SELECT * FROM mailboxes WHERE user_id = <campaign's userId> AND is_active = true
 * Since this script has no specific campaign in context, it targets the
 * first row matching `is_active = true` (ordered by id), which is the same
 * row the campaign processor would resolve to for that mailbox's owner
 * (mailboxes.user_id is unique, so "the active mailbox for a user" and
 * "an active mailbox" are equivalent per user).
 *
 * Usage (run ON THE PRODUCTION SERVER, in the app directory):
 *   node scripts/debug-smtp-prod.mjs [mailboxId]
 *
 * Optional arg: a specific mailbox id to target instead of "first active".
 *
 * Delete this file after use — it is a temporary diagnostic only.
 */
import "dotenv/config"; // reads production .env in the current directory
import crypto from "node:crypto";
import pg from "pg";
import nodemailer from "nodemailer";

// ─── Same key derivation as lib/crypto.ts getKey() ──────────────────────────
function getKey() {
  const raw = process.env.ENCRYPTION_KEY ?? "brokermail-ai-smtp-enc-key-v1!!32";
  return crypto.createHash("sha256").update(raw).digest();
}

// ─── Same decrypt() as lib/crypto.ts ────────────────────────────────────────
// Returns { value, succeeded } instead of swallowing the distinction, so this
// script can report decryptSucceeded independently of "decrypted to empty".
function decrypt(ciphertext) {
  if (!ciphertext) return { value: "", succeeded: false };
  try {
    const [ivHex, encHex] = ciphertext.split(":");
    if (!ivHex || !encHex) return { value: "", succeeded: false };
    const key = getKey();
    const iv = Buffer.from(ivHex, "hex");
    const enc = Buffer.from(encHex, "hex");
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
    const value = Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
    return { value, succeeded: true };
  } catch {
    return { value: "", succeeded: false };
  }
}

// ─── Same transport option shape as buildTransportOptions() in lib/smtp.ts ──
function buildTransportOptions(mailbox, pass) {
  const isSSL = mailbox.smtp_secure === "ssl";
  const isTLS = mailbox.smtp_secure === "tls";
  return {
    host: mailbox.smtp_host,
    port: mailbox.smtp_port,
    secure: isSSL,
    requireTLS: isTLS,
    auth: { user: mailbox.smtp_user, pass },
    tls: { rejectUnauthorized: false },
    connectionTimeout: 20_000,
    greetingTimeout: 30_000,
    socketTimeout: 60_000,
  };
}

function sha256(str) {
  return crypto.createHash("sha256").update(str ?? "").digest("hex");
}

async function main() {
  const mailboxIdArg = process.argv[2] ? Number(process.argv[2]) : null;

  console.log("=== SMTP debug diagnostic (production, read-only) ===");
  console.log("Mode: same mailbox-lookup pattern as processCampaignFully() (userId + is_active = true)");

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const { rows } = mailboxIdArg
    ? await client.query(
        "SELECT id, user_id, smtp_host, smtp_port, smtp_user, smtp_pass_encrypted, smtp_secure, is_active FROM mailboxes WHERE id = $1;",
        [mailboxIdArg],
      )
    : await client.query(
        "SELECT id, user_id, smtp_host, smtp_port, smtp_user, smtp_pass_encrypted, smtp_secure, is_active FROM mailboxes WHERE is_active = true ORDER BY id LIMIT 1;",
      );

  await client.end();

  const mailbox = rows[0];
  if (!mailbox) {
    console.error("No matching active mailbox found. Aborting.");
    process.exit(1);
  }

  console.log("\nMailbox targeted:");
  console.log("  id:", mailbox.id);
  console.log("  user_id:", mailbox.user_id);
  console.log("  smtp_host:", mailbox.smtp_host);
  console.log("  smtp_port:", mailbox.smtp_port);
  console.log("  smtp_secure:", mailbox.smtp_secure);
  console.log("  is_active:", mailbox.is_active);

  // ── decrypt() ──────────────────────────────────────────────────────────
  const { value: pass, succeeded: decryptSucceeded } = decrypt(mailbox.smtp_pass_encrypted);

  const authUserPresent = !!mailbox.smtp_user;
  const authPassPresent = pass.length > 0;

  console.log("\n--- decrypt() result ---");
  console.log("decryptSucceeded:", decryptSucceeded);
  console.log("passwordLength:", pass.length);
  console.log("authUserPresent:", authUserPresent);
  console.log("authPassPresent:", authPassPresent);
  console.log("decryptedPasswordSha256:", sha256(pass));
  console.log("encryptionKeySha256:", sha256(process.env.ENCRYPTION_KEY ?? "brokermail-ai-smtp-enc-key-v1!!32"));
  console.log("encryptionKeyEnvSet:", !!process.env.ENCRYPTION_KEY);

  // ── buildTransportOptions() + transporter.verify() ───────────────────────
  const transport = nodemailer.createTransport(buildTransportOptions(mailbox, pass));

  console.log("\nCalling transporter.verify() — no email will be sent...");
  try {
    await transport.verify();
    console.log("\nverifySucceeded: true");
  } catch (error) {
    console.log("\nverifySucceeded: false");
    console.log("\n--- raw Nodemailer error (unmodified, not friendly-mapped) ---");
    console.log("code:", error.code);
    console.log("responseCode:", error.responseCode);
    console.log("command:", error.command);
    console.log("response:", error.response);
    console.log("message:", error.message);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("Diagnostic failed unexpectedly:", e);
  process.exit(1);
});
