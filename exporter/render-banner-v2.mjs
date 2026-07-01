/**
 * Banner Exporter v2 — Sharp 精准坐标合成
 * 只在 background.png 的精确位置叠加动态数据：
 *   1. 进度条（金色填充 + 当前订阅数居中 + 百分比）
 *   2. 徽章解锁状态
 *
 * 坐标系基于 background.png 原始尺寸 1983×793
 */

import sharp from "sharp";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname }                     from "node:path";
import { fileURLToPath }                        from "node:url";

const ROOT   = resolve(fileURLToPath(new URL("../", import.meta.url)));
const CONFIG = JSON.parse(readFileSync(resolve(ROOT, "public/config/banner.config.json"), "utf8"));
const BG     = resolve(ROOT, "public/assets/background.png");
const OUTPUT = resolve(ROOT, "dist/banner-v2.png");
const FULL   = resolve(ROOT, "dist/banner-v2-full.png");

mkdirSync(dirname(OUTPUT), { recursive: true });

if (!existsSync(BG)) {
  console.error("❌ background.png not found:", BG);
  process.exit(1);
}

// ── Data ──────────────────────────────────────────────────────────────────
const subs       = Number(CONFIG.data?.subs ?? 0);
const goal       = Number(CONFIG.mission?.goal ?? 1000000);
const milestones = (CONFIG.achievements ?? []).map(a => Number(a.threshold));
const autoNext   = milestones.find(t => t > subs) ?? goal;
const prevMile   = [...milestones].reverse().find(t => t <= subs) ?? 0;
const segSize    = autoNext - prevMile;
const pctToNext  = Math.min(100, segSize > 0 ? ((subs - prevMile) / segSize) * 100 : 100);
const toGo       = autoNext - subs;

const fmtPlain = n => new Intl.NumberFormat("en-US", { useGrouping: false }).format(n);
const compact  = n => n >= 1000000 ? (n/1000000).toFixed(0)+"M"
                    : n >= 1000    ? (n/1000).toFixed(0)+"K"
                    : String(n);

console.log(`Subs: ${subs} | Next: ${compact(autoNext)} | Prev: ${compact(prevMile)} | Pct: ${pctToNext.toFixed(1)}%`);

// ── Background dimensions ─────────────────────────────────────────────────
const meta = await sharp(BG).metadata();
const BW = meta.width  ?? 1983;
const BH = meta.height ?? 793;

// ── COORDINATE MAP (1983×793) — verified from annotated screenshot ───────
// Green box = progress bar track
const PB = {
  x: 537,   // left edge
  y: 373,   // top edge
  w: 412,   // width
  h: 54,    // height
  r: 8,
};

// Blue box = "TO GO!" number area (next-goal distance)
const NG = {
  x: 963,   // left edge
  y: 360,   // top edge
  w: 148,   // width
  h: 85,    // height
};

// Red box = achievements badge row
// 7 badges, row starts at x≈712, width≈1175
const BADGE_ROW = {
  x0:    796,    // center of first badge (712 + 1175/7/2 ≈ 796)
  y:      162,   // vertical center (y=115 + 95/2)
  step:   168,   // 1175/7
  size:    50,
  labelY: 208,
  captY:  223,
};

// ── Build SVG overlay ─────────────────────────────────────────────────────
const fillW = Math.round(PB.w * pctToNext / 100);

// Badge SVG helper
const badges = CONFIG.achievements ?? [];
function badgeSVG(b, i) {
  const unlocked = subs >= Number(b.threshold);
  const cx = BADGE_ROW.x0 + i * BADGE_ROW.step;
  const cy = BADGE_ROW.y;
  const sz = BADGE_ROW.size;
  const r  = sz * 0.5;

  if (unlocked) {
    // Gold filled shield with checkmark
    return `
    <g>
      <path d="M${cx} ${cy-r+2} L${cx+r-2} ${cy-r*0.48} v${r*0.88} c0 ${r*0.46} -${r*0.36} ${r*0.78} -${r-2} ${r*0.96} c-${r*0.58} -${r*0.18} -${r-2} -${r*0.50} -${r-2} -${r*0.96} V${cy-r*0.48} Z"
        fill="url(#gld)" stroke="#ffe896" stroke-width="1.5" filter="url(#glow)"/>
      <path d="M${cx-r*0.32} ${cy} l${r*0.28} ${r*0.28} l${r*0.62} -${r*0.78}"
        fill="none" stroke="#1a1200" stroke-width="${sz*0.10}" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="${cx}" y="${BADGE_ROW.labelY}" text-anchor="middle"
        font-family="Arial Black,Impact,sans-serif" font-weight="900"
        font-size="13" fill="#ffc94a">${b.label}</text>
      <text x="${cx}" y="${BADGE_ROW.captY}" text-anchor="middle"
        font-family="Arial,sans-serif" font-size="9" fill="rgba(255,255,255,0.70)">SUBSCRIBERS</text>
    </g>`;
  } else {
    // Locked — dim shield with padlock
    return `
    <g opacity="0.55">
      <path d="M${cx} ${cy-r+2} L${cx+r-2} ${cy-r*0.48} v${r*0.88} c0 ${r*0.46} -${r*0.36} ${r*0.78} -${r-2} ${r*0.96} c-${r*0.58} -${r*0.18} -${r-2} -${r*0.50} -${r-2} -${r*0.96} V${cy-r*0.48} Z"
        fill="rgba(30,22,6,0.88)" stroke="rgba(255,201,74,0.32)" stroke-width="1.2"/>
      <rect x="${cx-r*0.26}" y="${cy-r*0.08}" width="${r*0.52}" height="${r*0.46}" rx="2" fill="rgba(255,255,255,0.55)"/>
      <rect x="${cx-r*0.22}" y="${cy-r*0.26}" width="${r*0.44}" height="${r*0.24}" rx="${r*0.10}"
        fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="1.5"/>
      <text x="${cx}" y="${BADGE_ROW.labelY}" text-anchor="middle"
        font-family="Arial Black,Impact,sans-serif" font-weight="900"
        font-size="13" fill="rgba(255,201,74,0.55)">${b.label}</text>
      <text x="${cx}" y="${BADGE_ROW.captY}" text-anchor="middle"
        font-family="Arial,sans-serif" font-size="9" fill="rgba(255,255,255,0.40)">SUBSCRIBERS</text>
    </g>`;
  }
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${BW}" height="${BH}">
<defs>
  <linearGradient id="pgrd" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0"    stop-color="#fffae8"/>
    <stop offset="0.20" stop-color="#ffd95a"/>
    <stop offset="0.55" stop-color="#ffc233"/>
    <stop offset="1"    stop-color="#a85f00"/>
  </linearGradient>
  <linearGradient id="gld" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0"    stop-color="#fffae8"/>
    <stop offset="0.15" stop-color="#ffd95a"/>
    <stop offset="0.45" stop-color="#ffc233"/>
    <stop offset="0.72" stop-color="#f5a615"/>
    <stop offset="1"    stop-color="#a85f00"/>
  </linearGradient>
  <filter id="shadow">
    <feDropShadow dx="0" dy="2" stdDeviation="5" flood-color="rgba(0,0,0,0.95)"/>
  </filter>
  <filter id="glow">
    <feGaussianBlur stdDeviation="3" result="b"/>
    <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <clipPath id="pbClip">
    <rect x="${PB.x}" y="${PB.y}" width="${PB.w}" height="${PB.h}" rx="${PB.r}"/>
  </clipPath>
</defs>

<!-- ── PROGRESS BAR: gold fill to pctToNext% ── -->
<rect x="${PB.x}" y="${PB.y}" width="${fillW}" height="${PB.h}" rx="${PB.r}"
  fill="url(#pgrd)" clip-path="url(#pbClip)"/>
<!-- shimmer stripes on fill -->
<g clip-path="url(#pbClip)" opacity="0.14">
  ${Array.from({length:24},(_,i)=>`<rect x="${PB.x+i*19}" y="${PB.y}" width="9" height="${PB.h}" fill="white" transform="skewX(-14)"/>`).join("")}
</g>

<!-- ── SUBSCRIBER NUMBER centered in progress bar ── -->
<text x="${PB.x + PB.w * 0.5}" y="${PB.y + PB.h * 0.72}"
  text-anchor="middle"
  font-family="Arial Black,Impact,sans-serif" font-weight="900"
  font-size="34" fill="white" filter="url(#shadow)"
  letter-spacing="-1">${fmtPlain(subs)}</text>

<!-- ── TO GO number in blue box area ── -->
<text x="${NG.x + NG.w * 0.5}" y="${NG.y + NG.h * 0.52}"
  text-anchor="middle"
  font-family="Arial Black,Impact,sans-serif" font-weight="900"
  font-size="32" fill="url(#gld)" filter="url(#glow)">${fmtPlain(toGo)}</text>

<!-- ── BADGES ── -->
${badges.map(badgeSVG).join("\n")}

</svg>`;

// ── Composite onto background ─────────────────────────────────────────────
console.log("🎨 合成 Banner v2...");

await sharp(BG)
  .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
  .png({ quality: 95 })
  .toFile(OUTPUT);

console.log(`✓ Banner v2 (${BW}×${BH}) → dist/banner-v2.png`);

// ── Full 2560×1440 for YouTube ────────────────────────────────────────────
const ratio    = BH / BW;
const FULL_W   = 2560;
const FULL_H   = 1440;
const BANNER_H = Math.round(FULL_W * ratio);
const TOP_Y    = Math.round((FULL_H - BANNER_H) / 2);

await sharp({
  create: { width: FULL_W, height: FULL_H, channels: 4,
            background: { r:0, g:0, b:0, alpha:1 } }
}).composite([{
  input: await sharp(OUTPUT).resize(FULL_W, BANNER_H).toBuffer(),
  top: TOP_Y, left: 0,
}])
.png({ quality: 95 })
.toFile(FULL);

console.log(`✓ Full banner (${FULL_W}×${FULL_H}) → dist/banner-v2-full.png`);
