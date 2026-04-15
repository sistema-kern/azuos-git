import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { tenantsTable, settingsTable } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import { parseTokenPayload } from "./adminAuth.js";

declare global {
  namespace Express {
    interface Request {
      tenantId?: number;
    }
  }
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const SUPER_TENANT_ID = 0;

// Cache: domain → tenantId
const domainCache = new Map<string, { tenantId: number; expiresAt: number }>();

// Cache: default tenant id (refreshed every 5 min)
let defaultTenantCache: { tenantId: number; expiresAt: number } | null = null;

async function resolveTenantByDomain(domain: string): Promise<number | null> {
  const cached = domainCache.get(domain);
  if (cached && Date.now() < cached.expiresAt) return cached.tenantId;

  const [tenant] = await db
    .select({ id: tenantsTable.id })
    .from(tenantsTable)
    .where(eq(tenantsTable.customDomain, domain))
    .limit(1);

  if (tenant) {
    domainCache.set(domain, { tenantId: tenant.id, expiresAt: Date.now() + CACHE_TTL_MS });
    return tenant.id;
  }
  return null;
}

async function getDefaultTenantId(): Promise<number> {
  if (defaultTenantCache && Date.now() < defaultTenantCache.expiresAt) {
    return defaultTenantCache.tenantId;
  }
  const [row] = await db
    .select({ value: settingsTable.value })
    .from(settingsTable)
    .where(and(eq(settingsTable.tenantId, SUPER_TENANT_ID), eq(settingsTable.key, "default_tenant_id")))
    .limit(1);
  const tenantId = row?.value ? Number(row.value) : 1;
  const resolved = isNaN(tenantId) || tenantId <= 0 ? 1 : tenantId;
  defaultTenantCache = { tenantId: resolved, expiresAt: Date.now() + CACHE_TTL_MS };
  return resolved;
}

/** Invalidate the default tenant cache (call after saving settings) */
export function invalidateDefaultTenantCache() {
  defaultTenantCache = null;
}

/**
 * Resolves tenantId from (in priority order):
 *  1. x-admin-key token with role=tenant_admin (allows public routes to scope correctly)
 *  2. x-tenant-id header (explicit override — used by super admin)
 *  3. Host header matched against customDomain in DB
 *  4. tenantId query param
 *  5. default_tenant_id setting from DB (configurable in /super)
 *
 * Sets req.tenantId for downstream use.
 */
export async function domainTenantMiddleware(req: Request, _res: Response, next: NextFunction) {
  // Check x-admin-key: if it's a tenant_admin token, extract tenantId from it.
  // This ensures public routes also get the correct tenant when called from the admin panel.
  const adminKey = req.headers["x-admin-key"] as string | undefined;
  if (adminKey) {
    const payload = parseTokenPayload(adminKey);
    if (payload && payload.role === "tenant_admin" && typeof payload.tenantId === "number") {
      req.tenantId = payload.tenantId;
      next();
      return;
    }
    // super_admin token: keep going (x-tenant-id header or domain resolution applies)
  }

  // Explicit header (super admin managing a specific tenant)
  const headerTenantId = req.headers["x-tenant-id"];
  if (headerTenantId) {
    const parsed = Number(headerTenantId);
    if (!isNaN(parsed) && parsed > 0) { req.tenantId = parsed; next(); return; }
  }

  // Detect from Host header
  const host = (req.headers.host ?? "").split(":")[0].trim().toLowerCase();
  if (host && host !== "localhost" && !host.endsWith(".replit.dev") && !host.endsWith(".replit.app") && !host.endsWith(".riker.replit.dev")) {
    const tenantId = await resolveTenantByDomain(host);
    if (tenantId) { req.tenantId = tenantId; next(); return; }
  }

  // Query param fallback
  const queryTenantId = req.query["tenantId"];
  if (queryTenantId) {
    const parsed = Number(queryTenantId);
    if (!isNaN(parsed) && parsed > 0) { req.tenantId = parsed; next(); return; }
  }

  // Default tenant from DB setting
  req.tenantId = await getDefaultTenantId();
  next();
}
