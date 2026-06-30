/**
 * Banner Uploader
 * 支持三种模式，自动选择：
 *
 * 模式 S — Session 文件模式（VPS 推荐，最可靠）
 *   用 scripts/interactive-login.mjs 或 scripts/setup-session.mjs 生成的
 *   .session/youtube-session.json，Playwright 直接复用登录状态。
 *   所需文件：.session/youtube-session.json
 *
 * 模式 A — Cookie 字符串模式（GitHub Actions 推荐）
 *   用手机 Safari 导出的 Cookie 字符串，Playwright 直接登录 YouTube Studio 上传。
 *   所需 Secret/环境变量：YOUTUBE_COOKIES
 *
 * 模式 B — OAuth API 模式（仅 YouTube 合作伙伴账号可用）
 *   通过 YouTube Data API channelBanners.insert 上传。
 *   所需：GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, YOUTUBE_CHANNEL_ID
 *
 * 优先级：Session 文件 > YOUTUBE_COOKIES > OAuth API
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve }                  from "node:path";
import { fileURLToPath }            from "node:url";
import { chromium }                 from "playwright";

const ROOT          = resolve(fileURLToPath(new URL("../", import.meta.url)));
const BANNER_FILE   = resolve(process.env.BANNER_FILE ?? "dist/banner.png");
const SESSION_FILE  = resolve(ROOT, ".session/youtube-session.json");
const SESSION_ENC   = resolve(ROOT, ".session/youtube-session.enc");
const YT_COOKIES    = process.env.YOUTUBE_COOKIES;
const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;
const CHANNEL_ID    = process.env.YOUTUBE_CHANNEL_ID;

// ── Validate banner file ──────────────────────────────────────────────────
if (!existsSync(BANNER_FILE)) {
  console.error(`❌ Banner 文件不存在：${BANNER_FILE}`);
  process.exit(1);
}

// ── Route to correct mode ─────────────────────────────────────────────────
const hasSession = existsSync(SESSION_ENC) || existsSync(SESSION_FILE);

if (hasSession) {
  const which = existsSync(SESSION_ENC) ? "加密" : "明文";
  console.log(`💾 检测到 Session ${which}文件，使用 Session 模式（模式 S）`);
  await uploadViaSession(SESSION_FILE);
} else if (YT_COOKIES) {
  console.log("🍪 检测到 YOUTUBE_COOKIES，使用 Cookie 模式（模式 A）");
  await uploadViaCookies(YT_COOKIES);
} else if (CLIENT_ID && CLIENT_SECRET && REFRESH_TOKEN) {
  console.log("🔑 未检测到 Session/Cookie，使用 OAuth API 模式（模式 B）");
  await uploadViaOAuth();
} else {
  console.error("❌ 未配置任何上传凭据，请选择以下任意一种方式：");
  console.error("  模式 S（VPS 推荐）：运行 node scripts/vps-login.mjs 生成 session");
  console.error("  模式 A（GitHub Actions）：设置环境变量 YOUTUBE_COOKIES");
  console.error("  模式 B（合作伙伴账号）：设置 GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET + GOOGLE_REFRESH_TOKEN");
  process.exit(1);
}

// ══════════════════════════════════════════════════════════════════════════
// 模式 S：Session 文件模式（VPS 专用，最可靠）
// ══════════════════════════════════════════════════════════════════════════
async function uploadViaSession(sessionFile) {
  // Load session — prefer encrypted .enc file over plain .json
  const encFile = sessionFile.replace(".json", ".enc");
  let sessionData;

  if (existsSync(encFile)) {
    const key = process.env.SESSION_ENCRYPTION_KEY;
    if (!key) {
      console.error("❌ 找到加密 Session 文件但未设置 SESSION_ENCRYPTION_KEY");
      console.error("   请在 .env 中添加 SESSION_ENCRYPTION_KEY");
      process.exit(1);
    }
    try {
      const { decryptSession } = await import("../scripts/encrypt-session.mjs");
      const enc = readFileSync(encFile, "utf8").trim();
      sessionData = JSON.parse(decryptSession(enc));
      console.log("🔒 已加载加密 session");
    } catch (e) {
      console.error("❌ Session 解密失败：", e.message);
      process.exit(1);
    }
  } else if (existsSync(sessionFile)) {
    sessionData = JSON.parse(readFileSync(sessionFile, "utf8"));
    console.log("📄 已加载明文 session（建议加密：node scripts/encrypt-session.mjs --encrypt）");
  } else {
    console.error("❌ 未找到 session 文件，请运行：node scripts/vps-login.mjs");
    process.exit(1);
  }
  console.log(`  账号：${sessionData.email ?? "unknown"}`);
  console.log(`  Session 创建时间：${sessionData.createdAt}`);
  console.log(`  Cookie 数量：${sessionData.cookies?.length ?? 0}`);

  // vps-oauth sessions use refresh_token, not browser cookies
  if (sessionData.loginMethod === "vps-oauth") {
    console.log("  检测到 VPS OAuth Session，使用 token 模式上传");
    const refreshToken = sessionData.refreshToken
      || process.env.GOOGLE_REFRESH_TOKEN;
    if (!refreshToken) {
      console.error("❌ Session 中没有 refresh_token，请重新运行 vps-login.mjs");
      process.exit(1);
    }
    // Temporarily set env vars for uploadViaOAuth
    process.env.GOOGLE_REFRESH_TOKEN = refreshToken;
    if (!process.env.GOOGLE_CLIENT_ID && sessionData.clientId)
      process.env.GOOGLE_CLIENT_ID = sessionData.clientId;
    if (!process.env.GOOGLE_CLIENT_SECRET && sessionData.clientSecret)
      process.env.GOOGLE_CLIENT_SECRET = sessionData.clientSecret;
    // Re-read env vars
    const { GOOGLE_CLIENT_ID: cid, GOOGLE_CLIENT_SECRET: csec } = process.env;
    if (!cid || !csec) {
      console.error("❌ 需要 GOOGLE_CLIENT_ID 和 GOOGLE_CLIENT_SECRET");
      console.error("   请检查 .env 文件中的配置");
      process.exit(1);
    }
    await uploadViaOAuth();
    return;
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport:  { width: 1280, height: 900 },
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });

  // Restore cookies from session
  if (sessionData.cookies?.length > 0) {
    await context.addCookies(sessionData.cookies);
    console.log(`  已加载 ${sessionData.cookies.length} 个 Cookie`);
  }

  const page = await context.newPage();

  // Navigate to YouTube Studio branding page
  console.log("📺 正在打开 YouTube Studio 品牌推广页面...");
  await page.goto(
    "https://studio.youtube.com/channel/default/customization/branding",
    { waitUntil: "networkidle", timeout: 30_000 }
  );

  const url = page.url();
  console.log("  当前 URL：", url.substring(0, 80));

  if (url.includes("accounts.google.com") || url.includes("signin")) {
    await page.screenshot({ path: BANNER_FILE.replace(".png", "-debug-session-expired.png") });
    await browser.close();
    console.error("❌ Session 已过期，需要重新登录");
    console.error("  请运行：node scripts/interactive-login.mjs");
    process.exit(1);
  }

  // Reuse the same upload logic as Cookie mode
  await _performUpload(page, browser);
}

// ══════════════════════════════════════════════════════════════════════════
// 模式 A：Cookie 字符串模式（GitHub Actions）
// ══════════════════════════════════════════════════════════════════════════
async function uploadViaCookies(cookieStr) {
  // Parse "key=value; key2=value2" string into Playwright cookie objects
  const cookies = cookieStr
    .split(";")
    .map(s => s.trim())
    .filter(Boolean)
    .flatMap(pair => {
      const eqIdx = pair.indexOf("=");
      if (eqIdx < 0) return [];
      const name  = pair.slice(0, eqIdx).trim();
      const value = pair.slice(eqIdx + 1).trim();
      return [
        { name, value, domain: ".youtube.com",     path: "/", secure: true, sameSite: "None" },
        { name, value, domain: ".google.com",       path: "/", secure: true, sameSite: "None" },
        { name, value, domain: "studio.youtube.com",path: "/", secure: true, sameSite: "None" },
      ];
    });

  console.log(`  解析出 ${cookieStr.split(";").filter(Boolean).length} 个 Cookie`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport:  { width: 1280, height: 900 },
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });

  await context.addCookies(cookies);
  const page = await context.newPage();

  console.log("📺 正在打开 YouTube Studio 品牌推广页面...");
  await page.goto(
    "https://studio.youtube.com/channel/default/customization/branding",
    { waitUntil: "networkidle", timeout: 30_000 }
  );

  const url = page.url();
  console.log("  当前 URL：", url.substring(0, 80));

  if (url.includes("accounts.google.com") || url.includes("signin")) {
    await page.screenshot({ path: BANNER_FILE.replace(".png", "-debug-login.png") });
    await browser.close();
    console.error("❌ Cookie 已过期或无效");
    console.error("  GitHub Actions 用户：更新 YOUTUBE_COOKIES Secret");
    console.error("  VPS 用户：运行 node scripts/interactive-login.mjs 重新登录");
    process.exit(1);
  }

  await _performUpload(page, browser);
}

// ── Shared upload logic (used by both Mode S and Mode A) ──────────────────
async function _performUpload(page, browser) {
  await page.waitForTimeout(3000);

  const debugPath = BANNER_FILE.replace("banner.png", "debug-studio.png");
  await page.screenshot({ path: debugPath });
  console.log(`  调试截图：${debugPath}`);

  console.log("🖼️  正在查找 Banner 上传区域...");

  const bannerSelectors = [
    "input[type='file'][accept*='image']",
    "[data-testid='banner-upload']",
    "ytcp-file-upload input[type='file']",
    "#channel-banner input[type='file']",
    "ytcp-image-picker input[type='file']",
  ];

  let fileInput = null;

  for (const sel of bannerSelectors) {
    const el = await page.$(sel);
    if (el) { fileInput = el; console.log(`  找到上传输入框：${sel}`); break; }
  }

  if (!fileInput) {
    console.log("  未直接找到文件输入，尝试点击编辑按钮...");
    const editSelectors = [
      "button[aria-label*='banner' i]",
      "button[aria-label*='Banner' i]",
      "ytcp-button:has-text('CHANGE')",
      "ytcp-button:has-text('UPLOAD')",
      "[aria-label='Edit channel art']",
    ];

    for (const sel of editSelectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          await el.click();
          await page.waitForTimeout(2000);
          fileInput = await page.$("input[type='file']");
          if (fileInput) { console.log(`  通过按钮找到上传框：${sel}`); break; }
        }
      } catch { /* continue */ }
    }
  }

  if (!fileInput) {
    const noInputDebug = BANNER_FILE.replace("banner.png", "debug-no-input.png");
    await page.screenshot({ path: noInputDebug, fullPage: true });
    await browser.close();
    console.error("❌ 无法找到 Banner 上传入口，调试截图：", noInputDebug);
    process.exit(1);
  }

  console.log(`📤 正在上传：${BANNER_FILE}`);
  await fileInput.setInputFiles(BANNER_FILE);
  await page.waitForTimeout(2000);

  console.log("💾 正在保存...");
  const saveSelectors = [
    "ytcp-button:has-text('DONE')",
    "ytcp-button:has-text('SAVE')",
    "button[aria-label*='Done' i]",
    "button[aria-label*='Save' i]",
  ];

  for (const sel of saveSelectors) {
    try {
      const btn = await page.$(sel);
      if (btn) {
        await btn.click();
        await page.waitForTimeout(3000);
        console.log(`  已点击保存：${sel}`);
        break;
      }
    } catch { /* continue */ }
  }

  const finalPath = BANNER_FILE.replace("banner.png", "debug-final.png");
  await page.screenshot({ path: finalPath });
  await browser.close();
  console.log("✅ Banner 上传完成！");
}

// ══════════════════════════════════════════════════════════════════════════
// 模式 B：OAuth API（保留，适合 YouTube 合作伙伴账号）
// ══════════════════════════════════════════════════════════════════════════
async function uploadViaOAuth() {
  if (!CHANNEL_ID) {
    console.error("❌ 模式 B 需要 YOUTUBE_CHANNEL_ID");
    process.exit(1);
  }

  // Step 1: Get access token
  console.log("🔑 正在刷新 access_token...");
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
    console.error("❌ 获取 access_token 失败：", JSON.stringify(tokenData));
    process.exit(1);
  }
  const ACCESS_TOKEN = tokenData.access_token;
  console.log("✓ access_token 获取成功");
  console.log("  Scopes:", tokenData.scope ?? "未返回");

  // Step 2: Upload banner image via channelBanners.insert
  console.log(`📤 正在上传 Banner：${BANNER_FILE}`);
  const imageBytes = readFileSync(BANNER_FILE);
  const BOUNDARY   = `banner_${Date.now()}`;

  const body = Buffer.concat([
    Buffer.from(`--${BOUNDARY}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{}\r\n`, "utf8"),
    Buffer.from(`--${BOUNDARY}\r\nContent-Type: image/png\r\nContent-Transfer-Encoding: binary\r\n\r\n`, "utf8"),
    imageBytes,
    Buffer.from(`\r\n--${BOUNDARY}--`, "utf8"),
  ]);

  const uploadRes = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/channelBanners/insert?uploadType=multipart",
    {
      method:  "POST",
      headers: {
        "Authorization": `Bearer ${ACCESS_TOKEN}`,
        "Content-Type":  `multipart/related; boundary=${BOUNDARY}`,
      },
      body,
    }
  );

  const uploadData = await uploadRes.json();
  console.log("  API 响应 (status", uploadRes.status, "):", JSON.stringify(uploadData));

  if (!uploadRes.ok) {
    console.error("❌ Banner 上传失败：", JSON.stringify(uploadData, null, 2));
    console.log("  注意：channelBanners.insert 仅对 YouTube 合作伙伴账号开放");
    console.log("  普通账号请改用 Cookie 模式（设置 YOUTUBE_COOKIES Secret）");
    process.exit(1);
  }

  const bannerUrl = uploadData.url ?? uploadData.bannerImageUrl;
  console.log("✓ Banner 图片上传成功，URL：", bannerUrl);

  // Step 3: Apply banner to channel
  console.log("📺 正在将 Banner 应用到频道...");
  const applyRes = await fetch(
    "https://www.googleapis.com/youtube/v3/channels?part=brandingSettings",
    {
      method:  "PUT",
      headers: {
        "Authorization": `Bearer ${ACCESS_TOKEN}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({
        id: CHANNEL_ID,
        brandingSettings: { image: { bannerExternalUrl: bannerUrl } },
      }),
    }
  );

  const applyData = await applyRes.json();
  if (!applyRes.ok) {
    console.error("❌ 应用频道 Banner 失败：", JSON.stringify(applyData, null, 2));
    process.exit(1);
  }

  console.log("✅ 频道 Banner 已成功更新（OAuth API 模式）");
  console.log("   频道 ID：", CHANNEL_ID);
}
