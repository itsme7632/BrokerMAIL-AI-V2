import jwt from "jsonwebtoken";

/**
 * Separate secret suffix for unsubscribe tokens so they cannot be confused
 * with auth tokens that share the same SESSION_SECRET base.
 */
const UNSUB_SECRET =
  (process.env.SESSION_SECRET ?? "dev-secret-change-in-prod") + "-unsub";

export interface UnsubscribePayload {
  userId:     number;
  leadId:     number | null;
  campaignId: number | null;
  email:      string;
}

/**
 * Generate a signed unsubscribe token.
 * Tokens expire in 365 days. Unsubscribe status is stored in the DB so
 * an expired token is an edge case, but we re-validate before trusting it.
 */
export function generateUnsubscribeToken(
  userId:     number,
  leadId:     number | null,
  campaignId: number | null,
  email:      string,
): string {
  return jwt.sign(
    { userId, leadId, campaignId, email } satisfies UnsubscribePayload,
    UNSUB_SECRET,
    { expiresIn: "365d" },
  );
}

/** Returns the payload if the token is valid, unexpired, and has the expected shape. */
export function verifyUnsubscribeToken(token: string): UnsubscribePayload | null {
  try {
    const raw = jwt.verify(token, UNSUB_SECRET) as Record<string, unknown>;

    // Runtime shape validation — fail closed on any unexpected payload.
    if (
      typeof raw.userId !== "number" ||
      typeof raw.email  !== "string" ||
      !raw.email.trim() ||
      (raw.leadId     !== null && typeof raw.leadId     !== "number") ||
      (raw.campaignId !== null && typeof raw.campaignId !== "number")
    ) {
      return null;
    }

    return {
      userId:     raw.userId,
      leadId:     (raw.leadId     ?? null) as number | null,
      campaignId: (raw.campaignId ?? null) as number | null,
      email:      raw.email,
    };
  } catch {
    return null;
  }
}

/**
 * Build the full /unsubscribe URL to embed in marketing emails.
 * Returns undefined if publicBase is empty — callers must not inject a broken link.
 */
export function buildUnsubscribeUrl(
  publicBase:  string,
  userId:      number,
  leadId:      number | null,
  campaignId:  number | null,
  email:       string,
): string | undefined {
  const base = publicBase.trim();
  if (!base) return undefined;
  const token = generateUnsubscribeToken(userId, leadId, campaignId, email);
  return `${base}/unsubscribe?token=${encodeURIComponent(token)}`;
}
