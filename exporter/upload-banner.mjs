/**
 * Banner Uploader
 * 用 OAuth refresh_token 换取 access_token，
 * 然后通过 YouTube Data API 上传频道 Banner。
 *
 * 环境变量（全部来自 GitHub Secrets）：
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   GOOGLE_REFRESH_TOKEN
 *   YOUTUBE_CHANNEL_ID
 *   BANNER_FILE  （可选，默认 dist/banner.png）
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve }                  from "node:path";
import { fileURLToPath }            from "node:url";

const ROOT        = resolve(fileURLToPath(new URL("../", import.meta.url)));
const BANNER_FILE = resolve(process.env.BANNER_FILE ?? "dist/banner.png");

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;
const CHANNEL_ID    = process.env.YOUTUBE_CHANNEL_ID;

// ── Validate ──────────────────────────────────────────────────────────────
const missing = [];
if (!CLIENT_ID)     missing.push("GOOGLE_CLIENT_ID");
if (!CLIENT_SECRET) missing.push("GOOGLE_CLIENT_SECRET");
if (!REFRESH_TOKEN) missing.push("GOOGLE_REFRESH_TOKEN");
if (!CHANNEL_ID)    missing.push("YOUTUBE_CHANNEL_ID");

if (missing.length) {
  console.error("❌ 缺少必要环境变量：", missing.join(", "));
  process.exit(1);
}

if (!existsSync(BANNER_FILE)) {
  console.error(`❌ Banner 文件不存在：${BANNER_FILE}`);
  process.exit(1);
}

// ── Step 1: Refresh access token ──────────────────────────────────────────
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
console.log("  Scopes:", tokenData.scope ?? "未返回 scope 信息");

// ── Step 2: Upload banner via channelBanners.insert ───────────────────────
console.log(`📤 正在上传 Banner：${BANNER_FILE}`);

const imageBytes = readFileSync(BANNER_FILE);

// Use multipart upload: metadata part + image part
const BOUNDARY = `----banner_boundary_${Date.now()}`;

const metaJson = JSON.stringify({});  // empty metadata object

const body = Buffer.concat([
  Buffer.from(
    `--${BOUNDARY}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${metaJson}\r\n`,
    "utf8"
  ),
  Buffer.from(
    `--${BOUNDARY}\r\n` +
    `Content-Type: image/png\r\n` +
    `Content-Transfer-Encoding: binary\r\n\r\n`,
    "utf8"
  ),
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

const uploadText = await uploadRes.text();
let uploadData;
try {
  uploadData = JSON.parse(uploadText);
} catch {
  console.error("❌ 上传响应无法解析：", uploadText.substring(0, 500));
  process.exit(1);
}

if (!uploadRes.ok) {
  console.error("❌ Banner 上传失败：", JSON.stringify(uploadData, null, 2));
  // Print diagnostic info
  console.log("\n── 诊断信息 ──");
  console.log("HTTP Status:", uploadRes.status);
  console.log("Channel ID:", CHANNEL_ID);
  console.log("确认以下 scope 已在授权中包含：");
  console.log("  https://www.googleapis.com/auth/youtube");
  console.log("  https://www.googleapis.com/auth/youtube.upload");
  console.log("  https://www.googleapis.com/auth/youtube.force-ssl");
  console.log("如果 scope 不足，请重新运行 get-refresh-token.mjs 重新授权");
  process.exit(1);
}

const bannerUrl = uploadData.url;
console.log(`✓ Banner 图片上传成功`);
console.log(`  URL：${bannerUrl}`);

// ── Step 3: Apply banner to channel ──────────────────────────────────────
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
      brandingSettings: {
        image: {
          bannerExternalUrl: bannerUrl,
        },
      },
    }),
  }
);

const applyText = await applyRes.text();
let applyData;
try {
  applyData = JSON.parse(applyText);
} catch {
  console.error("❌ 应用响应无法解析：", applyText.substring(0, 500));
  process.exit(1);
}

if (!applyRes.ok) {
  console.error("❌ 应用频道 Banner 失败：", JSON.stringify(applyData, null, 2));
  process.exit(1);
}

console.log("✅ 频道 Banner 已成功更新！");
console.log(`   频道 ID：${CHANNEL_ID}`);
