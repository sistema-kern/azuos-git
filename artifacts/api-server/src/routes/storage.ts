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

// Returns ordered list of base directories to search for uploaded files.
// 1st: PRIVATE_OBJECT_DIR (new uploads)
// 2nd+: each path in PUBLIC_OBJECT_SEARCH_PATHS (legacy uploads)
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

router.get("/uploads/*filePath", async (req: Request, res: Response) => {
  const raw = req.params.filePath;
  const filePath = Array.isArray(raw) ? raw.join("/") : raw;
  const ext = path.extname(filePath).toLowerCase();
  const defaultContentType = EXT_CONTENT_TYPES[ext] ?? "application/octet-stream";

  for (const root of getSearchRoots()) {
    const fullPath = path.join(root, filePath);
    try {
      const data = await fs.readFile(fullPath);

      // Determine content type: meta.json first, then extension
      let contentType = defaultContentType;
      try {
        const meta = JSON.parse(await fs.readFile(`${fullPath}.meta.json`, "utf-8")) as { contentType?: string };
        if (meta.contentType) contentType = meta.contentType;
      } catch {}

      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.send(data);
      return;
    } catch {
      // File not found in this root, try next
    }
  }

  res.status(404).json({ error: "File not found" });
});

export default router;