// One-shot icon generator. Draws a clean solid teal app icon with a white "V"
// mark (the app initial) — no external image deps. Run with `node scripts/gen-icons.mjs`.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, "..", "public");
mkdirSync(PUBLIC, { recursive: true });

// Brand colors (sRGB approximations of the OKLCH design tokens).
const TEAL = [31, 138, 138]; // --primary  #1f8a8a
const WHITE = [250, 251, 252]; // --primary-foreground (near-white)

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // rest 0 (compression/filter/interlace)
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter type none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Distance from point to segment (for drawing the V strokes with thickness).
function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function drawIcon(size, { maskable }) {
  const rgba = Buffer.alloc(size * size * 4);
  const radius = maskable ? 0 : size * 0.22; // squircle corners; maskable = full bleed
  // Safe zone for maskable: keep the mark within the central ~80%.
  const inset = maskable ? size * 0.18 : size * 0.28;
  const topY = inset;
  const botY = size - inset;
  const leftX = inset;
  const rightX = size - inset;
  const midX = size / 2;
  const stroke = size * 0.085;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // Rounded-rect background test.
      let inside = true;
      if (radius > 0) {
        const rx = Math.max(radius - x, x - (size - radius), 0);
        const ry = Math.max(radius - y, y - (size - radius), 0);
        if (rx * rx + ry * ry > radius * radius) inside = false;
      }
      if (!inside) {
        rgba[i] = 0;
        rgba[i + 1] = 0;
        rgba[i + 2] = 0;
        rgba[i + 3] = 0;
        continue;
      }
      // The "V": two strokes from top corners down to the bottom middle.
      const d = Math.min(
        distToSeg(x, y, leftX, topY, midX, botY),
        distToSeg(x, y, rightX, topY, midX, botY),
      );
      const isMark = d <= stroke / 2;
      const c = isMark ? WHITE : TEAL;
      rgba[i] = c[0];
      rgba[i + 1] = c[1];
      rgba[i + 2] = c[2];
      rgba[i + 3] = 255;
    }
  }
  return encodePNG(size, rgba);
}

writeFileSync(join(PUBLIC, "icon-192.png"), drawIcon(192, { maskable: false }));
writeFileSync(join(PUBLIC, "icon-512.png"), drawIcon(512, { maskable: false }));
writeFileSync(join(PUBLIC, "icon-maskable-512.png"), drawIcon(512, { maskable: true }));
writeFileSync(join(PUBLIC, "apple-touch-icon.png"), drawIcon(180, { maskable: true }));
console.log("Wrote icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png");
