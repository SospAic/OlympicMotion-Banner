import sharp from "sharp";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const BG   = resolve(ROOT, "public/assets/background.png");
const OUT  = resolve(ROOT, "dist/calibrate2.png");
mkdirSync(resolve(ROOT, "dist"), { recursive: true });

const meta = await sharp(BG).metadata();
const W = meta.width, H = meta.height;

// Mark current estimated positions
const PB = { x:535, y:448, w:413, h:68 };
const BADGE_X0 = 1261, BADGE_Y = 190, BADGE_STEP = 107, BADGE_SIZE = 52;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <!-- Grid 100px -->
  ${Array.from({length:20},(_,i)=>`
    <line x1="${i*100}" y1="0" x2="${i*100}" y2="${H}" stroke="rgba(255,255,0,0.20)" stroke-width="0.5"/>
    <text x="${i*100+1}" y="10" font-size="9" fill="yellow" font-family="monospace">${i*100}</text>
  `).join("")}
  ${Array.from({length:9},(_,i)=>`
    <line x1="0" y1="${i*100}" x2="${W}" y2="${i*100}" stroke="rgba(255,255,0,0.20)" stroke-width="0.5"/>
    <text x="1" y="${i*100+9}" font-size="9" fill="yellow" font-family="monospace">${i*100}</text>
  `).join("")}

  <!-- Progress bar position -->
  <rect x="${PB.x}" y="${PB.y}" width="${PB.w}" height="${PB.h}"
    fill="rgba(0,255,0,0.25)" stroke="lime" stroke-width="2"/>
  <text x="${PB.x+2}" y="${PB.y-3}" font-size="11" fill="lime" font-family="monospace"
    font-weight="bold">PB (${PB.x},${PB.y}) ${PB.w}×${PB.h}</text>

  <!-- Subscriber number (center of PB) -->
  <circle cx="${PB.x + PB.w*0.42}" cy="${PB.y + PB.h*0.5}" r="4" fill="cyan"/>
  <text x="${PB.x + PB.w*0.42}" y="${PB.y + PB.h*0.5 - 6}" text-anchor="middle"
    font-size="10" fill="cyan" font-family="monospace">NUM</text>

  <!-- Badges -->
  ${Array.from({length:7},(_,i)=>{
    const cx = BADGE_X0 + i*BADGE_STEP;
    const cy = BADGE_Y;
    const half = BADGE_SIZE/2;
    return `
      <rect x="${cx-half}" y="${cy-half}" width="${BADGE_SIZE}" height="${BADGE_SIZE}"
        fill="rgba(255,0,0,0.25)" stroke="red" stroke-width="1.5"/>
      <text x="${cx}" y="${cy-half-3}" text-anchor="middle"
        font-size="9" fill="red" font-family="monospace">B${i+1}(${cx},${cy})</text>
    `;
  }).join("")}
</svg>`;

await sharp(BG)
  .composite([{ input: Buffer.from(svg), top:0, left:0 }])
  .toFile(OUT);

console.log(`✓ calibrate2.png → ${OUT}`);
console.log(`  PB:    x=${PB.x} y=${PB.y} w=${PB.w} h=${PB.h}`);
console.log(`  Badge: x0=${BADGE_X0} y=${BADGE_Y} step=${BADGE_STEP}`);
