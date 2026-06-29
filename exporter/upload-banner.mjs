/**
 * Banner Uploader
 * 用 OAuth refresh_token 换取 access_token，
 * 然后通过 YouTube Data API 上传频道 Banner。
 *
 * 环境变量（全部来自 GitHub Secrets）：
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   GOOGLE_REFRESH_TOKEN
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

// ── Validate ──────────────────────────────────────────────────────────────
if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
  console.error("❌ 缺少必要环境变量：GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN");
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

// ── Step 2: Upload banner image ───────────────────────────────────────────
// YouTube channelBanners.insert — multipart upload
console.log(`📤 正在上传 Banner：${BANNER_FILE}`);

const imageData    = readFileSync(BANNER_FILE);
const BOUNDARY     = "banner_boundary_" + Date.now();

// Build multipart body
const metaPart = [
  `--${BOUNDARY}`,
  "Content-Type: application/json; charset=UTF-8",
  "",
  "{}",
  "",
].join("\r\n");

const imagePart = [
  `--${BOUNDARY}`,
  "Content-Type: image/png",
  "",
  "",
].join("\r\n");

const closing = `\r\n--${BOUNDARY}--`;

const metaBytes  = Buffer.from(metaPart,  "utf8");
const imageLabel = Buffer.from(imagePart, "utf8");
const closeBytes = Buffer.from(closing,   "utf8");

const body = Buffer.concat([metaBytes, imageLabel, imageData, closeBytes]);

const uploadRes = await fetch(
  "https://www.googleapis.com/upload/youtube/v3/channelBanners/insert?uploadType=multipart",
  {
    method:  "POST",
    headers: {
      "Authorization":  `Bearer ${ACCESS_TOKEN}`,
      "Content-Type":   `multipart/related; boundary=${BOUNDARY}`,
      "Content-Length": String(body.length),
    },
    body,
  }
);

const uploadData = await uploadRes.json();

if (!uploadRes.ok) {
  console.error("❌ Banner 上传失败：", JSON.stringify(uploadData, null, 2));
  process.exit(1);
}

const bannerUrl = uploadData.url;
console.log(`✓ Banner 图片上传成功，URL：${bannerUrl}`);

// ── Step 3: Set banner on channel ─────────────────────────────────────────
console.log("📺 正在将 Banner 设置到频道...");

const channelRes = await fetch(
  "https://www.googleapis.com/youtube/v3/channels?part=brandingSettings",
  {
    method:  "PUT",
    headers: {
      "Authorization": `Bearer ${ACCESS_TOKEN}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({
      id: process.env.YOUTUBE_CHANNEL_ID,
      brandingSettings: {
        image: {
          bannerExternalUrl: bannerUrl,
        },
      },
    }),
  }
);

const channelData = await channelRes.json();

if (!channelRes.ok) {
  console.error("❌ 设置频道 Banner 失败：", JSON.stringify(channelData, null, 2));
  process.exit(1);
}

console.log("✅ 频道 Banner 已成功更新！");
console.log(`   频道 ID：${process.env.YOUTUBE_CHANNEL_ID}`);
console.log(`   Banner URL：${bannerUrl}`);
