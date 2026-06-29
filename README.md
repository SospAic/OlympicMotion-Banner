# OlympicMotion Banner Engine Pro

YouTube 频道 Banner 自动生成引擎，三层分离架构：

```
Designer  →  Runtime  →  Exporter
（视觉）      （数据）      （截图）
```

---

## 目录结构

```
OlympicMotion-Banner/
├── public/                    # Banner Designer（静态站点）
│   ├── index.html             # Banner 页面结构
│   ├── app.js                 # 前端逻辑，读 config → 渲染 DOM
│   ├── assets/logo.svg        # Logo（可替换为 .png）
│   ├── config/
│   │   └── banner.config.json # 所有可配置项
│   ├── runtime/
│   │   └── banner-runtime.js  # 纯函数：数据计算层
│   └── styles/
│       ├── theme.css
│       ├── animation.css
│       └── banner.css
├── exporter/
│   └── render-banner.mjs      # Playwright 截图 → dist/banner.png
├── worker/
│   └── index.js               # Cloudflare Worker（可选 API 端点）
├── server.mjs                 # 本地开发服务器
├── .github/workflows/
│   └── banner.yml             # GitHub Actions 定时生成 banner
├── wrangler.toml              # Cloudflare Worker 配置
└── package.json
```

---

## 本地开发

### 环境要求
- Node.js 18+（路径：`D:\Software\yt-dlp\node\node.exe`）

### 启动

```bash
npm install
npm run dev
# 浏览器打开 http://localhost:4173
```

### 导出 banner.png

```bash
npm run export
# 输出：dist/banner.png（2560×423 px）
```

---

## 配置说明

编辑 `public/config/banner.config.json`：

```jsonc
{
  "brand": {
    "channelName": "OlympicMotion",  // 频道名（用于页面标题）
    "brandLine1":  "Olympic",         // h1 第一行
    "brandLine2":  "Motion",          // h1 第二行（金色）
    "slogan":      "Every Play Has A Story",
    "sloganAccent":"Story",           // 斜体金色高亮词
    "logo":        "/assets/logo.svg" // 替换为 /assets/logo.png
  },
  "mission": {
    "title": "Road To <span>1M</span> Champions", // 支持 HTML
    "goal":  1000000,                 // 总目标订阅数
    "cta":   "Subscribe & Be Part Of The Journey"
  },
  "data": {
    "subs": 46812                     // 当前订阅数（GitHub Actions 自动更新）
  },
  "social": {
    "youtube":   "https://youtube.com/@YourChannel",
    "instagram": "https://instagram.com/YourChannel",
    "tiktok":    "https://tiktok.com/@YourChannel",
    "x":         "https://x.com/YourChannel"
  },
  "achievements": [
    // 自定义里程碑，Runtime 自动计算解锁状态和进度条
  ]
}
```

---

## 部署流程（全免费）

整体架构：

```
GitHub Repo
    ↓ 推送代码
Cloudflare Pages（自动部署静态站点）
    ↓ 每6小时
GitHub Actions（拉取订阅数 → 生成 banner.png → commit 回 repo）
```

---

### 第一步：推送代码到 GitHub

1. 在 [github.com/new](https://github.com/new) 创建新仓库
   - 仓库名建议：`OlympicMotion-Banner`
   - 设为 Public（Cloudflare Pages 免费计划可访问）
   - **不要**勾选 Add README

2. 在本地项目目录执行：

```bash
git init
git add .
git commit -m "feat: initial OlympicMotion Banner Engine"
git branch -M main
git remote add origin https://github.com/你的用户名/OlympicMotion-Banner.git
git push -u origin main
```

---

### 第二步：Cloudflare Pages 部署（免费静态托管）

**目的**：把 `public/` 目录托管为可访问的网页，Playwright 截图时访问这个 URL。

1. 注册/登录 [dash.cloudflare.com](https://dash.cloudflare.com)（免费）

2. 左侧菜单 → **Workers & Pages** → **Create** → **Pages**

3. 选择 **Connect to Git** → 授权 GitHub → 选择 `OlympicMotion-Banner` 仓库

4. 配置构建设置：

   | 字段 | 值 |
   |------|-----|
   | 项目名称 | `olympicmotion-banner` |
   | Production branch | `main` |
   | Build command | （留空，不需要构建） |
   | Build output directory | `public` |

5. 点击 **Save and Deploy**

6. 等待约 30 秒，部署完成后获得地址：
   ```
   https://olympicmotion-banner.pages.dev
   ```

7. 验证：浏览器打开该地址，应看到 banner 页面

---

### 第三步：配置 GitHub Actions Secrets

**目的**：让 GitHub Actions 能自动从 YouTube API 拉取真实订阅数。

1. 在 GitHub 仓库页面 → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

2. 添加以下 Secrets：

   | Secret 名称 | 值 | 说明 |
   |-------------|-----|------|
   | `YOUTUBE_API_KEY` | `AIza...` | YouTube Data API v3 密钥 |
   | `YOUTUBE_CHANNEL_ID` | `UCxxxxxx` | 你的频道 ID |
   | `BANNER_URL` | `https://olympicmotion-banner.pages.dev` | Cloudflare Pages 地址 |

3. **获取 YouTube API Key**：
   - 访问 [console.cloud.google.com](https://console.cloud.google.com)
   - 创建项目 → 启用 **YouTube Data API v3**
   - **凭据** → **创建凭据** → **API 密钥**
   - 复制密钥填入 Secret

4. **获取频道 ID**：
   - 打开 YouTube，进入你的频道页
   - URL 中的 `@频道名` → 打开页面源码 → 搜索 `"channelId"` → 复制 `UC` 开头的 ID
   - 或访问：`https://www.youtube.com/@你的频道名/about`

---

### 第四步：更新 GitHub Actions workflow 使用 Cloudflare Pages URL

编辑 `.github/workflows/banner.yml`，在 `Render banner` 步骤前加一行：

```yaml
      - name: Render banner
        run: node exporter/render-banner.mjs dist/banner.png
        env:
          BANNER_URL: ${{ secrets.BANNER_URL }}
```

或直接在 workflow 文件顶部 env 区块添加（已在当前 workflow 中支持 `BANNER_URL` 环境变量）。

---

### 第五步：手动触发第一次 Actions 运行

1. GitHub 仓库 → **Actions** → **Generate Banner**

2. 点击 **Run workflow** → 填写订阅数（可选，留空则从 YouTube API 自动获取）

3. 等待约 2-3 分钟

4. 运行完成后：
   - `dist/banner.png` 自动 commit 到仓库
   - 在 Actions 页面 → **Artifacts** 下载 `olympicmotion-banner.zip`

---

### 第六步：在 YouTube 设置频道 Banner

1. 下载 `dist/banner.png`（2560×423 px）

2. YouTube Studio → **自定义** → **品牌推广** → **横幅图片**

3. 上传 `banner.png` → 裁剪预览（YouTube 会自动应用 safe area）

4. **发布**

---

### 自动更新流程（设置好后全自动）

```
每 6 小时
    ↓
GitHub Actions 触发
    ↓
从 YouTube API 拉取最新订阅数
    ↓
更新 banner.config.json 中的 subs 字段
    ↓
Playwright 访问 Cloudflare Pages 截图
    ↓
dist/banner.png commit 回 GitHub
    ↓
手动下载或通过 API 获取最新 banner
```

---

## Cloudflare Worker（可选，API 端点）

Worker 提供一个 REST API 查询当前 banner 状态：

```
GET https://olympicmotion-banner-engine.你的子域.workers.dev/api/banner-state?subs=46812&goal=1000000
```

返回：
```json
{
  "subscribers": 46812,
  "nextGoal": 50000,
  "pctToNext": 92.03,
  "toNext": 3188,
  "formatted": { "subscribers": "46812", "nextGoal": "50K", ... }
}
```

部署 Worker：
```bash
npx wrangler deploy
```

---

## Logo 替换

1. 准备一张 512×512 px 的圆形 Logo，保存为 `public/assets/logo.png`

2. 修改 `public/config/banner.config.json`：
```json
"logo": "/assets/logo.png"
```

3. 提交并推送，Cloudflare Pages 自动更新

---

## 常见问题

**Q: GitHub Actions 运行失败，报 "Could not start preview server"**
A: 确认 `BANNER_URL` Secret 已设置为 Cloudflare Pages 地址，不需要本地启动服务器。

**Q: YouTube API 返回 0**
A: 检查 API Key 是否启用了 YouTube Data API v3；Channel ID 是否以 `UC` 开头。

**Q: banner.png 尺寸不对**
A: 导出器固定裁切 `.banner-stage` 元素，输出 2560×423 px。YouTube 要求最小 2048×1152，建议上传原始 2560 宽度版本。
