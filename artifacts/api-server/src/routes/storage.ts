import { Router, type IRouter, type Request, type Response } from "express";
import fs from "fs/promises";
import path from "path";

const router: IRouter = Router();

const EXT_CONTENT_TYPES: Record<string, string> = {
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png":  "image/png",
  ".webp": "image/webp",
  ".gif":  "image/gif",
  ".svg":  "image/svg+xml",
  ".ico":  "image/x-icon",
  ".mp4":  "video/mp4",
  ".webm": "video/webm",
  ".pdf":  "application/pdf",
};

function getSearchRoots(): string[] {
  const roots: string[] = [];
  const priv = process.env.PRIVATE_OBJECT_DIR?.trim();
  if (priv) roots.push(priv);
  const pub = process.env.PUBLIC_OBJECT_SEARCH_PATHS?.trim();
  if (pub) {
    for (const p of pub.split(":")) {
      const t = p.trim();
      if (t && !roots.includes(t)) roots.push(t);
    }
  }
  return roots;
}

async function serveFile(filePath: string, res: Response, roots: string[]): Promise<boolean> {
  const ext = path.extname(filePath).toLowerCase();
  const defaultContentType = EXT_CONTENT_TYPES[ext] ?? "application/octet-stream";

  for (const root of roots) {
    const fullPath = path.join(root, filePath);
    try {
      const data = await fs.readFile(fullPath);
      let contentType = defaultContentType;
      try {
        const meta = JSON.parse(await fs.readFile(`${fullPath}.meta.json`, "utf-8")) as { contentType?: string };
        if (meta.contentType) contentType = meta.contentType;
      } catch {}
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.send(data);
      return true;
    } catch {
      // not found in this root, try next
    }
  }
  return false;
}

// ── NEW uploads: GET /api/uploads/tenant-1/gallery/file.png ──────────────────
router.use("/uploads", async (req: Request, res: Response, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  const filePath = req.path.replace(/^\/+/, "");
  if (!filePath) return next();

  const served = await serveFile(filePath, res, getSearchRoots());
  if (!served) res.status(404).json({ error: "File not found" });
});

// ── LEGACY GCS: GET /api/storage/objects/uploads/filename.ext ────────────────
// Old DB entries stored paths like /objects/uploads/uuid.png pointing to GCS.
// Try to find those files by filename only in all search roots (recursively).
router.use("/objects", async (req: Request, res: Response, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();

  // req.path is e.g. "/uploads/af72f3ad-....png" — extract just the filename
  const filename = path.basename(req.path);
  if (!filename || !filename.includes(".")) return next();

  const ext = path.extname(filename).toLowerCase();
  const contentType = EXT_CONTENT_TYPES[ext] ?? "application/octet-stream";
  const roots = getSearchRoots();

  // Search in root dir and all tenant subdirs
  for (const root of roots) {
    const candidates = [
      path.join(root, filename),
    ];
    // Also check common tenant/folder combos
    for (const sub of ["tenant-1/gallery", "tenant-1/profile", "tenant-1/home", "tenant-1/courts", "tenant-1/sponsors", "tenant-2/gallery", "tenant-3/gallery", "tenant-4/gallery"]) {
      candidates.push(path.join(root, sub, filename));
    }
    for (const fullPath of candidates) {
      try {
        const data = await fs.readFile(fullPath);
        res.setHeader("Content-Type", contentType);
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        res.send(data);
        return;
      } catch { /* try next */ }
    }
  }

  res.status(404).json({ error: "Legacy file not found" });
});

export default router;
