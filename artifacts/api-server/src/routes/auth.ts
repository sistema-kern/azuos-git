import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { tenantAdminsTable, tenantsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { generateTenantToken, verifyPassword, parseTokenPayload, hashPassword, adminAuth } from "../middlewares/adminAuth.js";
import { sql } from "drizzle-orm";

function getClientIp(req: import("express").Request): string | null {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(",")[0];
    return first.trim();
  }
  return req.socket?.remoteAddress ?? null;
}

const router: IRouter = Router();

// POST /auth/login — tenant admin login
router.post("/login", async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || !password) {
    res.status(400).json({ error: "Email e senha são obrigatórios" });
    return;
  }

  const [admin] = await db
    .select()
    .from(tenantAdminsTable)
    .where(and(
      eq(tenantAdminsTable.email, email.trim().toLowerCase()),
      eq(tenantAdminsTable.active, true),
      eq(tenantAdminsTable.tenantId, req.tenantId!),
    ))
    .limit(1);

  if (!admin) {
    res.status(401).json({ error: "Credenciais inválidas" });
    return;
  }

  const valid = await verifyPassword(password, admin.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Credenciais inválidas" });
    return;
  }

  const [tenant] = await db
    .select()
    .from(tenantsTable)
    .where(and(eq(tenantsTable.id, admin.tenantId), eq(tenantsTable.active, true)))
    .limit(1);

  if (!tenant) {
    res.status(403).json({ error: "Tenant inativo ou não encontrado" });
    return;
  }

  const token = generateTenantToken(admin.tenantId, admin.id);

  const clientIp = getClientIp(req);
  if (clientIp) {
    db.execute(sql`
      INSERT INTO analytics_excluded_ips (tenant_id, ip, label)
      VALUES (${admin.tenantId}, ${clientIp}, ${admin.email})
      ON CONFLICT (tenant_id, ip) DO NOTHING
    `).catch(() => {});
  }

  res.json({
    token,
    admin: { id: admin.id, name: admin.name, email: admin.email, tenantId: admin.tenantId },
    tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name, customDomain: tenant.customDomain },
  });
});

// GET /auth/me — get current user info from token
router.get("/me", adminAuth, async (req, res) => {
  const token = req.headers["x-admin-key"] as string;
  const payload = parseTokenPayload(token);

  if (req.adminRole === "super_admin") {
    res.json({ role: "super_admin", tenantId: req.tenantId });
    return;
  }

  if (payload?.role === "tenant_admin" && req.tenantAdminId) {
    const [admin] = await db
      .select({ id: tenantAdminsTable.id, name: tenantAdminsTable.name, email: tenantAdminsTable.email, tenantId: tenantAdminsTable.tenantId })
      .from(tenantAdminsTable)
      .where(eq(tenantAdminsTable.id, req.tenantAdminId))
      .limit(1);

    const [tenant] = await db
      .select({ id: tenantsTable.id, slug: tenantsTable.slug, name: tenantsTable.name, customDomain: tenantsTable.customDomain })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, req.tenantId!))
      .limit(1);

    res.json({ role: "tenant_admin", admin, tenant });
    return;
  }

  res.status(401).json({ error: "Unauthorized" });
});

// POST /auth/change-password — tenant admin only
router.post("/change-password", adminAuth, async (req, res) => {
  if (req.adminRole !== "tenant_admin" || !req.tenantAdminId) {
    res.status(403).json({ error: "Apenas admins de tenant podem alterar senha aqui" });
    return;
  }

  const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };
  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: "Senha atual e nova senha são obrigatórias" });
    return;
  }
  if (newPassword.length < 6) {
    res.status(400).json({ error: "A nova senha deve ter pelo menos 6 caracteres" });
    return;
  }

  const [admin] = await db
    .select()
    .from(tenantAdminsTable)
    .where(eq(tenantAdminsTable.id, req.tenantAdminId))
    .limit(1);

  if (!admin) {
    res.status(404).json({ error: "Admin não encontrado" });
    return;
  }

  const valid = await verifyPassword(currentPassword, admin.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Senha atual incorreta" });
    return;
  }

  const newHash = await hashPassword(newPassword);
  await db
    .update(tenantAdminsTable)
    .set({ passwordHash: newHash })
    .where(eq(tenantAdminsTable.id, req.tenantAdminId));

  res.json({ success: true });
});

export default router;
