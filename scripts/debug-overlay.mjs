/**
 * 在 banner-v2.png 上标注关键坐标，用于校准
 */
import sharp from "sharp";
import { resolve, dirname } from "node:path";
import { fileURLToPath }    from "node:url";
import { mkdirSync }        from "node:fs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SRC  = resolve(ROOT, "dist/banner-v2.png");
const OUT  = resolve(ROOT, "dist/banner-v2-debug.png");

const meta = await sharp(SRC).metadata();
const W = meta.width, H = meta.height;

// Draw coordinate markers at key positions
const PB = { x:537, y:378, w:403, h:68 };
const BADGE_X0 = 1243, BADGE_Y = 185, BADGE_STEP = 106;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <!-- Progress bar outline marker -->
  <rect x="${PB.x}" y="${PB.y}" width="${PB.w}" height="${PB.h}" 
    fill="none" stroke="lime" stroke-width="2" stroke-dasharray="6,3"/>
  <text x="${PB.x}" y="${PB.y-5}" font-size="14" fill="lime" font-family="monospace"
    >(${PB.x},${PB.y}) w=${PB.w} h=${PB.h}</text>
  
  <!-- Badge positions -->
  ${Array.from({length:7},(_,i)=>{
    const cx = BADGE_X0 + i*BADGE_STEP;
    return `<circle cx="${cx}" cy="${BADGE_Y}" r="30" fill="none" stroke="red" stroke-width="2" stroke-dasharray="4,2"/>
            <text x="${cx}" y="${BADGE_Y-35}" text-anchor="middle" font-size="11" fill="red" font-family="monospace">${cx},${BADGE_Y}</text>`;
  }).join("")}
  
  <!-- Grid every 100px -->
  ${Array.from({length:20},(_,i)=>{
    const x = i*100;
    return `<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="rgba(255,255,0,0.2)" stroke-width="0.5"/>
            <text x="${x+2}" y="10" font-size="9" fill="yellow" font-family="monospace">${x}</text>`;
  }).join("")}
  ${Array.from({length:8},(_,i)=>{
    const y = i*100;
    return `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="rgba(255,255,0,0.2)" stroke-width="0.5"/>
            <text x="2" y="${y+9}" font-size="9" fill="yellow" font-family="monospace">${y}</text>`;
  }).join("")}
</svg>`;

await sharp(SRC)
  .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
  .toFile(OUT);

console.log(`✓ Debug overlay → ${OUT}`);
