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
const SAFE_H = 380;

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
// Also accept static placeholder "00,000" which means app.js parsed but config failed
try {
  await page.waitForFunction(
    () => {
      const el = document.querySelector("[data-subs]");
      if (!el) return false;
      const txt = el.textContent.trim();
      // Accept any non-empty string (static placeholder OR live number)
      return txt.length > 0;
    },
    { timeout: 20_000 }
  );
} catch {
  // Even on timeout, continue and take a debug screenshot but don't abort
  const debugPath = OUTPUT.replace(".png", "-debug.png");
  await page.screenshot({ path: debugPath, fullPage: false });
  console.log(`Debug screenshot saved: ${debugPath}`);
  console.log("Page title:", await page.title());
  console.log("HTML preview:", (await page.content()).substring(0, 1200));
  if (pageErrors.length) console.log("Page errors:", pageErrors);
  // Continue anyway — static HTML has the banner structure
  console.warn("⚠  app.js paint timeout — using static HTML state");
}

// Extra wait for CSS animations, font rendering and badge pop-in animations
// Increased to 6s to ensure all animations complete (ringPulse, badgePop, goldSweep)
await page.waitForTimeout(6000);

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

// Step 2: Generate 2560×1440 full banner using scale factor
// Instead of resizing viewport (which breaks vw-based layout),
// use deviceScaleFactor to scale the 1546-wide layout up to 2560.
const FULL_W    = 2560;
const FULL_H    = 1440;
const SCALE     = FULL_W / SAFE_W;   // 2560 / 1546 ≈ 1.6571
const SCALED_H  = Math.round(SAFE_H * SCALE);

// Close current page and open a new one with the scale factor applied
await browser.close();
proc?.kill();

const browser2 = await chromium.launch({ headless: true });
const page2 = await browser2.newPage({
  viewport:          { width: SAFE_W, height: SAFE_H },
  deviceScaleFactor: SCALE,
});

await page2.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
try {
  await page2.waitForFunction(
    () => { const el = document.querySelector("[data-subs]"); return el && el.textContent.trim().length > 0; },
    { timeout: 15_000 }
  );
} catch { /* continue */ }
await page2.waitForTimeout(3000);

// Lock layout to safe-area dimensions (viewport CSS pixels same as step 1)
await page2.addStyleTag({ content: `
  body, html { margin:0; padding:0; overflow:hidden; background:#000; }
  .youtube-canvas { width: ${SAFE_W}px !important; height: ${SAFE_H}px !important; min-height:unset !important; }
  .banner-stage   { width: ${SAFE_W}px !important; height: ${SAFE_H}px !important; max-height:unset !important; }
  .safe-area      { width: ${SAFE_W}px !important; height: ${SAFE_H}px !important; transform:none !important; }
` });
await page2.waitForTimeout(400);

// Screenshot — deviceScaleFactor makes the physical pixels = SAFE_W * SCALE = 2560
// Place the scaled banner centred vertically in a black 2560×1440 canvas using Sharp
const scaledBannerBuf = await page2.screenshot({ clip: { x:0, y:0, width:SAFE_W, height:SAFE_H } });
await browser2.close();

const sharp = (await import("sharp")).default;
const topY  = Math.round((FULL_H - SCALED_H) / 2);

const fullOutput = OUTPUT.replace(".png", "-full.png");
await sharp({ create: { width: FULL_W, height: FULL_H, channels: 4, background: {r:0,g:0,b:0,alpha:1} } })
  .composite([{ input: scaledBannerBuf, top: topY, left: 0 }])
  .png({ quality: 95 })
  .toFile(fullOutput);

console.log(`✓ Full banner (${FULL_W}×${FULL_H}) → ${fullOutput.replace(ROOT,"").replace(/\\/g,"/")}`);
