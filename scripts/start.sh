#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
#  OlympicMotion Banner Engine — 一键启动脚本
#  用法：bash scripts/start.sh [--reinstall] [--no-service]
#
#  功能：
#    1. 检查并安装 Node.js / PM2 / Sharp 依赖
#    2. 验证 .env 配置完整性
#    3. 用 PM2 启动守护进程（banner-daemon）
#    4. 注册 systemd 服务，确保 VPS 重启后自动恢复
#    5. 立即触发一次 Banner 更新（v2 方案）
# ═══════════════════════════════════════════════════════════════════

set -euo pipefail

# ── 颜色 ───────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${CYAN}[INFO]${RESET}  $*"; }
ok()      { echo -e "${GREEN}[OK]${RESET}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
error()   { echo -e "${RED}[ERROR]${RESET} $*" >&2; }
die()     { error "$*"; exit 1; }
section() { echo -e "\n${BOLD}${CYAN}══ $* ══${RESET}"; }

# ── 参数 ───────────────────────────────────────────────────────────
REINSTALL=false
NO_SERVICE=false
for arg in "$@"; do
  case "$arg" in
    --reinstall)  REINSTALL=true ;;
    --no-service) NO_SERVICE=true ;;
  esac
done

# ── 路径 ───────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$ROOT/.env"
LOG_FILE="/var/log/olympicmotion-banner.log"
# Use CHANNEL_PM2_NAME if set (multi-channel), otherwise default
PM2_APP="${CHANNEL_PM2_NAME:-banner-daemon}"
SERVICE_NAME="olympicmotion-banner"

cd "$ROOT"

# ══════════════════════════════════════════════════════════════════
section "1. 环境检查"
# ══════════════════════════════════════════════════════════════════

# Node.js
if ! command -v node &>/dev/null; then
  warn "Node.js 未找到，正在安装 Node.js 22..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - 2>/dev/null
  apt-get install -y nodejs 2>/dev/null || die "Node.js 安装失败"
fi
NODE_VER=$(node --version)
ok "Node.js $NODE_VER"

# npm
if ! command -v npm &>/dev/null; then
  die "npm 未找到，请手动安装 npm"
fi
ok "npm $(npm --version)"

# PM2
if ! command -v pm2 &>/dev/null || [ "$REINSTALL" = true ]; then
  info "正在安装 PM2..."
  npm install -g pm2 --quiet || die "PM2 安装失败"
fi
ok "PM2 $(pm2 --version 2>/dev/null | head -1)"

# ══════════════════════════════════════════════════════════════════
section "2. 项目依赖"
# ══════════════════════════════════════════════════════════════════

if [ ! -d "$ROOT/node_modules" ] || [ "$REINSTALL" = true ]; then
  info "正在安装 npm 依赖..."
  npm ci --prefer-offline 2>/dev/null || npm install || die "npm 依赖安装失败"
fi

# 检查 Sharp
if ! node -e "import('sharp').then(()=>process.exit(0)).catch(()=>process.exit(1))" 2>/dev/null; then
  warn "Sharp 未找到或版本不兼容，正在重新安装..."
  npm install sharp --save-dev || die "Sharp 安装失败"
fi
ok "Sharp 已就绪"

# 检查 Playwright Chromium（v1 方案需要）
if [ ! -d "$ROOT/node_modules/playwright" ]; then
  warn "Playwright 未安装，跳过 Chromium 检查（v2 方案不需要）"
else
  if ! node node_modules/playwright/cli.js show-browsers 2>/dev/null | grep -q chromium; then
    info "正在安装 Playwright Chromium..."
    node node_modules/playwright/cli.js install chromium --with-deps 2>/dev/null || \
      warn "Playwright Chromium 安装失败（v2 方案不受影响）"
  fi
fi

# ══════════════════════════════════════════════════════════════════
section "3. 配置验证"
# ══════════════════════════════════════════════════════════════════

if [ ! -f "$ENV_FILE" ]; then
  if [ -f "$ROOT/.env.example" ]; then
    warn ".env 不存在，从 .env.example 复制..."
    cp "$ROOT/.env.example" "$ENV_FILE"
    warn "请编辑 $ENV_FILE 填入真实配置，然后重新运行此脚本"
    exit 1
  else
    die ".env 文件不存在，请创建并参考 .env.example"
  fi
fi

# 检查必要配置项
MISSING=()
check_env() {
  local key="$1"
  local val
  val=$(grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '"'"'" | xargs 2>/dev/null || true)
  if [ -z "$val" ]; then
    MISSING+=("$key")
  fi
}

check_env "YOUTUBE_API_KEY"
check_env "YOUTUBE_CHANNEL_ID"
check_env "GOOGLE_CLIENT_ID"
check_env "GOOGLE_CLIENT_SECRET"
check_env "GOOGLE_REFRESH_TOKEN"

if [ ${#MISSING[@]} -gt 0 ]; then
  warn "以下配置项未填写（可能影响运行）："
  for key in "${MISSING[@]}"; do
    echo "    - $key"
  done
  echo ""
  read -r -p "是否继续？[y/N] " confirm
  [[ "$confirm" =~ ^[Yy]$ ]] || exit 1
else
  ok ".env 配置完整"
fi

# 创建日志文件
touch "$LOG_FILE" 2>/dev/null || LOG_FILE="$ROOT/banner.log"
ok "日志文件：$LOG_FILE"

# 创建必要目录
mkdir -p "$ROOT/dist" "$ROOT/.session"
ok "目录已就绪"

# ══════════════════════════════════════════════════════════════════
section "4. PM2 守护进程"
# ══════════════════════════════════════════════════════════════════

# 停止旧实例（如果存在）
if pm2 describe "$PM2_APP" &>/dev/null; then
  info "停止旧 PM2 实例..."
  pm2 delete "$PM2_APP" 2>/dev/null || true
fi

# 生成 PM2 ecosystem 配置
cat > "$ROOT/ecosystem.config.cjs" << EOF
module.exports = {
  apps: [{
    name: "$PM2_APP",
    script: "scripts/watch-daemon.mjs",
    cwd: "$ROOT",
    interpreter: "$(command -v node)",
    instances: 1,
    autorestart: true,
    watch: false,
    max_restarts: 10,
    restart_delay: 5000,
    min_uptime: "10s",
    exp_backoff_restart_delay: 100,
    max_memory_restart: "512M",
    log_file: "$LOG_FILE",
    out_file: "$LOG_FILE",
    err_file: "$LOG_FILE",
    merge_logs: true,
    time: true,
    env: {
      NODE_ENV: "production"
    }
  }]
};
EOF

info "正在启动 PM2 守护进程..."
pm2 start "$ROOT/ecosystem.config.cjs" || die "PM2 启动失败"
pm2 save || warn "pm2 save 失败，进程列表可能在重启后丢失"
ok "PM2 守护进程已启动"

# ══════════════════════════════════════════════════════════════════
section "5. Systemd 服务（开机自启）"
# ══════════════════════════════════════════════════════════════════

if [ "$NO_SERVICE" = true ]; then
  warn "跳过 systemd 服务注册（--no-service）"
elif command -v systemctl &>/dev/null; then

  # 获取 PM2 startup 命令
  PM2_STARTUP=$(pm2 startup 2>&1 | grep "sudo" | tail -1 || true)

  SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
  NODE_BIN=$(command -v node)
  PM2_BIN=$(command -v pm2)
  PM2_HOME="${PM2_HOME:-$HOME/.pm2}"

  cat > "$SERVICE_FILE" << EOF
[Unit]
Description=OlympicMotion Banner Engine
Documentation=https://github.com/SospAic/OlympicMotion-Banner
After=network-online.target
Wants=network-online.target

[Service]
Type=forking
User=root
WorkingDirectory=$ROOT
ExecStart=$PM2_BIN start $ROOT/ecosystem.config.cjs --no-daemon
ExecReload=$PM2_BIN reload $PM2_APP
ExecStop=$PM2_BIN stop $PM2_APP
PIDFile=$PM2_HOME/pm2.pid
Restart=on-failure
RestartSec=10
StandardOutput=append:$LOG_FILE
StandardError=append:$LOG_FILE
Environment=PATH=$PATH
Environment=HOME=$HOME
Environment=PM2_HOME=$PM2_HOME

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable "$SERVICE_NAME" 2>/dev/null && ok "systemd 服务已启用：$SERVICE_NAME"

  # 同时执行 pm2 startup（双重保障）
  if [ -n "$PM2_STARTUP" ]; then
    eval "$PM2_STARTUP" 2>/dev/null || true
    ok "PM2 startup 已配置"
  fi

else
  warn "systemctl 不可用，跳过 systemd 注册"
  warn "VPS 重启后请手动运行：pm2 start $ROOT/ecosystem.config.cjs"
fi

# ══════════════════════════════════════════════════════════════════
section "6. 立即执行一次 Banner 更新"
# ══════════════════════════════════════════════════════════════════

info "正在运行一次完整更新（v2 方案）..."
if node "$ROOT/run.mjs" --v2 2>&1 | tee -a "$LOG_FILE"; then
  ok "Banner 更新成功"
else
  warn "Banner 更新失败，请检查日志：$LOG_FILE"
fi

# ══════════════════════════════════════════════════════════════════
section "完成"
# ══════════════════════════════════════════════════════════════════

echo ""
echo -e "${BOLD}${GREEN}  ✅ OlympicMotion Banner Engine 已成功启动！${RESET}"
echo ""
echo -e "  ${CYAN}PM2 状态：${RESET}       pm2 status"
echo -e "  ${CYAN}查看日志：${RESET}       pm2 logs $PM2_APP"
echo -e "  ${CYAN}管理菜单：${RESET}       node scripts/manage.mjs"
echo -e "  ${CYAN}手动更新：${RESET}       node run.mjs --v2"
echo -e "  ${CYAN}日志文件：${RESET}       $LOG_FILE"
echo ""
pm2 status
