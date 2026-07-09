#!/usr/bin/env node
/**
 * Read-only SMTP credential audit — run this ON THE PRODUCTION SERVER.
 * It never prints the plaintext password: only length, SHA-256 fingerprint,
 * and a masked preview (first 2 / last 2 chars).
 *
 * Usage (on the DO server, in the app directory where DATABASE_URL and
 * ENCRYPTION_KEY are loaded as real env vars):
 *   node scripts/audit-smtp-credential.mjs
 *
 * Does NOT send any email, does NOT modify any row.
 */
import crypto from "node:crypto";
import pg from "pg";

function getKey() {
  const raw = process.env.ENCRYPTION_KEY ?? "brokermail-ai-smtp-enc-key-v1!!32";
  return crypto.createHash("sha256").update(raw).digest();
}

function decrypt(ciphertext) {
  if (!ciphertext) return { ok: false, reason: "empty ciphertext" };
  try {
    const [ivHex, encHex] = ciphertext.split(":");
    const key = getKey();
    const iv = Buffer.from(ivHex, "hex");
    const enc = Buffer.from(encHex, "hex");
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
    const plain = Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
    return { ok: true, plain };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) };
  }
}

function fingerprint(plain) {
  const sha256 = crypto.createHash("sha256").update(plain).digest("hex");
  const masked =
    plain.length >= 4
      ? plain.slice(0, 2) + "*".repeat(Math.max(plain.length - 4, 0)) + plain.slice(-2)
      : "*".repeat(plain.length);
  return { length: plain.length, sha256, masked };
}

async function main() {
  console.log("ENCRYPTION_KEY set in this environment:", !!process.env.ENCRYPTION_KEY);
  console.log("ENCRYPTION_KEY length (if set):", process.env.ENCRYPTION_KEY?.length ?? "n/a");
  // Fingerprint of the KEY itself (not reversible, safe to compare across environments)
  console.log("ENCRYPTION_KEY fingerprint (sha256 of the raw string used):",
    crypto.createHash("sha256").update(process.env.ENCRYPTION_KEY ?? "brokermail-ai-smtp-enc-key-v1!!32").digest("hex"));

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const { rows } = await client.query(
    "SELECT id, user_id, smtp_host, smtp_user, smtp_pass_encrypted, is_active FROM mailboxes ORDER BY id;"
  );
  await client.end();

  for (const row of rows) {
    console.log("\n--- mailbox id", row.id, "user_id", row.user_id, "---");
    console.log("smtp_host:", row.smtp_host, "smtp_user:", row.smtp_user, "is_active:", row.is_active);
    const result = decrypt(row.smtp_pass_encrypted);
    if (!result.ok) {
      console.log("DECRYPT FAILED:", result.reason);
      continue;
    }
    console.log("decrypted metadata:", fingerprint(result.plain));
  }
}

main().catch((e) => {
  console.error("Audit failed:", e);
  process.exit(1);
});
