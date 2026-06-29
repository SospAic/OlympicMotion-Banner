/**
 * Banner Exporter — Layer 3
 * Renders the banner at 2560×423 (YouTube safe-area crop) via Playwright.
 *
 * Usage:
 *   node exporter/render-banner.mjs [output-path]
 *
 * Env vars:
 *   BANNER_URL   override the preview URL (default: http://localhost:4173/)
 */

import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve }      from "node:path";
import { fileURLToPath }         from "node:url";
import { spawn }                 from "node:child_process";
import { chromium }              from "playwright";

const ROOT   = resolve(fileURLToPath(new URL("../", import.meta.url)));
const OUTPUT = resolve(process.argv[2] ?? "dist/banner.png");
const URL    = process.env.BANNER_URL ?? "http://localhost:4173/";

// Ensure output directory exists
mkdirSync(dirname(OUTPUT), { recursive: true });

// ── Server probe ──────────────────────────────────────────────────────────
async function serverReady(url, tries = 28) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 300));
  }
  return false;
}

// Start local server if not already running
let proc;
if (!(await serverReady(URL, 2))) {
  proc = spawn(process.execPath, ["server.mjs"], {
    cwd: ROOT, stdio: "ignore", windowsHide: true,
  });
  if (!(await serverReady(URL))) {
    proc.kill();
    throw new Error(`Preview server did not start at ${URL}`);
  }
}

// ── Screenshot ────────────────────────────────────────────────────────────
const browser = await chromium.launch({ headless: true });
const page    = await browser.newPage({
  viewport:        { width: 2560, height: 1440 },
  deviceScaleFactor: 1,
});

await page.goto(URL, { waitUntil: "networkidle", timeout: 30_000 });

// Wait for fonts and progress bar animation
await page.waitForTimeout(800);

// Crop to the banner stage element (2560 × 423)
const stage = await page.$(".banner-stage");
if (!stage) throw new Error(".banner-stage not found in page");

await stage.screenshot({ path: OUTPUT });

await browser.close();
proc?.kill();

console.log(`✓ Banner exported → ${OUTPUT.replace(ROOT, "").replace(/\\/g, "/")}`);
