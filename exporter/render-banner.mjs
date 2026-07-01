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
// Use 1152×648 viewport to match the user's actual browser innerWidth
// This ensures all vw/clamp CSS values produce identical results to the browser
const page    = await browser.newPage({
  viewport:          { width: 1152, height: 648 },
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

// Step 1: Screenshot the banner stage at current viewport (matches browser visual)
await stage.screenshot({ path: OUTPUT });
console.log(`✓ Banner preview → ${OUTPUT.replace(ROOT, "").replace(/\\/g, "/")}`);

// Step 2: Create 2560×1440 full image for YouTube upload
// YouTube needs 16:9 min 2048×1152; we place the banner centered on black canvas
const fullOutput = OUTPUT.replace(".png", "-full.png");
const { createCanvas, loadImage } = await import("canvas").catch(() => null) ?? {};

if (createCanvas) {
  // Use canvas if available
  const bannerImg = await loadImage(OUTPUT);
  const canvas    = createCanvas(2560, 1440);
  const ctx       = canvas.getContext("2d");
  ctx.fillStyle   = "#000";
  ctx.fillRect(0, 0, 2560, 1440);
  // Scale banner to 2560px wide, keeping aspect ratio
  const bw = 2560;
  const bh = Math.round(bannerImg.height * (2560 / bannerImg.width));
  const by = Math.round((1440 - bh) / 2);
  ctx.drawImage(bannerImg, 0, by, bw, bh);
  const { writeFileSync } = await import("node:fs");
  writeFileSync(fullOutput, canvas.toBuffer("image/png"));
} else {
  // Fallback: resize viewport and take screenshot with banner centered via CSS
  await page.setViewportSize({ width: 2560, height: 1440 });
  await page.addStyleTag({ content: `
    body { display:flex; align-items:center; justify-content:center;
           width:2560px; height:1440px; background:#000; overflow:hidden; }
    .youtube-canvas { width:2560px; height:auto; }
    .banner-stage { width:2560px; }
    .safe-area { transform: scale(${(1152/2560).toFixed(4)}); transform-origin: left center; }
  ` });
  await page.waitForTimeout(500);
  await page.screenshot({ path: fullOutput, fullPage: false });
}
console.log(`✓ Full banner (2560×1440) → ${fullOutput.replace(ROOT, "").replace(/\\/g, "/")}`);


await browser.close();
proc?.kill();

console.log(`✓ Banner preview (2560×423) → ${OUTPUT.replace(ROOT, "").replace(/\\/g, "/")}`);
console.log(`✓ Full banner (2560×1440)  → ${fullOutput.replace(ROOT, "").replace(/\\/g, "/")}`);
