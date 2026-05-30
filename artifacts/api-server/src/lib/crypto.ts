import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

/** Derive a stable 32-byte AES key from the env var (or a built-in fallback). */
function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY ?? "brokermail-ai-smtp-enc-key-v1!!32";
  return createHash("sha256").update(raw).digest();
}

/**
 * Encrypt a plaintext string → IV:ciphertext (hex-encoded, colon-separated).
 * AES-256-CBC — safe to store in the database.
 */
export function encrypt(plaintext: string): string {
  if (!plaintext) return "";
  const key = getKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${enc.toString("hex")}`;
}

/**
 * Decrypt a value previously produced by `encrypt()`.
 * Returns empty string on any error (e.g. corrupted data).
 */
export function decrypt(ciphertext: string): string {
  if (!ciphertext) return "";
  try {
    const [ivHex, encHex] = ciphertext.split(":");
    const key = getKey();
    const iv = Buffer.from(ivHex, "hex");
    const enc = Buffer.from(encHex, "hex");
    const decipher = createDecipheriv("aes-256-cbc", key, iv);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}
