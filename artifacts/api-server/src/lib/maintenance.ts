import type { Request, Response, NextFunction } from "express";
import { db, adminSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { verifyToken } from "./auth";

let cachedMode: string | null = null;
let cacheExpiry = 0;
const CACHE_TTL = 15_000;

async function isMaintenanceOn(): Promise<boolean> {
  const now = Date.now();
  if (cachedMode !== null && now < cacheExpiry) {
    return cachedMode === "true";
  }
  try {
    const [row] = await db
      .select({ value: adminSettingsTable.value })
      .from(adminSettingsTable)
      .where(eq(adminSettingsTable.key, "maintenanceMode"));
    cachedMode = row?.value ?? "false";
    cacheExpiry = now + CACHE_TTL;
    return cachedMode === "true";
  } catch {
    return false;
  }
}

export function invalidateMaintenanceCache(): void {
  cachedMode = null;
  cacheExpiry = 0;
}

const BYPASS_PATHS = [
  "/api/auth/",
  "/api/admin/",
  "/api/tracking/",
  "/api/health",
];

export async function maintenanceMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (BYPASS_PATHS.some(p => req.path.startsWith(p))) {
    next();
    return;
  }

  const on = await isMaintenanceOn();
  if (!on) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const payload = verifyToken(token);
    if (payload?.role === "admin") {
      next();
      return;
    }
  }

  res.status(503).json({
    error: "BrokerMAIL AI is currently in maintenance mode.",
    maintenance: true,
  });
}
