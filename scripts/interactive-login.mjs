/**
 * interactive-login.mjs — 交互式登录 + Session 保存
 *
 * 支持两种模式，自动选择：
 *
 * 模式 A — SSH 端口转发（无 GUI VPS 推荐）
 *   1. VPS 上运行此脚本
 *   2. 脚本输出 SSH 转发命令，在本地电脑执行
 *   3. 本地 Chrome 打开 http://localhost:9222 完成登录
 *   4. 回到 VPS 脚本，按回车确认，session 自动保存
 *
 * 模式 B — 有图形界面
 *   直接打开浏览器窗口完成登录
 *
 * 用法：
 *   node scripts/interactive-login.mjs          # 自动检测
 *   node scripts/interactive-login.mjs --gui    # 强制图形界面模式
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { resolve, dirname }   from "node:path";
import { fileURLToPath }      from "node:url";
import { createInterface }    from "node:readline";
import { chromium }           from "playwright";
import { createServer }       from "node:http";

const ROOT         = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SESSION_DIR  = resolve(ROOT, ".session");
const SESSION_FILE = resolve(SESSION_DIR, "youtube-session.json");
const DEBUG_PORT   = 9222;
const FORCE_GUI    = process.argv.includes("--gui");
const HAS_DISPLAY  = !!process.env.DISPLAY;
const USE_HEADLESS = !FORCE_GUI && !HAS_DISPLAY;

// ── Load .env ─────────────────────────────────────────────────────────────
try {
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

// ── readline helper ───────────────────────────────────────────────────────
function ask(question) {
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, answer => { rl.close(); resolve(answer.trim()); });
  });
}

// ── Get VPS IP ────────────────────────────────────────────────────────────
async function getVpsIp() {
  try {
    const r = await fetch("https://api.ipify.org?format=text");
    return (await r.text()).trim();
  } catch {
    return "你的VPS_IP";
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════
console.log("\n═══════════════════════════════════════════════");
console.log("  OlympicMotion Banner Engine");
console.log("  YouTube Studio 登录 — Session 生成工具");
console.log(`  模式：${USE_HEADLESS ? "SSH 端口转发（无头）" : "图形界面"}`);
console.log("═══════════════════════════════════════════════\n");

// ── Launch browser ────────────────────────────────────────────────────────
console.log("🚀 启动 Playwright 浏览器...");

const launchOptions = {
  headless: USE_HEADLESS,
  args: [
    `--remote-debugging-port=${DEBUG_PORT}`,
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--window-size=1280,900",
  ],
};

// In headless mode, we don't need a display
if (USE_HEADLESS) {
  launchOptions.headless = true;
}

let browser;
try {
  browser = await chromium.launch(launchOptions);
} catch (e) {
  console.error("\n❌ Playwright 启动失败：", e.message);
  console.error("\n请手动安装缺失的系统依赖：");
  console.error("  yum install -y nss nspr atk at-spi2-atk cups-libs libdrm");
  console.error("  libxkbcommon libXcomposite libXdamage libXfixes libXrandr");
  console.error("  mesa-libgbm pango cairo alsa-lib libX11 libxcb libXext\n");
  console.error("或者运行：");
  console.error("  node node_modules/playwright/cli.js install-deps chromium\n");
  process.exit(1);
}

const context = await browser.newContext({
  viewport:  { width: 1280, height: 900 },
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
});

const page = await context.newPage();

// ── SSH Port Forward mode (headless) ──────────────────────────────────────
if (USE_HEADLESS) {
  const vpsIp = await getVpsIp();

  console.log("📋 无头模式 — SSH 端口转发登录");
  console.log("══════════════════════════════════════════════════════");
  console.log("\n第一步：在你的本地电脑开一个新终端，执行以下命令：\n");
  console.log(`  ssh -L ${DEBUG_PORT}:localhost:${DEBUG_PORT} -N root@${vpsIp}`);
  console.log("\n（保持这个终端不要关闭）\n");
  console.log("第二步：本地 Chrome/Edge 浏览器访问：\n");
  console.log(`  chrome://inspect`);
  console.log("\n  点击 'Configure' → 添加 localhost:9222");
  console.log("  然后点击 'inspect' 进入远程调试界面\n");
  console.log("  或者直接访问：http://localhost:9222\n");
  console.log("══════════════════════════════════════════════════════\n");

  // Navigate to YouTube Studio login
  await page.goto("https://accounts.google.com/", {
    waitUntil: "domcontentloaded",
    timeout: 15_000,
  }).catch(() => {});

  await page.goto("https://studio.youtube.com/", {
    waitUntil: "domcontentloaded",
    timeout: 15_000,
  }).catch(() => {});

  console.log("⏳ 等待你在本地浏览器完成 Google 登录...\n");
  console.log("   登录完成后，回到这里按回车键继续...\n");

  // Wait for user to complete login in the remote debug window
  await ask("   [完成登录后按 Enter 键继续]");

  // Check login status
  const currentUrl = page.url();
  console.log("\n  验证登录状态...");
  console.log(`  当前 URL：${currentUrl.substring(0, 60)}`);

  // Try navigating to studio if not already there
  if (!currentUrl.includes("studio.youtube.com")) {
    await page.goto("https://studio.youtube.com/", {
      waitUntil: "networkidle",
      timeout: 20_000,
    }).catch(() => {});
  }

} else {
  // ── GUI mode ──────────────────────────────────────────────────────────
  await page.goto("https://studio.youtube.com/", {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  }).catch(() => {});

  const needsLogin = page.url().includes("accounts.google.com");
  if (needsLogin) {
    console.log("✓ 浏览器窗口已打开，请完成 Google 登录...");
    await page.waitForURL(
      url => url.includes("studio.youtube.com") && !url.includes("accounts.google.com"),
      { timeout: 5 * 60 * 1000 }
    );
  }
}

// ── Collect cookies from all relevant domains ─────────────────────────────
console.log("\n  正在收集 session cookies...");

// Visit key domains to capture all auth cookies
for (const domain of [
  "https://www.youtube.com/",
  "https://accounts.google.com/",
  "https://studio.youtube.com/",
]) {
  try {
    await page.goto(domain, { waitUntil: "domcontentloaded", timeout: 10_000 });
    await page.waitForTimeout(800);
  } catch { /* ignore */ }
}

const finalUrl = page.url();
const allCookies = await context.cookies([
  "https://google.com",
  "https://accounts.google.com",
  "https://youtube.com",
  "https://www.youtube.com",
  "https://studio.youtube.com",
]);

const authCookies = allCookies.filter(c =>
  ["SID", "HSID", "SSID", "SAPISID", "__Secure-1PSID", "__Secure-3PSID"].includes(c.name)
);

// Save debug screenshot
await page.screenshot({ path: resolve(ROOT, "dist/login-result.png") });

if (authCookies.length < 2) {
  await browser.close();
  console.error("\n❌ 认证 Cookie 数量不足（找到 " + authCookies.length + " 个，需要至少 2 个）");
  console.error("   说明登录未成功完成");
  console.error("   调试截图：dist/login-result.png");
  if (USE_HEADLESS) {
    console.error("\n   请确认：");
    console.error("   1. SSH 转发命令已在本地执行并保持连接");
    console.error("   2. 已在本地浏览器完成 Google 账号登录");
    console.error("   3. 登录后等待页面跳转到 studio.youtube.com 再按 Enter");
  }
  process.exit(1);
}

// ── Save session ──────────────────────────────────────────────────────────
let email = "unknown";
try {
  email = await page.evaluate(() =>
    document.querySelector('meta[property="og:title"]')?.content ??
    document.title ?? "unknown"
  );
} catch { /* ignore */ }

const sessionData = {
  createdAt:   new Date().toISOString(),
  email,
  loginMethod: USE_HEADLESS ? "ssh-tunnel" : "gui",
  cookies:     allCookies,
};

writeFileSync(SESSION_FILE, JSON.stringify(sessionData, null, 2));
await browser.close();

console.log("\n═══════════════════════════════════════════════");
console.log("✅ Session 保存成功！");
console.log(`   文件：${SESSION_FILE}`);
console.log(`   Cookie 总数：${allCookies.length}`);
console.log(`   认证 Cookie：${authCookies.length} 个`);
console.log(`   截图：dist/login-result.png`);

// Auto-encrypt if key is set
if (process.env.SESSION_ENCRYPTION_KEY) {
  try {
    const { encryptSession } = await import("./encrypt-session.mjs");
    const enc     = encryptSession(JSON.stringify(sessionData, null, 2));
    const encFile = resolve(SESSION_DIR, "youtube-session.enc");
    writeFileSync(encFile, enc);
    const { unlinkSync } = await import("node:fs");
    unlinkSync(SESSION_FILE);
    console.log(`\n🔒 Session 已加密：${encFile}`);
    console.log("   明文文件已自动删除");
  } catch (e) {
    console.warn("⚠  自动加密失败：", e.message);
  }
} else {
  console.log("\n💡 提示：设置 SESSION_ENCRYPTION_KEY 可自动加密 session");
  console.log("   node scripts/encrypt-session.mjs --gen-key");
}

console.log("\n✓ 现在可以运行：node run.mjs");
console.log("═══════════════════════════════════════════════\n");
