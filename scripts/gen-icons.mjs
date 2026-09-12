/**
 * PWA 图标生成脚本（零第三方依赖，仅用 Node 内置 `zlib`）。
 *
 * 用法：`npm run icons`
 *
 * 生成文件：
 * - public/icons/icon-192.png
 * - public/icons/icon-512.png
 * - public/icons/maskable-512.png（含 12% 安全边距）
 * - public/icons/apple-touch-icon.png（180px）
 *
 * 之所以用脚本生成而不是引入图片资源：保证仓库零二进制依赖，
 * 且换主色时只需改下面 `PALETTE` 一处。
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 渐变色（左上 → 右下）。 */
const PALETTE = {
  from: [0x2f, 0x6b, 0xff],
  to: [0x7a, 0x5c, 0xff],
  glyph: [0xff, 0xff, 0xff],
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '..', 'public', 'icons');

// ---------------------------------------------------------------------------
// PNG 编码器（RGBA，filter 0）
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(size, pixels) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  let p = 0;
  for (let y = 0; y < size; y += 1) {
    raw[p] = 0; // filter: none
    p += 1;
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      raw[p] = pixels[i];
      raw[p + 1] = pixels[i + 1];
      raw[p + 2] = pixels[i + 2];
      raw[p + 3] = pixels[i + 3];
      p += 4;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// 绘制
// ---------------------------------------------------------------------------

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** 点到线段的距离平方。 */
function distToSegSq(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy || 1;
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return (px - cx) * (px - cx) + (py - cy) * (py - cy);
}

/**
 * 生成一个正方形图标的像素缓冲。
 *
 * 图形：对角渐变圆角底 + 白色播放三角（寓意「一键生成/运行」）。
 *
 * @param {number} size 边长（像素）。
 * @param {number} padRatio 安全边距比例（maskable 需要更大留白）。
 * @returns {Buffer} RGBA 像素缓冲。
 */
function drawIcon(size, padRatio) {
  const pixels = Buffer.alloc(size * size * 4);
  const pad = size * padRatio;
  const inner = size - pad * 2;
  const radius = inner * 0.22;

  // 播放三角形（相对于 inner 区域的比例坐标）
  const tri = [
    [0.36, 0.27],
    [0.36, 0.73],
    [0.72, 0.5],
  ];
  const triPx = tri.map(([tx, ty]) => [pad + tx * inner, pad + ty * inner]);
  const edgeHalf = inner * 0.045; // 圆角三角的等效半径

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;

      // 圆角矩形 SDF
      const cx = Math.min(Math.max(x, pad + radius), size - pad - radius);
      const cy = Math.min(Math.max(y, pad + radius), size - pad - radius);
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      const outside = d > radius && (x < pad + radius || x > size - pad - radius) &&
        (y < pad + radius || y > size - pad - radius);
      const inRect = x >= pad && x < size - pad && y >= pad && y < size - pad && !outside &&
        d <= radius + 0.5;

      if (!inRect) {
        pixels[i] = 0;
        pixels[i + 1] = 0;
        pixels[i + 2] = 0;
        pixels[i + 3] = 0;
        continue;
      }

      // 三角形内部判定（含圆角）
      let dmin = Infinity;
      for (let k = 0; k < 3; k += 1) {
        const [x1, y1] = triPx[k];
        const [x2, y2] = triPx[(k + 1) % 3];
        dmin = Math.min(dmin, distToSegSq(x, y, x1, y1, x2, y2));
      }
      const insideTri = dmin <= edgeHalf * edgeHalf;

      let color;
      if (insideTri) {
        color = PALETTE.glyph;
      } else {
        const t = (x / size) * 0.5 + (y / size) * 0.5;
        color = [0, 1, 2].map((c) => Math.round(lerp(PALETTE.from[c], PALETTE.to[c], t)));
      }

      // 圆角边缘抗锯齿
      const alpha = d > radius - 1 ? Math.max(0, Math.min(1, radius - d + 0.5)) : 1;
      pixels[i] = color[0];
      pixels[i + 1] = color[1];
      pixels[i + 2] = color[2];
      pixels[i + 3] = Math.round(255 * (insideTri ? alpha : alpha));
    }
  }
  return pixels;
}

/** 写出图标文件。 */
function write(name, size, padRatio) {
  const png = encodePng(size, drawIcon(size, padRatio));
  const file = resolve(OUT_DIR, name);
  writeFileSync(file, png);
  console.log(`  ✓ ${name} (${size}x${size}, ${(png.length / 1024).toFixed(1)} KB)`);
}

mkdirSync(OUT_DIR, { recursive: true });
console.log('生成 PWA 图标：');
write('icon-192.png', 192, 0);
write('icon-512.png', 512, 0);
write('maskable-512.png', 512, 0.12);
write('apple-touch-icon.png', 180, 0);
console.log('完成。');
