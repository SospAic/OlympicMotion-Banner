#!/usr/bin/env node
/**
 * manage.mjs — OlympicMotion Banner Engine 管理菜单
 *
 * 用法：
 *   node scripts/manage.mjs                    # 单频道自动选择 / 多频道弹出选择器
 *   node scripts/manage.mjs --channel=name     # 直接跳过选择器
 */

import { createInterface }                     from "node:readline";
import { existsSync, readFileSync,
         readdirSync, writeFileSync, statSync } from "node:fs";
import { resolve, dirname }                    from "node:path";
import { fileURLToPath }                       from "node:url";
import { spawn, execSync }                     from "node:child_process";
import { resolveChannel, listChannels,
         loadChannelEnv, parseChannelArg }     from "./channel.mjs";

const ROOT        = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SESSION_ENC = resolve(ROOT, ".session/youtube-session.enc");
const SESSION_JSON= resolve(ROOT, ".session/youtube-session.json");
const ENV_FILE    = resolve(ROOT, ".env");

// ── Active channel (resolved at startup) ─────────────────────────────────
// Will be set by channel selector / auto-detect before mainMenu() runs
let ACTIVE_CHANNEL = null;  // { name, root, configPath, bgPath, envPath } | null

// Returns the active config file path (channel-specific or legacy)
function getConfigFile() {
  if (ACTIVE_CHANNEL && existsSync(ACTIVE_CHANNEL.configPath)) return ACTIVE_CHANNEL.configPath;
  return resolve(ROOT, "public/config/banner.config.json");
}

const BANNER_FILE = resolve(ROOT, "dist/banner.png");

// ── Colors ────────────────────────────────────────────────────────────────
const C = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  dim:    "\x1b[2m",
  red:    "\x1b[31m",
  green:  "\x1b[32m",
  yellow: "\x1b[33m",
  blue:   "\x1b[34m",
  cyan:   "\x1b[36m",
  white:  "\x1b[37m",
  gold:   "\x1b[33m",
};

const bold   = s => `${C.bold}${s}${C.reset}`;
const cyan   = s => `${C.cyan}${s}${C.reset}`;
const green  = s => `${C.green}${s}${C.reset}`;
const yellow = s => `${C.yellow}${s}${C.reset}`;
const red    = s => `${C.red}${s}${C.reset}`;
const dim    = s => `${C.dim}${s}${C.reset}`;

// ── readline ──────────────────────────────────────────────────────────────
const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = q => new Promise(r => {
  const iface = createInterface({ input: process.stdin, output: process.stdout });
  iface.question(q, a => {
    iface.close();
    r(a.replace(/[\r\n]/g, "").trim());
  });
});

function clear() { process.stdout.write("\x1b[2J\x1b[H"); }

// ── Load .env ─────────────────────────────────────────────────────────────
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

// ── Run a child process and stream output ─────────────────────────────────
async function run(cmd, args = [], opts = {}) {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, {
      cwd:   ROOT,
      stdio: "inherit",
      env:   { ...process.env, NVM_DIR: process.env.NVM_DIR ?? `${process.env.HOME}/.nvm` },
      ...opts,
    });
    proc.on("close", code => resolve(code));
  });
}

async function runScript(script, ...args) {
  const nodeBin = process.execPath;
  return run(nodeBin, [script, ...args]);
}

// ── Status check ──────────────────────────────────────────────────────────
function getStatus() {
  const env    = loadEnv();
  const hasEnv = existsSync(ENV_FILE);
  const hasSess= existsSync(SESSION_ENC) || existsSync(SESSION_JSON);
  const hasBanner = existsSync(BANNER_FILE);
  let bannerAge = "";
  if (hasBanner) {
    const mins = Math.floor((Date.now() - statSync(BANNER_FILE).mtimeMs) / 60000);
    bannerAge = mins < 60 ? `${mins}分钟前` : `${Math.floor(mins/60)}小时前`;
  }

  let sessAge = "";
  const sessFile = existsSync(SESSION_ENC) ? SESSION_ENC : SESSION_JSON;
  if (hasSess) {
    const mins = Math.floor((Date.now() - statSync(sessFile).mtimeMs) / 60000);
    const days = Math.floor(mins / 1440);
    sessAge = days > 0 ? `${days}天前` : `${Math.floor(mins/60)}小时前`;
  }

  // Check pm2
  let pm2Running = false;
  try {
    const out = execSync("pm2 jlist 2>/dev/null || echo '[]'", { encoding: "utf8" });
    const list = JSON.parse(out);
    const pm2Name = process.env.CHANNEL_PM2_NAME ?? "banner-daemon";
    pm2Running = list.some(p => p.name === pm2Name && p.pm2_env?.status === "online");
  } catch { /* ignore */ }

  // Check SSL cert expiry
  let certDaysLeft = null;
  let certExists   = false;
  try {
    const certFile = env.SSL_CERT_FILE ?? "/etc/letsencrypt/live/om.sospaic.top/fullchain.pem";
    certExists = existsSync(certFile);
    if (certExists) {
      const out = execSync(`openssl x509 -enddate -noout -in "${certFile}" 2>/dev/null`, { encoding: "utf8" }).trim();
      const match = out.match(/notAfter=(.+)/);
      if (match) certDaysLeft = Math.floor((new Date(match[1]) - Date.now()) / 86400000);
    }
  } catch { /* ignore */ }

  // Check node cert expiry
  let nodeCertDaysLeft = null;
  let nodeCertExists   = false;
  try {
    const nodeFile = env.NODE_SSL_CERT_FILE ?? "/root/ygkkkca/cert.crt";
    nodeCertExists = existsSync(nodeFile);
    if (nodeCertExists) {
      const out = execSync(`openssl x509 -enddate -noout -in "${nodeFile}" 2>/dev/null`, { encoding: "utf8" }).trim();
      const match = out.match(/notAfter=(.+)/);
      if (match) nodeCertDaysLeft = Math.floor((new Date(match[1]) - Date.now()) / 86400000);
    }
  } catch { /* ignore */ }

  // Check Caddy running
  let caddyRunning = false;
  try {
    const out = execSync("systemctl is-active caddy 2>/dev/null; true", { encoding: "utf8" }).trim();
    caddyRunning = out === "active";
  } catch { /* ignore */ }

  return {
    hasEnv,
    hasApiKey:   !!(env.YOUTUBE_API_KEY),
    hasChannelId:!!(env.YOUTUBE_CHANNEL_ID),
    hasSess,
    sessAge,
    hasEncKey:      !!(env.SESSION_ENCRYPTION_KEY),
    hasRefreshToken:!!(env.GOOGLE_REFRESH_TOKEN),
    hasDomain:      !!(env.DOMAIN),
    domain:         env.DOMAIN ?? "",
    hasBanner,
    bannerAge,
    pm2Running,
    caddyRunning,
    certExists,
    certDaysLeft,
    nodeCertExists,
    nodeCertDaysLeft,
    nodeDomain:     env.NODE_DOMAIN ?? "",
    subs:        env.YOUTUBE_API_KEY ? "已配置" : "未配置",
    currentSubs: (() => {
      try {
        const cfg = JSON.parse(readFileSync(getConfigFile(), "utf8"));
        return cfg.data?.subs ?? 0;
      } catch { return 0; }
    })(),
  };
}

function statusLine(ok, label, detail = "") {
  const icon = ok ? green("✓") : red("✗");
  return `  ${icon} ${label.padEnd(22)} ${dim(detail)}`;
}

// ══════════════════════════════════════════════════════════════════════════
// MENUS
// ══════════════════════════════════════════════════════════════════════════

// ── Header ────────────────────────────────────────────────────────────────
function header(subtitle = "") {
  clear();
  const channelTag = ACTIVE_CHANNEL ? ` ${dim(`[${ACTIVE_CHANNEL.name}]`)}` : "";
  console.log(bold(cyan("\n  ╔══════════════════════════════════════════╗")));
  console.log(bold(cyan("  ║  OlympicMotion Banner Engine              ║")));
  console.log(bold(cyan("  ╚══════════════════════════════════════════╝")) + channelTag);
  if (subtitle) console.log(`\n  ${yellow("▶")} ${bold(subtitle)}\n`);
  else console.log();
}

// ── Main menu ─────────────────────────────────────────────────────────────
async function mainMenu() {
  const st = getStatus();
  header();

  console.log("  " + bold("系统状态："));
  console.log(statusLine(st.hasEnv,          ".env 配置文件"));
  console.log(statusLine(st.hasApiKey,        "YouTube API Key"));
  console.log(statusLine(st.hasChannelId,     "YouTube 频道 ID"));
  console.log(statusLine(st.hasSess || st.hasRefreshToken, "上传凭据",
    st.hasSess ? `Session (${st.sessAge})` : st.hasRefreshToken ? "OAuth Token" : "未配置"));
  console.log(statusLine(st.hasEncKey,        "Session 加密"));
  console.log(statusLine(st.hasBanner,        "Banner 文件",    st.hasBanner ? `生成于 ${st.bannerAge}` : ""));
  console.log(statusLine(st.pm2Running,       "守护进程 (pm2)", st.pm2Running ? "运行中" : "未运行"));
  console.log(statusLine(st.caddyRunning,     "Caddy 服务",     st.caddyRunning ? "运行中" : "未运行"));
  console.log(statusLine(st.hasDomain,        "Banner 域名",    st.domain));

  // Banner cert
  {
    const ok     = st.certExists && st.certDaysLeft !== null && st.certDaysLeft > 14;
    let detail;
    if (!st.certExists)                   detail = "证书文件不存在";
    else if (st.certDaysLeft === null)    detail = "无法读取";
    else if (st.certDaysLeft < 0)         detail = `已过期 ${Math.abs(st.certDaysLeft)} 天`;
    else                                  detail = `剩余 ${st.certDaysLeft} 天`;
    console.log(statusLine(ok, "Banner SSL 证书", detail));
  }

  // Node cert
  {
    const ok     = st.nodeCertExists && st.nodeCertDaysLeft !== null && st.nodeCertDaysLeft > 14;
    let detail;
    if (!st.nodeCertExists)                   detail = "证书文件不存在";
    else if (st.nodeCertDaysLeft === null)    detail = "无法读取";
    else if (st.nodeCertDaysLeft < 0)         detail = `已过期 ${Math.abs(st.nodeCertDaysLeft)} 天`;
    else                                      detail = `剩余 ${st.nodeCertDaysLeft} 天`;
    const nodeLabel = st.nodeDomain ? `节点证书 (${st.nodeDomain})` : "节点 SSL 证书";
    console.log(statusLine(ok, nodeLabel, detail));
  }
  if (st.currentSubs) {
    console.log(`\n  ${dim("当前订阅数：")} ${yellow(st.currentSubs.toLocaleString())}`);
  }

  console.log("\n  " + bold("功能菜单："));
  console.log(`  ${cyan("1")}  安装 & 初始化`);
  console.log(`  ${cyan("2")}  登录 & Session 管理`);
  console.log(`  ${cyan("3")}  生成 & 上传 Banner`);
  console.log(`  ${cyan("4")}  服务管理`);
  console.log(`  ${cyan("5")}  配置管理`);
  console.log(`  ${cyan("6")}  查看日志`);
  console.log(`  ${cyan("0")}  退出`);
  console.log();

  const choice = await ask(`  请选择 [0-6]：`);
  switch (choice.trim()) {
    case "1": await menuInstall();  break;
    case "2": await menuSession();  break;
    case "3": await menuBanner();   break;
    case "4": await menuDaemon();   break;
    case "5": await menuConfig();   break;
    case "6": await menuLogs();     break;
    case "0": rl.close(); console.log("\n  再见！\n"); process.exit(0);
    default:  await mainMenu();
  }
}

// ── 1. Install menu ───────────────────────────────────────────────────────
async function menuInstall() {
  header("安装 & 初始化");
  console.log(`  ${cyan("1")}  Ubuntu 一键安装（推荐，全自动）`);
  console.log(`  ${cyan("2")}  配置域名 + HTTPS + OAuth 回调 (Caddy)`);
  console.log(`  ${cyan("3")}  SSL 证书申请 & 自动续期`);
  console.log(`  ${cyan("4")}  仅安装/更新 npm 依赖`);
  console.log(`  ${cyan("5")}  安装 Playwright Chromium`);
  console.log(`  ${cyan("6")}  安装 Playwright 系统依赖`);
  console.log(`  ${cyan("7")}  安装 PM2 进程管理器`);
  console.log(`  ${cyan("8")}  更新项目代码 (git pull)`);
  console.log(`  ${cyan("0")}  返回主菜单\n`);

  const c = (await ask("  请选择：")).trim();
  switch (c) {
    case "1": {
      const sh = resolve(ROOT, "scripts/install-ubuntu.sh");
      console.log();
      await run("bash", [sh]);
      break;
    }
    case "2":
      console.log(); await runScript("scripts/setup-caddy.mjs");
      break;
    case "3":
      console.log(); await runScript("scripts/renew-cert.mjs");
      break;
    case "4":
      console.log(); await run("npm", ["ci"]);
      break;
    case "5":
      console.log(); await run(process.execPath, ["node_modules/playwright/cli.js", "install", "chromium"]);
      break;
    case "6":
      console.log(); await run(process.execPath, ["node_modules/playwright/cli.js", "install-deps", "chromium"]);
      break;
    case "7":
      console.log(); await run("npm", ["install", "-g", "pm2"]);
      break;
    case "8":
      console.log(); await run("git", ["pull", "--rebase", "origin", "main"]);
      break;
    case "0": break;
  }
  await pause(); await mainMenu();
}

// ── 2. Session menu ───────────────────────────────────────────────────────
async function menuSession() {
  header("登录 & Session 管理");
  const hasSess = existsSync(SESSION_ENC) || existsSync(SESSION_JSON);
  const hasKey  = !!(loadEnv().SESSION_ENCRYPTION_KEY);

  console.log(statusLine(hasSess, "Session 状态"));
  console.log(statusLine(hasKey,  "加密密钥"));
  console.log();
  console.log(`  ${cyan("1")}  VPS 登录（OAuth + SSH 隧道，推荐）`);
  console.log(`  ${cyan("2")}  生成 Session 加密密钥`);
  console.log(`  ${cyan("3")}  加密现有 Session`);
  console.log(`  ${cyan("4")}  验证 Session`);
  console.log(`  ${cyan("5")}  删除 Session（重置登录状态）`);
  console.log(`  ${cyan("0")}  返回主菜单\n`);

  const c = (await ask("  请选择：")).trim();
  switch (c) {
    case "1":
      console.log(); await runScript("scripts/vps-login.mjs");
      break;
    case "2":
      console.log(); await runScript("scripts/encrypt-session.mjs --gen-key".split(" ")[0]);
      break;
    case "3":
      console.log(); await run(process.execPath, ["scripts/encrypt-session.mjs", "--encrypt"]);
      break;
    case "4":
      console.log(); await run(process.execPath, ["scripts/encrypt-session.mjs", "--decrypt"]);
      break;
    case "5": {
      const confirm = await ask("  确认删除 Session？(y/N)：");
      if (confirm.toLowerCase() === "y") {
        const { unlinkSync } = await import("node:fs");
        if (existsSync(SESSION_ENC))  unlinkSync(SESSION_ENC);
        if (existsSync(SESSION_JSON)) unlinkSync(SESSION_JSON);
        console.log(green("  ✓ Session 已删除"));
      }
      break;
    }
    case "0": break;
  }
  await pause(); await mainMenu();
}

// ── 3. Banner menu (生成 & 上传，合并入口) ───────────────────────────────
async function menuBanner() {
  header("生成 & 上传 Banner");

  const hasBanner   = existsSync(BANNER_FILE);
  const hasBannerV2 = existsSync(resolve(ROOT, "dist/banner-v2.png"));

  console.log(`  ${dim("方案说明：")} ${cyan("新方案 v2")} = Sharp合成（快，无需浏览器）  ${cyan("旧方案 v1")} = Playwright截图`);
  if (hasBannerV2) console.log(`  ${dim("v2 Banner：")} ${green("已存在")}`);
  if (hasBanner)   console.log(`  ${dim("v1 Banner：")} ${green("已存在")}`);
  console.log();

  console.log(`  ${bold(cyan("── 新方案 v2 ──"))}`);
  console.log(`  ${cyan("1")}  v2 仅生成`);
  console.log(`  ${cyan("2")}  v2 生成并上传 ${green("[推荐]")}`);
  console.log(`  ${cyan("3")}  v2 手动指定订阅数，仅生成`);
  console.log(`  ${cyan("4")}  v2 手动指定订阅数，生成并上传`);
  console.log();
  console.log(`  ${bold(cyan("── 旧方案 v1 ──"))}`);
  console.log(`  ${cyan("5")}  v1 仅生成`);
  console.log(`  ${cyan("6")}  v1 生成并上传`);
  console.log(`  ${cyan("7")}  v1 手动指定订阅数，仅生成`);
  console.log(`  ${cyan("8")}  v1 手动指定订阅数，生成并上传`);
  console.log();
  console.log(`  ${bold(cyan("── 仅上传 ──"))}`);
  console.log(`  ${cyan("9")}  上传已有 Banner（v2 优先，无则用 v1）`);
  console.log(`  ${cyan("0")}  返回主菜单\n`);

  const c = (await ask("  请选择：")).trim();
  console.log();

  switch (c) {
    case "1":
      await runScript("run.mjs", "--v2", "--no-upload");
      break;
    case "2":
      await run(process.execPath, ["run.mjs", "--v2"]);
      break;
    case "3": {
      const subs = await ask("  输入订阅数：");
      if (subs.trim()) await run(process.execPath, ["run.mjs", "--v2", "--no-upload", `--subs=${subs.trim()}`]);
      break;
    }
    case "4": {
      const subs = await ask("  输入订阅数：");
      if (subs.trim()) await run(process.execPath, ["run.mjs", "--v2", `--subs=${subs.trim()}`]);
      break;
    }
    case "5":
      await runScript("run.mjs", "--no-upload");
      break;
    case "6":
      await runScript("run.mjs");
      break;
    case "7": {
      const subs = await ask("  输入订阅数：");
      if (subs.trim()) await run(process.execPath, ["run.mjs", "--no-upload", `--subs=${subs.trim()}`]);
      break;
    }
    case "8": {
      const subs = await ask("  输入订阅数：");
      if (subs.trim()) await run(process.execPath, ["run.mjs", `--subs=${subs.trim()}`]);
      break;
    }
    case "9":
      await run(process.execPath, ["exporter/upload-banner.mjs"]);
      break;
    case "0": break;
    default:
      console.log(yellow("  无效选项"));
  }
  await pause(); await mainMenu();
}

// ── 4. Daemon menu ────────────────────────────────────────────────────────
async function menuDaemon() {
  header("服务管理");

  // ── Collect service status ──────────────────────────────────────────────
  function svcStatus(name) {
    try {
      const s = execSync(`systemctl is-active ${name} 2>/dev/null; true`, { encoding: "utf8" }).trim();
      return s === "active" ? green("运行中") : red(s || "inactive");
    } catch { return red("未知"); }
  }

  function pm2AppStatus(appName) {
    try {
      const out  = execSync("pm2 jlist 2>/dev/null || echo '[]'", { encoding: "utf8" });
      const list = JSON.parse(out);
      const d    = list.find(p => p.name === appName);
      if (!d) return red("未运行");
      return d.pm2_env?.status === "online" ? green("运行中") : red(d.pm2_env?.status);
    } catch { return red("未知"); }
  }

  // Use bash to ensure systemctl/journalctl are found regardless of PATH
  const sh = (cmd) => run("bash", ["-c", cmd]);

  // Resolve channel-specific PM2 name and webhook port
  const pm2Name    = process.env.CHANNEL_PM2_NAME ?? "banner-daemon";
  const webhookPort= process.env.CHANNEL_WEBHOOK_PORT ?? loadEnv().WEBHOOK_PORT ?? "47832";

  const daemonSt = pm2AppStatus(pm2Name);
  const caddySt  = svcStatus("caddy");

  console.log(`  ${dim("PM2 Banner守护进程：")} ${daemonSt}`);
  console.log(`  ${dim("Caddy 反向代理：    ")} ${caddySt}\n`);

  console.log(`  ${bold(cyan("── Banner 守护进程 (PM2) ──"))}`);
  console.log(`  ${cyan("1")}  启动守护进程`);
  console.log(`  ${cyan("2")}  停止守护进程`);
  console.log(`  ${cyan("3")}  重启守护进程`);
  console.log(`  ${cyan("4")}  查看守护进程日志（最近 50 行）`);
  console.log(`  ${cyan("5")}  实时追踪守护进程日志`);
  console.log(`  ${cyan("6")}  健康检查（Webhook 接口）`);
  console.log(`  ${cyan("7")}  设置开机自启 (pm2 startup)`);
  console.log();
  console.log(`  ${bold(cyan("── Caddy 反向代理 ──"))}`);
  console.log(`  ${cyan("8")}  启动 Caddy`);
  console.log(`  ${cyan("9")}  停止 Caddy`);
  console.log(`  ${cyan("10")}  重启 Caddy`);
  console.log(`  ${cyan("11")}  重载 Caddy（不中断连接）`);
  console.log(`  ${cyan("12")}  查看 Caddy 日志（最近 50 行）`);
  console.log(`  ${cyan("13")}  查看 Caddy 运行状态详情`);
  console.log(`  ${cyan("17")}  修复证书文件权限（permission denied 时使用）`);
  console.log();
  console.log(`  ${bold(cyan("── 其他 ──"))}`);
  console.log(`  ${cyan("14")}  查看所有 PM2 进程`);
  console.log(`  ${cyan("15")}  查看系统端口占用`);
  console.log(`  ${cyan("16")}  查看 cron 定时任务`);
  console.log(`  ${cyan("0")}   返回主菜单\n`);

  const c = (await ask("  请选择：")).trim();
  console.log();
  switch (c) {
    // ── PM2 ──
    case "1":
      await run("pm2", ["start", "scripts/watch-daemon.mjs", "--name", pm2Name]);
      await run("pm2", ["save"]);
      break;
    case "2":
      await run("pm2", ["stop", pm2Name]);
      break;
    case "3":
      await run("pm2", ["restart", pm2Name]);
      break;
    case "4":
      await run("pm2", ["logs", pm2Name, "--lines", "50", "--nostream"]);
      break;
    case "5":
      console.log(dim("  按 Ctrl+C 退出追踪\n"));
      await run("pm2", ["logs", pm2Name]);
      break;
    case "6": {
      await sh(`curl -s -w "\\n" http://localhost:${webhookPort}/health`);
      break;
    }
    case "7":
      await run("pm2", ["save"]);
      await sh("pm2 startup");
      break;
    // ── Caddy ──
    case "8":
      await sh("systemctl start caddy && echo '✓ Caddy 已启动'");
      break;
    case "9": {
      const confirm = (await ask("  确认停止 Caddy？HTTPS 服务将中断 (y/N)：")).toLowerCase();
      if (confirm === "y") await sh("systemctl stop caddy && echo '✓ Caddy 已停止'");
      break;
    }
    case "10":
      await sh("systemctl restart caddy && echo '✓ Caddy 已重启'");
      break;
    case "11":
      await sh("systemctl reload caddy && echo '✓ Caddy 已重载'");
      break;
    case "12":
      await sh("journalctl -u caddy -n 50 --no-pager 2>/dev/null || tail -50 /var/log/caddy/olympicmotion.log 2>/dev/null || echo '未找到日志'");
      break;
    case "13":
      await sh("systemctl status caddy --no-pager");
      break;
    case "17": {
      // Fix cert file permissions so caddy user can read them
      const env = loadEnv();
      const certFile = env.SSL_CERT_FILE ?? "/etc/letsencrypt/live/om.sospaic.top/fullchain.pem";
      const keyFile  = env.SSL_KEY_FILE  ?? "/etc/letsencrypt/live/om.sospaic.top/privkey.pem";
      const certDir  = certFile.substring(0, certFile.lastIndexOf("/"));
      await sh(`chmod 755 "${certDir}" 2>/dev/null; chmod 644 "${certFile}" 2>/dev/null; chmod 644 "${keyFile}" 2>/dev/null; echo "✓ 证书权限已修复：644"`);
      await sh("systemctl restart caddy && echo '✓ Caddy 已重启' || echo '❌ Caddy 重启失败，查看选项13'");
      break;
    }
    // ── Other ──
    case "14":
      await run("pm2", ["list"]);
      break;
    case "15":
      await sh("ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null || echo '需要安装 iproute2'");
      break;
    case "16":
      await sh("crontab -l 2>/dev/null || echo '无 cron 任务'");
      break;
    case "0": break;
    default: console.log(yellow("  无效选项"));
  }
  await pause(); await mainMenu();
}

// ── 5. Config menu ────────────────────────────────────────────────────────
async function menuConfig() {
  header("配置管理");
  console.log(`  ${cyan("1")}  编辑 .env 配置文件`);
  console.log(`  ${cyan("2")}  编辑 banner.config.json`);
  console.log(`  ${cyan("3")}  查看当前配置摘要`);
  console.log(`  ${cyan("4")}  更新订阅数目标（goal）`);
  console.log(`  ${cyan("5")}  更换 Logo 路径`);
  console.log(`  ${cyan("0")}  返回主菜单\n`);

  const c = (await ask("  请选择：")).trim();
  switch (c) {
    case "1":
      console.log(); await run("nano", [".env"]);
      break;
    case "2":
      console.log(); await run("nano", [getConfigFile()]);
      break;
    case "3": {
      const env = loadEnv();
      console.log("\n  " + bold(".env 配置摘要："));
      const show = (k, mask = false) => {
        const v = env[k];
        if (!v) return console.log(`  ${dim(k.padEnd(28))} ${red("未设置")}`);
        const display = mask ? v.slice(0, 6) + "****" : v;
        console.log(`  ${cyan(k.padEnd(28))} ${green(display)}`);
      };
      show("YOUTUBE_API_KEY",         true);
      show("YOUTUBE_CHANNEL_ID");
      show("GOOGLE_CLIENT_ID",        true);
      show("GOOGLE_REFRESH_TOKEN",    true);
      show("SESSION_ENCRYPTION_KEY",  true);
      show("BANNER_URL");
      show("POLL_INTERVAL_MINUTES");
      show("WEBHOOK_PUBLIC_URL");
      try {
        const cfg = JSON.parse(readFileSync(getConfigFile(), "utf8"));
        console.log("\n  " + bold("banner.config.json 摘要："));
        console.log(`  ${"channelName".padEnd(28)} ${green(cfg.brand?.channelName ?? "-")}`);
        console.log(`  ${"mission.goal".padEnd(28)} ${green(cfg.mission?.goal?.toLocaleString() ?? "-")}`);
        console.log(`  ${"data.subs".padEnd(28)} ${yellow(cfg.data?.subs?.toLocaleString() ?? "-")}`);
        console.log(`  ${"logo".padEnd(28)} ${green(cfg.brand?.logo ?? "-")}`);
      } catch { /* ignore */ }
      break;
    }
    case "4": {
      const goal = await ask("  输入新的订阅目标（如 100000）：");
      if (goal.trim() && !isNaN(Number(goal.trim()))) {
        const cfg = JSON.parse(readFileSync(getConfigFile(), "utf8"));
        cfg.mission.goal  = Number(goal.trim());
        cfg.mission.title = `Road To <span>${(Number(goal.trim())/1000).toFixed(0).replace(".0","")}K</span> Champions`;
        writeFileSync(getConfigFile(), JSON.stringify(cfg, null, 2) + "\n");
        console.log(green(`  ✓ 目标已更新为 ${Number(goal.trim()).toLocaleString()}`));
      }
      break;
    }
    case "5": {
      const logo = await ask("  输入 Logo 路径（如 /assets/logo.png）：");
      if (logo.trim()) {
        const cfg = JSON.parse(readFileSync(getConfigFile(), "utf8"));
        cfg.brand.logo = logo.trim();
        writeFileSync(getConfigFile(), JSON.stringify(cfg, null, 2) + "\n");
        console.log(green("  ✓ Logo 路径已更新"));
      }
      break;
    }
    case "0": break;
  }
  await pause(); await mainMenu();
}

// ── 6. Logs menu ─────────────────────────────────────────────────────────
async function menuLogs() {
  header("日志");
  const logFile = "/var/log/olympicmotion-banner.log";
  const altLog  = resolve(ROOT, "banner.log");
  const log     = existsSync(logFile) ? logFile : altLog;

  console.log(`  ${cyan("1")}  查看最近 50 行日志`);
  console.log(`  ${cyan("2")}  实时追踪日志 (tail -f)`);
  console.log(`  ${cyan("3")}  PM2 守护进程日志`);
  console.log(`  ${cyan("0")}  返回主菜单\n`);

  const c = (await ask("  请选择：")).trim();
  switch (c) {
    case "1":
      console.log(); await run("tail", ["-n", "50", log]);
      break;
    case "2":
      console.log();
      console.log(dim("  按 Ctrl+C 退出追踪\n"));
      await run("tail", ["-f", log]);
      break;
    case "3":
      console.log(); await run("pm2", ["logs", "banner-daemon", "--lines", "50"]);
      break;
    case "0": break;
  }
  await pause(); await mainMenu();
}

// ── Helpers ───────────────────────────────────────────────────────────────
async function pause() {
  await ask(`\n  ${dim("按 Enter 返回菜单...")}`);
}

async function fetchSubsPreview() {
  const env = loadEnv();
  if (!env.YOUTUBE_API_KEY || !env.YOUTUBE_CHANNEL_ID) return "（未配置 API）";
  try {
    const r = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${env.YOUTUBE_CHANNEL_ID}&key=${env.YOUTUBE_API_KEY}`
    );
    const d = await r.json();
    return d.items?.[0]?.statistics?.subscriberCount ?? "获取失败";
  } catch { return "获取失败"; }
}

// ── Channel selector ──────────────────────────────────────────────────────
/**
 * Show an interactive channel selector and return the chosen channel name.
 * Only called when multiple channels exist and no --channel arg was given.
 */
async function selectChannelInteractive(channels) {
  clear();
  console.log(bold(cyan("\n  ╔══════════════════════════════════════════╗")));
  console.log(bold(cyan("  ║  OlympicMotion Banner Engine              ║")));
  console.log(bold(cyan("  ╚══════════════════════════════════════════╝")));
  console.log(`\n  ${yellow("▶")} ${bold("频道选择")}\n`);
  channels.forEach((ch, i) => {
    console.log(`  ${cyan(String(i + 1))}  ${ch}`);
  });
  console.log();
  const choice = await ask(`  请选择频道 [1-${channels.length}]：`);
  const idx = parseInt(choice.trim(), 10) - 1;
  if (idx >= 0 && idx < channels.length) return channels[idx];
  // Default to first channel on invalid input
  return channels[0];
}

// ── Boot ──────────────────────────────────────────────────────────────────
// Load .env into process.env before starting
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

// Wrap in async main to avoid top-level await warning on older Node versions
(async () => {
  // ── Resolve active channel ──────────────────────────────────────────────
  const channels = listChannels();

  if (channels.length > 0) {
    // Try --channel=name arg first
    const argName = parseChannelArg();
    if (argName) {
      // Skip selector — use named channel
      const { channelDescriptor } = await import("./channel.mjs");
      ACTIVE_CHANNEL = channelDescriptor(argName);
    } else if (channels.length === 1) {
      // Auto-select single channel silently
      const { channelDescriptor } = await import("./channel.mjs");
      ACTIVE_CHANNEL = channelDescriptor(channels[0]);
    } else {
      // Multiple channels — show selector
      const chosen = await selectChannelInteractive(channels);
      const { channelDescriptor } = await import("./channel.mjs");
      ACTIVE_CHANNEL = channelDescriptor(chosen);
    }

    // Load channel-specific env vars
    if (ACTIVE_CHANNEL) {
      loadChannelEnv(ACTIVE_CHANNEL.name);
      if (!process.env.CHANNEL_CONFIG) process.env.CHANNEL_CONFIG = ACTIVE_CHANNEL.configPath;
      if (!process.env.CHANNEL_BG)     process.env.CHANNEL_BG     = ACTIVE_CHANNEL.bgPath;
    }
  }
  // If channels/ doesn't exist → legacy mode, ACTIVE_CHANNEL stays null

  await mainMenu();
})().catch(e => { console.error(e.message); process.exit(1); });
