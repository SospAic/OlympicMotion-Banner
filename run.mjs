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
const useV2      = args.includes("--v2");          // use Sharp v2 renderer (no Playwright)
const manualSubs = args.find(a => a.startsWith("--subs="))?.split("=")[1];

// ── Helpers ───────────────────────────────────────────────────────────────
function log(msg) {
  const ts = new Date().toISOString();
  // Strip any accidental credential leaks from log output
  const safe = msg
    .replace(/AIza[A-Za-z0-9_-]{35}/g,  "AIza***")
    .replace(/key=[^&\s"']+/gi,          "key=***")
    .replace(/Bearer [A-Za-z0-9._-]+/g,  "Bearer ***")
    .replace(/refresh_token=[^&\s"']+/g, "refresh_token=***")
    .replace(/client_secret=[^&\s"']+/g, "client_secret=***");
  console.log(`[${ts}] ${safe}`);
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
    const n = Number(manualSubs);
    if (isNaN(n) || n < 0) throw new Error(`--subs 参数无效：${manualSubs}`);
    log(`使用手动指定订阅数：${n}`);
    return n;
  }

  const apiKey    = process.env.YOUTUBE_API_KEY;
  const channelId = process.env.YOUTUBE_CHANNEL_ID;

  if (!apiKey || !channelId) {
    log("⚠  未配置 YOUTUBE_API_KEY 或 YOUTUBE_CHANNEL_ID，跳过 API 拉取");
    return null;
  }

  log("📡 正在从 YouTube API 获取订阅数...");
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const url = `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${channelId}&key=${apiKey}`;
    const res  = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timeout));
    const data = await res.json();

    if (data.error) {
      log(`❌ YouTube API 错误：${data.error.message}（code ${data.error.code}）`);
      return null;
    }
    if (!data.items?.length) {
      log("⚠  YouTube API 返回空结果，检查 YOUTUBE_CHANNEL_ID 是否正确");
      return null;
    }

    const subs = Number(data.items[0].statistics?.subscriberCount ?? 0);
    log(`✓ 获取订阅数成功：${subs}`);
    return subs;
  } catch (e) {
    if (e.name === "AbortError") {
      log("❌ YouTube API 请求超时（15s）");
    } else {
      log(`❌ YouTube API 请求失败：${e.message}`);
    }
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

// ── Step 4a: Render banner via Sharp v2 (fast, no browser) ───────────────
async function renderBannerV2() {
  log("🎨 正在生成 Banner v2（Sharp 合成）...");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(resolve(ROOT, "dist"), { recursive: true });

  await new Promise((res, rej) => {
    const proc = spawn(process.execPath, ["exporter/render-banner-v2.mjs"], {
      cwd: ROOT,
      stdio: "inherit",
      env: { ...process.env },
    });
    proc.on("close", code => code === 0
      ? res()
      : rej(new Error(`render-banner-v2.mjs exited ${code}`)));
  });

  log("✓ Banner v2 已生成：dist/banner-v2.png + dist/banner-v2-full.png");
  return resolve(ROOT, "dist/banner-v2.png");
}

// ── Step 4b: Render banner via Playwright v1 (web screenshot) ────────────
async function renderBanner(serverUrl) {
  log("🎨 正在生成 Banner v1（Playwright 截图）...");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(resolve(ROOT, "dist"), { recursive: true });

  // Wait extra second after server is confirmed ready before screenshotting
  await new Promise(r => setTimeout(r, 1500));

  await new Promise((res, rej) => {
    const proc = spawn(process.execPath, ["exporter/render-banner.mjs", "dist/banner.png"], {
      cwd: ROOT,
      stdio: "inherit",
      env: { ...process.env, BANNER_URL: serverUrl },
    });
    proc.on("close", code => code === 0 ? res() : rej(new Error(`render-banner.mjs exited ${code}`)));
  });

  log("✓ Banner v1 已生成：dist/banner.png + dist/banner-full.png");
  return resolve(ROOT, "dist/banner.png");
}

// ── Step 5: Upload banner ─────────────────────────────────────────────────
async function uploadBanner() {
  log("📤 正在上传 Banner 到 YouTube...");
  const uploader = resolve(ROOT, "exporter/upload-banner.mjs");

  if (!existsSync(uploader)) {
    throw new Error("upload-banner.mjs 不存在：" + uploader);
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ["exporter/upload-banner.mjs"], {
      cwd:   ROOT,
      stdio: "inherit",
      env:   { ...process.env },
    });

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error("上传超时（5分钟），进程已终止"));
    }, 5 * 60 * 1000);

    proc.on("close", code => {
      clearTimeout(timer);
      if (code === 0) {
        log("✅ Banner 上传成功");
        resolve();
      } else {
        reject(new Error(`上传失败，退出码：${code}，请检查日志`));
      }
    });

    proc.on("error", err => {
      clearTimeout(timer);
      reject(new Error(`上传进程启动失败：${err.message}`));
    });
  });
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  log("═══════════════════════════════════════");
  log(`  OlympicMotion Banner Engine - 开始执行 (${useV2 ? "v2 Sharp" : "v1 Playwright"})`);
  log("═══════════════════════════════════════");

  loadEnv();

  let serverProc = null;

  try {
    // 1. Fetch subscribers
    const subs = await fetchSubscribers();

    // 2. Update config
    updateConfig(subs);

    if (useV2) {
      // ── V2 path: Sharp image composition, no browser needed ──
      await renderBannerV2();

      // Set BANNER_FILE so upload-banner.mjs picks up v2 output
      process.env.BANNER_FILE = resolve(ROOT, "dist/banner-v2.png");

    } else {
      // ── V1 path: Playwright screenshot ──
      // 3. Start server
      const { proc, url } = await startServer();
      serverProc = proc;

      // 4. Render
      await renderBanner(url);
    }

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
    if (e.stack) log(e.stack.split("\n").slice(1, 4).join(" | "));
    process.exitCode = 1;
  } finally {
    if (serverProc) {
      serverProc.kill();
      log("  本地服务器已关闭");
    }
  }
}

main();
