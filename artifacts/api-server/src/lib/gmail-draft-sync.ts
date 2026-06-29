import { db, draftsTable, usersTable } from "@workspace/db";
import { eq, and, inArray, sql } from "drizzle-orm";
import { getGmailClient } from "./gmail";
import { logger } from "./logger";

/**
 * Fetch all current draft IDs from Gmail for `user` — handles pagination so
 * we never miss a draft even when the user has > 500 sitting unsent.
 */
async function listAllGmailDraftIds(
  gmail: Awaited<ReturnType<typeof getGmailClient>>
): Promise<Set<string>> {
  const ids = new Set<string>();
  let pageToken: string | undefined;

  do {
    const res = await gmail.users.drafts.list({
      userId: "me",
      maxResults: 500,
      ...(pageToken ? { pageToken } : {}),
    });

    for (const d of res.data.drafts ?? []) {
      if (d.id) ids.add(d.id);
    }

    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  return ids;
}

/**
 * Check every unsent Gmail draft for `userId` by comparing our stored draft IDs
 * against Gmail's actual Drafts folder (one list call, not per-draft fetches).
 *
 * If a stored draft ID is absent from Gmail's Drafts folder the broker already
 * sent it → we auto-set sentAt so tracking activates immediately.
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

  // Fetch the complete set of Gmail draft IDs currently in the Drafts folder.
  // Any of our stored IDs that are missing → the broker sent (or deleted) them.
  let currentGmailDraftIds: Set<string>;
  try {
    currentGmailDraftIds = await listAllGmailDraftIds(gmail);
    logger.info(
      { userId, gmailDrafts: currentGmailDraftIds.size, ourUnsent: unsent.length },
      "[GMAIL-SYNC] Draft list fetched"
    );
  } catch (err: any) {
    logger.warn(
      { err: err?.message, userId },
      "[GMAIL-SYNC] Failed to list Gmail drafts — skipping user"
    );
    return { autoMarked: 0, checked: 0, skipped: "list_error" };
  }

  // Cross-reference: IDs absent from Gmail = sent
  const autoMarkedIds: number[] = [];
  for (const draft of unsent) {
    if (!draft.gmailDraftId) continue;
    if (!currentGmailDraftIds.has(draft.gmailDraftId)) {
      autoMarkedIds.push(draft.id);
      logger.info(
        { userId, draftId: draft.id, gmailDraftId: draft.gmailDraftId },
        "[GMAIL-SYNC] Draft absent from Gmail — marking as sent"
      );
    }
  }

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
