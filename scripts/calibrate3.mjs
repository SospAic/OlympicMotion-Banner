import sharp from "sharp";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const BG   = resolve(ROOT, "public/assets/background.png");
const OUT  = resolve(ROOT, "dist/calibrate3.png");
mkdirSync(resolve(ROOT, "dist"), { recursive: true });

const { width: W, height: H } = await sharp(BG).metadata();

// From calibrate screenshot analysis:
// Badges (red boxes) appear at top-right, starting ~x=700 in the SCALED display
// But the overlay labels show "B1(1261,190)" etc — those are from calibrate2.mjs
// The actual background shows badges at different y position

// From the calibrate.png screenshot (1983px wide displayed at ~1024px):
// Scale factor = 1983/1024 = 1.936
// Badge boxes appear at screen y≈65-100 → actual y = 65*1.936 ≈ 126 to 100*1.936 ≈ 194
// But the badge ICONS in background are the hexagon shapes in ACHIEVEMENTS section
// Let me measure from the actual background image more carefully

// The background image has these sections visible:
// - "ACHIEVEMENTS" title at top right → y ≈ 50-80
// - 7 hexagon badge outlines → y ≈ 115-195, x ≈ 715 to 1885

// Test positions based on direct pixel measurement
const tests = [
  // Try different y values for progress bar
  { label:"PB-test1", x:537, y:360, w:413, h:55, color:"lime" },
  { label:"PB-test2", x:537, y:380, w:413, h:55, color:"cyan" },
  { label:"PB-test3", x:537, y:400, w:413, h:55, color:"magenta" },
  // Badge positions  
  { label:"Badge-row", x:712, y:115, w:1175, h:95, color:"red" },
];

const rects = tests.map(t => `
  <rect x="${t.x}" y="${t.y}" width="${t.w}" height="${t.h}"
    fill="rgba(128,128,128,0.15)" stroke="${t.color}" stroke-width="2" stroke-dasharray="6,3"/>
  <text x="${t.x+2}" y="${t.y>20?t.y-4:t.y+12}" font-size="11" fill="${t.color}"
    font-family="monospace" font-weight="bold">${t.label} y=${t.y}</text>
`).join("");

// Fine grid every 50px
const gv = Array.from({length:40},(_,i)=>`
  <line x1="${i*50}" y1="0" x2="${i*50}" y2="${H}"
    stroke="${i%2===0?'rgba(255,255,0,0.35)':'rgba(255,255,0,0.15)'}" stroke-width="${i%2===0?'0.8':'0.4'}"/>
  ${i%2===0?`<text x="${i*50+1}" y="18" font-size="10" fill="yellow" font-family="monospace">${i*50}</text>`:''}
`).join("");

const gh = Array.from({length:16},(_,i)=>`
  <line x1="0" y1="${i*50}" x2="${W}" y2="${i*50}"
    stroke="${i%2===0?'rgba(255,255,0,0.35)':'rgba(255,255,0,0.15)'}" stroke-width="${i%2===0?'0.8':'0.4'}"/>
  ${i%2===0?`<text x="1" y="${i*50+10}" font-size="10" fill="yellow" font-family="monospace">${i*50}</text>`:''}
`).join("");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
${gv}${gh}${rects}
</svg>`;

await sharp(BG).composite([{input:Buffer.from(svg),top:0,left:0}]).toFile(OUT);
console.log(`✓ ${OUT}`);
