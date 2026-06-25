import { Router } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import {
  db, mailboxesTable, composerDraftsTable, emailQueueTable, draftsTable, designTemplatesTable,
  composerEmailTemplatesTable,
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

// ── Upload storage ────────────────────────────────────────────────────────────
const UPLOAD_DIR = path.join(process.cwd(), "../../data/composer-uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const diskStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename:    (_req, file, cb) => cb(null, `${randomUUID()}__${file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`),
});
const uploadDisk = multer({
  storage: diskStorage,
  limits: { fileSize: 25 * 1024 * 1024 },
});
const uploadMem  = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// ── Helpers ───────────────────────────────────────────────────────────────────

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

/** Resolve saved attachment IDs → { filename, content, contentType } for nodemailer/gmail */
function resolveAttachmentIds(ids: string[]): { filename: string; content: Buffer; contentType: string }[] {
  const result: { filename: string; content: Buffer; contentType: string }[] = [];
  for (const id of ids) {
    const filePath = path.join(UPLOAD_DIR, id);
    if (!fs.existsSync(filePath)) continue;
    const originalName = id.replace(/^[a-f0-9-]+__/, "").replace(/_/g, " ");
    try {
      result.push({
        filename:    originalName,
        content:     fs.readFileSync(filePath),
        contentType: "application/octet-stream",
      });
    } catch { /* skip unreadable */ }
  }
  return result;
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
        imapHost:  mailboxesTable.imapHost,
        isActive:  mailboxesTable.isActive,
      })
      .from(mailboxesTable)
      .where(eq(mailboxesTable.userId, user.id))
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
    const { mailboxId, mailboxType, toEmail, ccEmail, bccEmail, subject, body, trackOpen, trackClick, includeBranding, attachmentsMeta } = req.body;
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
      attachmentsMeta: attachmentsMeta ?? "[]",
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
    const { mailboxId, mailboxType, toEmail, ccEmail, bccEmail, subject, body, trackOpen, trackClick, includeBranding, attachmentsMeta } = req.body;
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
        attachmentsMeta: attachmentsMeta ?? "[]",
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

// ── POST /api/composer/upload-attachment ──────────────────────────────────────
router.post("/composer/upload-attachment", requireAuth, uploadDisk.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) { res.status(400).json({ error: "No file provided" }); return; }
    res.json({
      id:   file.filename,
      name: file.originalname,
      size: file.size,
      type: file.mimetype,
    });
  } catch (err: any) {
    logger.error({ err }, "[COMPOSER] Failed to upload attachment");
    res.status(500).json({ error: "Failed to upload attachment" });
  }
});

// ── GET /api/composer/design-templates ───────────────────────────────────────
router.get("/composer/design-templates", requireAuth, async (req, res) => {
  const user = req.user as User;
  try {
    const rows = await db
      .select()
      .from(designTemplatesTable)
      .where(eq(designTemplatesTable.userId, user.id))
      .orderBy(desc(designTemplatesTable.createdAt));
    res.json(rows);
  } catch (err: any) {
    logger.error({ err }, "[COMPOSER] Failed to load design templates");
    res.status(500).json({ error: "Failed to load design templates" });
  }
});

// ── POST /api/composer/design-templates ──────────────────────────────────────
router.post("/composer/design-templates", requireAuth, async (req, res) => {
  const user = req.user as User;
  try {
    const { name, description, htmlLayout } = req.body;
    if (!name?.trim()) { res.status(400).json({ error: "Name is required" }); return; }
    if (!htmlLayout?.trim()) { res.status(400).json({ error: "HTML layout is required" }); return; }
    const [row] = await db.insert(designTemplatesTable).values({
      userId:      user.id,
      name:        name.trim(),
      description: description?.trim() || null,
      htmlLayout:  htmlLayout,
    }).returning();
    res.json(row);
  } catch (err: any) {
    logger.error({ err }, "[COMPOSER] Failed to create design template");
    res.status(500).json({ error: "Failed to create design template" });
  }
});

// ── PUT /api/composer/design-templates/:id ────────────────────────────────────
router.put("/composer/design-templates/:id", requireAuth, async (req, res) => {
  const user = req.user as User;
  const id   = parseInt(req.params.id);
  try {
    const { name, description, htmlLayout } = req.body;
    const [row] = await db
      .update(designTemplatesTable)
      .set({
        name:        name?.trim() || undefined,
        description: description?.trim() || null,
        htmlLayout:  htmlLayout || undefined,
        updatedAt:   new Date(),
      })
      .where(and(eq(designTemplatesTable.id, id), eq(designTemplatesTable.userId, user.id)))
      .returning();
    if (!row) { res.status(404).json({ error: "Template not found" }); return; }
    res.json(row);
  } catch (err: any) {
    logger.error({ err }, "[COMPOSER] Failed to update design template");
    res.status(500).json({ error: "Failed to update design template" });
  }
});

// ── DELETE /api/composer/design-templates/:id ─────────────────────────────────
router.delete("/composer/design-templates/:id", requireAuth, async (req, res) => {
  const user = req.user as User;
  const id   = parseInt(req.params.id);
  try {
    await db.delete(designTemplatesTable)
      .where(and(eq(designTemplatesTable.id, id), eq(designTemplatesTable.userId, user.id)));
    res.json({ ok: true });
  } catch (err: any) {
    logger.error({ err }, "[COMPOSER] Failed to delete design template");
    res.status(500).json({ error: "Failed to delete design template" });
  }
});

// ── POST /api/composer/design-templates/:id/duplicate ────────────────────────
router.post("/composer/design-templates/:id/duplicate", requireAuth, async (req, res) => {
  const user = req.user as User;
  const id   = parseInt(req.params.id);
  try {
    const [original] = await db.select()
      .from(designTemplatesTable)
      .where(and(eq(designTemplatesTable.id, id), eq(designTemplatesTable.userId, user.id)));
    if (!original) { res.status(404).json({ error: "Template not found" }); return; }
    const [copy] = await db.insert(designTemplatesTable).values({
      userId:      user.id,
      name:        `${original.name} (Copy)`,
      description: original.description,
      htmlLayout:  original.htmlLayout,
    }).returning();
    res.json(copy);
  } catch (err: any) {
    logger.error({ err }, "[COMPOSER] Failed to duplicate design template");
    res.status(500).json({ error: "Failed to duplicate design template" });
  }
});

// ── POST /api/composer/ai-generate ───────────────────────────────────────────
router.post("/composer/ai-generate", requireAuth, async (req, res) => {
  const { prompt, subject, tone } = req.body;
  if (!prompt?.trim()) { res.status(400).json({ error: "Prompt is required" }); return; }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "AI features require an OpenAI API key. Please configure OPENAI_API_KEY in Settings." });
    return;
  }

  try {
    const systemPrompt = `You are a professional email copywriter for an auto transport brokerage company. 
Write compelling, professional email content in HTML format. 
Use <p>, <ul>, <li>, <strong>, <em> tags. 
Do NOT include <html>, <head>, <body> or CSS — just the inner content.
Keep it concise, professional, and action-oriented.
${tone ? `Tone: ${tone}` : ""}`;

    const userPrompt = `Write email body HTML for: ${prompt}
${subject ? `Email subject: ${subject}` : ""}

Return ONLY the inner HTML content, no wrapper tags.`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 1000,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error((err as any)?.error?.message || `OpenAI error ${response.status}`);
    }

    const data = await response.json() as any;
    const generatedHtml = data.choices?.[0]?.message?.content?.trim() || "";
    res.json({ html: generatedHtml });
  } catch (err: any) {
    logger.error({ err }, "[COMPOSER] AI generate failed");
    res.status(500).json({ error: err.message || "AI generation failed" });
  }
});

// ── POST /api/composer/test ───────────────────────────────────────────────────
router.post("/composer/test", requireAuth, uploadMem.array("attachments"), async (req, res) => {
  const user  = req.user as User;
  const files = (req.files as Express.Multer.File[]) || [];
  try {
    const { mailboxId, mailboxType, subject, bodyHtml, testRecipient, attachmentIds } = req.body;
    const recipient = testRecipient || user.email;
    if (!recipient) { res.status(400).json({ error: "No test recipient available" }); return; }

    // Resolve stored attachment IDs → buffers
    const storedIds: string[] = attachmentIds ? JSON.parse(attachmentIds) : [];
    const storedAttachments = resolveAttachmentIds(storedIds);
    const uploadedAttachments = files.map(f => ({ filename: f.originalname, content: f.buffer, contentType: f.mimetype }));
    const allAttachments = [...storedAttachments, ...uploadedAttachments];

    const banner = `<div style="background:#fef3c7;border:1px solid #fcd34d;padding:8px 12px;border-radius:4px;font-size:12px;margin-bottom:12px;"><strong>⚠ TEST EMAIL</strong> — This is a preview sent by BrokerMAIL Composer.</div>`;
    const finalHtml = banner + (bodyHtml ?? "");
    const textBody  = stripHtml(finalHtml);

    if (mailboxType === "gmail") {
      await sendGmailMessage(user, {
        to: recipient,
        subject: `[TEST] ${subject ?? "Test Email"}`,
        bodyText: textBody,
        bodyHtml: finalHtml,
        attachments: allAttachments,
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
        attachments: allAttachments,
      });
    }

    res.json({ ok: true, sentTo: recipient });
  } catch (err: any) {
    logger.error({ err }, "[COMPOSER] Test send failed");
    res.status(500).json({ error: err.message || "Failed to send test email" });
  }
});

// ── POST /api/composer/send ───────────────────────────────────────────────────
router.post("/composer/send", requireAuth, uploadMem.array("attachments"), async (req, res) => {
  const user  = req.user as User;
  const files = (req.files as Express.Multer.File[]) || [];
  try {
    const {
      mailboxId, mailboxType, to, cc, bcc, subject, bodyHtml,
      trackOpen: trackOpenStr, trackClick: trackClickStr, attachmentIds,
    } = req.body;

    if (!to?.trim()) { res.status(400).json({ error: "To address is required" }); return; }

    // Resolve stored attachment IDs → buffers
    const storedIds: string[] = attachmentIds ? JSON.parse(attachmentIds) : [];
    const storedAttachments = resolveAttachmentIds(storedIds);
    const uploadedAttachments = files.map(f => ({ filename: f.originalname, content: f.buffer, contentType: f.mimetype }));
    const allAttachments = [...storedAttachments, ...uploadedAttachments];

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
        attachments: allAttachments,
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
        attachments: allAttachments,
      });
    }

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

    // Clean up uploaded attachment files after successful send
    for (const id of storedIds) {
      try { fs.unlinkSync(path.join(UPLOAD_DIR, id)); } catch { /* ignore */ }
    }

    logger.info({ userId: user.id, to, mailboxType, trackingId }, "[COMPOSER] Email sent");
    res.json({ ok: true, trackingId });
  } catch (err: any) {
    logger.error({ err }, "[COMPOSER] Send failed");
    res.status(500).json({ error: err.message || "Failed to send email" });
  }
});

// ── GET /api/composer/email-templates ─────────────────────────────────────────
router.get("/composer/email-templates", requireAuth, async (req, res) => {
  const user = req.user as User;
  try {
    const rows = await db
      .select()
      .from(composerEmailTemplatesTable)
      .where(eq(composerEmailTemplatesTable.userId, user.id))
      .orderBy(desc(composerEmailTemplatesTable.updatedAt));
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to load email templates" });
  }
});

// ── POST /api/composer/email-templates ────────────────────────────────────────
router.post("/composer/email-templates", requireAuth, async (req, res) => {
  const user = req.user as User;
  try {
    const { name, subject, body, designId, includeBranding } = req.body;
    if (!name?.trim()) { res.status(400).json({ error: "Name is required" }); return; }
    const [row] = await db.insert(composerEmailTemplatesTable).values({
      userId:          user.id,
      name:            name.trim(),
      subject:         subject ?? "",
      body:            body ?? "",
      designId:        designId ?? "professional",
      includeBranding: includeBranding !== undefined ? Boolean(includeBranding) : true,
    }).returning();
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to save email template" });
  }
});

// ── PUT /api/composer/email-templates/:id ─────────────────────────────────────
router.put("/composer/email-templates/:id", requireAuth, async (req, res) => {
  const user = req.user as User;
  const id   = parseInt(req.params.id);
  try {
    const { name, subject, body, designId, includeBranding } = req.body;
    const [row] = await db
      .update(composerEmailTemplatesTable)
      .set({
        ...(name            !== undefined && { name: name.trim() }),
        ...(subject         !== undefined && { subject }),
        ...(body            !== undefined && { body }),
        ...(designId        !== undefined && { designId }),
        ...(includeBranding !== undefined && { includeBranding: Boolean(includeBranding) }),
        updatedAt: new Date(),
      })
      .where(and(eq(composerEmailTemplatesTable.id, id), eq(composerEmailTemplatesTable.userId, user.id)))
      .returning();
    if (!row) { res.status(404).json({ error: "Template not found" }); return; }
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to update email template" });
  }
});

// ── DELETE /api/composer/email-templates/:id ──────────────────────────────────
router.delete("/composer/email-templates/:id", requireAuth, async (req, res) => {
  const user = req.user as User;
  const id   = parseInt(req.params.id);
  try {
    await db.delete(composerEmailTemplatesTable)
      .where(and(eq(composerEmailTemplatesTable.id, id), eq(composerEmailTemplatesTable.userId, user.id)));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to delete email template" });
  }
});

// ── POST /api/composer/email-templates/:id/duplicate ──────────────────────────
router.post("/composer/email-templates/:id/duplicate", requireAuth, async (req, res) => {
  const user = req.user as User;
  const id   = parseInt(req.params.id);
  try {
    const [original] = await db.select()
      .from(composerEmailTemplatesTable)
      .where(and(eq(composerEmailTemplatesTable.id, id), eq(composerEmailTemplatesTable.userId, user.id)));
    if (!original) { res.status(404).json({ error: "Template not found" }); return; }
    const [copy] = await db.insert(composerEmailTemplatesTable).values({
      userId:          user.id,
      name:            `${original.name} (Copy)`,
      subject:         original.subject,
      body:            original.body,
      designId:        original.designId,
      includeBranding: original.includeBranding,
    }).returning();
    res.json(copy);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to duplicate email template" });
  }
});

export default router;
