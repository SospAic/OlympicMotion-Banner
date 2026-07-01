/**
 * diagnose-upload.mjs — 诊断 YouTube Banner 上传权限
 * 用法：node scripts/diagnose-upload.mjs
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve }                  from "node:path";
import { fileURLToPath }            from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

// ── Load .env ─────────────────────────────────────────────────────────────
const env = {};
try {
  for (const line of readFileSync(resolve(ROOT, ".env"), "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
} catch { /* ignore */ }

const CLIENT_ID     = env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = env.GOOGLE_REFRESH_TOKEN;
const BANNER_FILE   = resolve(ROOT, "dist/banner.png");

console.log("\n══════════════════════════════════════════════");
console.log("  YouTube Banner 上传诊断工具");
console.log("══════════════════════════════════════════════\n");

// ── Check config ──────────────────────────────────────────────────────────
console.log("── 1. 配置检查 ──");
console.log("CLIENT_ID    :", CLIENT_ID   ? CLIENT_ID.slice(0, 30) + "..." : "❌ 未设置");
console.log("CLIENT_SECRET:", CLIENT_SECRET ? CLIENT_SECRET.slice(0, 10) + "..." : "❌ 未设置");
console.log("REFRESH_TOKEN:", REFRESH_TOKEN && !REFRESH_TOKEN.includes("你的")
  ? REFRESH_TOKEN.slice(0, 20) + "..."
  : "❌ 未设置或是占位符");
console.log("banner.png   :", existsSync(BANNER_FILE) ? "✓ 存在" : "❌ 不存在");

if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN || REFRESH_TOKEN.includes("你的")) {
  console.error("\n❌ 配置不完整，请先完成 .env 配置");
  process.exit(1);
}

// ── Step 1: Get access token ──────────────────────────────────────────────
console.log("\n── 2. 获取 access_token ──");
const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: REFRESH_TOKEN,
    grant_type: "refresh_token",
  }),
});
const tokenData = await tokenRes.json();

if (!tokenData.access_token) {
  console.error("❌ token 获取失败：", JSON.stringify(tokenData));
  process.exit(1);
}
const AT = tokenData.access_token;
console.log("✓ access_token 获取成功");
console.log("  Scopes:", tokenData.scope ?? "未返回");

// ── Step 2: Check channel ownership ──────────────────────────────────────
console.log("\n── 3. 验证频道归属 ──");
const chRes  = await fetch(
  "https://www.googleapis.com/youtube/v3/channels?part=snippet,status&mine=true",
  { headers: { Authorization: `Bearer ${AT}` } }
);
const chData = await chRes.json();

if (chData.error) {
  console.error("❌ 频道 API 失败：", JSON.stringify(chData.error));
} else if (!chData.items?.length) {
  console.warn("⚠  未找到频道（此账号可能没有 YouTube 频道）");
} else {
  for (const ch of chData.items) {
    console.log(`✓ 频道：${ch.snippet?.title} (${ch.id})`);
  }
}

// ── Step 3: Try channelBanners.insert ─────────────────────────────────────
console.log("\n── 4. 测试 channelBanners.insert ──");
if (!existsSync(BANNER_FILE)) {
  console.warn("⚠  dist/banner.png 不存在，跳过上传测试");
} else {
  const img      = readFileSync(BANNER_FILE);
  const BOUNDARY = "diag_boundary";
  const body     = Buffer.concat([
    Buffer.from(`--${BOUNDARY}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{}\r\n`, "utf8"),
    Buffer.from(`--${BOUNDARY}\r\nContent-Type: image/png\r\nContent-Transfer-Encoding: binary\r\n\r\n`, "utf8"),
    img,
    Buffer.from(`\r\n--${BOUNDARY}--`, "utf8"),
  ]);

  const uploadRes = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/channelBanners/insert?uploadType=multipart",
    {
      method: "POST",
      headers: {
        Authorization:  `Bearer ${AT}`,
        "Content-Type": `multipart/related; boundary=${BOUNDARY}`,
      },
      body,
    }
  );
  const uploadData = await uploadRes.json();
  console.log(`  HTTP 状态：${uploadRes.status}`);
  console.log(`  响应：${JSON.stringify(uploadData).slice(0, 300)}`);

  if (uploadRes.ok) {
    console.log("✅ channelBanners.insert 成功！URL：", uploadData.url);

    // Step 4: Apply to channel
    console.log("\n── 5. 应用 Banner 到频道 ──");
    const chId = chData.items?.[0]?.id;
    if (!chId) {
      console.error("❌ 无法获取频道 ID");
    } else {
      const applyRes = await fetch(
        "https://www.googleapis.com/youtube/v3/channels?part=brandingSettings",
        {
          method: "PUT",
          headers: { Authorization: `Bearer ${AT}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            id: chId,
            brandingSettings: { image: { bannerExternalUrl: uploadData.url } },
          }),
        }
      );
      const applyData = await applyRes.json();
      console.log(`  HTTP 状态：${applyRes.status}`);
      if (applyRes.ok) {
        console.log("✅ Banner 已成功设置到频道！");
      } else {
        console.error("❌ 设置失败：", JSON.stringify(applyData).slice(0, 200));
      }
    }
  } else if (uploadRes.status === 403) {
    console.error("❌ 403 Forbidden — channelBanners.insert 被拒绝");
    console.log("\n  原因分析：");
    const reason = uploadData?.error?.errors?.[0]?.reason;
    console.log("  错误原因：", reason ?? "unknown");
    if (reason === "forbidden") {
      console.log("  这通常意味着账号没有足够权限调用此 API");
      console.log("  YouTube channelBanners.insert 对普通账号有限制");
      console.log("  建议改用 Playwright 浏览器自动化上传");
    }
  }
}

console.log("\n══════════════════════════════════════════════\n");
