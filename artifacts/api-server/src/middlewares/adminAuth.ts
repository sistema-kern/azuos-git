import { Request, Response, NextFunction } from "express";
import { createHmac, timingSafeEqual, randomBytes, scrypt } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(scrypt);

declare global {
  namespace Express {
    interface Request {
      tenantId?: number;
      adminRole?: "super_admin" | "tenant_admin";
      tenantAdminId?: number;
    }
  }
}

function getAdminPassword(): string {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) throw new Error("ADMIN_PASSWORD environment variable is required");
  return pw;
}

// ── Token generation / verification ──────────────────────────────────────────

export function generateAdminToken(): string {
  const password = getAdminPassword();
  const payload = JSON.stringify({ ts: Date.now(), role: "super_admin", nonce: randomBytes(8).toString("hex") });
  const payloadB64 = Buffer.from(payload).toString("base64url");
  const signature = createHmac("sha256", password).update(payloadB64).digest("hex");
  return `${payloadB64}.${signature}`;
}

export function generateTenantToken(tenantId: number, adminId: number): string {
  const password = getAdminPassword();
  const payload = JSON.stringify({ ts: Date.now(), role: "tenant_admin", tenantId, adminId, nonce: randomBytes(8).toString("hex") });
  const payloadB64 = Buffer.from(payload).toString("base64url");
  const signature = createHmac("sha256", password).update(payloadB64).digest("hex");
  return `${payloadB64}.${signature}`;
}

export function parseTokenPayload(token: string): Record<string, unknown> | null {
  try {
    const password = getAdminPassword();
    const dotIndex = token.lastIndexOf(".");
    if (dotIndex === -1) return null;

    const payloadB64 = token.substring(0, dotIndex);
    const sig = token.substring(dotIndex + 1);

    const expectedSig = createHmac("sha256", password).update(payloadB64).digest("hex");
    const sigBuf = Buffer.from(sig, "hex");
    const expectedBuf = Buffer.from(expectedSig, "hex");
    if (sigBuf.length !== expectedBuf.length) return null;
    if (!timingSafeEqual(sigBuf, expectedBuf)) return null;

    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
    const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
    if (Date.now() - (payload.ts as number) > TOKEN_TTL_MS) return null;

    return payload;
  } catch {
    return null;
  }
}

export function verifyAdminToken(token: string): boolean {
  const payload = parseTokenPayload(token);
  if (!payload) return false;
  return payload.role === "admin" || payload.role === "super_admin";
}

// ── Password hashing ──────────────────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const hashBuffer = Buffer.from(hash, "hex");
  const suppliedHash = (await scryptAsync(password, salt, 64)) as Buffer;
  return timingSafeEqual(hashBuffer, suppliedHash);
}

// ── Middlewares ───────────────────────────────────────────────────────────────

/**
 * adminAuth: accepts both super_admin tokens (ADMIN_PASSWORD) and tenant_admin tokens.
 * Sets req.tenantId and req.adminRole on the request.
 * Super admin defaults to tenantId=1, but can override with X-Tenant-Id header.
 */
export function adminAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.headers["x-admin-key"] as string | undefined;
  if (!token) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return;
  }

  const payload = parseTokenPayload(token);
  if (!payload) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return;
  }

  if (payload.role === "admin" || payload.role === "super_admin") {
    req.adminRole = "super_admin";
    const tenantHeader = req.headers["x-tenant-id"];
    // Prefer explicit x-tenant-id header, then domain-resolved tenantId (set by domainTenantMiddleware), then default to 1
    req.tenantId = tenantHeader ? parseInt(tenantHeader as string, 10) : (req.tenantId ?? 1);
  } else if (payload.role === "tenant_admin") {
    req.adminRole = "tenant_admin";
    req.tenantId = payload.tenantId as number;
    req.tenantAdminId = payload.adminId as number;
  } else {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return;
  }

  next();
}

/**
 * superAdminAuth: only allows super_admin tokens.
 */
export function superAdminAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.headers["x-admin-key"] as string | undefined;
  if (!token) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return;
  }

  const payload = parseTokenPayload(token);
  if (!payload || (payload.role !== "admin" && payload.role !== "super_admin")) {
    res.status(403).json({ success: false, message: "Super admin access required" });
    return;
  }

  next();
}
