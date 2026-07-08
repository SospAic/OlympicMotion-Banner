#!/usr/bin/env node
/**
 * renew-cert.mjs — SSL 证书申请 & 自动续期管理
 *
 * 支持两种方式：
 *   1. acme.sh（推荐，无需 root，HTTP-01 或 DNS-01）
 *   2. certbot（系统级，HTTP-01）
 *
 * 功能：
 *   - 首次申请证书
 *   - 配置 cron 定时自动续期
 *   - 续期后自动重载 Caddy
 *   - 证书路径写入 .env
 *
 * 用法：node scripts/renew-cert.mjs
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve }      from "node:path";
import { fileURLToPath} from "node:url";
import { createInterface } from "node:readline";
import { execSync, spawn } from "node:child_process";

const ROOT     = resolve(fileURLToPath(new URL("..", import.meta.url)));
const ENV_FILE = resolve(ROOT, ".env");

// ── Colors ────────────────────────────────────────────────────────────────
const G = s => `\x1b[32m${s}\x1b[0m`;
const Y = s => `\x1b[33m${s}\x1b[0m`;
const R = s => `\x1b[31m${s}\x1b[0m`;
const C = s => `\x1b[36m${s}\x1b[0m`;
const B = s => `\x1b[1m${s}\x1b[0m`;
const D = s => `\x1b[2m${s}\x1b[0m`;

// ── Helpers ───────────────────────────────────────────────────────────────
const ask = q => new Promise(r => {
  const iface = createInterface({ input: process.stdin, output: process.stdout });
  iface.question(q, a => { iface.close(); r(a.replace(/[\r\n]/g, "").trim()); });
});

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
  const regex = new RegExp(`^${key}=.*`, "m");
  if (regex.test(content)) {
    content = content.replace(regex, `${key}=${value}`);
  } else {
    content = content.trimEnd() + `\n${key}=${value}\n`;
  }
  writeFileSync(ENV_FILE, content);
}

function run(cmd, args = [], opts = {}) {
  return new Promise(resolve => {
    const proc = spawn(cmd, args, { stdio: "inherit", ...opts });
    proc.on("close", code => resolve(code));
  });
}

function tryExec(cmd) {
  try { return execSync(cmd, { encoding: "utf8", stdio: "pipe" }).trim(); }
  catch { return null; }
}

function cmdExists(cmd) {
  return !!tryExec(`which ${cmd} 2>/dev/null`);
}

// ── Check cert expiry ──────────────────────────────────────────────────────
function checkCertExpiry(certPath) {
  if (!existsSync(certPath)) return null;
  try {
    const out = execSync(
      `openssl x509 -enddate -noout -in "${certPath}" 2>/dev/null`,
      { encoding: "utf8" }
    ).trim();
    const match = out.match(/notAfter=(.+)/);
    if (!match) return null;
    const expiry = new Date(match[1]);
    const daysLeft = Math.floor((expiry - Date.now()) / 86400000);
    return { expiry, daysLeft };
  } catch { return null; }
}

// ── Install acme.sh ────────────────────────────────────────────────────────
async function installAcme(email) {
  console.log("\n📦 正在安装 acme.sh...");
  const code = await run("bash", ["-c",
    `curl -fsSL https://get.acme.sh | sh -s email=${email}`
  ]);
  if (code !== 0) throw new Error("acme.sh 安装失败");
  // Source acme.sh into PATH for current session
  process.env.PATH = `${process.env.HOME}/.acme.sh:${process.env.PATH}`;
  console.log(G("✓ acme.sh 安装完成"));
}

// ── Issue cert via acme.sh ─────────────────────────────────────────────────
async function issueAcme({ domain, email, certDir, method, dnsProvider, dnsEnvVars }) {
  const acme = `${process.env.HOME}/.acme.sh/acme.sh`;
  if (!existsSync(acme)) await installAcme(email);

  mkdirSync(certDir, { recursive: true });

  let issueArgs;
  if (method === "dns") {
    issueArgs = [
      "--issue", "--dns", dnsProvider,
      "-d", domain,
      "--server", "letsencrypt",
    ];
    // Set DNS provider env vars
    for (const [k, v] of Object.entries(dnsEnvVars)) process.env[k] = v;
  } else {
    // HTTP-01: standalone on port 80
    issueArgs = [
      "--issue", "--standalone", "--httpport", "80",
      "-d", domain,
      "--server", "letsencrypt",
    ];
  }

  console.log(`\n🔐 正在申请证书（${method === "dns" ? "DNS-01" : "HTTP-01 standalone"}）...`);
  const issueCode = await run(acme, issueArgs);

  if (issueCode !== 0 && issueCode !== 2) {
    throw new Error(`证书申请失败（退出码 ${issueCode}）`);
  }

  // Install cert to target path
  const installArgs = [
    "--install-cert", "-d", domain,
    "--cert-file",   `${certDir}/cert.crt`,
    "--key-file",    `${certDir}/private.key`,
    "--fullchain-file", `${certDir}/fullchain.pem`,
    "--reloadcmd",   "systemctl reload caddy 2>/dev/null || true",
  ];
  const installCode = await run(acme, installArgs);
  if (installCode !== 0) throw new Error("证书安装失败");

  return {
    certFile: `${certDir}/cert.crt`,
    keyFile:  `${certDir}/private.key`,
  };
}

// ── Issue cert via certbot ─────────────────────────────────────────────────
async function issueCertbot({ domain, email, certDir }) {
  if (!cmdExists("certbot")) {
    console.log("📦 安装 certbot...");
    await run("apt-get", ["-y", "install", "certbot"]);
  }

  console.log("\n🔐 正在申请证书（certbot HTTP-01）...");
  const code = await run("certbot", [
    "certonly", "--standalone",
    "--preferred-challenges", "http",
    "--http-01-port", "80",
    "-d", domain,
    "--email", email,
    "--agree-tos", "--non-interactive",
    "--cert-path",      `${certDir}/cert.crt`,
    "--key-path",       `${certDir}/private.key`,
    "--fullchain-path", `${certDir}/fullchain.pem`,
  ]);
  if (code !== 0) throw new Error("certbot 申请证书失败");

  return {
    certFile: `/etc/letsencrypt/live/${domain}/fullchain.pem`,
    keyFile:  `/etc/letsencrypt/live/${domain}/privkey.pem`,
  };
}

// ── Setup cron for auto renewal ────────────────────────────────────────────
function setupCron(method, certDir, domain) {
  const reloadCmd = "systemctl reload caddy 2>/dev/null || true";

  let cronLine;
  if (method === "acme") {
    // acme.sh has built-in cron — just ensure it's installed
    tryExec(`${process.env.HOME}/.acme.sh/acme.sh --install-cronjob 2>/dev/null`);
    // Also add a post-renew hook to reload Caddy
    const hookDir = `${process.env.HOME}/.acme.sh/${domain}`;
    mkdirSync(hookDir, { recursive: true });
    writeFileSync(`${hookDir}/reload.sh`, `#!/bin/bash\n${reloadCmd}\n`);
    tryExec(`chmod +x ${hookDir}/reload.sh`);
    console.log(G("✓ acme.sh 自动续期 cron 已配置"));
    return;
  }

  // certbot / manual: add cron job
  // Run at 3:00 AM on the 1st and 15th of each month
  cronLine = `0 3 1,15 * * node ${ROOT}/scripts/renew-cert.mjs --renew-only >> /var/log/olympicmotion-cert.log 2>&1`;

  const existing = tryExec("crontab -l 2>/dev/null") ?? "";
  if (existing.includes("renew-cert.mjs")) {
    console.log(G("✓ 续期 cron 已存在，跳过"));
    return;
  }
  const newCron = (existing.trimEnd() + `\n${cronLine}\n`).trim() + "\n";
  const tmpFile = "/tmp/crontab_om_tmp";
  writeFileSync(tmpFile, newCron);
  tryExec(`crontab ${tmpFile}`);
  tryExec(`rm -f ${tmpFile}`);
  console.log(G("✓ 续期 cron 已添加（每月1日和15日 03:00 自动续期）"));
}

// ── Renew only mode (called by cron) ──────────────────────────────────────
async function renewOnly() {
  const env = loadEnv();
  const certFile = env.SSL_CERT_FILE ?? "/root/ygkkkca/cert.crt";
  const domain   = env.DOMAIN ?? "";

  console.log(`[${new Date().toISOString()}] 检查证书续期...`);
  const info = checkCertExpiry(certFile);
  if (!info) {
    console.log("⚠  无法读取证书，跳过");
    return;
  }
  console.log(`证书到期：${info.expiry.toLocaleDateString()} （剩余 ${info.daysLeft} 天）`);

  if (info.daysLeft > 30) {
    console.log("✓ 证书有效，无需续期");
    return;
  }

  console.log("⏳ 证书即将到期，开始续期...");
  const acme = `${process.env.HOME}/.acme.sh/acme.sh`;
  if (existsSync(acme) && domain) {
    const code = await run(acme, ["--renew", "-d", domain, "--force"]);
    if (code === 0) {
      tryExec("systemctl reload caddy 2>/dev/null || true");
      console.log(`[${new Date().toISOString()}] ✓ 证书续期成功，Caddy 已重载`);
    } else {
      console.error(`[${new Date().toISOString()}] ❌ 续期失败`);
    }
  } else {
    console.log("⚠  未找到 acme.sh，请手动续期");
  }
}

// ── Main interactive flow ──────────────────────────────────────────────────
async function main() {
  // Cron mode
  if (process.argv.includes("--renew-only")) {
    await renewOnly();
    return;
  }

  // Check mode
  if (process.argv.includes("--check")) {
    const env = loadEnv();
    const cert = env.SSL_CERT_FILE ?? "/root/ygkkkca/cert.crt";
    const info = checkCertExpiry(cert);
    if (!info) { console.log(Y("⚠  证书文件不存在或无法读取：") + cert); return; }
    const color = info.daysLeft > 30 ? G : info.daysLeft > 7 ? Y : R;
    console.log(`证书路径：${cert}`);
    console.log(`到期时间：${info.expiry.toLocaleDateString("zh-CN")}`);
    console.log(color(`剩余天数：${info.daysLeft} 天`));
    return;
  }

  console.log(B(C("\n  ╔══════════════════════════════════════════╗")));
  console.log(B(C("  ║  SSL 证书申请 & 自动续期管理              ║")));
  console.log(B(C("  ╚══════════════════════════════════════════╝\n")));

  const env = loadEnv();

  // ── Show current cert status ─────────────────────────────────────────────
  const currentCert = env.SSL_CERT_FILE ?? "/root/ygkkkca/cert.crt";
  const certInfo    = checkCertExpiry(currentCert);
  if (certInfo) {
    const color = certInfo.daysLeft > 30 ? G : certInfo.daysLeft > 7 ? Y : R;
    console.log(`  当前证书：${D(currentCert)}`);
    console.log(`  到期时间：${color(`${certInfo.expiry.toLocaleDateString("zh-CN")} (剩余 ${certInfo.daysLeft} 天)`)}\n`);
  } else {
    console.log(`  当前证书：${Y("未找到")} ${D(currentCert)}\n`);
  }

  console.log(`  ${C("1")}  申请新证书（acme.sh + Let's Encrypt）${G("[推荐]")}`);
  console.log(`  ${C("2")}  申请新证书（certbot）`);
  console.log(`  ${C("3")}  手动填写现有证书路径（证书已存在）`);
  console.log(`  ${C("4")}  立即检查证书到期状态`);
  console.log(`  ${C("5")}  立即触发续期`);
  console.log(`  ${C("6")}  配置自动续期 cron`);
  console.log(`  ${C("0")}  返回\n`);

  const choice = (await ask("  请选择：")).trim();

  switch (choice) {
    case "1": await flowAcme(env);    break;
    case "2": await flowCertbot(env); break;
    case "3": await flowManual(env);  break;
    case "4": {
      const info = checkCertExpiry(currentCert);
      if (!info) { console.log(R("\n  ❌ 无法读取证书")); break; }
      const c = info.daysLeft > 30 ? G : info.daysLeft > 7 ? Y : R;
      console.log(`\n  到期：${info.expiry.toLocaleDateString("zh-CN")}  ${c(`剩余 ${info.daysLeft} 天`)}`);
      break;
    }
    case "5": await renewOnly(); break;
    case "6": {
      const m = env.CERT_METHOD ?? "acme";
      setupCron(m, "/root/ygkkkca", env.DOMAIN ?? "");
      break;
    }
    case "0": break;
    default: console.log(Y("  无效选项"));
  }
}

// ── Flow: acme.sh ─────────────────────────────────────────────────────────
async function flowAcme(env) {
  console.log(B("\n  ── acme.sh 申请证书 ──\n"));

  const domain = (await ask(`  域名 [${env.DOMAIN ?? ""}]：`)) || env.DOMAIN || "";
  if (!domain) { console.log(R("  域名不能为空")); return; }

  const email = (await ask(`  邮箱（Let's Encrypt 通知用）[${env.ACME_EMAIL ?? ""}]：`))
    || env.ACME_EMAIL || "";
  if (!email) { console.log(R("  邮箱不能为空")); return; }

  const certDir = (await ask(`  证书保存目录 [/root/ygkkkca]：`)) || "/root/ygkkkca";

  console.log(`\n  验证方式：`);
  console.log(`  ${C("1")}  HTTP-01（需要 80 端口在申请期间可用）`);
  console.log(`  ${C("2")}  DNS-01（无需 80 端口，支持通配符）\n`);
  const methodChoice = (await ask("  请选择 [1]：")) || "1";
  const method = methodChoice === "2" ? "dns" : "http";

  let dnsProvider = "";
  const dnsEnvVars = {};
  if (method === "dns") {
    console.log(`\n  常用 DNS 提供商：`);
    console.log(`  dns_cf（Cloudflare）dns_dp（DNSPod）dns_ali（阿里云）dns_gd（GoDaddy）`);
    dnsProvider = (await ask("  DNS 提供商 [dns_cf]：")) || "dns_cf";

    if (dnsProvider === "dns_cf") {
      const cfToken = await ask("  Cloudflare API Token（或留空用 CF_Key+CF_Email）：");
      if (cfToken) {
        dnsEnvVars["CF_Token"] = cfToken;
        saveEnv("CF_TOKEN", cfToken);
      } else {
        dnsEnvVars["CF_Key"]   = await ask("  CF_Key：");
        dnsEnvVars["CF_Email"] = await ask("  CF_Email：");
        saveEnv("CF_KEY",   dnsEnvVars["CF_Key"]);
        saveEnv("CF_EMAIL", dnsEnvVars["CF_Email"]);
      }
    } else if (dnsProvider === "dns_dp") {
      dnsEnvVars["DP_Id"]  = await ask("  DNSPod ID：");
      dnsEnvVars["DP_Key"] = await ask("  DNSPod Key：");
      saveEnv("DP_ID",  dnsEnvVars["DP_Id"]);
      saveEnv("DP_KEY", dnsEnvVars["DP_Key"]);
    } else if (dnsProvider === "dns_ali") {
      dnsEnvVars["Ali_Key"]    = await ask("  阿里云 AccessKey ID：");
      dnsEnvVars["Ali_Secret"] = await ask("  阿里云 AccessKey Secret：");
      saveEnv("ALI_KEY",    dnsEnvVars["Ali_Key"]);
      saveEnv("ALI_SECRET", dnsEnvVars["Ali_Secret"]);
    } else {
      const extraKey = await ask("  环境变量名（如 GD_Key）：");
      const extraVal = await ask("  值：");
      if (extraKey) { dnsEnvVars[extraKey] = extraVal; saveEnv(extraKey, extraVal); }
    }
  }

  try {
    const { certFile, keyFile } = await issueAcme({
      domain, email, certDir, method, dnsProvider, dnsEnvVars
    });
    saveEnv("DOMAIN",        domain);
    saveEnv("ACME_EMAIL",    email);
    saveEnv("SSL_CERT_FILE", certFile);
    saveEnv("SSL_KEY_FILE",  keyFile);
    saveEnv("CERT_METHOD",   "acme");
    setupCron("acme", certDir, domain);

    console.log(G("\n  ✅ 证书申请成功！"));
    console.log(`  证书：${certFile}`);
    console.log(`  密钥：${keyFile}`);
    console.log(`\n  ${Y("下一步：")} 重新运行 node scripts/setup-caddy.mjs 更新 Caddy 配置`);
  } catch (e) {
    console.log(R(`\n  ❌ ${e.message}`));
  }
}

// ── Flow: certbot ─────────────────────────────────────────────────────────
async function flowCertbot(env) {
  console.log(B("\n  ── certbot 申请证书 ──\n"));
  const domain  = (await ask(`  域名 [${env.DOMAIN ?? ""}]：`)) || env.DOMAIN || "";
  const email   = (await ask(`  邮箱：`)) || env.ACME_EMAIL || "";
  const certDir = (await ask(`  证书保存目录 [/root/ygkkkca]：`)) || "/root/ygkkkca";
  if (!domain || !email) { console.log(R("  域名和邮箱不能为空")); return; }
  try {
    const { certFile, keyFile } = await issueCertbot({ domain, email, certDir });
    saveEnv("DOMAIN",        domain);
    saveEnv("ACME_EMAIL",    email);
    saveEnv("SSL_CERT_FILE", certFile);
    saveEnv("SSL_KEY_FILE",  keyFile);
    saveEnv("CERT_METHOD",   "certbot");
    setupCron("certbot", certDir, domain);
    console.log(G("\n  ✅ 证书申请成功！"));
    console.log(`  ${Y("下一步：")} 重新运行 node scripts/setup-caddy.mjs`);
  } catch (e) {
    console.log(R(`\n  ❌ ${e.message}`));
  }
}

// ── Flow: manual path ─────────────────────────────────────────────────────
async function flowManual(env) {
  console.log(B("\n  ── 手动配置证书路径 ──\n"));
  const certFile = (await ask(`  公钥路径 (crt/pem) [${env.SSL_CERT_FILE ?? "/root/ygkkkca/cert.crt"}]：`))
    || env.SSL_CERT_FILE || "/root/ygkkkca/cert.crt";
  const keyFile  = (await ask(`  私钥路径 (key)     [${env.SSL_KEY_FILE ?? "/root/ygkkkca/private.key"}]：`))
    || env.SSL_KEY_FILE || "/root/ygkkkca/private.key";

  if (!existsSync(certFile)) console.log(Y(`  ⚠  证书文件不存在：${certFile}`));
  if (!existsSync(keyFile))  console.log(Y(`  ⚠  密钥文件不存在：${keyFile}`));

  saveEnv("SSL_CERT_FILE", certFile);
  saveEnv("SSL_KEY_FILE",  keyFile);

  const info = checkCertExpiry(certFile);
  if (info) {
    const c = info.daysLeft > 30 ? G : info.daysLeft > 7 ? Y : R;
    console.log(c(`\n  证书到期：${info.expiry.toLocaleDateString("zh-CN")}（剩余 ${info.daysLeft} 天）`));
  }

  console.log(G("\n  ✅ 证书路径已保存到 .env"));
  console.log(`  ${Y("下一步：")} 重新运行 node scripts/setup-caddy.mjs`);
}

main().catch(e => { console.error(R(`❌ ${e.message}`)); process.exit(1); });
