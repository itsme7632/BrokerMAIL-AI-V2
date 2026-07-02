import { db, suppressionListTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";

/**
 * Shared suppression-list service. Every send path (campaigns, composer,
 * Gmail drafts, retries, lead import) MUST route through these helpers
 * instead of querying suppressionListTable directly — suppression is
 * strictly per-user (composite unique index on userId+email), so every
 * lookup must be scoped by userId or it will leak across tenants.
 */

/** Returns true if the given email is suppressed for this specific user. */
export async function isSuppressed(userId: number, email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  try {
    const [row] = await db
      .select({ id: suppressionListTable.id })
      .from(suppressionListTable)
      .where(and(eq(suppressionListTable.userId, userId), eq(suppressionListTable.email, normalized)));
    return !!row;
  } catch {
    // non-fatal — if the lookup fails, don't block sending on an infra hiccup
    return false;
  }
}

/**
 * Given a list of candidate emails, returns the subset (lowercased) that are
 * suppressed for this user. Always scoped by userId.
 */
export async function filterSuppressed(userId: number, emails: string[]): Promise<Set<string>> {
  const normalized = Array.from(new Set(emails.map(e => e.trim().toLowerCase()).filter(Boolean)));
  const suppressed = new Set<string>();
  if (normalized.length === 0) return suppressed;
  try {
    const rows = await db
      .select({ email: suppressionListTable.email })
      .from(suppressionListTable)
      .where(and(eq(suppressionListTable.userId, userId), inArray(suppressionListTable.email, normalized)));
    for (const r of rows) suppressed.add(r.email);
  } catch {
    // non-fatal — proceed without suppression filter on lookup failure
  }
  return suppressed;
}
