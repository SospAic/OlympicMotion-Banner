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

// ── Pre-flight check: verify URL returns HTML, not Worker text ────────────
async function verifyBannerUrl(url) {
  try {
    const r = await fetch(url);
    const ct = r.headers.get("content-type") ?? "";
    if (!ct.includes("text/html")) {
      const body = await r.text();
      throw new Error(
        `BANNER_URL returned non-HTML content (${ct}).\n` +
        `Body preview: ${body.substring(0, 200)}\n` +
        `Make sure BANNER_URL points to Cloudflare PAGES (e.g. https://xxx.pages.dev), ` +
        `NOT a Cloudflare Worker URL.`
      );
    }
    return true;
  } catch (e) {
    throw new Error(`BANNER_URL pre-flight failed: ${e.message}`);
  }
}

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
  await verifyBannerUrl(TARGET_URL);
}

// ── Screenshot ────────────────────────────────────────────────────────────
const browser = await chromium.launch({ headless: true });

// Strategy: use 1546×423 viewport — exactly the YouTube safe-area dimensions.
// This forces banner-stage to fill the entire viewport with no scaling artifacts.
// All vw units resolve against 1546px which produces correct visual proportions.
const SAFE_W = 1546;
const SAFE_H = 423;

const page = await browser.newPage({
  viewport:          { width: SAFE_W, height: SAFE_H },
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
      // Accept any non-empty value (config may fall back to defaults)
      return el && el.textContent.trim().length > 0;
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

// Extra wait for CSS animations, font rendering and badge pop-in animations
// badgePop animation is 0.5s with delays up to 65ms * 6 = ~0.9s total
// numFlash animation is 1.2s
// ringPulse, goldSweep etc need to complete at least one cycle
await page.waitForTimeout(5000);

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

// Inject CSS to make safe-area fill the viewport exactly, no transforms
await page.addStyleTag({ content: `
  body, html { margin:0; padding:0; overflow:hidden; background:#000; }
  .youtube-canvas {
    width: ${SAFE_W}px !important;
    height: ${SAFE_H}px !important;
    min-height: unset !important;
    aspect-ratio: unset !important;
  }
  .banner-stage {
    width: ${SAFE_W}px !important;
    height: ${SAFE_H}px !important;
    max-height: unset !important;
  }
  .safe-area {
    width: ${SAFE_W}px !important;
    height: ${SAFE_H}px !important;
    transform: none !important;
  }
` });
await page.waitForTimeout(500);

// Step 1: Screenshot the banner at safe-area dimensions (pixel-perfect)
await page.screenshot({ path: OUTPUT, fullPage: false, clip: { x:0, y:0, width:SAFE_W, height:SAFE_H } });
console.log(`✓ Banner preview (${SAFE_W}×${SAFE_H}) → ${OUTPUT.replace(ROOT, "").replace(/\\/g, "/")}`);

// Step 2: Resize viewport to 2560×1440 and place banner centered for YouTube upload
await page.setViewportSize({ width: 2560, height: 1440 });
await page.addStyleTag({ content: `
  body, html { margin:0; padding:0; background:#000; width:2560px; height:1440px; overflow:hidden; }
  .youtube-canvas {
    width: 2560px !important;
    height: 1440px !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
  }
  .banner-stage {
    position: absolute !important;
    top: 50% !important;
    left: 0 !important;
    transform: translateY(-50%) !important;
    width: 2560px !important;
    height: ${SAFE_H}px !important;
    max-height: unset !important;
  }
  .safe-area {
    width: 2560px !important;
    height: ${SAFE_H}px !important;
    transform: scale(${(2560/SAFE_W).toFixed(6)}) !important;
    transform-origin: left center !important;
  }
` });
await page.waitForTimeout(500);

const fullOutput = OUTPUT.replace(".png", "-full.png");
await page.screenshot({ path: fullOutput, fullPage: false });
console.log(`✓ Full banner (2560×1440) → ${fullOutput.replace(ROOT, "").replace(/\\/g, "/")}`);


await browser.close();
proc?.kill();

console.log(`✓ Banner preview (2560×423) → ${OUTPUT.replace(ROOT, "").replace(/\\/g, "/")}`);
console.log(`✓ Full banner (2560×1440)  → ${fullOutput.replace(ROOT, "").replace(/\\/g, "/")}`);
