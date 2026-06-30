#!/usr/bin/env bash
# OlympicMotion Banner Engine — Ubuntu 20.04/22.04/24.04 安装脚本
set -euo pipefail

REPO="https://github.com/SospAic/OlympicMotion-Banner.git"
DIR="${HOME}/OlympicMotion-Banner"

R='\033[0;31m'; G='\033[0;32m'; Y='\033[1;33m'
C='\033[0;36m'; B='\033[1m'; N='\033[0m'
ok()       { echo -e "${G}[✓]${N} $*"; }
info()     { echo -e "${C}[i]${N} $*"; }
warn()     { echo -e "${Y}[!]${N} $*"; }
die()      { echo -e "${R}[✗]${N} $*"; exit 1; }
step()     { echo -e "\n${B}${C}── $* ──${N}"; }

# Non-fatal warnings collected and shown at end
WARNINGS=()
warn_skip() { WARNINGS+=("$*"); echo -e "${Y}[!]${N} $* (已跳过)"; }

echo -e "${B}"
echo "  ╔══════════════════════════════════════════╗"
echo "  ║  OlympicMotion Banner Engine v2.0         ║"
echo "  ║  Ubuntu 安装脚本                          ║"
echo "  ╚══════════════════════════════════════════╝"
echo -e "${N}"

# ── Step 1: System deps ───────────────────────────────────────
step "1/6 安装系统依赖"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq \
  curl wget git ca-certificates gnupg \
  libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
  libcups2 libdrm2 libxkbcommon0 libxcomposite1 \
  libxdamage1 libxfixes3 libxrandr2 libgbm1 \
  libpango-1.0-0 libcairo2 libasound2t64 \
  libx11-xcb1 libxcb1 libxext6 libx11-6 \
  fonts-liberation nano 2>/dev/null || \
apt-get install -y -qq \
  curl wget git ca-certificates gnupg \
  libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
  libcups2 libdrm2 libxkbcommon0 libxcomposite1 \
  libxdamage1 libxfixes3 libxrandr2 libgbm1 \
  libpango-1.0-0 libcairo2 libasound2 \
  libx11-xcb1 libxcb1 libxext6 libx11-6 \
  fonts-liberation nano
ok "系统依赖安装完成"

# ── Step 2: Node.js 22 ────────────────────────────────────────
step "2/6 安装 Node.js 22"
if command -v node &>/dev/null && [[ $(node -e 'process.stdout.write(process.version.split(".")[0].slice(1))') -ge 22 ]]; then
  ok "Node.js $(node --version) 已安装"
else
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
  ok "Node.js $(node --version) 安装完成"
fi

# ── Step 3: Caddy (HTTPS reverse proxy) ──────────────────────
step "3/6 安装 Caddy Web 服务器"
if command -v caddy &>/dev/null; then
  ok "Caddy $(caddy version | head -1) 已安装"
else
  {
    apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
      | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
      | tee /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -qq
    apt-get install -y caddy
    ok "Caddy $(caddy version | head -1) 安装完成"
  } || warn_skip "Caddy 安装失败，域名 HTTPS 功能不可用（可后续手动安装）"
fi

# ── Step 4: PM2 + project ─────────────────────────────────────
step "4/6 安装 PM2 + 克隆项目"
npm install -g pm2 --silent
ok "PM2 $(pm2 --version) 安装完成"

if [[ -d "$DIR/.git" ]]; then
  info "项目已存在，更新代码..."
  cd "$DIR"
  git fetch origin main 2>&1 || warn_skip "git fetch 失败，使用现有代码"
  git reset --hard origin/main 2>&1 || warn_skip "git reset 失败，使用现有代码"
  git clean -fd 2>/dev/null || true
else
  git clone "$REPO" "$DIR" || die "克隆失败，请检查网络"
fi
cd "$DIR"
npm ci --silent || warn_skip "npm ci 失败，尝试 npm install"
npm install --silent 2>/dev/null || warn_skip "npm install 失败，请手动运行 npm ci"
node node_modules/playwright/cli.js install chromium 2>/dev/null || warn_skip "Playwright Chromium 安装失败，请手动运行: node node_modules/playwright/cli.js install chromium"
ok "项目依赖安装完成"

# ── Step 5: .env ──────────────────────────────────────────────
step "5/6 配置文件"
if [[ ! -f .env ]]; then
  cp .env.example .env
  chmod 600 .env
  warn ".env 已创建，请填写配置"
else
  chmod 600 .env
  ok ".env 已存在"
fi
mkdir -p .session && chmod 700 .session

# ── Step 6: Cron backup ───────────────────────────────────────
step "6/6 设置定时任务"
LOG="/var/log/olympicmotion-banner.log"
touch "$LOG" 2>/dev/null || LOG="${DIR}/banner.log"
CRON="0 */2 * * * cd ${DIR} && node run.mjs >> ${LOG} 2>&1"
if crontab -l 2>/dev/null | grep -q "OlympicMotion"; then
  ok "Cron 已存在"
else
  { (crontab -l 2>/dev/null || true; echo "# OlympicMotion Banner Engine"; echo "$CRON") | crontab -
    ok "Cron 已设置（每2小时备用轮询）"
  } || warn_skip "Cron 设置失败，请手动添加定时任务"
fi

# ── Done ──────────────────────────────────────────────────────
echo -e "\n${B}${G}"
echo "  ╔══════════════════════════════════════════╗"
echo "  ║  ✅ 安装完成！                             ║"
echo "  ╚══════════════════════════════════════════╝"
echo -e "${N}"

# Show any non-fatal warnings
if [[ ${#WARNINGS[@]} -gt 0 ]]; then
  echo -e "${Y}  ⚠  安装过程中有以下问题需要注意：${N}"
  for w in "${WARNINGS[@]}"; do
    echo -e "  ${Y}•${N} ${w}"
  done
  echo ""
fi

echo -e "  接下来运行管理菜单："
echo -e "  ${C}cd ${DIR} && node scripts/manage.mjs${N}\n"
