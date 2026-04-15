import { Router, type IRouter, type Request, type Response } from "express";
import fs from "fs/promises";
import path from "path";

const router: IRouter = Router();

router.get("/uploads/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    const fullPath = path.join(process.env.PRIVATE_OBJECT_DIR || "", filePath);
    const data = await fs.readFile(fullPath);
    const metaPath = `${fullPath}.meta.json`;
    let contentType = "application/octet-stream";
    try {
      const meta = JSON.parse(await fs.readFile(metaPath, "utf-8")) as { contentType?: string };
      if (meta.contentType) contentType = meta.contentType;
    } catch {}
    res.setHeader("Content-Type", contentType);
    res.send(data);
  } catch {
    res.status(404).json({ error: "File not found" });
  }
});

export default router;