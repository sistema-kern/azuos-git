import { Router, type IRouter } from "express";
import { timingSafeEqual } from "crypto";
import { generateAdminToken, verifyPassword } from "../middlewares/adminAuth.js";
import { db } from "@workspace/db";
import { settingsTable } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";

const router: IRouter = Router();

async function getSuperPasswordHash(): Promise<string | null> {
  const [row] = await db
    .select({ value: settingsTable.value })
    .from(settingsTable)
    .where(and(eq(settingsTable.tenantId, 0), eq(settingsTable.key, "super_admin_password_hash")))
    .limit(1);
  return row?.value ?? null;
}

// POST /admin/login
router.post("/login", async (req, res) => {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    res.status(503).json({ success: false, message: "Admin authentication not configured" });
    return;
  }

  const { password } = req.body;
  if (!password || typeof password !== "string") {
    res.status(401).json({ success: false, message: "Senha incorreta" });
    return;
  }

  const overrideHash = await getSuperPasswordHash();

  let match = false;
  if (overrideHash) {
    match = await verifyPassword(password, overrideHash);
  } else {
    const inputBuf = Buffer.from(password);
    const secretBuf = Buffer.from(adminPassword);
    match =
      inputBuf.length === secretBuf.length &&
      timingSafeEqual(inputBuf, secretBuf);
  }

  if (!match) {
    res.status(401).json({ success: false, message: "Senha incorreta" });
    return;
  }

  const token = generateAdminToken();
  res.json({ success: true, token });
});

export default router;
