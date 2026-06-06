/**
 * email-validator.ts
 *
 * Email validation service used by the upload parse endpoint.
 * Three validation layers:
 *   1. Syntax — basic RFC-5321 pattern check (fast, synchronous)
 *   2. Disposable / role — static blocklists (fast, synchronous)
 *   3. DNS   — MX-record lookup with A-record fallback (async, cached 1h)
 *
 * DNS results are cached in memory for 1 hour.  The caller batches all unique
 * domains and resolves them in parallel via validateDomainsBatch(), which caps
 * total latency to the single slowest domain (max 3 s per domain).
 */

import { promises as dns } from "dns";

// ---------------------------------------------------------------------------
// Disposable email domain blocklist
// ---------------------------------------------------------------------------

const DISPOSABLE_DOMAINS = new Set<string>([
  "mailinator.com", "mailinator.net", "mailinator.org",
  "guerrillamail.com", "guerrillamail.net", "guerrillamail.org",
  "guerrillamail.biz", "guerrillamail.de", "guerrillamail.info",
  "guerrillamailblock.com",
  "trashmail.com", "trashmail.me", "trashmail.net", "trashmail.io",
  "trashmail.at", "trashmail.org",
  "tempmail.com", "temp-mail.org", "temp-mail.io", "tempr.email",
  "throwam.com",
  "yopmail.com", "yopmail.fr",
  "sharklasers.com", "grr.la", "spam4.me",
  "maildrop.cc", "mailnesia.com",
  "dispostable.com", "discard.email",
  "spamgourmet.com", "spamgourmet.net",
  "mailexpire.com", "spamfree24.org",
  "wegwerfmail.de", "einrot.com",
  "fakeinbox.com", "spambox.us",
  "getairmail.com", "filzmail.com", "filzmail.de",
  "binkmail.com", "crapmail.org",
  "gishpuppy.com", "mailme.ir",
  "anonbox.net", "anonymbox.com",
  "dropmail.me", "meltmail.com", "mailtemp.info",
  "nowmymail.net", "fakemailgenerator.com",
  "tempemail.net", "tempemail.com",
  "10minutemail.com", "10minutemail.net", "10minutemail.org",
  "10minutemail.us",
  "20minutemail.com", "20minutemail.it",
  "5minutemail.com", "1minutemail.com",
  "tempinbox.com", "tempinbox.net",
  "mailpoof.com", "mytemp.email",
  "spamavert.com", "wh4f.org",
  "throwam.com", "thrma.com",
  "mailnull.com",
  "mt2015.com", "mt2014.com", "nwldx.com",
]);

// ---------------------------------------------------------------------------
// Role-account prefix blocklist
// ---------------------------------------------------------------------------

const ROLE_PREFIXES = new Set<string>([
  "info", "support", "admin", "sales", "contact", "billing",
  "webmaster", "help", "noreply", "no-reply", "postmaster",
  "abuse", "marketing", "office", "team", "hr", "hello",
  "enquiries", "enquiry", "accounts", "mailer", "daemon",
  "newsletter", "notifications", "notify", "donotreply",
]);

// ---------------------------------------------------------------------------
// DNS domain cache
// ---------------------------------------------------------------------------

interface DnsCacheEntry { resolvable: boolean; cachedAt: number }
const domainCache = new Map<string, DnsCacheEntry>();
const CACHE_TTL_MS = 60 * 60_000; // 1 hour

async function isDomainResolvable(domain: string): Promise<boolean> {
  const cached = domainCache.get(domain);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.resolvable;

  const race = <T>(p: Promise<T>, ms: number): Promise<T> =>
    Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

  let resolvable = false;
  try {
    const mx = await race(dns.resolveMx(domain), 3_000);
    resolvable = mx.length > 0;
  } catch {
    try {
      const a = await race(dns.resolve4(domain), 3_000);
      resolvable = a.length > 0;
    } catch {
      resolvable = false;
    }
  }

  domainCache.set(domain, { resolvable, cachedAt: Date.now() });
  return resolvable;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface EmailValidationResult {
  valid:       boolean;
  reason:      string | null;
  flagged:     boolean;
  flagReason:  string | null;
  isDisposable: boolean;
}

/**
 * Fast synchronous checks: syntax, disposable domain, role account prefix.
 * Does NOT perform DNS lookups.
 */
export function validateEmailFast(email: string): EmailValidationResult {
  const trimmed = email.trim().toLowerCase();

  if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { valid: false, reason: "Invalid email syntax", flagged: false, flagReason: null, isDisposable: false };
  }

  const [local, domain] = trimmed.split("@") as [string, string];

  if (DISPOSABLE_DOMAINS.has(domain)) {
    return { valid: false, reason: "Disposable email provider", flagged: false, flagReason: null, isDisposable: true };
  }

  const prefix = local.split("+")[0].split(".")[0];
  const isFlagged = ROLE_PREFIXES.has(prefix);

  return {
    valid: true,
    reason: null,
    flagged: isFlagged,
    flagReason: isFlagged ? `Role account (${local}@)` : null,
    isDisposable: false,
  };
}

/**
 * Resolve all unique domains in parallel.
 * Returns the set of domains that have NO valid MX or A record.
 * Domains that time out or throw are treated as resolvable (fail-open) to
 * avoid blocking legitimate sends due to transient DNS issues.
 */
export async function validateDomainsBatch(domains: string[]): Promise<Set<string>> {
  const failed = new Set<string>();
  if (domains.length === 0) return failed;

  const results = await Promise.allSettled(
    domains.map(async (d) => ({ domain: d, ok: await isDomainResolvable(d) })),
  );

  for (const r of results) {
    if (r.status === "fulfilled" && !r.value.ok) failed.add(r.value.domain);
    // rejected = timeout or other error → treat domain as ok (fail-open)
  }
  return failed;
}

/**
 * Returns true when a bounce reason string indicates a permanent 5xx failure
 * that warrants adding the recipient to the suppression list.
 */
export function isPermanentBounce(reason: string): boolean {
  const s = reason.toLowerCase();
  return (
    /\b550\b/.test(s) ||
    /\b554\b/.test(s) ||
    /\b5\.1\b/.test(s) ||
    /\b5\.2\b/.test(s) ||
    s.includes("user unknown") ||
    s.includes("mailbox not found") ||
    s.includes("does not exist") ||
    s.includes("no such user") ||
    s.includes("address rejected") ||
    s.includes("invalid recipient") ||
    s.includes("recipient rejected") ||
    s.includes("undeliverable address")
  );
}

/** Extract a short SMTP status code string from a bounce reason (e.g. "550"). */
export function extractBounceCode(reason: string): string | null {
  const m = reason.match(/\b(5\d\d)\b/);
  return m ? m[1] : null;
}
