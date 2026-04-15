import { Router } from "express";
import { chromium } from "playwright-core";
import { adminAuth } from "../middlewares/adminAuth.js";
import path from "path";
import fs from "fs";

const router = Router();

const CHROMIUM_CANDIDATES = [
  "/nix/store/0n9rl5l9syy808xi9bk4f6dhnfrvhkww-playwright-browsers-chromium/chromium-1080/chrome-linux/chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
];

function findChromium(): string | null {
  for (const p of CHROMIUM_CANDIDATES) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const SCREENSHOTS_BASE = path.join(
  process.cwd(),
  "..",
  "azuos-esportes",
  "public",
  "screenshots",
);

interface PageSpec {
  name: string;
  urlPath: string;
  waitFor?: string;
  adminLogin?: boolean;
}

const PAGES: PageSpec[] = [
  { name: "home",          urlPath: "/",             waitFor: "networkidle" },
  { name: "agendamento",   urlPath: "/agendamento",  waitFor: "networkidle" },
  { name: "beach-tennis",  urlPath: "/beach-tennis", waitFor: "networkidle" },
  { name: "copa",          urlPath: "/copa",         waitFor: "networkidle" },
  { name: "admin",         urlPath: "/admin",        waitFor: "networkidle", adminLogin: true },
];

export type CaptureResult = { page: string; status: "ok" | "error"; error?: string };

export async function captureScreenshots(tenantId: number, baseUrl: string): Promise<
  { success: true; results: CaptureResult[] } | { success: false; error: string }
> {
  const chromiumExec = findChromium();
  if (!chromiumExec) {
    return { success: false, error: "Captura de screenshots não disponível neste ambiente (Chromium não encontrado)" };
  }

  const screenshotsDir = path.join(SCREENSHOTS_BASE, String(tenantId));
  fs.mkdirSync(screenshotsDir, { recursive: true });

  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    browser = await chromium.launch({
      executablePath: chromiumExec,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });

    const results: CaptureResult[] = [];

    for (const spec of PAGES) {
      const page = await browser.newPage();
      await page.setViewportSize({ width: 1280, height: 800 });
      try {
        await page.goto(baseUrl + spec.urlPath, { waitUntil: "networkidle", timeout: 20000 });

        if (spec.adminLogin) {
          const passInput = page.locator('input[type="password"]').first();
          const visible = await passInput.isVisible({ timeout: 3000 }).catch(() => false);
          if (visible) {
            await passInput.fill(process.env.ADMIN_PASSWORD ?? "");
            await Promise.all([
              page.waitForNavigation({ timeout: 8000 }).catch(() => {}),
              page.keyboard.press("Enter"),
            ]);
            await page.waitForTimeout(1500);
          }
        }

        await page.waitForTimeout(800);
        const outPath = path.join(screenshotsDir, `${spec.name}.jpg`);
        await page.screenshot({ path: outPath, type: "jpeg", quality: 88, fullPage: false });
        results.push({ page: spec.name, status: "ok" });
      } catch (err) {
        results.push({ page: spec.name, status: "error", error: String(err) });
      } finally {
        await page.close();
      }
    }

    return { success: true, results };
  } catch (err) {
    console.error("[screenshots] capture error:", err);
    return { success: false, error: `Falha ao capturar screenshots: ${String(err)}` };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// POST /screenshots/capture — admin only
router.post("/capture", adminAuth, async (req, res) => {
  const { baseUrl } = req.body as { baseUrl?: string };
  if (!baseUrl) { res.status(400).json({ error: "baseUrl é obrigatório" }); return; }

  const tenantId = req.tenantId ?? 1;
  const result = await captureScreenshots(tenantId, baseUrl);
  if (!result.success) {
    res.status(503).json({ error: result.error });
    return;
  }
  res.json({ success: true, tenantId, results: result.results });
});

export default router;
