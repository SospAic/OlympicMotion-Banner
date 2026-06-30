/**
 * OlympicMotion Banner Engine — VPS 一键执行脚本
 *
 * 用法：
 *   node run.mjs              # 完整流程（拉取订阅数 + 生成 + 上传）
 *   node run.mjs --no-upload  # 只生成，不上传
 *   node run.mjs --subs=50000 # 手动指定订阅数
 *
 * 配置：
 *   在项目根目录创建 .env 文件（参考 .env.example）
 *
 * cron 示例（每2小时运行）：
 *   0 *\/2 * * * cd /path/to/OlympicMotion-Banner && node run.mjs >> /var/log/banner.log 2>&1
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname }                         from "node:path";
import { fileURLToPath }                            from "node:url";
import { spawn }                                    from "node:child_process";
import { createRequire }                            from "node:module";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)));

// ── Load .env file ────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = resolve(ROOT, ".env");
  if (!existsSync(envPath)) {
    console.warn("⚠  未找到 .env 文件，使用系统环境变量");
    console.warn("   请复制 .env.example 为 .env 并填入配置");
    return;
  }
  const lines = readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;
    const key   = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (key && !process.env[key]) {
      process.env[key] = value;
    }
  }
  console.log("✓ 已加载 .env 配置");
}

// ── Parse CLI args ────────────────────────────────────────────────────────
const args       = process.argv.slice(2);
const noUpload   = args.includes("--no-upload");
const manualSubs = args.find(a => a.startsWith("--subs="))?.split("=")[1];

// ── Helpers ───────────────────────────────────────────────────────────────
function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

async function waitForServer(url, tries = 30) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch { /* not ready */ }
    await new Promise(r => setTimeout(r, 300));
  }
  return false;
}

// ── Step 1: Fetch subscriber count ────────────────────────────────────────
async function fetchSubscribers() {
  if (manualSubs) {
    log(`使用手动指定订阅数：${manualSubs}`);
    return Number(manualSubs);
  }

  const apiKey    = process.env.YOUTUBE_API_KEY;
  const channelId = process.env.YOUTUBE_CHANNEL_ID;

  if (!apiKey || !channelId) {
    log("⚠  未配置 YOUTUBE_API_KEY 或 YOUTUBE_CHANNEL_ID，跳过 API 拉取");
    return null;
  }

  log("📡 正在从 YouTube API 获取订阅数...");
  try {
    const url = `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${channelId}&key=${apiKey}`;
    const res  = await fetch(url);
    const data = await res.json();

    if (data.error) {
      log(`❌ YouTube API 错误：${data.error.message}`);
      return null;
    }

    const subs = Number(data.items?.[0]?.statistics?.subscriberCount ?? 0);
    log(`✓ 获取订阅数成功：${subs}`);
    return subs;
  } catch (e) {
    log(`❌ YouTube API 请求失败：${e.message}`);
    return null;
  }
}

// ── Step 2: Update config ─────────────────────────────────────────────────
function updateConfig(subs) {
  const configPath = resolve(ROOT, "public/config/banner.config.json");
  const cfg        = JSON.parse(readFileSync(configPath, "utf8"));
  const oldSubs    = cfg.data?.subs ?? 0;

  if (!subs || subs === 0) {
    log(`⚠  订阅数无效，保留原值：${oldSubs}`);
    return oldSubs;
  }

  cfg.data = { ...cfg.data, subs };
  writeFileSync(configPath, JSON.stringify(cfg, null, 2) + "\n");
  log(`✓ 配置已更新：${oldSubs} → ${subs}`);
  return subs;
}

// ── Step 3: Start local server ────────────────────────────────────────────
async function startServer() {
  const port      = process.env.PORT ?? "4173";
  const serverUrl = `http://localhost:${port}/`;

  // Check if already running
  if (await waitForServer(serverUrl, 2)) {
    log(`✓ 本地服务器已在运行：${serverUrl}`);
    return { proc: null, url: serverUrl };
  }

  log("🚀 正在启动本地服务器...");
  const proc = spawn(process.execPath, ["server.mjs"], {
    cwd:        ROOT,
    stdio:      "ignore",
    windowsHide: true,
    env:        { ...process.env },
  });

  if (!(await waitForServer(serverUrl))) {
    proc.kill();
    throw new Error(`本地服务器启动失败：${serverUrl}`);
  }

  log(`✓ 本地服务器已启动：${serverUrl}`);
  return { proc, url: serverUrl };
}

// ── Step 4: Render banner ─────────────────────────────────────────────────
async function renderBanner(serverUrl) {
  log("🎨 正在生成 Banner...");

  const outputPath = resolve(ROOT, "dist/banner.png");
  const exporter   = resolve(ROOT, "exporter/render-banner.mjs");

  const { chromium } = await import("playwright");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(resolve(ROOT, "dist"), { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page    = await browser.newPage({
    viewport:          { width: 2560, height: 1440 },
    deviceScaleFactor: 1,
  });

  await page.goto(serverUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });

  // Wait for app.js to finish painting
  await page.waitForFunction(
    () => {
      const el = document.querySelector("[data-subs]");
      return el && el.textContent.trim().length > 0 && el.textContent !== "00,000";
    },
    { timeout: 15_000 }
  );
  await page.waitForTimeout(1000);

  const stage = page.locator(".banner-stage").first();
  if (await stage.count() === 0) {
    await browser.close();
    throw new Error(".banner-stage 未找到，页面渲染失败");
  }

  await stage.screenshot({ path: outputPath });
  await browser.close();

  log(`✓ Banner 已生成：dist/banner.png`);
  return outputPath;
}

// ── Step 5: Upload banner ─────────────────────────────────────────────────
async function uploadBanner() {
  log("📤 正在上传 Banner 到 YouTube...");
  const uploader = resolve(ROOT, "exporter/upload-banner.mjs");
  const { default: upload } = await import(`file://${uploader}?t=${Date.now()}`).catch(() => ({}));

  // Instead, run as subprocess to get clean output
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ["exporter/upload-banner.mjs"], {
      cwd:   ROOT,
      stdio: "inherit",
      env:   { ...process.env },
    });
    proc.on("close", code => {
      if (code === 0) {
        log("✅ Banner 上传成功");
        resolve();
      } else {
        reject(new Error(`上传失败，退出码：${code}`));
      }
    });
  });
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  log("═══════════════════════════════════════");
  log("  OlympicMotion Banner Engine - 开始执行");
  log("═══════════════════════════════════════");

  loadEnv();

  let serverProc = null;

  try {
    // 1. Fetch subscribers
    const subs = await fetchSubscribers();

    // 2. Update config
    updateConfig(subs);

    // 3. Start server
    const { proc, url } = await startServer();
    serverProc = proc;

    // 4. Render
    await renderBanner(url);

    // 5. Upload
    if (!noUpload) {
      await uploadBanner();
    } else {
      log("⏭  跳过上传（--no-upload）");
    }

    log("═══════════════════════════════════════");
    log("  ✅ 全部完成！");
    log("═══════════════════════════════════════");

  } catch (e) {
    log(`❌ 执行失败：${e.message}`);
    process.exitCode = 1;
  } finally {
    if (serverProc) {
      serverProc.kill();
      log("  本地服务器已关闭");
    }
  }
}

main();
