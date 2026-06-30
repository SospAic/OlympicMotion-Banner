/**
 * setup-caddy.mjs — Caddy 反向代理 + 域名配置
 *
 * 功能：
 *   - 自动申请 HTTPS 证书（Let's Encrypt）
 *   - /oauth/callback → localhost:8080（OAuth 授权回调）
 *   - /webhook        → localhost:4174（YouTube PubSubHubbub）
 *   - /               → localhost:4173（Banner 预览页面）
 *
 * 用法：
 *   node scripts/setup-caddy.mjs
 */

import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { resolve }                                  from "node:path";
import { fileURLToPath }                            from "node:url";
import { createInterface }                          from "node:readline";
import { execSync, spawn }                          from "node:child_process";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const CADDY_FILE = "/etc/caddy/Caddyfile";
const ENV_FILE   = resolve(ROOT, ".env");

// ── Helpers ───────────────────────────────────────────────────────────────
const rl  = createInterface({ input: process.stdin, output: process.stdout });
const ask = q => new Promise(r => rl.question(q, r));

function loadEnv() {
  if (!existsSync(ENV_FILE)) return {};
  const env = {};
  for (const line of readFileSync(ENV_FILE, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

function saveEnv(key, value) {
  let content = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
  if (content.includes(`${key}=`)) {
    content = content.replace(new RegExp(`^${key}=.*`, "m"), `${key}=${value}`);
  } else {
    content += `\n${key}=${value}\n`;
  }
  writeFileSync(ENV_FILE, content);
}

function run(cmd, args) {
  return new Promise(resolve => {
    const p = spawn(cmd, args, { stdio: "inherit" });
    p.on("close", resolve);
  });
}

// ── Main ──────────────────────────────────────────────────────────────────
console.log("\n══════════════════════════════════════════════");
console.log("  Caddy 域名 + HTTPS + OAuth 回调 配置工具");
console.log("══════════════════════════════════════════════\n");

// Check caddy installed
try {
  execSync("caddy version", { stdio: "ignore" });
} catch {
  console.error("❌ Caddy 未安装，请先运行 install-ubuntu.sh");
  process.exit(1);
}

const env = loadEnv();

// Get domain
let domain = env.DOMAIN ?? "";
if (!domain) {
  domain = (await ask("请输入你的域名（如 banner.example.com）：")).trim();
  if (!domain) { console.error("❌ 域名不能为空"); process.exit(1); }
  saveEnv("DOMAIN", domain);
}
console.log(`\n✓ 域名：${domain}`);

// Get banner port
const bannerPort = env.PORT ?? "4173";
const webhookPort = env.WEBHOOK_PORT ?? "4174";
const oauthPort = "8080";

// Build Caddyfile
const caddyfile = `# OlympicMotion Banner Engine — Caddy 配置
# 自动 HTTPS，证书由 Let's Encrypt 签发

${domain} {
    # OAuth 授权回调（用于 Google OAuth 登录）
    handle /oauth/callback* {
        reverse_proxy localhost:${oauthPort}
    }

    # YouTube PubSubHubbub Webhook（即时更新）
    handle /webhook* {
        reverse_proxy localhost:${webhookPort}
    }

    # Banner 预览页面
    handle {
        reverse_proxy localhost:${bannerPort}
    }

    # 日志
    log {
        output file /var/log/caddy/olympicmotion.log
        format json
    }
}
`;

console.log("\n生成的 Caddyfile 内容：");
console.log("─────────────────────────────────────────────");
console.log(caddyfile);
console.log("─────────────────────────────────────────────");

const confirm = await ask("确认写入 /etc/caddy/Caddyfile？(y/N)：");
if (confirm.toLowerCase() !== "y") {
  console.log("已取消");
  rl.close();
  process.exit(0);
}

// Backup existing Caddyfile
if (existsSync(CADDY_FILE)) {
  const backup = `${CADDY_FILE}.bak.${Date.now()}`;
  execSync(`cp ${CADDY_FILE} ${backup}`);
  console.log(`✓ 原配置已备份：${backup}`);
}

writeFileSync(CADDY_FILE, caddyfile);
console.log("✓ Caddyfile 已写入");

// Create log dir
execSync("mkdir -p /var/log/caddy");

// Reload Caddy
console.log("\n重载 Caddy...");
await run("systemctl", ["reload", "caddy"]).catch(() =>
  run("caddy", ["reload", "--config", CADDY_FILE])
);

// Update .env with public URL
const publicUrl = `https://${domain}`;
saveEnv("WEBHOOK_PUBLIC_URL", `${publicUrl}/webhook`);
saveEnv("BANNER_URL", publicUrl);
console.log(`\n✓ 已更新 .env：`);
console.log(`  WEBHOOK_PUBLIC_URL = ${publicUrl}/webhook`);
console.log(`  BANNER_URL         = ${publicUrl}`);

// Show Google Cloud Console instructions
console.log("\n══════════════════════════════════════════════");
console.log("  接下来需要在 Google Cloud Console 配置：");
console.log("══════════════════════════════════════════════\n");
console.log("1. 打开 https://console.cloud.google.com");
console.log("2. API 和服务 → 凭据 → 找到你的 OAuth 客户端 → 编辑");
console.log("3. 在「已授权的重定向 URI」中添加：\n");
console.log(`   \x1b[33m${publicUrl}/oauth/callback\x1b[0m\n`);
console.log("4. API 和服务 → OAuth 同意屏幕 → 发布应用（正式版）");
console.log("   （发布后 refresh_token 永不过期）\n");
console.log("5. 完成后重新运行登录：");
console.log("   node scripts/vps-login.mjs\n");
console.log("══════════════════════════════════════════════\n");

rl.close();
