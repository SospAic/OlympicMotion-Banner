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

const ROOT       = resolve(fileURLToPath(new URL("../", import.meta.url)));
const OUTPUT     = resolve(process.argv[2] ?? "dist/banner.png");
const TARGET_URL = process.env.BANNER_URL ?? "http://localhost:4173/";

// Ensure output directory exists
mkdirSync(dirname(OUTPUT), { recursive: true });

console.log(`Target URL: ${TARGET_URL}`);

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

// Start local server only when BANNER_URL is not set (local dev mode)
let proc;
if (!process.env.BANNER_URL) {
  if (!(await serverReady(TARGET_URL, 2))) {
    proc = spawn(process.execPath, ["server.mjs"], {
      cwd: ROOT, stdio: "ignore", windowsHide: true,
    });
    if (!(await serverReady(TARGET_URL))) {
      proc.kill();
      throw new Error(`Preview server did not start at ${TARGET_URL}`);
    }
  }
} else {
  const reachable = await serverReady(TARGET_URL, 10);
  if (!reachable) {
    throw new Error(`Remote banner URL not reachable: ${TARGET_URL}`);
  }
}

// ── Screenshot ────────────────────────────────────────────────────────────
const browser = await chromium.launch({ headless: true });
const page    = await browser.newPage({
  viewport:          { width: 2560, height: 1440 },
  deviceScaleFactor: 1,
});

// Collect console errors for debugging
const pageErrors = [];
page.on("pageerror",  e => pageErrors.push("pageerror: " + e.message));
page.on("console",    m => { if (m.type() === "error") pageErrors.push("console: " + m.text()); });
page.on("requestfailed", r => pageErrors.push("reqfail: " + r.url() + " " + r.failure()?.errorText));

// Navigate — use domcontentloaded first, then wait explicitly
await page.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });

// Wait for the app.js module to finish painting
// data-subs is set by app.js after config loads — wait for it to have real content
try {
  await page.waitForFunction(
    () => {
      const el = document.querySelector("[data-subs]");
      return el && el.textContent.trim().length > 0 && el.textContent !== "00,000";
    },
    { timeout: 15_000 }
  );
} catch {
  // If we can't confirm, take a debug screenshot and log what's there
  const debugPath = OUTPUT.replace(".png", "-debug.png");
  await page.screenshot({ path: debugPath, fullPage: false });
  console.log(`Debug screenshot saved: ${debugPath}`);
  console.log("Page title:", await page.title());
  console.log("HTML preview:", (await page.content()).substring(0, 800));
  if (pageErrors.length) console.log("Page errors:", pageErrors);
  throw new Error("app.js did not finish painting within 15s — see debug screenshot");
}

// Extra wait for CSS animations and font rendering
await page.waitForTimeout(1000);

if (pageErrors.length) {
  console.warn("Non-fatal page errors:", pageErrors);
}

// Find and screenshot the banner stage
const stage = page.locator(".banner-stage").first();
const count = await stage.count();

if (count === 0) {
  const debugPath = OUTPUT.replace(".png", "-debug.png");
  await page.screenshot({ path: debugPath, fullPage: false });
  console.log("Debug screenshot saved:", debugPath);
  throw new Error(".banner-stage not found — check debug screenshot");
}

await stage.screenshot({ path: OUTPUT });

await browser.close();
proc?.kill();

console.log(`✓ Banner exported → ${OUTPUT.replace(ROOT, "").replace(/\\/g, "/")}`);
