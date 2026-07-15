import { Router, type IRouter } from "express";
import { db, usersTable, supportTicketsTable, systemLogsTable } from "@workspace/db";
import type { TicketReply } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import multer from "multer";
import path from "path";
import fs from "fs";

const router: IRouter = Router();

const UPLOAD_DIR = path.join(process.cwd(), "data", "ticket-uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_TYPES = [
  "image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
];

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
      cb(null, `${Date.now()}-${safe}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) cb(null, true);
    else cb(new Error("File type not allowed"));
  },
});

function serialize(t: typeof supportTicketsTable.$inferSelect) {
  return {
    ...t,
    createdAt:  t.createdAt.toISOString(),
    updatedAt:  t.updatedAt.toISOString(),
    resolvedAt: t.resolvedAt?.toISOString() ?? null,
  };
}

// ─── Upload attachment ─────────────────────────────────────────────────────────

router.post("/support/upload", requireAuth, upload.single("file"), (req, res) => {
  if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }
  const url = `/api/support/files/${req.file.filename}`;
  res.json({ url, filename: req.file.originalname, size: req.file.size });
});

router.get("/support/files/:filename", (req, res) => {
  const filename = (req.params.filename as string).replace(/[^a-zA-Z0-9._-]/g, "_");
  const filePath = path.join(UPLOAD_DIR, filename);
  if (!fs.existsSync(filePath)) { res.status(404).json({ error: "File not found" }); return; }
  res.sendFile(filePath);
});

// ─── Public contact form (no auth — marketing site) ─────────────────────────────

router.post("/support/contact", async (req, res): Promise<void> => {
  const { name, email, company, message } =
    req.body as { name: string; email: string; company?: string; message: string };

  if (!name?.trim() || !email?.trim() || !message?.trim()) {
    res.status(400).json({ error: "Name, email, and message are required." }); return;
  }

  const [ticket] = await db.insert(supportTicketsTable).values({
    userId:      null,
    userEmail:   email.trim(),
    userName:    name.trim(),
    subject:     company?.trim() ? `Contact form — ${company.trim()}` : "Contact form submission",
    category:    "contact",
    priority:    "medium",
    message:     message.trim(),
    attachments: [],
    status:      "open",
    replies:     [],
  }).returning();

  await db.insert(systemLogsTable).values({
    userId:      null,
    type:        "contact_message_received",
    severity:    "info",
    description: `Contact form submission from ${email.trim()} (${name.trim()})`,
  });

  res.status(201).json({ ok: true, id: ticket.id });
});

// ─── Create ticket ─────────────────────────────────────────────────────────────

router.post("/support/tickets", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const { subject, category = "general", priority = "medium", message, attachments = [] } =
    req.body as { subject: string; category?: string; priority?: string; message: string; attachments?: string[] };

  if (!subject?.trim() || !message?.trim()) {
    res.status(400).json({ error: "Subject and message are required." }); return;
  }

  const [ticket] = await db.insert(supportTicketsTable).values({
    userId:      user.id,
    userEmail:   user.email,
    userName:    user.name,
    subject:     subject.trim(),
    category,
    priority,
    message:     message.trim(),
    attachments: Array.isArray(attachments) ? attachments : [],
    status:      "open",
    replies:     [],
  }).returning();

  await db.insert(systemLogsTable).values({
    userId:      user.id,
    type:        "support_ticket_created",
    severity:    "info",
    description: `User ${user.email} opened ticket #${ticket.id}: "${subject}"`,
  });

  res.status(201).json(serialize(ticket));
});

// ─── List user tickets ─────────────────────────────────────────────────────────

router.get("/support/tickets", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const tickets = await db.select().from(supportTicketsTable)
    .where(eq(supportTicketsTable.userId, user.id))
    .orderBy(desc(supportTicketsTable.createdAt))
    .limit(50);
  res.json(tickets.map(serialize));
});

// ─── Get single ticket ─────────────────────────────────────────────────────────

router.get("/support/tickets/:id", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const id = parseInt((req.params.id as string), 10);

  const [ticket] = await db.select().from(supportTicketsTable)
    .where(and(eq(supportTicketsTable.id, id), eq(supportTicketsTable.userId, user.id)));

  if (!ticket) { res.status(404).json({ error: "Ticket not found." }); return; }
  res.json(serialize(ticket));
});

// ─── User reply ────────────────────────────────────────────────────────────────

router.post("/support/tickets/:id/reply", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const id = parseInt((req.params.id as string), 10);
  const { message, attachments = [] } = req.body as { message: string; attachments?: string[] };

  if (!message?.trim()) { res.status(400).json({ error: "Message required." }); return; }

  const [ticket] = await db.select().from(supportTicketsTable)
    .where(and(eq(supportTicketsTable.id, id), eq(supportTicketsTable.userId, user.id)));
  if (!ticket) { res.status(404).json({ error: "Ticket not found." }); return; }
  if (ticket.status === "closed") { res.status(400).json({ error: "Cannot reply to a closed ticket." }); return; }

  const replies = (ticket.replies ?? []) as TicketReply[];
  const newReply: TicketReply = {
    id:         Date.now().toString(),
    author:     "user",
    authorName: user.name,
    message:    message.trim(),
    createdAt:  new Date().toISOString(),
  };

  const newStatus = ticket.status === "resolved" ? "open" : ticket.status === "waiting_for_user" ? "open" : ticket.status;

  await db.update(supportTicketsTable).set({
    replies:   [...replies, newReply],
    status:    newStatus,
    updatedAt: new Date(),
  }).where(eq(supportTicketsTable.id, id));

  await db.insert(systemLogsTable).values({
    userId:      user.id,
    type:        "support_ticket_reply",
    severity:    "info",
    description: `User ${user.email} replied to ticket #${id}`,
  });

  res.json({ ok: true, reply: newReply });
});

// ─── Close ticket (by user) ────────────────────────────────────────────────────

router.post("/support/tickets/:id/close", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const id = parseInt((req.params.id as string), 10);

  const [ticket] = await db.select().from(supportTicketsTable)
    .where(and(eq(supportTicketsTable.id, id), eq(supportTicketsTable.userId, user.id)));
  if (!ticket) { res.status(404).json({ error: "Ticket not found." }); return; }

  await db.update(supportTicketsTable).set({
    status:     "closed",
    resolvedAt: new Date(),
    updatedAt:  new Date(),
  }).where(eq(supportTicketsTable.id, id));

  res.json({ ok: true });
});

export default router;
