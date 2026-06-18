import { Router } from "express";
import multer from "multer";
import {
  db, mailboxesTable, composerDraftsTable, emailQueueTable, draftsTable,
} from "@workspace/db";
import type { User } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { sendEmail } from "../lib/smtp";
import { sendGmailMessage } from "../lib/gmail";
import { logger } from "../lib/logger";
import { randomUUID } from "crypto";
import { getTrackingSettings } from "../lib/tracking-settings";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

function injectClickTracking(html: string, trackingId: string, base: string): string {
  return html.replace(
    /href="(https?:\/\/[^"]+)"/gi,
    (_, url) => `href="${base}/api/track/click/${trackingId}?url=${encodeURIComponent(url)}"`,
  );
}

function injectOpenPixel(html: string, trackingId: string, base: string): string {
  const pixel = `<img src="${base}/api/track/open/${trackingId}" width="1" height="1" alt="" `
    + `style="display:none!important;width:1px!important;height:1px!important;border:0;" />`;
  return /<\/body>/i.test(html)
    ? html.replace(/<\/body>/i, pixel + "</body>")
    : html + pixel;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

// ── GET /api/composer/mailboxes ───────────────────────────────────────────────
router.get("/composer/mailboxes", requireAuth, async (req, res) => {
  const user = req.user as User;
  try {
    const mailboxes = await db
      .select({
        id:        mailboxesTable.id,
        smtpUser:  mailboxesTable.smtpUser,
        fromName:  mailboxesTable.fromName,
        smtpHost:  mailboxesTable.smtpHost,
        isActive:  mailboxesTable.isActive,
      })
      .from(mailboxesTable)
      .where(and(eq(mailboxesTable.userId, user.id), eq(mailboxesTable.isActive, true)))
      .orderBy(mailboxesTable.id);

    const gmailConnected = !!(user.gmailAccessToken && user.gmailRefreshToken);
    res.json({ mailboxes, gmailConnected, userEmail: user.email, userName: user.name });
  } catch (err: any) {
    logger.error({ err }, "[COMPOSER] Failed to load mailboxes");
    res.status(500).json({ error: "Failed to load mailboxes" });
  }
});

// ── GET /api/composer/drafts ──────────────────────────────────────────────────
router.get("/composer/drafts", requireAuth, async (req, res) => {
  const user = req.user as User;
  try {
    const rows = await db
      .select()
      .from(composerDraftsTable)
      .where(and(eq(composerDraftsTable.userId, user.id), eq(composerDraftsTable.status, "draft")))
      .orderBy(desc(composerDraftsTable.updatedAt));
    res.json(rows);
  } catch (err: any) {
    logger.error({ err }, "[COMPOSER] Failed to load drafts");
    res.status(500).json({ error: "Failed to load drafts" });
  }
});

// ── POST /api/composer/drafts ─────────────────────────────────────────────────
router.post("/composer/drafts", requireAuth, async (req, res) => {
  const user = req.user as User;
  try {
    const { mailboxId, mailboxType, toEmail, ccEmail, bccEmail, subject, body, trackOpen, trackClick, includeBranding } = req.body;
    const [draft] = await db.insert(composerDraftsTable).values({
      userId:          user.id,
      mailboxId:       mailboxId ? parseInt(mailboxId) : null,
      mailboxType:     mailboxType ?? "smtp",
      toEmail:         toEmail ?? "",
      ccEmail:         ccEmail ?? "",
      bccEmail:        bccEmail ?? "",
      subject:         subject ?? "",
      body:            body ?? "",
      trackOpen:       trackOpen !== undefined ? (trackOpen === true || trackOpen === "true") : true,
      trackClick:      trackClick !== undefined ? (trackClick === true || trackClick === "true") : true,
      includeBranding: includeBranding !== undefined ? (includeBranding === true || includeBranding === "true") : true,
      status:          "draft",
    }).returning();
    res.json(draft);
  } catch (err: any) {
    logger.error({ err }, "[COMPOSER] Failed to save draft");
    res.status(500).json({ error: "Failed to save draft" });
  }
});

// ── PUT /api/composer/drafts/:id ──────────────────────────────────────────────
router.put("/composer/drafts/:id", requireAuth, async (req, res) => {
  const user = req.user as User;
  const id   = parseInt(req.params.id);
  try {
    const { mailboxId, mailboxType, toEmail, ccEmail, bccEmail, subject, body, trackOpen, trackClick, includeBranding } = req.body;
    const [draft] = await db
      .update(composerDraftsTable)
      .set({
        mailboxId:       mailboxId ? parseInt(mailboxId) : null,
        mailboxType:     mailboxType ?? "smtp",
        toEmail:         toEmail ?? "",
        ccEmail:         ccEmail ?? "",
        bccEmail:        bccEmail ?? "",
        subject:         subject ?? "",
        body:            body ?? "",
        trackOpen:       trackOpen !== undefined ? (trackOpen === true || trackOpen === "true") : true,
        trackClick:      trackClick !== undefined ? (trackClick === true || trackClick === "true") : true,
        includeBranding: includeBranding !== undefined ? (includeBranding === true || includeBranding === "true") : true,
        updatedAt:       new Date(),
      })
      .where(and(eq(composerDraftsTable.id, id), eq(composerDraftsTable.userId, user.id)))
      .returning();
    if (!draft) { res.status(404).json({ error: "Draft not found" }); return; }
    res.json(draft);
  } catch (err: any) {
    logger.error({ err }, "[COMPOSER] Failed to update draft");
    res.status(500).json({ error: "Failed to update draft" });
  }
});

// ── DELETE /api/composer/drafts/:id ──────────────────────────────────────────
router.delete("/composer/drafts/:id", requireAuth, async (req, res) => {
  const user = req.user as User;
  const id   = parseInt(req.params.id);
  try {
    await db.delete(composerDraftsTable)
      .where(and(eq(composerDraftsTable.id, id), eq(composerDraftsTable.userId, user.id)));
    res.json({ ok: true });
  } catch (err: any) {
    logger.error({ err }, "[COMPOSER] Failed to delete draft");
    res.status(500).json({ error: "Failed to delete draft" });
  }
});

// ── POST /api/composer/test ───────────────────────────────────────────────────
router.post("/composer/test", requireAuth, upload.array("attachments"), async (req, res) => {
  const user  = req.user as User;
  const files = (req.files as Express.Multer.File[]) || [];
  try {
    const { mailboxId, mailboxType, subject, bodyHtml, testRecipient } = req.body;
    const recipient = testRecipient || user.email;
    if (!recipient) { res.status(400).json({ error: "No test recipient available" }); return; }

    const banner = `<div style="background:#fef3c7;border:1px solid #fcd34d;padding:8px 12px;border-radius:4px;font-size:12px;margin-bottom:12px;"><strong>⚠ TEST EMAIL</strong> — This is a preview sent by BrokerMAIL Composer.</div>`;
    const finalHtml = banner + (bodyHtml ?? "");
    const textBody  = stripHtml(finalHtml);

    if (mailboxType === "gmail") {
      await sendGmailMessage(user, {
        to: recipient,
        subject: `[TEST] ${subject ?? "Test Email"}`,
        bodyText: textBody,
        bodyHtml: finalHtml,
        attachments: files.map(f => ({ filename: f.originalname, content: f.buffer, contentType: f.mimetype })),
      });
    } else {
      const mbId = parseInt(mailboxId);
      if (!mbId) { res.status(400).json({ error: "Mailbox required for SMTP send" }); return; }
      const [mailbox] = await db.select().from(mailboxesTable)
        .where(and(eq(mailboxesTable.id, mbId), eq(mailboxesTable.userId, user.id)));
      if (!mailbox) { res.status(404).json({ error: "Mailbox not found" }); return; }

      await sendEmail(mailbox, {
        to:          recipient,
        subject:     `[TEST] ${subject ?? "Test Email"}`,
        text:        textBody,
        html:        finalHtml,
        attachments: files.map(f => ({ filename: f.originalname, content: f.buffer, contentType: f.mimetype })),
      });
    }

    res.json({ ok: true, sentTo: recipient });
  } catch (err: any) {
    logger.error({ err }, "[COMPOSER] Test send failed");
    res.status(500).json({ error: err.message || "Failed to send test email" });
  }
});

// ── POST /api/composer/send ───────────────────────────────────────────────────
router.post("/composer/send", requireAuth, upload.array("attachments"), async (req, res) => {
  const user  = req.user as User;
  const files = (req.files as Express.Multer.File[]) || [];
  try {
    const {
      mailboxId, mailboxType, to, cc, bcc, subject, bodyHtml,
      trackOpen: trackOpenStr, trackClick: trackClickStr,
    } = req.body;

    if (!to?.trim()) { res.status(400).json({ error: "To address is required" }); return; }

    const shouldTrackOpen  = trackOpenStr  !== "false";
    const shouldTrackClick = trackClickStr !== "false";
    const trackingId       = randomUUID();
    const ts               = await getTrackingSettings();
    const base             = ts.trackingUrl;

    let finalHtml = bodyHtml ?? "";
    if (shouldTrackClick && finalHtml) finalHtml = injectClickTracking(finalHtml, trackingId, base);
    if (shouldTrackOpen  && finalHtml) finalHtml = injectOpenPixel(finalHtml, trackingId, base);
    const textBody = stripHtml(finalHtml);

    let actualMailboxId = 0;

    if (mailboxType === "gmail") {
      await sendGmailMessage(user, {
        to,
        cc:          cc || undefined,
        bcc:         bcc || undefined,
        subject:     subject ?? "",
        bodyText:    textBody,
        bodyHtml:    finalHtml,
        attachments: files.map(f => ({ filename: f.originalname, content: f.buffer, contentType: f.mimetype })),
      });
    } else {
      const mbId = parseInt(mailboxId);
      if (!mbId) { res.status(400).json({ error: "Mailbox required for SMTP send" }); return; }
      const [mailbox] = await db.select().from(mailboxesTable)
        .where(and(eq(mailboxesTable.id, mbId), eq(mailboxesTable.userId, user.id)));
      if (!mailbox) { res.status(404).json({ error: "Mailbox not found" }); return; }
      actualMailboxId = mailbox.id;

      await sendEmail(mailbox, {
        to,
        cc:          cc || undefined,
        bcc:         bcc || undefined,
        subject:     subject ?? "",
        text:        textBody,
        html:        finalHtml,
        attachments: files.map(f => ({ filename: f.originalname, content: f.buffer, contentType: f.mimetype })),
      });
    }

    // Record in emailQueueTable so the email appears in Sent Emails
    await db.insert(emailQueueTable).values({
      jobId:              `composer:${trackingId}`,
      userId:             user.id,
      mailboxId:          actualMailboxId,
      templateId:         0,
      email:              to,
      subject:            subject ?? "",
      rowDataJson:        "{}",
      style:              "clean",
      useSignatureBuilder: false,
      status:             "success",
      trackingId,
      sentAt:             new Date(),
    });

    // Insert minimal drafts record so open/click tracking events can resolve
    try {
      await db.insert(draftsTable).values({
        userId:       user.id,
        campaignId:   null,
        leadId:       null,
        gmailDraftId: `${mailboxType === "gmail" ? "gmail" : "smtp"}-composer:${trackingId}`,
        email:        to,
        subject:      subject ?? "",
        body:         finalHtml,
        status:       "success",
        trackingId,
        sentAt:       new Date(),
      });
    } catch (draftErr) {
      logger.warn({ draftErr }, "[COMPOSER] Could not insert tracking draft (non-fatal)");
    }

    logger.info({ userId: user.id, to, mailboxType, trackingId }, "[COMPOSER] Email sent");
    res.json({ ok: true, trackingId });
  } catch (err: any) {
    logger.error({ err }, "[COMPOSER] Send failed");
    res.status(500).json({ error: err.message || "Failed to send email" });
  }
});

export default router;
