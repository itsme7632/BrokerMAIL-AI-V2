import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import type { Request, Response, NextFunction } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const JWT_SECRET = process.env.SESSION_SECRET ?? "dev-secret-change-in-prod";

export interface AuthPayload {
  userId: number;
  email: string;
  role: string;
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string): AuthPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as AuthPayload;
  } catch {
    return null;
  }
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = authHeader.slice(7);
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, payload.userId));
  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }
  (req as Request & { user: typeof user }).user = user;

  // Update lastActiveAt at most once per hour (fire-and-forget)
  const oneHourAgo = new Date(Date.now() - 3_600_000);
  if (!user.lastActiveAt || user.lastActiveAt < oneHourAgo) {
    db.update(usersTable)
      .set({ lastActiveAt: new Date() })
      .where(eq(usersTable.id, user.id))
      .catch(() => {});
  }

  next();
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  await requireAuth(req, res, () => {
    const user = (req as Request & { user: typeof usersTable.$inferSelect }).user;
    if (user?.role !== "admin") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  });
}

declare global {
  namespace Express {
    interface Request {
      user?: typeof usersTable.$inferSelect;
    }
  }
}
