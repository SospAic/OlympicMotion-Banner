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
    // HTTP-01: webroot mode — Caddy serves /.well-known/acme-challenge/
    // This avoids port 80 conflict with Caddy standalone listener
    const webroot = "/var/www/acme-challenge";
    mkdirSync(webroot, { recursive: true });
    issueArgs = [
      "--issue", "--webroot", webroot,
      "-d", domain,
      "--server", "letsencrypt",
    ];
    console.log(Y(`  ℹ  使用 webroot 模式，确保 Caddy 已配置 /.well-known/acme-challenge/* 路由`));
    console.log(`     Caddyfile 中需添加：handle /.well-known/acme-challenge/* { root * ${webroot}; file_server }`);
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
  const ts  = () => `[${new Date().toISOString()}]`;

  // ── Banner cert ──────────────────────────────────────────────────────────
  const bannerCert   = env.SSL_CERT_FILE ?? "/etc/letsencrypt/live/om.sospaic.top/fullchain.pem";
  const bannerDomain = env.DOMAIN ?? "";
  console.log(`${ts()} 检查 Banner 证书续期...`);
  const bannerInfo = checkCertExpiry(bannerCert);
  if (bannerInfo) {
    console.log(`  Banner 证书到期：${bannerInfo.expiry.toLocaleDateString()} （剩余 ${bannerInfo.daysLeft} 天）`);
    if (bannerInfo.daysLeft <= 30 && bannerDomain) {
      const acme = `${process.env.HOME}/.acme.sh/acme.sh`;
      if (existsSync(acme)) {
        const code = await run(acme, ["--renew", "-d", bannerDomain]);
        if (code === 0) {
          tryExec("systemctl reload caddy 2>/dev/null || true");
          console.log(`${ts()} ✓ Banner 证书续期成功，Caddy 已重载`);
        } else console.error(`${ts()} ❌ Banner 证书续期失败`);
      }
    } else if (bannerInfo.daysLeft > 30) {
      console.log("  ✓ Banner 证书有效，无需续期");
    }
  } else {
    console.log("  ⚠  Banner 证书文件不存在，跳过");
  }

  // ── Node cert ────────────────────────────────────────────────────────────
  const nodeCert   = env.NODE_SSL_CERT_FILE ?? "";
  const nodeDomain = env.NODE_DOMAIN ?? "";
  if (nodeCert) {
    console.log(`${ts()} 检查节点证书续期...`);
    const nodeInfo = checkCertExpiry(nodeCert);
    if (nodeInfo) {
      console.log(`  节点证书到期：${nodeInfo.expiry.toLocaleDateString()} （剩余 ${nodeInfo.daysLeft} 天）`);
      if (nodeInfo.daysLeft <= 30 && nodeDomain) {
        const acme = `${process.env.HOME}/.acme.sh/acme.sh`;
        if (existsSync(acme)) {
          const reloadCmd = env.NODE_RELOAD_CMD ?? "echo '节点服务已通知续期'";
          const code = await run(acme, ["--renew", "-d", nodeDomain]);
          if (code === 0) {
            tryExec(reloadCmd);
            console.log(`${ts()} ✓ 节点证书续期成功`);
          } else console.error(`${ts()} ❌ 节点证书续期失败`);
        }
      } else if (nodeInfo.daysLeft > 30) {
        console.log("  ✓ 节点证书有效，无需续期");
      }
    } else {
      console.log("  ⚠  节点证书文件不存在，跳过");
    }
  }
}

// ── Main interactive flow ──────────────────────────────────────────────────
async function main() {
  if (process.argv.includes("--renew-only")) { await renewOnly(); return; }

  if (process.argv.includes("--check")) {
    const env = loadEnv();
    const checks = [
      ["Banner", "SSL_CERT_FILE",      "/etc/letsencrypt/live/om.sospaic.top/fullchain.pem"],
      ["节点",   "NODE_SSL_CERT_FILE", "/root/ygkkkca/cert.crt"],
    ];
    for (const [label, certKey, def] of checks) {
      const cert = env[certKey] ?? def;
      if (!cert) continue;
      const info = checkCertExpiry(cert);
      if (!info) { console.log(Y(`⚠  ${label} 证书不存在：${cert}`)); continue; }
      const color = info.daysLeft > 30 ? G : info.daysLeft > 7 ? Y : R;
      console.log(`${label} 证书：${cert}`);
      const daysTxt = info.daysLeft >= 0 ? `剩余 ${info.daysLeft} 天` : `已过期 ${Math.abs(info.daysLeft)} 天`;
      console.log(`  到期：${info.expiry.toLocaleDateString("zh-CN")}  ${color(daysTxt)}`);
    }
    return;
  }

  console.log(B(C("\n  ╔══════════════════════════════════════════╗")));
  console.log(B(C("  ║  SSL 证书申请 & 自动续期管理              ║")));
  console.log(B(C("  ╚══════════════════════════════════════════╝\n")));

  const env = loadEnv();

  // Show status for both certs
  for (const [label, certKey, def] of [
    ["Banner", "SSL_CERT_FILE", "/etc/letsencrypt/live/om.sospaic.top/fullchain.pem"],
    ["节点",   "NODE_SSL_CERT_FILE", "/root/ygkkkca/cert.crt"],
  ]) {
    const cert = env[certKey] ?? def;
    if (!cert) { console.log(`  ${label} 证书：${D("未配置")}`); continue; }
    const info = checkCertExpiry(cert);
    if (info) {
      const color = info.daysLeft > 30 ? G : info.daysLeft > 7 ? Y : R;
      const daysTxt = info.daysLeft >= 0
        ? `剩余 ${info.daysLeft} 天`
        : `已过期 ${Math.abs(info.daysLeft)} 天`;
      console.log(`  ${label} 证书：${color(`${info.expiry.toLocaleDateString("zh-CN")} (${daysTxt})`)}`);
    } else {
      console.log(`  ${label} 证书：${Y("文件不存在")} ${D(cert)}`);
    }
  }
  console.log();

  console.log(`  ${B(C("── Banner 证书（Caddy HTTPS）──"))}`);
  console.log(`  ${C("1")}  Banner 证书 — acme.sh 申请 ${G("[推荐]")}`);
  console.log(`  ${C("2")}  Banner 证书 — certbot 申请`);
  console.log(`  ${C("3")}  Banner 证书 — 手动填写路径（已有文件）`);
  console.log(`  ${C("4")}  Banner 证书 — 检查到期 / 立即续期`);
  console.log();
  console.log(`  ${B(C("── 节点证书（代理/其他服务）──"))}`);
  console.log(`  ${C("5")}  节点证书 — acme.sh 申请`);
  console.log(`  ${C("6")}  节点证书 — certbot 申请`);
  console.log(`  ${C("7")}  节点证书 — 手动填写路径（已有文件）`);
  console.log(`  ${C("8")}  节点证书 — 检查到期 / 立即续期`);
  console.log();
  console.log(`  ${C("9")}  配置自动续期 cron（两个证书统一续期）`);
  console.log(`  ${C("0")}  返回\n`);

  const choice = (await ask("  请选择：")).trim();
  switch (choice) {
    case "1": await flowAcme(env, "banner");    break;
    case "2": await flowCertbot(env, "banner"); break;
    case "3": await flowManual(env, "banner");  break;
    case "4": await flowCheck(env, "banner");   break;
    case "5": await flowAcme(env, "node");      break;
    case "6": await flowCertbot(env, "node");   break;
    case "7": await flowManual(env, "node");    break;
    case "8": await flowCheck(env, "node");     break;
    case "9": {
      const m = env.CERT_METHOD ?? "acme";
      setupCron(m, "/root/ygkkkca", env.DOMAIN ?? "");
      break;
    }
    case "0": break;
    default: console.log(Y("  无效选项"));
  }
}

// ── Flow helpers: env keys by cert type ───────────────────────────────────
function certKeys(type) {
  if (type === "node") return {
    certFile:  "NODE_SSL_CERT_FILE",
    keyFile:   "NODE_SSL_KEY_FILE",
    domain:    "NODE_DOMAIN",
    method:    "NODE_CERT_METHOD",
    email:     "ACME_EMAIL",
    label:     "节点证书",
    defaultDir:"/root/ygkkkca",
    defaultCert:"/root/ygkkkca/cert.crt",
    defaultKey: "/root/ygkkkca/private.key",
    defaultDomain: "ny.sospaic.top",
    reloadCmd: "NODE_RELOAD_CMD",
    defaultReload: "echo '节点证书已续期'",
  };
  return {
    certFile:  "SSL_CERT_FILE",
    keyFile:   "SSL_KEY_FILE",
    domain:    "DOMAIN",
    method:    "CERT_METHOD",
    email:     "ACME_EMAIL",
    label:     "Banner证书",
    defaultDir:"/etc/letsencrypt/live/om.sospaic.top",
    defaultCert:"/etc/letsencrypt/live/om.sospaic.top/fullchain.pem",
    defaultKey: "/etc/letsencrypt/live/om.sospaic.top/privkey.pem",
    defaultDomain: "om.sospaic.top",
    reloadCmd: null,
    defaultReload: "systemctl reload caddy 2>/dev/null || true",
  };
}

// ── Flow: check & renew ────────────────────────────────────────────────────
async function flowCheck(env, type) {
  const k    = certKeys(type);
  const cert = env[k.certFile] ?? k.defaultCert;
  if (!cert) { console.log(Y(`\n  ⚠  ${k.label}路径未配置`)); return; }
  const info = checkCertExpiry(cert);
  if (!info) { console.log(R(`\n  ❌ 无法读取 ${k.label}：${cert}`)); return; }
  const color = info.daysLeft > 30 ? G : info.daysLeft > 7 ? Y : R;
  const daysTxt = info.daysLeft >= 0 ? `剩余 ${info.daysLeft} 天` : `已过期 ${Math.abs(info.daysLeft)} 天`;
  console.log(`\n  ${k.label} 路径：${D(cert)}`);
  console.log(`  到期时间：${info.expiry.toLocaleDateString("zh-CN")}`);
  console.log(`  ${color(daysTxt)}`);

  if (info.daysLeft <= 30) {
    const confirm = (await ask("\n  证书即将到期，立即续期？(y/N)：")).toLowerCase();
    if (confirm === "y") {
      const domain = env[k.domain] ?? "";
      const acme   = `${process.env.HOME}/.acme.sh/acme.sh`;
      if (existsSync(acme) && domain) {
        const code = await run(acme, ["--renew", "-d", domain, "--force"]);
        if (code === 0) {
          tryExec(type === "banner"
            ? "systemctl reload caddy 2>/dev/null || true"
            : (env[k.reloadCmd] ?? k.defaultReload));
          console.log(G("\n  ✓ 续期成功"));
        } else console.log(R("\n  ❌ 续期失败"));
      } else {
        console.log(Y("  ⚠  未找到 acme.sh 或域名未配置，请手动续期"));
      }
    }
  }
}

// ── Flow: acme.sh ─────────────────────────────────────────────────────────
async function flowAcme(env, type) {
  const k = certKeys(type);
  console.log(B(`\n  ── acme.sh 申请${k.label} ──\n`));

  const domain = (await ask(`  域名 [${env[k.domain] ?? k.defaultDomain}]：`))
    || env[k.domain] || k.defaultDomain;
  if (!domain) { console.log(R("  域名不能为空")); return; }

  const email = (await ask(`  邮箱 [${env[k.email] ?? ""}]：`)) || env[k.email] || "";
  if (!email) { console.log(R("  邮箱不能为空")); return; }

  const certDir = (await ask(`  证书保存目录 [${k.defaultDir}]：`)) || k.defaultDir;

  console.log(`\n  验证方式：`);
  console.log(`  ${C("1")}  HTTP-01（需要 80 端口在申请期间可用）`);
  console.log(`  ${C("2")}  DNS-01（无需 80 端口，支持通配符）\n`);
  const methodChoice = (await ask("  请选择 [1]：")) || "1";
  const method = methodChoice === "2" ? "dns" : "http";

  let dnsProvider = "";
  const dnsEnvVars = {};
  if (method === "dns") {
    console.log(`\n  常用 DNS 提供商：dns_cf（Cloudflare）dns_dp（DNSPod）dns_ali（阿里云）`);
    dnsProvider = (await ask("  DNS 提供商 [dns_cf]：")) || "dns_cf";
    if (dnsProvider === "dns_cf") {
      const cfToken = await ask("  Cloudflare API Token：");
      if (cfToken) { dnsEnvVars["CF_Token"] = cfToken; saveEnv("CF_TOKEN", cfToken); }
      else {
        dnsEnvVars["CF_Key"]   = await ask("  CF_Key：");
        dnsEnvVars["CF_Email"] = await ask("  CF_Email：");
        saveEnv("CF_KEY", dnsEnvVars["CF_Key"]); saveEnv("CF_EMAIL", dnsEnvVars["CF_Email"]);
      }
    } else if (dnsProvider === "dns_dp") {
      dnsEnvVars["DP_Id"]  = await ask("  DNSPod ID：");
      dnsEnvVars["DP_Key"] = await ask("  DNSPod Key：");
      saveEnv("DP_ID", dnsEnvVars["DP_Id"]); saveEnv("DP_KEY", dnsEnvVars["DP_Key"]);
    } else if (dnsProvider === "dns_ali") {
      dnsEnvVars["Ali_Key"]    = await ask("  阿里云 AccessKey ID：");
      dnsEnvVars["Ali_Secret"] = await ask("  阿里云 AccessKey Secret：");
      saveEnv("ALI_KEY", dnsEnvVars["Ali_Key"]); saveEnv("ALI_SECRET", dnsEnvVars["Ali_Secret"]);
    } else {
      const ek = await ask("  环境变量名："); const ev = await ask("  值：");
      if (ek) { dnsEnvVars[ek] = ev; saveEnv(ek, ev); }
    }
  }

  // For node cert: ask for reload command
  if (type === "node") {
    const reloadCmd = (await ask(`  续期后执行命令（重载节点服务，留空跳过）[${env[k.reloadCmd] ?? ""}]：`))
      || env[k.reloadCmd] || "";
    if (reloadCmd) saveEnv(k.reloadCmd, reloadCmd);
  }

  try {
    const { certFile, keyFile } = await issueAcme({ domain, email, certDir, method, dnsProvider, dnsEnvVars });
    saveEnv(k.domain,   domain);
    saveEnv(k.email,    email);
    saveEnv(k.certFile, certFile);
    saveEnv(k.keyFile,  keyFile);
    saveEnv(k.method,   "acme");
    setupCron("acme", certDir, domain);
    console.log(G(`\n  ✅ ${k.label}申请成功！`));
    console.log(`  证书：${certFile}\n  密钥：${keyFile}`);
    if (type === "banner") console.log(`\n  ${Y("下一步：")} 重新运行 node scripts/setup-caddy.mjs`);
  } catch (e) { console.log(R(`\n  ❌ ${e.message}`)); }
}

// ── Flow: certbot ─────────────────────────────────────────────────────────
async function flowCertbot(env, type) {
  const k = certKeys(type);
  console.log(B(`\n  ── certbot 申请${k.label} ──\n`));
  const domain  = (await ask(`  域名 [${env[k.domain] ?? k.defaultDomain}]：`))
    || env[k.domain] || k.defaultDomain;
  const email   = (await ask(`  邮箱 [${env[k.email] ?? ""}]：`)) || env[k.email] || "";
  const certDir = (await ask(`  证书保存目录 [${k.defaultDir}]：`)) || k.defaultDir;
  if (!domain || !email) { console.log(R("  域名和邮箱不能为空")); return; }
  try {
    const { certFile, keyFile } = await issueCertbot({ domain, email, certDir });
    saveEnv(k.domain,   domain);
    saveEnv(k.email,    email);
    saveEnv(k.certFile, certFile);
    saveEnv(k.keyFile,  keyFile);
    saveEnv(k.method,   "certbot");
    setupCron("certbot", certDir, domain);
    console.log(G(`\n  ✅ ${k.label}申请成功！`));
    if (type === "banner") console.log(`  ${Y("下一步：")} 重新运行 node scripts/setup-caddy.mjs`);
  } catch (e) { console.log(R(`\n  ❌ ${e.message}`)); }
}

// ── Flow: manual path ─────────────────────────────────────────────────────
async function flowManual(env, type) {
  const k = certKeys(type);
  console.log(B(`\n  ── 手动配置${k.label}路径 ──\n`));
  const defCert   = env[k.certFile]  ?? k.defaultCert;
  const defKey    = env[k.keyFile]   ?? k.defaultKey;
  const defDomain = env[k.domain]    ?? k.defaultDomain;
  const certFile  = (await ask(`  公钥路径 (crt/pem) [${defCert}]：`))   || defCert;
  const keyFile   = (await ask(`  私钥路径 (key)     [${defKey}]：`))    || defKey;
  const domainIn  = (await ask(`  对应域名           [${defDomain}]：`)) || defDomain;

  if (!existsSync(certFile)) console.log(Y(`  ⚠  证书文件不存在：${certFile}`));
  if (!existsSync(keyFile))  console.log(Y(`  ⚠  密钥文件不存在：${keyFile}`));

  saveEnv(k.certFile, certFile);
  saveEnv(k.keyFile,  keyFile);
  if (domainIn) saveEnv(k.domain, domainIn);

  if (type === "node") {
    const reloadCmd = (await ask(`  续期后执行命令（重载节点服务，留空跳过）[${env[k.reloadCmd] ?? ""}]：`))
      || env[k.reloadCmd] || "";
    if (reloadCmd) saveEnv(k.reloadCmd, reloadCmd);
  }

  const info = checkCertExpiry(certFile);
  if (info) {
    const c = info.daysLeft > 30 ? G : info.daysLeft > 7 ? Y : R;
    console.log(c(`\n  证书到期：${info.expiry.toLocaleDateString("zh-CN")}（剩余 ${info.daysLeft} 天）`));
  }
  console.log(G(`\n  ✅ ${k.label}路径已保存到 .env`));
  if (type === "banner") console.log(`  ${Y("下一步：")} 重新运行 node scripts/setup-caddy.mjs`);
}

main().catch(e => { console.error(R(`❌ ${e.message}`)); process.exit(1); });
