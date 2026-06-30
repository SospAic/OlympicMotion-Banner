/**
 * interactive-login.mjs — 交互式登录 + Session 保存
 *
 * 在 VPS 上通过端口转发，用本地浏览器完成 Google 登录，
 * Playwright 捕获完整 session（含所有 HttpOnly Cookie）保存到本地。
 *
 * 步骤：
 *   VPS 上运行此脚本 → 本地浏览器打开提示的 URL → 完成登录 → session 自动保存
 *
 * 用法：
 *   # 在 VPS 上运行（需要先做 SSH 端口转发）
 *   node scripts/interactive-login.mjs
 *
 * SSH 端口转发命令（在本地电脑执行）：
 *   ssh -L 9222:localhost:9222 root@你的VPS_IP
 */

import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve }                               from "node:path";
import { fileURLToPath }                         from "node:url";
import { chromium }                              from "playwright";
import { createServer }                          from "node:http";

const ROOT         = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SESSION_DIR  = resolve(ROOT, ".session");
const SESSION_FILE = resolve(SESSION_DIR, "youtube-session.json");
const CALLBACK_PORT = 9876;

// Load .env
try {
  const { readFileSync } = await import("node:fs");
  const envPath = resolve(ROOT, ".env");
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i < 0) continue;
      const k = t.slice(0, i).trim();
      const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
      if (k && !process.env[k]) process.env[k] = v;
    }
  }
} catch { /* ignore */ }

mkdirSync(SESSION_DIR, { recursive: true });
mkdirSync(resolve(ROOT, "dist"), { recursive: true });

console.log("\n═══════════════════════════════════════════════");
console.log("  OlympicMotion Banner Engine");
console.log("  交互式登录 — Session 生成工具");
console.log("═══════════════════════════════════════════════\n");

// ── Launch browser with remote debugging port ─────────────────────────────
console.log("🚀 启动 Playwright 浏览器（带调试端口）...");

const browser = await chromium.launch({
  headless: false,       // 需要可视化（通过 SSH X11 或端口转发）
  args: [
    "--remote-debugging-port=9222",
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--window-size=1280,900",
  ],
  // If no display available, try virtual display
  ...(process.env.DISPLAY ? {} : { headless: true }),
});

const context = await browser.newContext({
  viewport:  { width: 1280, height: 900 },
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
});

const page = await context.newPage();

// ── Navigate to YouTube Studio login ─────────────────────────────────────
const TARGET = "https://studio.youtube.com/";
await page.goto(TARGET, { waitUntil: "domcontentloaded", timeout: 30_000 });

const startUrl = page.url();
const needsLogin = startUrl.includes("accounts.google.com");

if (needsLogin) {
  console.log("\n📋 需要登录 Google 账号");
  console.log("═══════════════════════════════════════════════");

  if (process.env.DISPLAY) {
    // Has display — show browser window
    console.log("✓ 检测到图形界面，浏览器窗口已打开");
    console.log("  请在浏览器窗口中完成 Google 登录");
  } else {
    // Headless mode — generate login URL and wait
    console.log("⚠  无图形界面，使用 URL 登录方式");
    console.log("\n方式一：SSH 端口转发（推荐）");
    console.log("─────────────────────────────");
    console.log("在本地电脑开一个新终端，执行：");
    console.log(`\n  ssh -L 9222:localhost:9222 root@$(hostname -I | awk '{print $1}')\n`);
    console.log("然后本地 Chrome 访问：chrome://inspect");
    console.log("点击 'inspect' 进入远程调试界面，完成登录\n");

    console.log("方式二：直接打开登录链接");
    console.log("─────────────────────────");
    console.log("在已登录 Google 的设备上访问以下链接完成授权后");
    console.log("脚本将自动检测并保存 session\n");
  }

  // Wait for successful navigation to YouTube Studio
  console.log("⏳ 等待登录完成（最多 5 分钟）...");
  console.log("   登录成功后脚本自动继续\n");

  await page.waitForURL(
    url => url.includes("studio.youtube.com") && !url.includes("accounts.google.com"),
    { timeout: 5 * 60 * 1000 }
  ).catch(() => {
    console.error("❌ 登录超时（5分钟内未完成）");
  });
}

// ── Verify login ──────────────────────────────────────────────────────────
const finalUrl = page.url();
console.log("\n当前 URL：", finalUrl.substring(0, 80));

if (!finalUrl.includes("studio.youtube.com") || finalUrl.includes("accounts.google.com")) {
  await page.screenshot({ path: resolve(ROOT, "dist/login-debug.png") });
  console.error("❌ 登录未成功，调试截图：dist/login-debug.png");
  await browser.close();
  process.exit(1);
}

// Wait a bit to ensure all cookies are set
await page.waitForTimeout(3000);

// ── Also navigate to key YouTube domains to capture all cookies ───────────
for (const domain of [
  "https://www.youtube.com/",
  "https://accounts.google.com/",
]) {
  try {
    await page.goto(domain, { waitUntil: "domcontentloaded", timeout: 10_000 });
    await page.waitForTimeout(1000);
  } catch { /* ignore */ }
}

// Navigate back to studio
await page.goto("https://studio.youtube.com/", {
  waitUntil: "networkidle",
  timeout:   20_000,
}).catch(() => {});
await page.waitForTimeout(2000);

// ── Save session ──────────────────────────────────────────────────────────
const allCookies = await context.cookies([
  "https://google.com",
  "https://accounts.google.com",
  "https://youtube.com",
  "https://www.youtube.com",
  "https://studio.youtube.com",
]);

// Get email from page title or account info
let email = "unknown";
try {
  email = await page.evaluate(() => {
    const meta = document.querySelector('meta[name="yt-remote-connected-devices"]');
    return window.__ytInitialData?.header?.c4TabbedHeaderRenderer?.title ?? "unknown";
  });
} catch { /* ignore */ }

const sessionData = {
  createdAt: new Date().toISOString(),
  email,
  loginMethod: "interactive",
  cookies: allCookies,
};

writeFileSync(SESSION_FILE, JSON.stringify(sessionData, null, 2));

await browser.close();

console.log("\n═══════════════════════════════════════════════");
console.log("✅ Session 保存成功！");
console.log(`   文件：${SESSION_FILE}`);
console.log(`   Cookie 数量：${allCookies.length}`);

const authCookies = allCookies.filter(c =>
  ["SID", "HSID", "SSID", "SAPISID", "__Secure-1PSID", "__Secure-3PSID"].includes(c.name)
);
console.log(`   认证 Cookie：${authCookies.length} 个`);

if (authCookies.length < 3) {
  console.warn("\n⚠  认证 Cookie 数量较少，session 可能不完整");
  console.warn("   建议重新登录：node scripts/interactive-login.mjs");
} else {
  console.log("\n✓ Session 有效，可以运行：node run.mjs");
}

// Auto-encrypt if SESSION_ENCRYPTION_KEY is set
if (process.env.SESSION_ENCRYPTION_KEY) {
  try {
    const { encryptSession } = await import("./encrypt-session.mjs");
    const enc = encryptSession(JSON.stringify(sessionData, null, 2));
    const encFile = resolve(SESSION_DIR, "youtube-session.enc");
    writeFileSync(encFile, enc);
    // Remove plain text file after encryption
    const { unlinkSync } = await import("node:fs");
    unlinkSync(SESSION_FILE);
    console.log(`\n🔒 Session 已加密保存：${encFile}`);
    console.log("   明文文件已自动删除");
  } catch (e) {
    console.warn("⚠  自动加密失败：", e.message);
    console.warn("   可手动加密：node scripts/encrypt-session.mjs --encrypt");
  }
} else {
  console.log("\n💡 提示：设置 SESSION_ENCRYPTION_KEY 可自动加密 session 文件");
  console.log("   生成密钥：node scripts/encrypt-session.mjs --gen-key");
}

console.log("═══════════════════════════════════════════════\n");
