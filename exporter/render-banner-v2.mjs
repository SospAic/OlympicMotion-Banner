/**
 * Banner Exporter v2 — Sharp 图片合成版本
 * 以 public/assets/background.png 为底图，直接合成所有元素
 * 不依赖 Playwright/浏览器，速度更快
 *
 * 用法：node exporter/render-banner-v2.mjs
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
const subs        = Number(CONFIG.data?.subs ?? 0);
const goal        = Number(CONFIG.mission?.goal ?? 1000000);
const milestones  = (CONFIG.achievements ?? []).map(a => Number(a.threshold));
const autoNext    = milestones.find(t => t > subs) ?? goal;
const prevMile    = [...milestones].reverse().find(t => t <= subs) ?? 0;
const pctToNext   = Math.min(100, ((subs - prevMile) / (autoNext - prevMile)) * 100);
const toGo        = autoNext - subs;

const fmt = n => new Intl.NumberFormat("en-US", {useGrouping:false}).format(n);
const fmtComma = n => new Intl.NumberFormat("en-US").format(n);
const compact = n => n >= 1000000 ? (n/1000000).toFixed(0)+"M" : n >= 1000 ? (n/1000).toFixed(0)+"K" : String(n);

// ── Canvas dimensions (match background.png proportions) ─────────────────
// Background is 1920×537 — we'll work at that size then crop/scale
const meta   = await sharp(BG).metadata();
const BW     = meta.width  ?? 1920;
const BH     = meta.height ?? 537;

console.log(`Background: ${BW}×${BH}`);

// ── Color palette ─────────────────────────────────────────────────────────
const GOLD    = "#ffc94a";
const GOLD2   = "#ffbd2e";
const WHITE   = "#ffffff";
const DIM     = "rgba(255,255,255,0.75)";
const DARK    = "rgba(0,0,0,0.75)";
const PANEL   = "rgba(10,8,4,0.82)";
const BORDER  = "rgba(255,201,74,0.55)";

// Scale factor so all coordinates below are designed for 1546px width
const SC = BW / 1546;
const s  = v => Math.round(v * SC);  // scale a value
const sh = v => Math.round(v * SC);  // same, explicit

// ── Achievement badges ────────────────────────────────────────────────────
function badgeSVG(label, caption, unlocked, x, y, size) {
  const fill    = unlocked ? "url(#bg)" : "rgba(30,24,8,0.85)";
  const stroke  = unlocked ? "#ffc94a" : "rgba(255,201,74,0.35)";
  const iconClr = unlocked ? "#1a1200" : "rgba(255,255,255,0.50)";
  const textClr = unlocked ? "#ffc94a" : "rgba(255,255,255,0.55)";
  const subtClr = unlocked ? "rgba(255,255,255,0.70)" : "rgba(255,255,255,0.35)";
  const r = size * 0.5;
  return `
  <defs>
    <linearGradient id="bg${label}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff4b8"/>
      <stop offset="0.45" stop-color="#ffc233"/>
      <stop offset="1" stop-color="#9a5f06"/>
    </linearGradient>
  </defs>
  <g transform="translate(${x},${y})">
    <path d="M${r} 2 L${size-2} ${size*0.32} v${size*0.35} c0 ${size*0.18} -${size*0.14} ${size*0.30} -${r} ${size*0.37} C${size*0.14} ${size*0.97} 2 ${size*0.85} 2 ${size*0.67} V${size*0.32} Z"
      fill="${unlocked ? `url(#bg${label})` : fill}" stroke="${stroke}" stroke-width="1.5"/>
    ${unlocked
      ? `<path d="M${r*0.42} ${r*1.10} l${r*0.34} ${r*0.34} l${r*0.76} -${r*0.96}" fill="none" stroke="${iconClr}" stroke-width="${size*0.09}" stroke-linecap="round" stroke-linejoin="round"/>`
      : `<rect x="${r*0.62}" y="${r*0.90}" width="${r*0.76}" height="${r*0.70}" rx="2" fill="${iconClr}"/>
         <rect x="${r*0.72}" y="${r*0.72}" width="${r*0.56}" height="${r*0.28}" rx="${r*0.12}" fill="none" stroke="${iconClr}" stroke-width="1.5"/>`
    }
    <text x="${r}" y="${size+11}" text-anchor="middle" font-family="Arial Black,Impact,sans-serif" font-weight="900" font-size="${size*0.34}" fill="${textClr}">${label}</text>
    <text x="${r}" y="${size+20}" text-anchor="middle" font-family="Arial,sans-serif" font-size="${size*0.18}" fill="${subtClr}">${caption}</text>
  </g>`;
}

// ── Build SVG overlay ─────────────────────────────────────────────────────
// Layout zones (designed at 1546px width):
//  Left:   0  – 415   (brand)
//  Mid:  415  – 990   (mission + stats)
//  Right: 990 – 1546  (achievements)
//  Bottom: feature strip

const W = BW, H = BH;

// Mid panel dimensions
const MP_X = s(415), MP_W = s(575);
// Progress bar
const PB_X = s(420), PB_Y = s(220), PB_W = s(380), PB_H = s(60);
const FILL_W = Math.round(PB_W * pctToNext / 100);
// Next goal box
const NG_X = s(820), NG_Y = s(205), NG_W = s(145), NG_H = s(90);
// Badge row
const BAD_Y = s(55), BAD_SIZE = s(54), BAD_GAP = s(10);
const BAD_X0 = s(1000);
const badges = CONFIG.achievements ?? [];
const badgeSVGs = badges.map((b, i) => {
  const bx = BAD_X0 + i * (BAD_SIZE + BAD_GAP);
  return badgeSVG(b.label, b.caption.replace("Subscribers","SUBS"), subs >= b.threshold, bx, BAD_Y, BAD_SIZE);
}).join("");

// Feature strip icons (text only for simplicity)
const features = ["EPIC MOMENTS","UNTOLD STORIES","OLYMPIC LEGENDS","BEHIND THE SCENES","WEEKLY UPLOADS"];
const FY = H - s(28);
const fStrip = features.map((f, i) => {
  const fx = s(380) + i * s(120);
  return `<text x="${fx}" y="${FY}" font-family="Arial Narrow,Arial,sans-serif" font-weight="700" font-size="${s(11)}" fill="rgba(255,255,255,0.80)" letter-spacing="0.5">${f}</text>`;
}).join("");

// Social icons text
const socials = [
  { name:"YT",  color:"#FF0000" },
  { name:"IG",  color:"#E1306C" },
  { name:"TT",  color:"#ffffff" },
  { name:"X",   color:"#ffffff" },
];
const SOC_Y = H - s(42);
const SOC_X0 = s(1380);
const socSVG = socials.map((sc, i) => {
  const sx = SOC_X0 + i * s(38);
  return `
  <circle cx="${sx+s(14)}" cy="${SOC_Y+s(2)}" r="${s(14)}" fill="rgba(255,255,255,0.10)" stroke="rgba(255,201,74,0.40)" stroke-width="1"/>
  <text x="${sx+s(14)}" y="${SOC_Y+s(7)}" text-anchor="middle" font-family="Arial Black,sans-serif" font-weight="900" font-size="${s(9)}" fill="${sc.color}">${sc.name}</text>`;
}).join("");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
<defs>
  <linearGradient id="goldGrad" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#fffae8"/>
    <stop offset="0.15" stop-color="#ffd95a"/>
    <stop offset="0.45" stop-color="#ffc233"/>
    <stop offset="0.72" stop-color="#f5a615"/>
    <stop offset="1" stop-color="#a85f00"/>
  </linearGradient>
  <linearGradient id="progressGrad" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#fffae8"/>
    <stop offset="0.15" stop-color="#ffd95a"/>
    <stop offset="0.5" stop-color="#ffc233"/>
    <stop offset="1" stop-color="#a85f00"/>
  </linearGradient>
  <filter id="glow">
    <feGaussianBlur stdDeviation="3" result="blur"/>
    <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <filter id="textGlow">
    <feGaussianBlur stdDeviation="4" result="blur"/>
    <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <clipPath id="pbClip">
    <rect x="${PB_X}" y="${PB_Y}" width="${PB_W}" height="${PB_H}" rx="${s(10)}"/>
  </clipPath>
</defs>

<!-- ── MISSION KICKER ── -->
<text x="${s(698)}" y="${s(42)}" text-anchor="middle" font-family="Arial Narrow,Arial,sans-serif" font-weight="800" font-size="${s(13)}" fill="${GOLD}" letter-spacing="6">&#xBB; MISSION &#xAB;</text>

<!-- ── MISSION TITLE ── -->
<text x="${s(698)}" y="${s(82)}" text-anchor="middle" font-family="Arial Black,Impact,sans-serif" font-weight="900" font-size="${s(42)}" fill="${WHITE}" font-style="italic">ROAD TO </text>
<text x="${s(698)}" y="${s(82)}" text-anchor="middle" font-family="Arial Black,Impact,sans-serif" font-weight="900" font-size="${s(42)}" fill="transparent" font-style="italic">
  <tspan fill="${WHITE}">ROAD TO </tspan><tspan fill="url(#goldGrad)">1M</tspan><tspan fill="${WHITE}"> CHAMPIONS</tspan>
</text>

<!-- ── SUBSCRIBER CARD background ── -->
<rect x="${s(418)}" y="${s(100)}" width="${s(570)}" height="${s(200)}" rx="${s(14)}" fill="${PANEL}" stroke="${BORDER}" stroke-width="1.5"/>

<!-- ── SUBSCRIBER LABEL ── -->
<text x="${s(437)}" y="${s(128)}" font-family="Arial Narrow,Arial,sans-serif" font-weight="700" font-size="${s(13)}" fill="${GOLD}" letter-spacing="1">&#9679; SUBSCRIBERS</text>

<!-- ── BIG NUMBER ── -->
<text x="${s(600)}" y="${s(200)}" text-anchor="middle" font-family="Arial Black,Impact,sans-serif" font-weight="900" font-size="${s(72)}" fill="${WHITE}" filter="url(#textGlow)" letter-spacing="-2">${fmt(subs)}</text>

<!-- ── PROGRESS BAR track ── -->
<rect x="${PB_X}" y="${PB_Y}" width="${PB_W}" height="${PB_H}" rx="${s(10)}" fill="rgba(255,255,255,0.10)" stroke="rgba(255,255,255,0.45)" stroke-width="1.5"/>
<!-- fill -->
<rect x="${PB_X}" y="${PB_Y}" width="${FILL_W}" height="${PB_H}" rx="${s(10)}" fill="url(#progressGrad)" clip-path="url(#pbClip)"/>
<!-- stripe overlay -->
<g clip-path="url(#pbClip)">
  ${Array.from({length:20},(_,i)=>`<line x1="${PB_X+i*s(22)}" y1="${PB_Y}" x2="${PB_X+i*s(22)+s(10)}" y2="${PB_Y+PB_H}" stroke="rgba(255,255,255,0.12)" stroke-width="${s(8)}"/>`).join("")}
</g>
<!-- % text -->
<text x="${PB_X+PB_W-s(14)}" y="${PB_Y+PB_H*0.62}" text-anchor="end" font-family="Arial Black,sans-serif" font-weight="900" font-size="${s(22)}" fill="${WHITE}" text-shadow="0 2px 8px #000">${pctToNext.toFixed(1)}%</text>
<!-- target -->
<text x="${PB_X+PB_W/2}" y="${PB_Y+PB_H+s(15)}" text-anchor="middle" font-family="Arial Narrow,Arial,sans-serif" font-size="${s(11)}" fill="rgba(255,255,255,0.60)" letter-spacing="1">TARGET: ${fmtComma(goal)}</text>

<!-- ── NEXT GOAL box ── -->
<rect x="${NG_X}" y="${NG_Y}" width="${NG_W}" height="${NG_H}" rx="${s(10)}" fill="${PANEL}" stroke="${BORDER}" stroke-width="1.5"/>
<text x="${NG_X+NG_W/2}" y="${NG_Y+s(22)}" text-anchor="middle" font-family="Arial Narrow,Arial,sans-serif" font-weight="700" font-size="${s(11)}" fill="${GOLD}" letter-spacing="1">NEXT GOAL</text>
<text x="${NG_X+NG_W/2}" y="${NG_Y+s(60)}" text-anchor="middle" font-family="Arial Black,Impact,sans-serif" font-weight="900" font-size="${s(36)}" fill="url(#goldGrad)" filter="url(#glow)">${compact(autoNext)}</text>
<text x="${NG_X+NG_W/2}" y="${NG_Y+s(80)}" text-anchor="middle" font-family="Arial Narrow,Arial,sans-serif" font-style="italic" font-size="${s(11)}" fill="rgba(255,255,255,0.75)">${fmtComma(toGo)} TO GO!</text>

<!-- ── CTA STRIP ── -->
<rect x="${s(430)}" y="${s(310)}" width="${s(545)}" height="${s(46)}" rx="${s(6)}"
  fill="rgba(255,196,42,0.12)" stroke="rgba(255,201,74,0.75)" stroke-width="1.5"/>
<text x="${s(704)}" y="${s(340)}" text-anchor="middle" font-family="Arial Black,Impact,sans-serif" font-weight="900" font-size="${s(16)}" font-style="italic" fill="${WHITE}" letter-spacing="1">SUBSCRIBE &amp; BE PART OF </text>
<text x="${s(704)}" y="${s(340)}" text-anchor="middle" font-family="Arial Black,Impact,sans-serif" font-weight="900" font-size="${s(16)}" font-style="italic" fill="transparent">
  <tspan fill="${WHITE}">SUBSCRIBE &amp; BE PART OF </tspan><tspan fill="${GOLD2}">THE JOURNEY</tspan>
</text>

<!-- ── ACHIEVEMENTS TITLE ── -->
<text x="${s(1268)}" y="${s(32)}" text-anchor="middle" font-family="Arial Black,Impact,sans-serif" font-weight="900" font-size="${s(18)}" font-style="italic" fill="${GOLD}" letter-spacing="2">&#9733; &#9733; ACHIEVEMENTS &#9733; &#9733;</text>

<!-- ── BADGES ── -->
${badgeSVGs}

<!-- ── MANIFESTO ── -->
<text x="${s(1005)}" y="${s(195)}" font-family="Arial Black,Impact,sans-serif" font-weight="800" font-size="${s(14)}" font-style="italic" fill="${WHITE}" letter-spacing="0.5">ONE CHANNEL.</text>
<text x="${s(1005)}" y="${s(215)}" font-family="Arial Black,Impact,sans-serif" font-weight="800" font-size="${s(14)}" font-style="italic" fill="${WHITE}" letter-spacing="0.5">ONE MISSION.</text>
<text x="${s(1005)}" y="${s(235)}" font-family="Arial Black,Impact,sans-serif" font-weight="800" font-size="${s(14)}" font-style="italic" fill="${WHITE}" letter-spacing="0.5">MILLIONS OF STORIES.</text>
<text x="${s(1005)}" y="${s(258)}" font-family="Arial Black,Impact,sans-serif" font-weight="900" font-size="${s(14)}" font-style="italic" fill="${GOLD2}" letter-spacing="0.5">LET'S MAKE HISTORY TOGETHER!</text>

<!-- ── FOLLOW & CONNECT ── -->
<text x="${s(1390)}" y="${s(295)}" text-anchor="middle" font-family="Arial Narrow,Arial,sans-serif" font-weight="700" font-size="${s(10)}" fill="${GOLD}" letter-spacing="2">FOLLOW &amp; CONNECT</text>
${socSVG}

<!-- ── FEATURE STRIP ── -->
<line x1="${s(380)}" y1="${H-s(46)}" x2="${s(1180)}" y2="${H-s(46)}" stroke="rgba(255,201,74,0.20)" stroke-width="1"/>
${fStrip}

</svg>`;

// ── Composite ─────────────────────────────────────────────────────────────
console.log("🎨 合成 Banner v2...");

await sharp(BG)
  .resize(BW, BH)
  .composite([{
    input: Buffer.from(svg),
    top: 0,
    left: 0,
  }])
  .png({ quality: 95 })
  .toFile(OUTPUT);

console.log(`✓ Banner v2 (${BW}×${BH}) → dist/banner-v2.png`);

// Full 2560×1440 version for YouTube upload
const ratio   = BH / BW;
const FULL_W  = 2560;
const FULL_H  = 1440;
const BANNER_H = Math.round(FULL_W * ratio);
const TOP_Y   = Math.round((FULL_H - BANNER_H) / 2);

await sharp({ create: { width: FULL_W, height: FULL_H, channels: 4, background: { r:0,g:0,b:0,alpha:1 } } })
  .composite([{
    input: await sharp(OUTPUT).resize(FULL_W, BANNER_H).toBuffer(),
    top: TOP_Y,
    left: 0,
  }])
  .png({ quality: 95 })
  .toFile(FULL);

console.log(`✓ Full banner (${FULL_W}×${FULL_H}) → dist/banner-v2-full.png`);
