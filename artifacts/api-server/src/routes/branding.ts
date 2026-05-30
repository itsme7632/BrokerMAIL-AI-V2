import { Router, type IRouter } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

const ALLOWED_MIME = ["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp", "image/svg+xml"];
const MAX_LOGO_BYTES = 600 * 1024; // 600 KB

router.get("/users/branding", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const [row] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
  res.json({
    agentName:      row?.agentName      ?? "",
    companyName:    row?.companyName    ?? "",
    companyTagline: row?.companyTagline ?? "",
    companyWebsite: row?.companyWebsite ?? "",
    companyPhone:   row?.companyPhone   ?? "",
    usdot:          row?.usdot          ?? "",
    mcNumber:       row?.mcNumber       ?? "",
    accentColor:    row?.accentColor    ?? "",
    useSignature:   row?.useSignature   ?? false,
    logoUrl:        row?.logoUrl        ?? null,
  });
});

router.put("/users/branding", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const {
    agentName, companyName, companyTagline, companyWebsite, companyPhone,
    usdot, mcNumber, accentColor, useSignature,
  } = req.body as {
    agentName?:      string;
    companyName?:    string;
    companyTagline?: string;
    companyWebsite?: string;
    companyPhone?:   string;
    usdot?:          string;
    mcNumber?:       string;
    accentColor?:    string;
    useSignature?:   boolean;
  };

  await db.update(usersTable).set({
    agentName:      agentName?.trim()      || null,
    companyName:    companyName?.trim()    || null,
    companyTagline: companyTagline?.trim() || null,
    companyWebsite: companyWebsite?.trim() || null,
    companyPhone:   companyPhone?.trim()   || null,
    usdot:          usdot?.trim()          || null,
    mcNumber:       mcNumber?.trim()       || null,
    accentColor:    accentColor?.trim()    || null,
    useSignature:   useSignature === true,
    updatedAt: new Date(),
  }).where(eq(usersTable.id, user.id));

  res.json({ ok: true });
});

// ─── POST /api/users/logo ─────────────────────────────────────────────────────
// Accepts { logoDataUrl: "data:image/png;base64,..." } or { remove: true }

router.post("/users/logo", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const { logoDataUrl, remove } = req.body as {
    logoDataUrl?: string;
    remove?: boolean;
  };

  if (remove) {
    await db.update(usersTable).set({ logoUrl: null, updatedAt: new Date() })
      .where(eq(usersTable.id, user.id));
    res.json({ ok: true, logoUrl: null });
    return;
  }

  if (!logoDataUrl || typeof logoDataUrl !== "string") {
    res.status(400).json({ error: "logoDataUrl is required" });
    return;
  }

  // Validate data URL format: data:<mime>;base64,<data>
  const match = logoDataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    res.status(400).json({ error: "Invalid data URL format" });
    return;
  }

  const [, mime, base64Data] = match;
  if (!ALLOWED_MIME.includes(mime)) {
    res.status(400).json({ error: "Only PNG, JPG, GIF, WebP, and SVG images are allowed" });
    return;
  }

  const byteLength = Math.ceil((base64Data.length * 3) / 4);
  if (byteLength > MAX_LOGO_BYTES) {
    res.status(400).json({ error: "Logo must be under 600 KB" });
    return;
  }

  await db.update(usersTable).set({ logoUrl: logoDataUrl, updatedAt: new Date() })
    .where(eq(usersTable.id, user.id));

  res.json({ ok: true, logoUrl: logoDataUrl });
});

export default router;
