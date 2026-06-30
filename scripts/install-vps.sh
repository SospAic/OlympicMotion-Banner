#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# OlympicMotion Banner Engine — VPS 一键安装脚本
# 支持系统：Ubuntu 20.04 / 22.04 / 24.04，Debian 11 / 12
#
# 用法：
#   wget -O install.sh https://raw.githubusercontent.com/SospAic/OlympicMotion-Banner/main/scripts/install-vps.sh
#   chmod +x install.sh && bash install.sh
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

REPO_URL="https://github.com/SospAic/OlympicMotion-Banner.git"
INSTALL_DIR="${HOME}/OlympicMotion-Banner"
LOG_FILE="/var/log/olympicmotion-banner.log"
NODE_VERSION="22"

# ── Colors ────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()    { echo -e "${CYAN}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[✓]${NC} $*"; }
warn()    { echo -e "${YELLOW}[⚠]${NC} $*"; }
error()   { echo -e "${RED}[✗]${NC} $*"; exit 1; }
step()    { echo -e "\n${BOLD}${BLUE}══ $* ══${NC}"; }

echo -e "${BOLD}"
echo "  ╔═══════════════════════════════════════════╗"
echo "  ║   OlympicMotion Banner Engine              ║"
echo "  ║   VPS 一键安装脚本 v1.0                    ║"
echo "  ╚═══════════════════════════════════════════╝"
echo -e "${NC}"

# ── Check root ────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  warn "非 root 用户，部分系统依赖可能需要手动安装"
fi

# ── Step 1: System update ─────────────────────────────────────
step "步骤 1/6：更新系统包"
apt-get update -qq
success "系统包索引已更新"

# ── Step 2: Install Node.js ───────────────────────────────────
step "步骤 2/6：安装 Node.js ${NODE_VERSION}"
if command -v node &>/dev/null; then
  CURRENT_NODE=$(node --version | cut -d. -f1 | tr -d 'v')
  if [[ $CURRENT_NODE -ge $NODE_VERSION ]]; then
    success "Node.js $(node --version) 已安装，跳过"
  else
    warn "Node.js 版本过低 ($(node --version))，重新安装..."
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash -
    apt-get install -y nodejs
    success "Node.js $(node --version) 安装完成"
  fi
else
  info "安装 Node.js ${NODE_VERSION}..."
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash -
  apt-get install -y nodejs
  success "Node.js $(node --version) 安装完成"
fi

# ── Step 3: Install system deps for Playwright ───────────────
step "步骤 3/6：安装 Playwright 系统依赖"
apt-get install -y --no-install-recommends \
  git curl ca-certificates \
  libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
  libcups2 libdrm2 libxkbcommon0 libxcomposite1 \
  libxdamage1 libxfixes3 libxrandr2 libgbm1 \
  libpango-1.0-0 libcairo2 libasound2 \
  libx11-xcb1 libxcb1 libxext6 libx11-6 \
  fonts-liberation fonts-noto-cjk \
  2>/dev/null || true
success "系统依赖安装完成"

# ── Step 4: Clone / update project ───────────────────────────
step "步骤 4/6：获取项目代码"
if [[ -d "$INSTALL_DIR/.git" ]]; then
  info "项目已存在，更新到最新版本..."
  git -C "$INSTALL_DIR" pull --rebase origin main
  success "代码已更新到最新版本"
else
  info "克隆项目到 ${INSTALL_DIR}..."
  git clone "$REPO_URL" "$INSTALL_DIR"
  success "项目克隆完成"
fi

cd "$INSTALL_DIR"

# ── Step 5: Install npm deps + Playwright browser ────────────
step "步骤 5/6：安装 Node 依赖和 Playwright 浏览器"
npm ci --silent
node node_modules/playwright/cli.js install chromium
success "依赖安装完成"

# ── Step 6: Create .env if not exists ────────────────────────
step "步骤 6/6：创建配置文件"
if [[ ! -f ".env" ]]; then
  cp .env.example .env
  warn ".env 配置文件已创建，请编辑填入真实值：nano ${INSTALL_DIR}/.env"
else
  success ".env 已存在，跳过创建"
fi

# ── Create log file ───────────────────────────────────────────
touch "$LOG_FILE" 2>/dev/null || LOG_FILE="${INSTALL_DIR}/banner.log"
success "日志文件：${LOG_FILE}"

# ── Setup cron ────────────────────────────────────────────────
CRON_JOB="0 */2 * * * cd ${INSTALL_DIR} && node run.mjs >> ${LOG_FILE} 2>&1"
# Check if cron already set
if crontab -l 2>/dev/null | grep -q "OlympicMotion-Banner"; then
  warn "Cron 任务已存在，跳过设置"
else
  (crontab -l 2>/dev/null || true; echo "# OlympicMotion Banner Engine"; echo "$CRON_JOB") | crontab -
  success "Cron 定时任务已设置（每2小时执行）"
fi

# ── Print summary ─────────────────────────────────────────────
echo -e "\n${BOLD}${GREEN}"
echo "  ╔═══════════════════════════════════════════╗"
echo "  ║   ✅ 安装完成！                             ║"
echo "  ╚═══════════════════════════════════════════╝"
echo -e "${NC}"
echo -e "${BOLD}接下来的步骤：${NC}"
echo ""
echo -e "  ${YELLOW}1.${NC} 编辑配置文件："
echo "     nano ${INSTALL_DIR}/.env"
echo ""
echo -e "  ${YELLOW}2.${NC} 执行一次性 OAuth 授权（获取 YouTube 上传权限）："
echo "     cd ${INSTALL_DIR} && node scripts/setup-session.mjs"
echo ""
echo -e "  ${YELLOW}3.${NC} 测试生成（不上传）："
echo "     cd ${INSTALL_DIR} && node run.mjs --no-upload"
echo ""
echo -e "  ${YELLOW}4.${NC} 完整测试（生成 + 上传）："
echo "     cd ${INSTALL_DIR} && node run.mjs"
echo ""
echo -e "  ${YELLOW}5.${NC} 查看日志："
echo "     tail -f ${LOG_FILE}"
echo ""
echo -e "  ${YELLOW}6.${NC} 查看/修改定时任务："
echo "     crontab -l"
echo ""
