/**
 * 一次性运行脚本：获取 Google OAuth refresh_token
 *
 * ⚠️  OAuth 客户端类型必须是「Web 应用」，不是「桌面应用」
 *     已授权的重定向 URI 必须添加：
 *       - http://localhost:8080/callback （本地测试用）
 *       - https://你的域名/oauth/callback （VPS 生产用）
 *
 * 用法（VPS 上推荐直接用 vps-login.mjs 代替此脚本）：
 *   node get-refresh-token.mjs
 *
 * 需要先设置环境变量：
 *   CLIENT_ID     = 你的 OAuth Web 客户端 ID（.apps.googleusercontent.com 结尾）
 *   CLIENT_SECRET = 你的 OAuth 客户端密钥（GOCSPX- 开头）
 */

import { createServer } from "node:http";
import { createInterface } from "node:readline";

const CLIENT_ID     = process.env.CLIENT_ID     ?? "在此填入你的client_id";
const CLIENT_SECRET = process.env.CLIENT_SECRET ?? "在此填入你的client_secret";
const REDIRECT_URI  = "http://localhost:8080";
const SCOPE = [
  "https://www.googleapis.com/auth/youtube",
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.force-ssl",
].join(" ");

if (CLIENT_ID.startsWith("在此")) {
  console.error("请先设置 CLIENT_ID 和 CLIENT_SECRET 环境变量，或直接修改脚本中的默认值");
  process.exit(1);
}

// 1. 生成授权 URL
const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.searchParams.set("client_id",     CLIENT_ID);
authUrl.searchParams.set("redirect_uri",  REDIRECT_URI);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("scope",         SCOPE);
authUrl.searchParams.set("access_type",   "offline");
authUrl.searchParams.set("prompt",        "consent");  // 强制返回 refresh_token

console.log("\n======================================");
console.log("请用翻墙浏览器打开以下链接，完成 Google 授权：");
console.log("\n" + authUrl.toString());
console.log("\n授权完成后，页面会跳转到 localhost:8080（可能显示无法访问）");
console.log("脚本会自动捕获授权码并换取 refresh_token");
console.log("======================================\n");

// 2. 启动本地临时服务器接收回调
const code = await new Promise((resolve, reject) => {
  const server = createServer((req, res) => {
    const url    = new URL(req.url, "http://localhost:8080");
    const code   = url.searchParams.get("code");
    const error  = url.searchParams.get("error");

    if (error) {
      res.writeHead(400);
      res.end("授权失败：" + error);
      server.close();
      reject(new Error("授权被拒绝：" + error));
      return;
    }

    if (code) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<h2>✓ 授权成功！请回到终端查看 refresh_token</h2><p>本窗口可以关闭。</p>");
      server.close();
      resolve(code);
    }
  });

  server.listen(8080, () => {
    console.log("等待 Google 授权回调（监听 http://localhost:8080）...\n");
  });

  // 超时 5 分钟
  setTimeout(() => {
    server.close();
    reject(new Error("超时：5分钟内未完成授权"));
  }, 5 * 60 * 1000);
});

// 3. 用授权码换取 tokens
console.log("正在换取 tokens...");
const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
  method:  "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body:    new URLSearchParams({
    code,
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri:  REDIRECT_URI,
    grant_type:    "authorization_code",
  }),
});

const tokens = await tokenRes.json();

if (!tokens.refresh_token) {
  console.error("未获取到 refresh_token，完整响应：", JSON.stringify(tokens, null, 2));
  process.exit(1);
}

// 4. 输出结果
console.log("\n======================================");
console.log("✓ 成功！请将以下信息添加到 GitHub Secrets：");
console.log("======================================");
console.log("\nSecret 名称：GOOGLE_CLIENT_ID");
console.log("Secret 值：  " + CLIENT_ID);
console.log("\nSecret 名称：GOOGLE_CLIENT_SECRET");
console.log("Secret 值：  " + CLIENT_SECRET);
console.log("\nSecret 名称：GOOGLE_REFRESH_TOKEN");
console.log("Secret 值：  " + tokens.refresh_token);
console.log("\n======================================");
console.log("⚠️  完成后请立即删除本脚本（get-refresh-token.mjs）");
console.log("======================================\n");
