/**
 * vps-login.mjs — VPS 专用登录工具（无需 GUI，无需浏览器调试）
 *
 * 原理：
 *   OAuth 授权码回调流程 + Playwright session 建立
 *   完全在 VPS 云端执行，不需要任何本地操作（除了一次浏览器授权）
 *
 * 流程：
 *   1. VPS 启动 HTTP 回调服务器（端口 8080）
 *   2. 脚本输出 SSH 转发命令和 Google 授权链接
 *   3. 本地执行 SSH 转发（输入密码后正常挂着不动）
 *   4. 本地浏览器打开授权链接 → 登录 Google → 自动跳转
 *   5. VPS 捕获授权码 → 换取 tokens → 建立 Playwright session → 保存
 *
 * 用法：
 *   node scripts/vps-login.mjs
 *
 * 需要 .env 配置：
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 */

import { createServer }                               from "node:http";
import { mkdirSync, writeFileSync, existsSync,
         readFileSync }                               from "node:fs";
import { resolve }                                    from "node:path";
import { fileURLToPath }                              from "node:url";
import { chromium }                                   from "playwright";

const ROOT         = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SESSION_DIR  = resolve(ROOT, ".session");
const SESSION_FILE = resolve(SESSION_DIR, "youtube-session.json");
const CALLBACK_PORT = 8080;
const REDIRECT_URI  = process.env.DOMAIN
  ? `https://${process.env.DOMAIN}/oauth/callback`
  : `http://localhost:${CALLBACK_PORT}/callback`;
const USE_DOMAIN    = !!process.env.DOMAIN;
const SCOPE = [
  "https://www.googleapis.com/auth/youtube",
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.force-ssl",
  "openid",
  "email",
  "profile",
].join(" ");

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

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("❌ 请在 .env 中配置 GOOGLE_CLIENT_ID 和 GOOGLE_CLIENT_SECRET");
  console.error("   参考 get-refresh-token.mjs 获取 OAuth 凭据");
  process.exit(1);
}

// ── Get VPS public IP ─────────────────────────────────────────────────────
let vpsIp = "你的VPS_IP";
try {
  const r = await fetch("https://api.ipify.org?format=text");
  vpsIp = (await r.text()).trim();
} catch { /* ignore */ }

// ── Build auth URL ────────────────────────────────────────────────────────
const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.searchParams.set("client_id",     CLIENT_ID);
authUrl.searchParams.set("redirect_uri",  REDIRECT_URI);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("scope",         SCOPE);
authUrl.searchParams.set("access_type",   "offline");
authUrl.searchParams.set("prompt",        "consent");

// ── Print instructions ────────────────────────────────────────────────────
console.log("\n═══════════════════════════════════════════════════════");
console.log("  OlympicMotion — VPS 登录工具");
console.log("═══════════════════════════════════════════════════════");
console.log("\n📋 操作步骤：\n");

if (USE_DOMAIN) {
  console.log("【已配置域名模式 — 无需 SSH 隧道】\n");
  console.log("直接用运营 YouTube 的浏览器打开以下链接：\n");
  console.log(`  ${authUrl.toString()}\n`);
  console.log("  ✓ 授权后页面自动跳转，VPS 自动完成后续步骤\n");
} else {
  console.log("【第一步】在你的本地电脑，开一个新终端，执行：\n");
  console.log(`  ssh -L ${CALLBACK_PORT}:localhost:${CALLBACK_PORT} -N root@${vpsIp}\n`);
  console.log("  ✓ 输入密码后没有任何输出是正常的，保持这个终端不关闭\n");
  console.log("【第二步】本地浏览器（使用你运营 YouTube 的 VPN）打开以下链接：\n");
  console.log(`  ${authUrl.toString()}\n`);
  console.log("  ✓ 选择你的 YouTube 运营账号登录并授权\n");
  console.log("【第三步】等待自动完成...\n");
}
console.log("═══════════════════════════════════════════════════════\n");

// ── Start callback HTTP server ────────────────────────────────────────────
console.log(`⏳ 正在监听授权回调（端口 ${CALLBACK_PORT}）...\n`);

const authCode = await new Promise((resolve, reject) => {  const server = createServer((req, res) => {
    const url   = new URL(req.url, `http://localhost:${CALLBACK_PORT}`);
    const code  = url.searchParams.get("code");
    const error = url.searchParams.get("error");

    if (error) {
      res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
      res.end(`<h2>❌ 授权失败：${error}</h2><p>请重新运行脚本</p>`);
      server.close();
      reject(new Error("授权被拒绝：" + error));
      return;
    }

    if (code) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`
        <html><body style="font-family:sans-serif;text-align:center;padding:40px;background:#0a0a0a;color:#fff">
        <h2 style="color:#ffc94a">✅ 授权成功！</h2>
        <p>请回到 VPS 终端查看进度</p>
        <p style="color:#888;font-size:12px">此页面可以关闭</p>
        </body></html>
      `);
      server.close();
      resolve(code);
    }
  });

  server.listen(CALLBACK_PORT, "127.0.0.1", () => {});

  // Timeout after 10 minutes
  setTimeout(() => {
    server.close();
    reject(new Error("超时：10分钟内未完成授权"));
  }, 10 * 60 * 1000);
});

console.log("✓ 授权码已接收，正在换取 tokens...\n");

// ── Exchange code for tokens ──────────────────────────────────────────────
const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
  method:  "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body:    new URLSearchParams({
    code:          authCode,
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri:  REDIRECT_URI,
    grant_type:    "authorization_code",
  }),
});

const tokens = await tokenRes.json();

if (!tokens.access_token) {
  console.error("❌ Token 换取失败：", JSON.stringify(tokens));
  process.exit(1);
}

console.log("✓ access_token 获取成功");

// ── Get user email ────────────────────────────────────────────────────────
let email = "unknown";
try {
  const infoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const info = await infoRes.json();
  email = info.email ?? info.name ?? "unknown";
  console.log(`✓ 账号：${email}`);
} catch { /* ignore */ }

// ── Save refresh_token to .env ────────────────────────────────────────────
if (tokens.refresh_token) {
  const envPath = resolve(ROOT, ".env");
  let envContent = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  if (envContent.includes("GOOGLE_REFRESH_TOKEN=")) {
    envContent = envContent.replace(/^GOOGLE_REFRESH_TOKEN=.*/m, `GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
  } else {
    envContent += `\nGOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`;
  }
  writeFileSync(envPath, envContent);
  console.log("✓ refresh_token 已自动写入 .env");
}

// ── Save session (token-based, no browser cookies needed) ─────────────────
// upload-banner.mjs mode B will use refresh_token to upload via OAuth API
const sessionData = {
  createdAt:    new Date().toISOString(),
  email,
  loginMethod:  "vps-oauth",
  accessToken:  tokens.access_token,
  refreshToken: tokens.refresh_token ?? "",
  cookies:      [],
};

writeFileSync(SESSION_FILE, JSON.stringify(sessionData, null, 2));
console.log(`\n✅ Session 已保存：${SESSION_FILE}`);

// Auto-encrypt
if (process.env.SESSION_ENCRYPTION_KEY) {
  try {
    const { encryptSession } = await import("./encrypt-session.mjs");
    const enc = encryptSession(JSON.stringify(sessionData, null, 2));
    writeFileSync(resolve(SESSION_DIR, "youtube-session.enc"), enc);
    const { unlinkSync } = await import("node:fs");
    unlinkSync(SESSION_FILE);
    console.log("🔒 Session 已加密，明文已删除");
  } catch (e) {
    console.warn("⚠  自动加密失败：", e.message);
  }
}

console.log("\n✓ 完成！现在可以运行：node run.mjs\n");
