/**
 * 分析 background.png 中各元素的位置
 * 截取关键区域帮助精确定位
 */
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const BG   = resolve(ROOT, "public/assets/background.png");
const OUT  = resolve(ROOT, "dist/analysis");
mkdirSync(OUT, { recursive: true });

const meta = await sharp(BG).metadata();
const W = meta.width, H = meta.height;
console.log(`Background: ${W}×${H}`);

// 截取各区域用于分析坐标
const regions = [
  // 名称, left, top, width, height
  ["full",        0,    0,    W,    H  ],  // 完整图
  ["middle",      Math.round(W*0.27), 0, Math.round(W*0.43), H],  // 中间区域
  ["progress",    Math.round(W*0.27), Math.round(H*0.45), Math.round(W*0.43), Math.round(H*0.35)],  // 进度条区域
  ["achievements",Math.round(W*0.62), 0, Math.round(W*0.38), Math.round(H*0.55)],  // 徽章区域
];

for (const [name, left, top, width, height] of regions) {
  const path = resolve(OUT, `region-${name}.png`);
  await sharp(BG)
    .extract({ left, top, width: Math.min(width, W-left), height: Math.min(height, H-top) })
    .toFile(path);
  console.log(`✓ ${name}: left=${left} top=${top} w=${width} h=${height} → ${path}`);
}

// 画网格线帮助定位
const gridSvg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  ${Array.from({length: 20}, (_, i) => {
    const x = Math.round(W * i / 20);
    return `<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="rgba(255,0,0,0.4)" stroke-width="1"/>
            <text x="${x+2}" y="12" font-size="10" fill="red">${x}</text>`;
  }).join("")}
  ${Array.from({length: 10}, (_, i) => {
    const y = Math.round(H * i / 10);
    return `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="rgba(0,255,0,0.4)" stroke-width="1"/>
            <text x="2" y="${y+10}" font-size="10" fill="lime">${y}</text>`;
  }).join("")}
</svg>`;

await sharp(BG)
  .composite([{ input: Buffer.from(gridSvg), top: 0, left: 0 }])
  .toFile(resolve(OUT, "grid.png"));
console.log("✓ grid overlay saved");
