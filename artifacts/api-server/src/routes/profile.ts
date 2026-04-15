import { Router, type IRouter, type Request } from "express";
import { db } from "@workspace/db";
import { settingsTable, tenantsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { adminAuth } from "../middlewares/adminAuth.js";
import multer from "multer";
import path from "path";
import { saveTenantUpload } from "../lib/uploadHelper.js";

const router: IRouter = Router();

const PROFILE_KEYS = [
  "company_name",
  "company_cnpj",
  "company_phone",
  "company_address",
  "company_description",
  "contact_email",
  "contact_map_embed",
  "logo_url",
  "favicon_url",
  "theme_primary",
  "theme_background",
  "theme_primary_foreground",
  "instagram_handle",
  "instagram_description",
  "copa_page_name",
  "copa_page_title",
  "copa_page_description",
  "nav_hidden",
] as const;
type ProfileKey = (typeof PROFILE_KEYS)[number];

function getPublicTenantId(req: Request): number {
  const h = req.headers["x-tenant-id"] as string | undefined;
  if (h && !isNaN(parseInt(h, 10))) return parseInt(h, 10);
  const q = req.query.tenantId as string | undefined;
  if (q && !isNaN(parseInt(q, 10))) return parseInt(q, 10);
  return req.tenantId ?? 1;
}

async function getProfileSetting(tenantId: number, key: ProfileKey): Promise<string | null> {
  const rows = await db.select().from(settingsTable)
    .where(and(eq(settingsTable.tenantId, tenantId), eq(settingsTable.key, key)))
    .limit(1);
  return rows[0]?.value ?? null;
}

async function setProfileSetting(tenantId: number, key: string, value: string): Promise<void> {
  await db
    .insert(settingsTable)
    .values({ tenantId, key, value })
    .onConflictDoUpdate({
      target: [settingsTable.tenantId, settingsTable.key],
      set: { value, updatedAt: new Date() },
    });
}

const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg"];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error("Formato não suportado. Use JPG, PNG, WEBP, SVG ou GIF."));
    }
  },
});

function resolveLogoUrl(logoValue: string | undefined): string {
  if (!logoValue) return "";
  if (logoValue.startsWith("http")) return logoValue;
  if (logoValue.startsWith("/objects/")) return `/api/storage${logoValue}`; // legacy GCS
  if (logoValue.startsWith("/tenant-")) return `/api/uploads${logoValue}`; // local disk
  if (logoValue.startsWith("/api/")) return logoValue; // already a full API path
  return logoValue;
}

// GET /profile - public, returns company info and theme
router.get("/", async (req, res) => {
  const tenantId = getPublicTenantId(req);
  const keys: ProfileKey[] = [
    "company_name", "company_cnpj", "company_phone", "company_address",
    "company_description", "contact_email", "contact_map_embed",
    "logo_url", "favicon_url", "theme_primary", "theme_background",
    "theme_primary_foreground", "instagram_handle", "instagram_description",
    "copa_page_name", "copa_page_title", "copa_page_description", "nav_hidden",
  ];

  const [rows, tenantRows, superLogoRows] = await Promise.all([
    db.select().from(settingsTable)
      .where(eq(settingsTable.tenantId, tenantId))
      .then((rs) => rs.filter((r) => keys.includes(r.key as ProfileKey))),
    db.select({ active: tenantsTable.active, subscriptionStatus: tenantsTable.subscriptionStatus }).from(tenantsTable)
      .where(eq(tenantsTable.id, tenantId)).limit(1),
    db.select({ value: settingsTable.value }).from(settingsTable)
      .where(and(eq(settingsTable.tenantId, 0), eq(settingsTable.key, "platform_logo_url"))).limit(1),
  ]);

  const result: Record<string, string> = {};
  for (const r of rows) result[r.key] = r.value;

  const tenantActiveRaw = tenantRows[0]?.active ?? true;
  const subscriptionStatus = tenantRows[0]?.subscriptionStatus ?? "active";
  const tenantActive = tenantActiveRaw && subscriptionStatus !== "cancelled" && subscriptionStatus !== "suspended";
  const superLogoUrl = resolveLogoUrl(superLogoRows[0]?.value);

  res.json({
    company_name: result.company_name ?? "Azuos Esportes",
    company_cnpj: result.company_cnpj ?? "",
    company_phone: result.company_phone ?? "",
    company_address: result.company_address ?? "",
    company_description: result.company_description ?? "",
    contact_email: result.contact_email ?? "",
    contact_map_embed: result.contact_map_embed ?? "",
    logo_url: resolveLogoUrl(result.logo_url),
    favicon_url: resolveLogoUrl(result.favicon_url),
    theme_primary: result.theme_primary ?? "#c9a227",
    theme_background: result.theme_background ?? "#0a0a0a",
    theme_primary_foreground: result.theme_primary_foreground ?? "#000000",
    instagram_handle: result.instagram_handle ?? "",
    instagram_description: result.instagram_description ?? "",
    copa_page_name: result.copa_page_name ?? "Copa",
    copa_page_title: result.copa_page_title ?? "",
    copa_page_description: result.copa_page_description ?? "",
    nav_hidden: result.nav_hidden ?? "[]",
    tenant_active: tenantActive,
    subscription_status: subscriptionStatus,
    super_logo_url: superLogoUrl,
    tenant_id: tenantId,
  });
});

// PUT /profile - admin only, update text fields
router.put("/", adminAuth, async (req, res) => {
  const tenantId = req.tenantId!;
  const body = req.body as Record<string, string>;
  const allowedTextKeys = [
    "company_name", "company_cnpj", "company_phone", "company_address",
    "company_description", "contact_email", "contact_map_embed",
    "theme_primary", "theme_background", "theme_primary_foreground",
    "instagram_handle", "instagram_description",
    "copa_page_name", "copa_page_title", "copa_page_description", "nav_hidden",
  ];
  for (const key of allowedTextKeys) {
    if (key in body && typeof body[key] === "string") {
      await setProfileSetting(tenantId, key, body[key].trim());
    }
  }
  res.json({ success: true });
});

// POST /profile/logo - admin only, upload logo locally
router.post("/logo", adminAuth, logoUpload.single("logo"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "Nenhum arquivo enviado" });
    return;
  }
  try {
    const { objectPath } = await saveTenantUpload(
      req.tenantId!,
      "profile",
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
    );
    await setProfileSetting(req.tenantId!, "logo_url", objectPath);
    const publicUrl = `/api/uploads${objectPath}`;
    res.json({ success: true, filename: objectPath, url: publicUrl });
  } catch (err) {
    console.error("Logo upload failed:", err);
    res.status(500).json({ error: "Falha ao salvar imagem. Tente novamente." });
  }
});

// POST /profile/favicon - admin only, upload favicon locally
router.post("/favicon", adminAuth, logoUpload.single("favicon"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "Nenhum arquivo enviado" });
    return;
  }
  try {
    const { objectPath } = await saveTenantUpload(
      req.tenantId!,
      "profile",
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
    );
    await setProfileSetting(req.tenantId!, "favicon_url", objectPath);
    const publicUrl = `/api/uploads${objectPath}`;
    res.json({ success: true, filename: objectPath, url: publicUrl });
  } catch (err) {
    console.error("Favicon upload failed:", err);
    res.status(500).json({ error: "Falha ao salvar favicon. Tente novamente." });
  }
});

export default router;
