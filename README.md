# OlympicMotion Banner Engine Pro v2.0

YouTube 频道 Banner 自动生成引擎，三层分离架构：

```
Designer  →  Runtime  →  Exporter
（视觉）      （数据）      （截图）
```

---

## 目录结构

```
OlympicMotion-Banner/
├── public/                      # Banner Designer（静态站点）
│   ├── index.html               # Banner 页面结构
│   ├── app.js                   # 前端逻辑：读 config → 渲染 DOM
│   ├── assets/logo.svg          # Logo（可替换为 .png）
│   ├── config/banner.config.json  # 所有可配置项
│   ├── runtime/banner-runtime.js  # 纯函数：数据计算层
│   └── styles/                  # CSS 样式
├── exporter/
│   ├── render-banner.mjs        # Playwright 截图 → dist/banner.png
│   └── upload-banner.mjs        # 上传 banner 到 YouTube（三种模式）
├── scripts/
│   ├── manage.mjs               # 交互式管理菜单（推荐入口）
│   ├── vps-login.mjs            # VPS OAuth 登录工具
│   ├── setup-caddy.mjs          # 域名 + HTTPS + OAuth 回调配置
│   ├── install-ubuntu.sh        # Ubuntu 一键安装脚本
│   ├── watch-daemon.mjs         # 即时更新守护进程（PM2）
│   ├── encrypt-session.mjs      # Session AES-256-GCM 加密工具
│   └── interactive-login.mjs    # 交互式登录（备用）
├── run.mjs                      # VPS 一键执行（获取订阅数+生成+上传）
├── server.mjs                   # 本地开发服务器
├── .env.example                 # 环境变量模板
├── .github/workflows/banner.yml # GitHub Actions（已禁用定时，保留手动触发）
└── package.json
```

---

## 快速开始（VPS 部署，推荐）

### 第一步：Ubuntu VPS 一键安装

```bash
curl -fsSL https://raw.githubusercontent.com/SospAic/OlympicMotion-Banner/main/scripts/install-ubuntu.sh | bash
```

### 第二步：进入管理菜单

```bash
cd ~/OlympicMotion-Banner && node scripts/manage.mjs
```

### 第三步：配置域名 + HTTPS（菜单 1→2）

需要先把域名 A 记录指向 VPS IP，然后在菜单里配置，Caddy 自动申请 HTTPS 证书。

### 第四步：Google Cloud Console 配置

1. 打开 [console.cloud.google.com](https://console.cloud.google.com)
2. 启用 **YouTube Data API v3**
3. **凭据 → 创建凭据 → OAuth 客户端 ID**
   - 应用类型：**Web 应用**（⚠️ 不是桌面应用）
   - 已授权的重定向 URI 添加：`https://你的域名/oauth/callback`
4. **OAuth 同意屏幕 → 发布为正式版**（refresh_token 永不过期）
5. 把 `client_id` 和 `client_secret` 填入 `.env`

### 第五步：VPS 登录授权（菜单 2→1）

```bash
node scripts/vps-login.mjs
```

用浏览器打开授权链接，完成后 token 自动保存。

### 第六步：启动守护进程（菜单 6→1）

```bash
pm2 start scripts/watch-daemon.mjs --name banner-daemon
pm2 save && pm2 startup
```

---

## 配置说明（`.env`）

复制 `.env.example` 为 `.env`，填入以下配置：

```bash
# YouTube API（获取订阅数）
YOUTUBE_API_KEY=AIzaSy...
YOUTUBE_CHANNEL_ID=UCxxxxxxxx

# OAuth Web 客户端（⚠️ 必须是 Web 应用类型）
GOOGLE_CLIENT_ID=1234567890-xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxx
GOOGLE_REFRESH_TOKEN=1//04xxx...  # vps-login.mjs 自动填入

# 域名配置（setup-caddy.mjs 自动填入）
DOMAIN=banner.example.com
BANNER_URL=https://banner.example.com
WEBHOOK_PUBLIC_URL=https://banner.example.com/webhook

# Session 加密密钥（可选，AES-256-GCM）
SESSION_ENCRYPTION_KEY=  # encrypt-session.mjs --gen-key 生成

# 守护进程配置
POLL_INTERVAL_MINUTES=5   # 轮询间隔
WEBHOOK_PORT=4174          # PubSubHubbub 端口
```

---

## `banner.config.json` 配置

```jsonc
{
  "brand": {
    "channelName": "OlympicMotion",
    "brandLine1":  "Olympic",
    "brandLine2":  "Motion",
    "slogan":      "Every Play Has A Story",
    "sloganAccent":"Story",
    "logo":        "/assets/logo.svg"   // 替换为 /assets/logo.png
  },
  "mission": {
    "title": "Road To <span>1M</span> Champions",
    "goal":  1000000,
    "cta":   "Subscribe & Be Part Of The Journey"
  },
  "data": {
    "subs": 46812    // run.mjs 自动从 YouTube API 更新
  },
  "social": {
    "youtube":   "https://youtube.com/@YourChannel",
    "instagram": "https://instagram.com/YourChannel",
    "tiktok":    "https://tiktok.com/@YourChannel",
    "x":         "https://x.com/YourChannel"
  }
}
```

---

## 上传模式说明

`upload-banner.mjs` 自动检测可用凭据，优先级：

| 模式 | 条件 | 说明 |
|------|------|------|
| S — Session | `.session/youtube-session.enc` 存在 | VPS 登录后自动使用，推荐 |
| A — Cookie | `YOUTUBE_COOKIES` 环境变量 | GitHub Actions 用 |
| B — OAuth API | `GOOGLE_CLIENT_ID` + `GOOGLE_REFRESH_TOKEN` | YouTube 合作伙伴账号 |

---

## Logo 替换

1. 准备 512×512 px 圆形图片，保存为 `public/assets/logo.png`
2. 修改 `banner.config.json`：`"logo": "/assets/logo.png"`
3. 重启本地服务器或重新生成 banner

---

## 常见问题

**Q: `invalid_grant` 错误**  
A: refresh_token 失效。删除旧 session 重新授权：
```bash
rm -f .session/youtube-session.enc .session/youtube-session.json
node scripts/vps-login.mjs
```

**Q: OAuth 应用类型选错了（桌面应用）**  
A: Google Cloud Console → 凭据 → 编辑 OAuth 客户端 → 应用类型改为「Web 应用」→ 添加回调地址 → 保存。重新运行 `vps-login.mjs`。

**Q: Caddy 只监听 80 不监听 443**  
A: Caddyfile 里域名格式错误（如 `msco` 而非 `banner.example.com`）。运行 `node scripts/manage.mjs` → 1→2 重新配置。

**Q: `redirect_uri_mismatch`**  
A: Google Cloud Console 里的「已授权的重定向 URI」与 `.env` 里的 `DOMAIN` 不匹配。确认两者一致。

**Q: YouTube API 返回 0**  
A: 检查 `YOUTUBE_API_KEY` 是否启用了 YouTube Data API v3；`YOUTUBE_CHANNEL_ID` 是否以 `UC` 开头。
