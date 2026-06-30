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
echo "  ║   VPS 一键安装脚本 v1.1                    ║"
echo "  ╚═══════════════════════════════════════════╝"
echo -e "${NC}"

# ── Detect OS ─────────────────────────────────────────────────
OS_ID=""
OS_VERSION=""
PKG_MANAGER=""

if [[ -f /etc/os-release ]]; then
  source /etc/os-release
  OS_ID="${ID,,}"        # lowercase: ubuntu, debian, centos, rhel, fedora, rocky, almalinux
  OS_VERSION="${VERSION_ID%%.*}"  # major version only
elif [[ -f /etc/redhat-release ]]; then
  OS_ID="centos"
  OS_VERSION=$(grep -oE '[0-9]+' /etc/redhat-release | head -1)
fi

case "$OS_ID" in
  ubuntu|debian|linuxmint)
    PKG_MANAGER="apt"
    ;;
  centos|rhel|fedora|rocky|almalinux|ol)
    PKG_MANAGER="yum"
    # CentOS 8+ / RHEL 8+ use dnf
    if [[ "$OS_VERSION" -ge 8 ]] 2>/dev/null; then
      PKG_MANAGER="dnf"
    fi
    ;;
  *)
    warn "未识别的系统：${OS_ID}，尝试自动检测包管理器"
    if command -v dnf  &>/dev/null; then PKG_MANAGER="dnf"
    elif command -v yum  &>/dev/null; then PKG_MANAGER="yum"
    elif command -v apt-get &>/dev/null; then PKG_MANAGER="apt"
    else error "无法确定包管理器，请手动安装依赖"
    fi
    ;;
esac

info "检测到系统：${OS_ID:-unknown} ${OS_VERSION} | 包管理器：${PKG_MANAGER}"

# ── Node.js install helper ────────────────────────────────────
_install_node() {
  info "安装 Node.js..."

  # CentOS 7 / RHEL 7: glibc too old for Node 22, use nvm + Node 18
  if [[ "$OS_ID" =~ ^(centos|rhel)$ && "$OS_VERSION" == "7" ]]; then
    warn "CentOS 7 的 glibc 版本过低（2.17），Node.js 22 需要 glibc 2.28+"
    info "改用 nvm 安装 Node.js 18（CentOS 7 最高可用版本）"

    # Install build tools needed by nvm
    yum install -y -q curl git gcc gcc-c++ make 2>/dev/null || true

    # Install nvm
    export NVM_DIR="${HOME}/.nvm"
    curl -fsSL "https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh" | bash

    # Load nvm in current shell
    source "${NVM_DIR}/nvm.sh" 2>/dev/null || true

    # Install Node 18 (last version with CentOS 7 glibc 2.17 support)
    nvm install 18
    nvm use 18
    nvm alias default 18

    # Make node/npm available system-wide
    NODE_BIN=$(nvm which current)
    NODE_DIR=$(dirname "$NODE_BIN")
    if [[ ! -f /usr/local/bin/node ]]; then
      ln -sf "$NODE_BIN" /usr/local/bin/node
      ln -sf "${NODE_DIR}/npm"  /usr/local/bin/npm
      ln -sf "${NODE_DIR}/npx"  /usr/local/bin/npx
    fi

    # Add nvm to shell profile for future sessions
    for profile in ~/.bashrc ~/.bash_profile ~/.profile; do
      if [[ -f "$profile" ]] && ! grep -q "NVM_DIR" "$profile"; then
        cat >> "$profile" << 'NVMEOF'
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
NVMEOF
      fi
    done

    NODE_VERSION=18  # update for version check

  else
    # All other systems: use NodeSource rpm/deb repo
    case "$PKG_MANAGER" in
      apt)
        curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash -
        apt-get install -y nodejs
        ;;
      dnf|yum)
        curl -fsSL "https://rpm.nodesource.com/setup_${NODE_VERSION}.x" | bash -
        $PKG_MANAGER install -y nodejs
        ;;
    esac
  fi
}

# ── Check root ────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  warn "非 root 用户，部分系统依赖可能需要手动安装"
fi

# ── Step 1: System update ─────────────────────────────────────
step "步骤 1/7：更新系统包"
case "$PKG_MANAGER" in
  apt)
    apt-get update -qq
    ;;
  dnf)
    dnf check-update -q || true
    # Install EPEL for extra packages (CentOS/RHEL)
    dnf install -y -q epel-release 2>/dev/null || true
    ;;
  yum)
    yum check-update -q || true
    yum install -y -q epel-release 2>/dev/null || true
    ;;
esac
success "系统包索引已更新"

# ── Step 2/7：安装 Node.js ───────────────────────────────────
step "步骤 2/7：安装 Node.js"

# Load nvm if already installed
export NVM_DIR="${HOME}/.nvm"
[[ -s "${NVM_DIR}/nvm.sh" ]] && source "${NVM_DIR}/nvm.sh"

if command -v node &>/dev/null; then
  CURRENT_NODE=$(node --version | cut -d. -f1 | tr -d 'v')
  MIN_NODE=18
  if [[ "$CURRENT_NODE" -ge "$MIN_NODE" ]] 2>/dev/null; then
    success "Node.js $(node --version) 已安装，跳过"
  else
    warn "Node.js 版本过低 ($(node --version))，重新安装..."
    _install_node
    success "Node.js $(node --version) 安装完成"
  fi
else
  _install_node
  # Reload nvm after install
  [[ -s "${NVM_DIR}/nvm.sh" ]] && source "${NVM_DIR}/nvm.sh"
  success "Node.js $(node --version) 安装完成"
fi

# ── Step 3: Install system deps for Playwright ───────────────
step "步骤 3/7：安装 Playwright 系统依赖"
case "$PKG_MANAGER" in
  apt)
    apt-get install -y --no-install-recommends \
      git curl ca-certificates \
      libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
      libcups2 libdrm2 libxkbcommon0 libxcomposite1 \
      libxdamage1 libxfixes3 libxrandr2 libgbm1 \
      libpango-1.0-0 libcairo2 libasound2 \
      libx11-xcb1 libxcb1 libxext6 libx11-6 \
      fonts-liberation fonts-noto-cjk \
      2>/dev/null || true
    ;;
  dnf|yum)
    # CentOS / RHEL / Rocky equivalents
    $PKG_MANAGER install -y \
      git curl ca-certificates \
      nss nspr atk at-spi2-atk \
      cups-libs libdrm libxkbcommon libXcomposite \
      libXdamage libXfixes libXrandr mesa-libgbm \
      pango cairo alsa-lib \
      libX11-xcb libxcb libXext libX11 \
      liberation-fonts \
      2>/dev/null || true

    # Enable additional font support on CentOS 7
    if [[ "$OS_VERSION" == "7" ]]; then
      yum install -y fontconfig freetype 2>/dev/null || true
    fi

    # CentOS 7 needs additional libraries for headless Chrome
    if [[ "$OS_ID" == "centos" && "$OS_VERSION" == "7" ]]; then
      yum install -y \
        libXScrnSaver GConf2 \
        xorg-x11-fonts-Type1 xorg-x11-fonts-misc \
        dbus-x11 \
        2>/dev/null || true
    fi
    ;;
esac
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
step "步骤 5/7：安装 Node 依赖和 Playwright 浏览器"

# Reload nvm if needed
[[ -s "${NVM_DIR}/nvm.sh" ]] && source "${NVM_DIR}/nvm.sh"

npm ci --silent

# CentOS 7: use Playwright's built-in deps installer
if [[ "$OS_ID" =~ ^(centos|rhel)$ && "$OS_VERSION" == "7" ]]; then
  info "CentOS 7：使用 Playwright 自带依赖安装方式..."
  node node_modules/playwright/cli.js install chromium --with-deps 2>/dev/null || \
  node node_modules/playwright/cli.js install chromium
else
  node node_modules/playwright/cli.js install chromium
fi
success "依赖安装完成"

# ── Step 5.5: Install pm2 for daemon management ───────────────
step "步骤 6/7：安装 PM2 进程管理器"
if command -v pm2 &>/dev/null; then
  success "PM2 已安装：$(pm2 --version)"
else
  npm install -g pm2 --silent
  success "PM2 安装完成：$(pm2 --version)"
fi

# ── Step 6: Create .env if not exists ────────────────────────
step "步骤 7/7：创建配置文件"
if [[ ! -f ".env" ]]; then
  cp .env.example .env
  chmod 600 .env
  warn ".env 配置文件已创建（权限已锁定为 600）"
  warn "请编辑填入真实值：nano ${INSTALL_DIR}/.env"
else
  chmod 600 .env
  success ".env 已存在，权限已设为 600"
fi

# Lock down sensitive directories
chmod 700 "${INSTALL_DIR}/.session" 2>/dev/null || mkdir -p "${INSTALL_DIR}/.session" && chmod 700 "${INSTALL_DIR}/.session"

# ── Create log file ───────────────────────────────────────────
touch "$LOG_FILE" 2>/dev/null || LOG_FILE="${INSTALL_DIR}/banner.log"
success "日志文件：${LOG_FILE}"

# ── Setup cron (backup polling, daemon is primary) ────────────
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
echo -e "  ${YELLOW}2.${NC} 生成 Session 加密密钥（强烈推荐）："
echo "     cd ${INSTALL_DIR} && node scripts/encrypt-session.mjs --gen-key"
echo "     # 将输出的 SESSION_ENCRYPTION_KEY 填入 .env"
echo ""
echo -e "  ${YELLOW}3.${NC} 执行一次性登录（获取 YouTube 上传权限）："
echo "     cd ${INSTALL_DIR} && node scripts/interactive-login.mjs"
echo ""
echo -e "  ${YELLOW}4.${NC} 测试生成（不上传）："
echo "     cd ${INSTALL_DIR} && node run.mjs --no-upload"
echo ""
echo -e "  ${YELLOW}5.${NC} 启动即时更新守护进程（PM2）："
echo "     cd ${INSTALL_DIR} && pm2 start scripts/watch-daemon.mjs --name banner-daemon"
echo "     pm2 save && pm2 startup"
echo ""
echo -e "  ${YELLOW}6.${NC} 查看守护进程状态："
echo "     pm2 status"
echo "     pm2 logs banner-daemon"
echo ""
echo -e "  ${YELLOW}7.${NC} 健康检查："
echo "     curl http://localhost:${WEBHOOK_PORT:-4174}/health"
echo ""
echo -e "  ${YELLOW}8.${NC} 查看/修改定时任务（备用轮询）："
echo "     crontab -l"
echo ""
