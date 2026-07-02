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
// bg.png is a native YouTube full-size banner (2560×1440 or similar)
// Fall back to old background.png if bg.png not found
const BG_NEW = resolve(ROOT, "public/assets/bg.png");
const BG_OLD = resolve(ROOT, "public/assets/background.png");
const BG     = existsSync(BG_NEW) ? BG_NEW : BG_OLD;
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

// Sort milestones ascending — never mutate the original array
const milestones = (CONFIG.achievements ?? [])
  .map(a => Number(a.threshold))
  .sort((a, b) => a - b);

const maxMilestone = Math.max(...milestones, goal);
const goalReached  = subs >= maxMilestone;

// Next milestone above subs (or goal as fallback)
const autoNext = goalReached
  ? maxMilestone
  : (milestones.find(t => t > subs) ?? goal);

// Previous milestone ≤ subs (highest one already reached, 0 if none)
// Use a non-mutating filter+last approach
const prevMile = goalReached
  ? milestones[milestones.length - 1] ?? 0
  : (milestones.filter(t => t <= subs).pop() ?? 0);

// When subs exactly equals a milestone, that segment is just starting (0%)
// so prevMile = subs, segSize = autoNext - subs → correct 0% for new segment
const segSize   = Math.max(1, autoNext - prevMile);
const rawPct    = goalReached ? 100 : ((subs - prevMile) / segSize) * 100;
const pctToNext = Math.min(100, Math.max(0, rawPct));
const toGo      = goalReached ? 0 : Math.max(0, autoNext - subs);

const fmtPlain = n => new Intl.NumberFormat("en-US", { useGrouping: false }).format(n);
const compact  = n => n >= 1000000 ? (n/1000000).toFixed(0)+"M"
                    : n >= 1000    ? (n/1000).toFixed(0)+"K"
                    : String(n);

console.log(`Subs: ${subs} | Next: ${compact(autoNext)} | Prev: ${compact(prevMile)} | Seg: ${compact(segSize)} | Pct: ${pctToNext.toFixed(2)}% | ToGo: ${toGo} | GoalReached: ${goalReached}`);

// ── Background dimensions ─────────────────────────────────────────────────
const meta = await sharp(BG).metadata();
const BW = meta.width  ?? 1983;
const BH = meta.height ?? 793;

// ── Load layout from config ───────────────────────────────────────────────
const layout = CONFIG.v2Layout ?? {};
const PBcfg  = layout.progressBar  ?? {};
const NGcfg  = layout.toGoBox      ?? {};
const BRcfg  = layout.badgeRow     ?? {};
const FSCfg  = PBcfg.fillStyle     ?? {};
const CKCfg  = BRcfg.checkmark     ?? {};
const SNcfg  = PBcfg.subsNumber    ?? {};

const PB = {
  x: PBcfg.x ?? 725, y: PBcfg.y ?? 329,
  w: PBcfg.w ?? 530, h: PBcfg.h ?? 117,
  r:   PBcfg.cornerRadius     ?? 8,
  fr:  PBcfg.fillCornerRadius ?? 12,
  numOX: SNcfg.offsetX    ?? 0.5,
  numOY: SNcfg.offsetY    ?? 0.7,
  numFS: SNcfg.fontSize   ?? 70,
  numColor:  SNcfg.color      ?? "#ffffff",
  numFamily: SNcfg.fontFamily ?? "Arial Black,Impact,sans-serif",
  numWeight: SNcfg.fontWeight ?? "900",
  numLS:     SNcfg.letterSpacing ?? -2,
  numShadow: SNcfg.shadowBlur    ?? 6,
  shimmerOp: FSCfg.shimmerOpacity ?? 0.18,
  glowColor: FSCfg.glowColor      ?? "rgba(255,200,50,0.55)",
  glowBlur:  FSCfg.glowBlur       ?? 8,
};

const NG = {
  x: NGcfg.x ?? 1276, y: NGcfg.y ?? 323,
  w: NGcfg.w ?? 118,  h: NGcfg.h ?? 78,
  oX: NGcfg.numberOffsetX ?? 0.5,
  oY: NGcfg.numberOffsetY ?? 0.85,
  fs: NGcfg.fontSize    ?? 80,
  maxFS:     NGcfg.maxFontSize      ?? 80,
  minFS:     NGcfg.minFontSize      ?? 22,
  autoShrink:NGcfg.autoShrink       ?? true,
  compact:   NGcfg.useCompactFormat ?? true,
  compactThr:NGcfg.compactThreshold ?? 99999,
  color:     NGcfg.color     ?? "#ffc94a",
  family:    NGcfg.fontFamily ?? "Arial Black,Impact,sans-serif",
  weight:    NGcfg.fontWeight ?? "900",
};

const BADGE_ROW = {
  x0:    BRcfg.x0        ?? 796,
  y:     BRcfg.y         ?? 162,
  step:  BRcfg.step      ?? 168,
  size:  BRcfg.size      ?? 50,
  labelY: BRcfg.labelY   ?? 208,
  captY:  BRcfg.captionY ?? 223,
  lblFS:  BRcfg.labelFontSize    ?? 13,
  capFS:  BRcfg.captionFontSize  ?? 9,
  lblColor:   BRcfg.labelColor          ?? "#ffc94a",
  capColor:   BRcfg.captionColor        ?? "rgba(255,255,255,0.70)",
  lockOp:     BRcfg.lockedOpacity       ?? 0.55,
  lockLbl:    BRcfg.lockedLabelColor    ?? "rgba(255,201,74,0.55)",
  lockCap:    BRcfg.lockedCaptionColor  ?? "rgba(255,255,255,0.40)",
  ck: {
    ox:  CKCfg.offsetX        ?? -0.32,
    oy:  CKCfg.offsetY        ?? 0,
    sx:  CKCfg.scaleX         ?? 0.28,
    sy:  CKCfg.scaleY         ?? 0.28,
    ax:  CKCfg.armX           ?? 0.62,
    ay:  CKCfg.armY           ?? -0.78,
    color: CKCfg.strokeColor      ?? "#1a1200",
    wRatio: CKCfg.strokeWidthRatio ?? 0.10,
  },
};

// ── Build SVG overlay ─────────────────────────────────────────────────────
const fillW = Math.round(PB.w * pctToNext / 100);

// Auto-shrink or compact for TO GO number
function toGoDisplay(n) {
  if (goalReached) return "✓";
  if (NG.compact && n > NG.compactThr) {
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
    if (n >= 1000)    return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  }
  return fmtPlain(n);
}

function autoFontSize(text, maxW, maxFS, minFS) {
  if (!NG.autoShrink) return maxFS;
  // Estimate: Arial Black ~0.65× of font-size per char
  const charW = maxFS * 0.65;
  const needed = text.length * charW;
  if (needed <= maxW) return maxFS;
  const computed = Math.floor(maxW / (text.length * 0.65));
  return Math.max(minFS, Math.min(maxFS, computed));
}

const toGoText = toGoDisplay(toGo);
const toGoFS   = goalReached ? Math.round(NG.maxFS * 0.9)
                             : autoFontSize(toGoText, NG.w * 0.92, NG.maxFS, NG.minFS);

const badges = CONFIG.achievements ?? [];
function badgeSVG(b, i) {
  const unlocked = subs >= Number(b.threshold);
  // Hidden badges are completely omitted — no SVG rendered, background shows through
  if (!unlocked) return "";

  const cx = BADGE_ROW.x0 + i * BADGE_ROW.step;
  const cy = BADGE_ROW.y;
  const sz = BADGE_ROW.size;
  const r  = sz * 0.5;
  const ck = BADGE_ROW.ck;

  return `
    <g>
      <path d="M${cx} ${cy-r+2} L${cx+r-2} ${cy-r*0.48} v${r*0.88} c0 ${r*0.46} -${r*0.36} ${r*0.78} -${r-2} ${r*0.96} c-${r*0.58} -${r*0.18} -${r-2} -${r*0.50} -${r-2} -${r*0.96} V${cy-r*0.48} Z"
        fill="url(#gld)" stroke="#ffe896" stroke-width="1.5" filter="url(#glow)"/>
      <path d="M${cx+r*ck.ox} ${cy+r*ck.oy} l${r*ck.sx} ${r*ck.sy} l${r*ck.ax} ${r*ck.ay}"
        fill="none" stroke="${ck.color}" stroke-width="${sz*ck.wRatio}"
        stroke-linecap="round" stroke-linejoin="round"/>
      <text x="${cx}" y="${BADGE_ROW.labelY}" text-anchor="middle"
        font-family="Arial Black,Impact,sans-serif" font-weight="900"
        font-size="${BADGE_ROW.lblFS}" fill="${BADGE_ROW.lblColor}">${b.label}</text>
      <text x="${cx}" y="${BADGE_ROW.captY}" text-anchor="middle"
        font-family="Arial,sans-serif" font-size="${BADGE_ROW.capFS}"
        fill="${BADGE_ROW.capColor}">SUBSCRIBERS</text>
    </g>`;
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${BW}" height="${BH}">
<defs>
  <linearGradient id="pgrd" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0"    stop-color="#fffae8"/>
    <stop offset="0.20" stop-color="#ffd95a"/>
    <stop offset="0.55" stop-color="#ffc233"/>
    <stop offset="1"    stop-color="#a85f00"/>
  </linearGradient>
  <linearGradient id="pgrdV" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0"   stop-color="rgba(255,255,255,0.30)"/>
    <stop offset="0.4" stop-color="rgba(255,255,255,0.00)"/>
    <stop offset="1"   stop-color="rgba(0,0,0,0.20)"/>
  </linearGradient>
  <linearGradient id="gld" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0"    stop-color="#fffae8"/>
    <stop offset="0.15" stop-color="#ffd95a"/>
    <stop offset="0.45" stop-color="#ffc233"/>
    <stop offset="0.72" stop-color="#f5a615"/>
    <stop offset="1"    stop-color="#a85f00"/>
  </linearGradient>
  <filter id="shadow">
    <feDropShadow dx="0" dy="2" stdDeviation="${PB.numShadow}" flood-color="rgba(0,0,0,0.95)"/>
  </filter>
  <filter id="glow">
    <feGaussianBlur stdDeviation="${PB.glowBlur * 0.5}" result="b"/>
    <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <filter id="pbGlow">
    <feGaussianBlur stdDeviation="${PB.glowBlur}" result="blur"/>
    <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <clipPath id="pbClip">
    <rect x="${PB.x}" y="${PB.y}" width="${PB.w}" height="${PB.h}" rx="${PB.fr}"/>
  </clipPath>
</defs>

<!-- ── PROGRESS BAR: gold fill ── -->
<!-- outer glow -->
<rect x="${PB.x-2}" y="${PB.y-2}" width="${Math.min(fillW+4, PB.w+4)}" height="${PB.h+4}"
  rx="${PB.fr+2}" fill="${PB.glowColor}" filter="url(#pbGlow)" opacity="0.7"
  clip-path="url(#pbClip)"/>
<!-- main fill -->
<rect x="${PB.x}" y="${PB.y}" width="${fillW}" height="${PB.h}" rx="${PB.fr}"
  fill="url(#pgrd)" clip-path="url(#pbClip)"/>
<!-- vertical highlight on fill (top sheen) -->
<rect x="${PB.x}" y="${PB.y}" width="${fillW}" height="${PB.h}"
  rx="${PB.fr}" fill="url(#pgrdV)" clip-path="url(#pbClip)" opacity="0.8"/>
<!-- shimmer stripes -->
<g clip-path="url(#pbClip)" opacity="${PB.shimmerOp}">
  ${Array.from({length:28},(_,i)=>`<rect x="${PB.x+i*22-4}" y="${PB.y}" width="11" height="${PB.h}" fill="white" transform="skewX(-16)"/>`).join("")}
</g>
<!-- right-edge fade -->
<rect x="${PB.x + fillW - 18}" y="${PB.y}" width="20" height="${PB.h}"
  fill="rgba(0,0,0,0.12)" clip-path="url(#pbClip)"/>

<!-- ── SUBSCRIBER NUMBER ── -->
<text x="${PB.x + PB.w * PB.numOX}" y="${PB.y + PB.h * PB.numOY}"
  text-anchor="middle"
  font-family="${PB.numFamily}" font-weight="${PB.numWeight}"
  font-size="${PB.numFS}" fill="${PB.numColor}" filter="url(#shadow)"
  letter-spacing="${PB.numLS}">${fmtPlain(subs)}</text>

<!-- ── TO GO number (auto-size, compact if needed) ── -->
<text x="${NG.x + NG.w * NG.oX}" y="${NG.y + NG.h * NG.oY}"
  text-anchor="middle"
  font-family="${NG.family}" font-weight="${NG.weight}"
  font-size="${toGoFS}" fill="${NG.color}" filter="url(#glow)">${toGoText}</text>

<!-- ── BADGES ── -->
${badges.map(badgeSVG).join("\n")}

</svg>`;

// ── Composite onto background ─────────────────────────────────────────────
console.log("🎨 合成 Banner v2...");
console.log(`   使用背景图：${BG.replace(ROOT, "").replace(/\\/g, "/")}`);

await sharp(BG)
  .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
  .png({ quality: 95 })
  .toFile(OUTPUT);

console.log(`✓ Banner v2 (${BW}×${BH}) → dist/banner-v2.png`);

// ── Full 2560×1440 for YouTube ────────────────────────────────────────────
// bg.png has the correct 16:9 YouTube aspect ratio.
// Scale the composited banner up to 2560×1440 — SVG coordinates scale proportionally.
const FULL_W = 2560;
const FULL_H = 1440;
const scaleX = FULL_W / BW;   // e.g. 2560/1642 ≈ 1.559
const scaleH = FULL_H / BH;   // e.g. 1440/923  ≈ 1.560

// Re-render SVG at full 2560×1440 resolution by scaling all coordinates
const svgFull = `<svg xmlns="http://www.w3.org/2000/svg" width="${FULL_W}" height="${FULL_H}">` +
  svg.slice(svg.indexOf(">") + 1, svg.lastIndexOf("</svg>"))
    .replace(/\b(\d+(?:\.\d+)?)(px)?\b/g, (m, n, px) => px ? m : m) // keep as-is, Sharp handles pixel scaling
  + "</svg>";

// Simplest & most accurate: upscale the composited output to 2560×1440
await sharp(OUTPUT)
  .resize(FULL_W, FULL_H, { fit: "fill" })
  .png({ quality: 95 })
  .toFile(FULL);

console.log(`✓ Full banner (${FULL_W}×${FULL_H}) → dist/banner-v2-full.png`);
