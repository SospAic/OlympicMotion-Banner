/**
 * watch-daemon.mjs — Banner 即时更新守护进程
 *
 * 功能：
 *   1. 订阅 YouTube PubSubHubbub，频道有更新时收到推送
 *   2. 定时轮询订阅数（每 N 分钟，可配置）
 *   3. 订阅数变化时立即触发 banner 更新
 *   4. 内置 HTTP 服务器接收 webhook 推送
 *
 * 用法：
 *   node scripts/watch-daemon.mjs          # 前台运行
 *   pm2 start scripts/watch-daemon.mjs     # 后台守护（推荐）
 *
 * 安装 pm2：npm install -g pm2
 * PM2 开机自启：pm2 startup && pm2 save
 *
 * 环境变量（来自 .env）：
 *   YOUTUBE_API_KEY        — YouTube Data API 密钥
 *   YOUTUBE_CHANNEL_ID     — 频道 ID
 *   POLL_INTERVAL_MINUTES  — 轮询间隔（默认 5，最低 1）
 *   WEBHOOK_PORT           — Webhook 监听端口（默认 4174）
 *   WEBHOOK_PUBLIC_URL     — 公网可访问的 URL（用于 PubSubHubbub 订阅）
 *                            例：https://你的VPS_IP:4174
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve }                                  from "node:path";
import { fileURLToPath }                            from "node:url";
import { createServer }                             from "node:http";
import { spawn }                                    from "node:child_process";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

// ── Load .env ─────────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = resolve(ROOT, ".env");
  if (!existsSync(envPath)) return;
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
loadEnv();

const API_KEY       = process.env.YOUTUBE_API_KEY;
const CHANNEL_ID    = process.env.YOUTUBE_CHANNEL_ID;
const POLL_MIN      = Math.max(1, Number(process.env.POLL_INTERVAL_MINUTES ?? 5));
const WEBHOOK_PORT  = Number(process.env.WEBHOOK_PORT ?? 4174);
const PUBLIC_URL    = process.env.WEBHOOK_PUBLIC_URL ?? "";
const STATE_FILE    = resolve(ROOT, ".session/daemon-state.json");

// ── State ──────────────────────────────────────────────────────────────────
let lastSubs        = 0;
let isRunning       = false;
let updateCount     = 0;

function loadState() {
  if (existsSync(STATE_FILE)) {
    try {
      const s = JSON.parse(readFileSync(STATE_FILE, "utf8"));
      lastSubs = s.lastSubs ?? 0;
      console.log(`[daemon] 恢复状态：上次订阅数 = ${lastSubs}`);
    } catch { /* ignore */ }
  }
}

function saveState() {
  writeFileSync(STATE_FILE, JSON.stringify({
    lastSubs,
    updatedAt: new Date().toISOString(),
    updateCount,
  }, null, 2));
}

// ── Logger (no sensitive data) ─────────────────────────────────────────────
function log(msg, level = "INFO") {
  const ts = new Date().toISOString();
  const safe = msg
    .replace(/key=[^&\s]+/gi, "key=***")
    .replace(/AIza[A-Za-z0-9_-]{35}/g, "AIza***")
    .replace(/Bearer [A-Za-z0-9._-]+/g, "Bearer ***");
  console.log(`[${ts}] [${level}] ${safe}`);
}

// ── Fetch current subscriber count ────────────────────────────────────────
async function fetchSubs() {
  if (!API_KEY || !CHANNEL_ID) return null;
  try {
    const res  = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${CHANNEL_ID}&key=${API_KEY}`
    );
    const data = await res.json();
    if (data.error) {
      log(`YouTube API 错误：${data.error.message}`, "WARN");
      return null;
    }
    return Number(data.items?.[0]?.statistics?.subscriberCount ?? 0);
  } catch (e) {
    log(`API 请求失败：${e.message}`, "WARN");
    return null;
  }
}

// ── Trigger banner update ─────────────────────────────────────────────────
async function triggerUpdate(subs, reason) {
  if (isRunning) {
    log(`跳过触发（上次更新仍在执行中）`, "WARN");
    return;
  }

  isRunning = true;
  updateCount++;
  log(`🚀 触发 Banner 更新 #${updateCount}，原因：${reason}，订阅数：${subs}`);

  const args = subs > 0 ? [`--subs=${subs}`] : [];

  await new Promise((resolve) => {
    const proc = spawn(process.execPath, ["run.mjs", ...args], {
      cwd:   ROOT,
      stdio: "inherit",
      env:   { ...process.env },
    });
    proc.on("close", (code) => {
      if (code === 0) {
        log(`✅ Banner 更新完成 #${updateCount}`);
      } else {
        log(`❌ Banner 更新失败 #${updateCount}，退出码：${code}`, "ERROR");
      }
      isRunning = false;
      resolve();
    });
  });
}

// ── Check for changes ─────────────────────────────────────────────────────
async function checkAndUpdate(reason = "poll") {
  const subs = await fetchSubs();
  if (subs === null) return;

  if (subs !== lastSubs) {
    const delta = subs - lastSubs;
    log(`订阅数变化：${lastSubs} → ${subs}（${delta > 0 ? "+" : ""}${delta}）`);
    lastSubs = subs;
    saveState();
    await triggerUpdate(subs, reason);
  } else {
    log(`订阅数无变化：${subs}`);
  }
}

// ── PubSubHubbub webhook server ────────────────────────────────────────────
function startWebhookServer() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${WEBHOOK_PORT}`);

    // Verification challenge (GET)
    if (req.method === "GET" && url.searchParams.has("hub.challenge")) {
      const challenge = url.searchParams.get("hub.challenge");
      log(`✓ Webhook 验证成功`);
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(challenge);
      return;
    }

    // Notification (POST)
    if (req.method === "POST") {
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", async () => {
        res.writeHead(200);
        res.end("ok");
        log(`📬 收到 PubSubHubbub 推送通知，立即触发更新`);
        await checkAndUpdate("webhook");
      });
      return;
    }

    // Health check
    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        status: "ok",
        lastSubs,
        updateCount,
        isRunning,
        uptime: process.uptime(),
      }));
      return;
    }

    res.writeHead(404);
    res.end("not found");
  });

  server.listen(WEBHOOK_PORT, () => {
    log(`✓ Webhook 服务器已启动，端口：${WEBHOOK_PORT}`);
    if (PUBLIC_URL) {
      log(`  公网地址：${PUBLIC_URL}`);
      subscribeToYouTubePush();
    } else {
      log(`  未配置 WEBHOOK_PUBLIC_URL，跳过 PubSubHubbub 订阅（仅使用轮询模式）`);
    }
  });

  return server;
}

// ── Subscribe to YouTube PubSubHubbub ─────────────────────────────────────
async function subscribeToYouTubePush() {
  if (!CHANNEL_ID || !PUBLIC_URL) return;

  const topic    = `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${CHANNEL_ID}`;
  const callback = `${PUBLIC_URL}/webhook`;
  const hub      = "https://pubsubhubbub.appspot.com/subscribe";

  try {
    const res = await fetch(hub, {
      method:  "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body:    new URLSearchParams({
        "hub.mode":          "subscribe",
        "hub.topic":         topic,
        "hub.callback":      callback,
        "hub.verify":        "async",
        "hub.lease_seconds": "86400",  // 24 hours, re-subscribe daily
      }),
    });

    if (res.status === 202) {
      log(`✓ PubSubHubbub 订阅请求已发送（将在验证后生效）`);
    } else {
      log(`⚠  PubSubHubbub 订阅返回 ${res.status}`, "WARN");
    }
  } catch (e) {
    log(`PubSubHubbub 订阅失败：${e.message}`, "WARN");
  }
}

// ── Main ──────────────────────────────────────────────────────────────────
loadState();

log("═══════════════════════════════════════");
log("  OlympicMotion Banner Daemon 已启动");
log(`  轮询间隔：每 ${POLL_MIN} 分钟`);
log(`  Webhook 端口：${WEBHOOK_PORT}`);
log("═══════════════════════════════════════");

// Start webhook server
startWebhookServer();

// Initial check on startup
setTimeout(() => checkAndUpdate("startup"), 3000);

// Poll on interval
setInterval(() => checkAndUpdate("poll"), POLL_MIN * 60 * 1000);

// Re-subscribe to PubSubHubbub daily
if (PUBLIC_URL) {
  setInterval(() => subscribeToYouTubePush(), 23 * 60 * 60 * 1000);
}

// Graceful shutdown
process.on("SIGTERM", () => { log("收到 SIGTERM，正在退出..."); process.exit(0); });
process.on("SIGINT",  () => { log("收到 SIGINT，正在退出...");  process.exit(0); });
