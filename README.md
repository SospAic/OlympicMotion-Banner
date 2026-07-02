# OlympicMotion Banner Engine Pro v2.0

YouTube 频道 Banner 自动生成引擎，支持两套渲染方案：

| 方案 | 引擎 | 速度 | 说明 |
|------|------|------|------|
| **v2（推荐）** | Sharp 图片合成 | 快（无浏览器） | 直接在 `background.png` 上叠加 SVG 动态数据 |
| v1 | Playwright 截图 | 慢（需 Chromium） | 截图 Web 页面，支持 CSS 动画 |

---

## 目录结构

```
OlympicMotion-Banner/
├── public/
│   ├── index.html                    # v1 Banner 页面
│   ├── app.js                        # v1 前端逻辑
│   ├── assets/
│   │   ├── background.png            # v2 底图（1983×793）
│   │   └── logo.svg
│   ├── config/banner.config.json     # 全局配置（v1+v2 共用）
│   ├── runtime/banner-runtime.js     # v1 数据计算层
│   └── styles/                       # v1 CSS 样式
├── exporter/
│   ├── render-banner-v2.mjs          # v2：Sharp 合成 → dist/banner-v2.png
│   ├── render-banner.mjs             # v1：Playwright 截图 → dist/banner.png
│   └── upload-banner.mjs             # 上传 Banner 到 YouTube（三种模式）
├── scripts/
│   ├── start.sh                      # 一键启动脚本（推荐入口）
│   ├── manage.mjs                    # 交互式管理菜单
│   ├── watch-daemon.mjs              # 守护进程（PM2，订阅数变化自动更新）
│   ├── vps-login.mjs                 # VPS OAuth 登录工具
│   ├── setup-caddy.mjs               # 域名 + HTTPS + OAuth 回调配置
│   ├── install-ubuntu.sh             # Ubuntu 一键安装脚本
│   └── encrypt-session.mjs           # Session AES-256-GCM 加密工具
├── run.mjs                           # 一键执行（获取订阅数 + 生成 + 上传）
├── server.mjs                        # v1 本地开发服务器
├── ecosystem.config.cjs              # PM2 配置（start.sh 自动生成）
├── .env.example                      # 环境变量模板
└── package.json
```

---

## 快速开始（VPS 一键部署）

### 第一步：克隆项目

```bash
git clone https://github.com/SospAic/OlympicMotion-Banner.git
cd OlympicMotion-Banner
```

### 第二步：配置 .env

```bash
cp .env.example .env
nano .env   # 填入以下配置
```

### 第三步：一键启动

```bash
bash scripts/start.sh
```

脚本会自动完成：检查 Node.js/PM2 → 安装依赖 → 验证配置 → 启动 PM2 守护进程 → 注册 systemd 开机自启 → 立即执行一次 Banner 更新。

---

## 日常管理

```bash
# 交互式管理菜单（推荐）
node scripts/manage.mjs

# 手动触发一次更新（v2 方案）
node run.mjs --v2

# 手动触发一次更新（v1 方案）
node run.mjs

# 只生成不上传
node run.mjs --v2 --no-upload

# 手动指定订阅数测试
node run.mjs --v2 --subs=50000 --no-upload

# 查看 PM2 状态
pm2 status

# 查看实时日志
pm2 logs banner-daemon

# 重启守护进程
pm2 restart banner-daemon
```

---

## 配置说明（`.env`）

```bash
# YouTube API（获取订阅数）
YOUTUBE_API_KEY=AIzaSy...
YOUTUBE_CHANNEL_ID=UCxxxxxxxx

# OAuth Web 客户端（⚠️ 必须是 Web 应用类型，不是桌面应用）
GOOGLE_CLIENT_ID=1234567890-xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxx
GOOGLE_REFRESH_TOKEN=1//04xxx...    # vps-login.mjs 自动填入

# 域名配置（setup-caddy.mjs 自动填入）
DOMAIN=om.example.com
BANNER_URL=https://om.example.com
WEBHOOK_PUBLIC_URL=https://om.example.com/webhook

# Session 加密密钥（可选，AES-256-GCM）
SESSION_ENCRYPTION_KEY=             # encrypt-session.mjs --gen-key 生成

# 守护进程配置
POLL_INTERVAL_MINUTES=5             # 订阅数轮询间隔（分钟，最低 1）
WEBHOOK_PORT=4174                   # PubSubHubbub Webhook 端口
```

---

## banner.config.json 配置

```jsonc
{
  "data": { "subs": 85 },              // run.mjs 自动从 YouTube API 更新
  "mission": { "goal": 1000000 },      // 订阅目标（达成后显示 ✓）

  // v2 方案布局坐标（基于 background.png 1983×793）
  "v2Layout": {
    "progressBar": {
      "x": 725, "y": 329, "w": 530, "h": 120,  // 进度条位置和尺寸
      "cornerRadius": 40,                         // 外框圆角
      "fillCornerRadius": 50,                     // 填充圆角
      "subsNumber": {
        "fontSize": 70, "color": "#ffffff"        // 进度条内订阅数样式
      }
    },
    "toGoBox": {
      "x": 1276, "y": 323, "w": 118, "h": 78,   // 距下一目标数字的位置
      "autoShrink": true,                          // 字数多时自动缩小字号
      "useCompactFormat": true,                    // 超过 5 位转为 1.2M/34K
      "color": "#ffc94a"
    },
    "badgeRow": {
      "x0": 1481, "y": 223, "step": 71,           // 徽章起始坐标和间距
      "size": 60                                   // 徽章大小
    }
  },

  // 成就里程碑（超过阈值解锁对应徽章）
  "achievements": [
    { "label": "100",  "threshold": 100 },
    { "label": "1K",   "threshold": 1000 },
    { "label": "10K",  "threshold": 10000 },
    { "label": "50K",  "threshold": 50000 },
    { "label": "100K", "threshold": 100000 },
    { "label": "500K", "threshold": 500000 },
    { "label": "1M",   "threshold": 1000000 }
  ]
}
```

---

## 上传模式

`upload-banner.mjs` 自动选择可用凭据，优先级：

| 优先级 | 模式 | 条件 | 说明 |
|--------|------|------|------|
| 1 | S — Session | `.session/youtube-session.enc` 存在 | VPS 登录后自动使用，推荐 |
| 2 | A — Cookie | `YOUTUBE_COOKIES` 环境变量 | GitHub Actions 用 |
| 3 | B — OAuth API | `GOOGLE_CLIENT_ID` + `GOOGLE_REFRESH_TOKEN` | YouTube 合作伙伴账号 |

---

## Google Cloud Console 配置

1. 打开 [console.cloud.google.com](https://console.cloud.google.com)
2. 启用 **YouTube Data API v3**
3. **凭据 → 创建凭据 → OAuth 客户端 ID**
   - 应用类型：**Web 应用**（⚠️ 不是桌面应用）
   - 已授权的重定向 URI：`https://你的域名/oauth/callback`
4. **OAuth 同意屏幕 → 发布为正式版**（refresh_token 永不过期）
5. 把 `client_id` 和 `client_secret` 填入 `.env`

---

## VPS 登录授权

```bash
node scripts/vps-login.mjs
```

用浏览器打开授权链接完成后，token 自动保存到 `.env` 和 `.session/`。

---

## 域名 + HTTPS 配置（Caddy）

```bash
# 先把域名 A 记录指向 VPS IP，然后：
node scripts/setup-caddy.mjs
```

---

## 常见问题

**Q: `invalid_grant` 错误**  
删除旧 session 重新授权：
```bash
rm -f .session/youtube-session.enc .session/youtube-session.json
node scripts/vps-login.mjs
```

**Q: OAuth 应用类型选错了（桌面应用）**  
Google Cloud Console → 凭据 → 编辑 OAuth 客户端 → 应用类型改为「Web 应用」→ 添加回调地址 → 保存。重新运行 `vps-login.mjs`。

**Q: v2 方案 Sharp 报错**  
```bash
npm install sharp --save-dev
```

**Q: 订阅数显示 toGo 是负数**  
已修复（v2.1+）：当订阅数超过所有里程碑时，进度条显示 100%，toGo 显示 ✓。

**Q: VPS 重启后 Banner 守护进程没有自动恢复**  
```bash
bash scripts/start.sh   # 重新注册 systemd 服务
```

**Q: channels.update 返回 400 Required**  
已修复（v2.1+）：上传前先 GET 现有 brandingSettings，合并后再 PUT。
