/**
 * setup-session.mjs — 一次性 OAuth Session 生成工具
 *
 * 在 VPS 上运行一次，完成以下操作：
 *   1. 用 OAuth refresh_token 换取 access_token
 *   2. 用 access_token 通过 Google 的 OAuth 登录端点建立浏览器 session
 *   3. Playwright 完成登录流程，捕获所有 Cookie（含 HttpOnly）
 *   4. 将 session 保存到 .session/youtube-session.json
 *
 * 之后 upload-banner.mjs 直接加载此 session，无需再次登录。
 * Session 有效期通常 6-12 个月。
 *
 * 用法：
 *   node scripts/setup-session.mjs
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve }                              from "node:path";
import { fileURLToPath }                        from "node:url";
import { chromium }                             from "playwright";

const ROOT         = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SESSION_DIR  = resolve(ROOT, ".session");
const SESSION_FILE = resolve(SESSION_DIR, "youtube-session.json");

// ── Load .env ─────────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = resolve(ROOT, ".env");
  if (!existsSync(envPath)) return;
  const lines = require("fs").readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    if (k && !process.env[k]) process.env[k] = v;
  }
}

// Load env using readFileSync directly (no require in ESM)
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
    console.log("✓ 已加载 .env 配置");
  }
} catch { /* ignore */ }

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;

if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
  console.error("❌ 请先在 .env 中配置：");
  console.error("   GOOGLE_CLIENT_ID");
  console.error("   GOOGLE_CLIENT_SECRET");
  console.error("   GOOGLE_REFRESH_TOKEN");
  console.error("\n获取方法：在本地电脑运行 node get-refresh-token.mjs");
  process.exit(1);
}

mkdirSync(SESSION_DIR, { recursive: true });

// ── Step 1: Get fresh access token ────────────────────────────────────────
console.log("\n🔑 正在获取 access_token...");
const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
  method:  "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body:    new URLSearchParams({
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: REFRESH_TOKEN,
    grant_type:    "refresh_token",
  }),
});

const tokenData = await tokenRes.json();
if (!tokenData.access_token) {
  console.error("❌ access_token 获取失败：", JSON.stringify(tokenData));
  process.exit(1);
}
const ACCESS_TOKEN = tokenData.access_token;
console.log("✓ access_token 获取成功");

// ── Step 2: Use OAuth token to establish Google session ───────────────────
console.log("\n🌐 正在启动 Playwright 建立 Google 登录 session...");
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport:  { width: 1280, height: 900 },
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
});

const page = await context.newPage();

// Use Google's token-based login to establish a full session
// This exchanges the OAuth access_token for browser cookies
const loginUrl =
  `https://accounts.google.com/o/oauth2/auth/oauthchooseaccount` +
  `?response_type=token` +
  `&client_id=${encodeURIComponent(CLIENT_ID)}` +
  `&scope=email+profile+https://www.googleapis.com/auth/youtube`;

// Step 2a: Use tokeninfo to get email
console.log("   获取账号信息...");
const infoRes  = await fetch(`https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${ACCESS_TOKEN}`);
const infoData = await infoRes.json();
const email    = infoData.email;
if (!email) {
  console.error("❌ 无法从 token 获取邮箱信息：", JSON.stringify(infoData));
  await browser.close();
  process.exit(1);
}
console.log(`✓ 账号邮箱：${email}`);

// Step 2b: Use Google's accounts.google.com with OAuth token to create session
// The key is using the programmatic sign-in endpoint
console.log("   正在通过 OAuth token 建立浏览器 session...");

// Navigate to Google's token exchange endpoint
await page.goto("https://accounts.google.com/", {
  waitUntil: "domcontentloaded",
  timeout:   15_000,
}).catch(() => {});

// Use the OAuthLogin endpoint to convert access_token to a browser session
// This is the same mechanism used by Google's own apps
const oauthLoginUrl = `https://accounts.google.com/o/oauth2/programmatic_auth?` +
  `client_id=${encodeURIComponent(CLIENT_ID)}&` +
  `scope=${encodeURIComponent("email profile https://www.googleapis.com/auth/youtube")}&` +
  `response_type=code&` +
  `access_type=offline`;

// Alternative: directly set the GOOGLE_ABUSE_EXEMPTION and auth cookies
// by navigating to a special token-exchange URL
const tokenAuthUrl = `https://accounts.google.com/accounts/OAuthLogin?` +
  `source=ogb&` +
  `issuedTo=${encodeURIComponent(CLIENT_ID)}&` +
  `obfuscatedid=${encodeURIComponent(email)}&` +
  `token=${encodeURIComponent(ACCESS_TOKEN)}`;

await page.goto(tokenAuthUrl, {
  waitUntil: "domcontentloaded",
  timeout:   20_000,
}).catch(e => console.log("  登录跳转（正常）：", e.message.substring(0, 50)));

await page.waitForTimeout(2000);
let currentUrl = page.url();
console.log("  当前 URL：", currentUrl.substring(0, 80));

// Step 2c: If not logged in yet, try the service login approach
if (!currentUrl.includes("myaccount.google.com") && !currentUrl.includes("google.com/u/")) {
  console.log("  尝试备用登录方式...");

  // Use the merge session endpoint
  const mergeUrl = `https://accounts.google.com/MergeSession?` +
    `service=youtube&` +
    `continue=https://studio.youtube.com/&` +
    `uberauth=${encodeURIComponent(ACCESS_TOKEN)}`;

  await page.goto(mergeUrl, {
    waitUntil: "domcontentloaded",
    timeout:   20_000,
  }).catch(() => {});

  await page.waitForTimeout(2000);
  currentUrl = page.url();
  console.log("  当前 URL：", currentUrl.substring(0, 80));
}

// Step 2d: Navigate to YouTube Studio and verify login
console.log("   正在访问 YouTube Studio...");
await page.goto("https://studio.youtube.com/", {
  waitUntil: "networkidle",
  timeout:   30_000,
}).catch(() => {});

await page.waitForTimeout(3000);
currentUrl = page.url();
console.log("  最终 URL：", currentUrl.substring(0, 80));

// Save debug screenshot
const debugPath = resolve(ROOT, "dist");
mkdirSync(debugPath, { recursive: true });
await page.screenshot({ path: resolve(debugPath, "session-setup-debug.png") });
console.log("  调试截图：dist/session-setup-debug.png");

// ── Step 3: Check login and save session ──────────────────────────────────
const isLoggedIn = currentUrl.includes("studio.youtube.com") &&
                   !currentUrl.includes("accounts.google.com");

if (!isLoggedIn) {
  console.warn("\n⚠️  自动登录未完全成功，正在尝试手动提取 token cookies...");

  // Even if redirect failed, we might have valid cookies from the token exchange
  // Get all cookies and check for auth cookies
  const allCookies = await context.cookies([
    "https://google.com",
    "https://youtube.com",
    "https://studio.youtube.com",
  ]);

  const authCookies = allCookies.filter(c =>
    ["SID", "HSID", "SSID", "APISID", "SAPISID", "__Secure-1PSID", "__Secure-3PSID"].includes(c.name)
  );

  if (authCookies.length === 0) {
    console.error("\n❌ 未能通过 OAuth token 建立浏览器 session");
    console.error("   原因：Google 限制了 OAuth token → browser session 的程序化转换");
    console.error("\n✅ 解决方案：使用 VPS 上的交互式登录（更可靠）");
    console.error("   运行：node scripts/interactive-login.mjs");
    await browser.close();
    process.exit(1);
  }
}

// Save the full session
const allCookies = await context.cookies([
  "https://google.com",
  "https://accounts.google.com",
  "https://youtube.com",
  "https://studio.youtube.com",
  "https://www.youtube.com",
]);

const sessionData = {
  createdAt: new Date().toISOString(),
  email,
  cookies: allCookies,
};

writeFileSync(SESSION_FILE, JSON.stringify(sessionData, null, 2));
await browser.close();

console.log(`\n✅ Session 已保存：${SESSION_FILE}`);
console.log(`   包含 ${allCookies.length} 个 Cookie`);
console.log(`   账号：${email}`);
console.log("\n✓ 可以运行完整流程了：node run.mjs");
