/**
 * Banner Uploader
 * 支持两种模式，自动选择：
 *
 * 模式 A — Cookie 模式（推荐，适合个人账号）
 *   用手机 Safari 导出的 Cookie 字符串，Playwright 直接登录 YouTube Studio 上传。
 *   所需 Secret：YOUTUBE_COOKIES
 *
 * 模式 B — OAuth API 模式（备用，仅适合 YouTube 合作伙伴账号）
 *   通过 YouTube Data API channelBanners.insert 上传。
 *   所需 Secret：GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN,
 *               YOUTUBE_CHANNEL_ID
 *
 * 优先级：有 YOUTUBE_COOKIES → 用模式 A，否则尝试模式 B。
 *
 * Cookie 获取方法（iPhone Safari）：
 *   1. Safari 打开 studio.youtube.com（已登录状态）
 *   2. 地址栏输入：javascript:prompt('Cookie',document.cookie)
 *   3. 弹窗里的内容就是 Cookie，复制存入 GitHub Secret: YOUTUBE_COOKIES
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve }                  from "node:path";
import { fileURLToPath }            from "node:url";
import { chromium }                 from "playwright";

const BANNER_FILE   = resolve(process.env.BANNER_FILE ?? "dist/banner.png");
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
if (YT_COOKIES) {
  console.log("🍪 检测到 YOUTUBE_COOKIES，使用 Cookie 模式（模式 A）");
  await uploadViaCookies(YT_COOKIES);
} else if (CLIENT_ID && CLIENT_SECRET && REFRESH_TOKEN) {
  console.log("🔑 未检测到 YOUTUBE_COOKIES，使用 OAuth API 模式（模式 B）");
  await uploadViaOAuth();
} else {
  console.error("❌ 未配置任何上传凭据，请设置以下任意一组 GitHub Secrets：");
  console.error("  模式 A（推荐）：YOUTUBE_COOKIES");
  console.error("  模式 B（备用）：GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET + GOOGLE_REFRESH_TOKEN + YOUTUBE_CHANNEL_ID");
  process.exit(1);
}

// ══════════════════════════════════════════════════════════════════════════
// 模式 A：Cookie + Playwright 浏览器自动化
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
      // Set cookies for both youtube.com and google.com domains
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

  // ── Navigate to YouTube Studio branding page ──────────────────────────
  console.log("📺 正在打开 YouTube Studio 品牌推广页面...");
  await page.goto(
    "https://studio.youtube.com/channel/default/customization/branding",
    { waitUntil: "networkidle", timeout: 30_000 }
  );

  const url = page.url();
  console.log("  当前 URL：", url);

  // Check if we were redirected to login
  if (url.includes("accounts.google.com") || url.includes("signin")) {
    await page.screenshot({ path: BANNER_FILE.replace(".png", "-debug-login.png") });
    await browser.close();
    console.error("❌ Cookie 已过期或无效，被重定向到登录页面");
    console.error("  请重新从 iPhone Safari 导出 Cookie 并更新 YOUTUBE_COOKIES Secret");
    console.error("  方法：Safari 打开 studio.youtube.com → 地址栏输入 javascript:prompt('Cookie',document.cookie)");
    process.exit(1);
  }

  // ── Wait for page to fully load ───────────────────────────────────────
  console.log("  等待页面加载完成...");
  await page.waitForTimeout(3000);

  // Take a screenshot for debugging
  const debugPath = BANNER_FILE.replace("banner.png", "debug-studio.png");
  await page.screenshot({ path: debugPath });
  console.log(`  调试截图已保存：${debugPath}`);

  // ── Find and click the banner upload area ─────────────────────────────
  console.log("🖼️  正在查找 Banner 上传区域...");

  // YouTube Studio banner section selectors (may need updating if YouTube changes UI)
  const bannerSelectors = [
    "input[type='file'][accept*='image']",
    "[data-testid='banner-upload']",
    "ytcp-file-upload input[type='file']",
    "#channel-banner input[type='file']",
    "ytcp-image-picker input[type='file']",
  ];

  let fileInput = null;

  // Try to find file input directly
  for (const sel of bannerSelectors) {
    const el = await page.$(sel);
    if (el) {
      fileInput = el;
      console.log(`  找到上传输入框：${sel}`);
      break;
    }
  }

  // If not found, look for "Edit" / "Change" buttons in banner section
  if (!fileInput) {
    console.log("  未直接找到文件输入，尝试点击编辑按钮...");

    const editSelectors = [
      "button[aria-label*='banner' i]",
      "button[aria-label*='Banner' i]",
      "ytcp-button:has-text('CHANGE')",
      "ytcp-button:has-text('UPLOAD')",
      "#banner-button",
      "[aria-label='Edit channel art']",
      "[title='Channel banner']",
    ];

    for (const sel of editSelectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          console.log(`  点击编辑按钮：${sel}`);
          await el.click();
          await page.waitForTimeout(2000);
          // Now try to find file input again
          fileInput = await page.$("input[type='file']");
          if (fileInput) break;
        }
      } catch { /* continue */ }
    }
  }

  if (!fileInput) {
    // Last resort: hover over the banner area to reveal upload button
    console.log("  尝试悬停显示上传按钮...");
    try {
      const bannerImg = await page.$("ytcp-channel-banner, .channel-banner, #channel-banner-container");
      if (bannerImg) {
        await bannerImg.hover();
        await page.waitForTimeout(1500);
        fileInput = await page.$("input[type='file']");
      }
    } catch { /* continue */ }
  }

  if (!fileInput) {
    const finalDebug = BANNER_FILE.replace("banner.png", "debug-no-input.png");
    await page.screenshot({ path: finalDebug, fullPage: true });
    await browser.close();
    console.error("❌ 无法找到 Banner 上传入口");
    console.error(`  调试截图已保存：${finalDebug}`);
    console.error("  YouTube Studio 页面结构可能已更新，请提交 issue 附上截图");
    process.exit(1);
  }

  // ── Upload the banner file ────────────────────────────────────────────
  console.log(`📤 正在上传 Banner 文件：${BANNER_FILE}`);
  await fileInput.setInputFiles(BANNER_FILE);
  await page.waitForTimeout(2000);

  // ── Confirm / Save ────────────────────────────────────────────────────
  console.log("💾 正在保存...");

  const saveSelectors = [
    "button[aria-label*='Done' i]",
    "button[aria-label*='Save' i]",
    "ytcp-button:has-text('DONE')",
    "ytcp-button:has-text('SAVE')",
    "#save-button",
    "ytcp-ve.save-button",
  ];

  let saved = false;
  for (const sel of saveSelectors) {
    try {
      const btn = await page.$(sel);
      if (btn) {
        console.log(`  点击保存按钮：${sel}`);
        await btn.click();
        await page.waitForTimeout(3000);
        saved = true;
        break;
      }
    } catch { /* continue */ }
  }

  if (!saved) {
    console.warn("  ⚠️  未找到保存按钮，图片可能已自动保存");
  }

  const finalPath = BANNER_FILE.replace("banner.png", "debug-final.png");
  await page.screenshot({ path: finalPath });
  console.log(`  最终截图已保存：${finalPath}`);

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
