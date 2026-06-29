import { db, draftsTable, usersTable } from "@workspace/db";
import { eq, and, inArray, sql } from "drizzle-orm";
import { getGmailClient } from "./gmail";
import { logger } from "./logger";

/**
 * Check every unsent Gmail draft for `userId` against the Gmail API.
 * If a draft returns 404 it has been sent (or deleted) from Gmail — we
 * auto-set `sentAt` so tracking activates immediately.
 *
 * Returns { autoMarked, checked } — safe to call from both HTTP handlers and
 * the background job.
 */
export async function syncSentDrafts(
  userId: number
): Promise<{ autoMarked: number; checked: number; skipped?: string }> {
  // Grab the freshest user record (tokens may have refreshed since JWT was issued)
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId));

  if (!user?.gmailAccessToken) {
    return { autoMarked: 0, checked: 0, skipped: "no_gmail" };
  }

  // All unsent, non-SMTP, successfully-created Gmail drafts
  const unsent = await db
    .select({ id: draftsTable.id, gmailDraftId: draftsTable.gmailDraftId })
    .from(draftsTable)
    .where(
      and(
        eq(draftsTable.userId, userId),
        sql`${draftsTable.sentAt} IS NULL`,
        sql`${draftsTable.gmailDraftId} IS NOT NULL`,
        sql`${draftsTable.gmailDraftId} NOT LIKE 'smtp:%'`,
        sql`${draftsTable.status} = 'success'`,
      )
    );

  if (unsent.length === 0) {
    return { autoMarked: 0, checked: 0 };
  }

  let gmail: Awaited<ReturnType<typeof getGmailClient>>;
  try {
    gmail = await getGmailClient(user);
  } catch (err) {
    logger.warn({ err, userId }, "[GMAIL-SYNC] Could not build Gmail client — skipping user");
    return { autoMarked: 0, checked: 0, skipped: "gmail_auth_error" };
  }

  const autoMarkedIds: number[] = [];

  await Promise.all(
    unsent.map(async (draft) => {
      if (!draft.gmailDraftId) return;
      try {
        await gmail.users.drafts.get({
          userId: "me",
          id: draft.gmailDraftId,
          format: "minimal",
        });
        // Draft still exists in Gmail — not sent yet
      } catch (err: any) {
        const status = err?.response?.status ?? err?.status ?? err?.code;
        if (status === 404) {
          // Draft is gone from Gmail → broker sent it
          autoMarkedIds.push(draft.id);
        }
        // Auth/network errors — skip silently; they'll be retried next cycle
      }
    })
  );

  if (autoMarkedIds.length > 0) {
    const sentAt = new Date();
    await db
      .update(draftsTable)
      .set({ sentAt })
      .where(inArray(draftsTable.id, autoMarkedIds));

    logger.info(
      { userId, checked: unsent.length, autoMarked: autoMarkedIds.length },
      "[GMAIL-SYNC] Auto-marked drafts as sent"
    );
  }

  return { autoMarked: autoMarkedIds.length, checked: unsent.length };
}

/**
 * Background sweep — runs across ALL users who have Gmail connected and have
 * unsent drafts. Called on the periodic watchdog interval.
 *
 * Processes users sequentially (not in parallel) to stay well within Gmail's
 * per-user rate limits (250 quota units/second).
 */
export async function runGmailDraftSync(): Promise<void> {
  try {
    // Find every user who has Gmail connected and at least one unsent draft
    const usersWithUnsent = await db
      .selectDistinct({ userId: draftsTable.userId })
      .from(draftsTable)
      .where(
        and(
          sql`${draftsTable.sentAt} IS NULL`,
          sql`${draftsTable.gmailDraftId} IS NOT NULL`,
          sql`${draftsTable.gmailDraftId} NOT LIKE 'smtp:%'`,
          sql`${draftsTable.status} = 'success'`,
        )
      );

    if (usersWithUnsent.length === 0) return;

    logger.debug(
      { userCount: usersWithUnsent.length },
      "[GMAIL-SYNC] Background sweep starting"
    );

    let totalMarked = 0;
    for (const { userId } of usersWithUnsent) {
      const result = await syncSentDrafts(userId);
      totalMarked += result.autoMarked;
      // Small delay between users to avoid hammering the Gmail API
      await new Promise((r) => setTimeout(r, 200));
    }

    if (totalMarked > 0) {
      logger.info(
        { totalMarked, userCount: usersWithUnsent.length },
        "[GMAIL-SYNC] Background sweep complete"
      );
    }
  } catch (err) {
    logger.warn({ err }, "[GMAIL-SYNC] Background sweep skipped (non-fatal)");
  }
}
