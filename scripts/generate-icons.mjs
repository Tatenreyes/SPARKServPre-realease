/**
 * Generates the app icons.
 *
 *   npm run icons
 *
 * ## Why a script rather than four exported files
 *
 * The icons are the only binary assets in this project, and a binary nobody can
 * regenerate is a binary nobody can change: the next person who wants a different
 * mark has to open an image editor and guess the padding. This draws them from the
 * same geometry as `public/icons/icon.svg`, so the design is reviewable as code and
 * the maskable safe area is arithmetic rather than a judgement call.
 *
 * ## No dependencies
 *
 * A PNG is a signature, three chunks and a zlib stream, and Node already has zlib —
 * so this needs no image library and no network. Edges are supersampled 4× and
 * box-filtered, which is what keeps the bolt's diagonals from looking like stairs at
 * 192px.
 *
 * ## The maskable one is deliberately smaller
 *
 * Android may crop an icon to a circle of 80% of the canvas, so the maskable mark is
 * drawn at 46% of the height (a 225px bolt inside a 410px circle) instead of 64%.
 * Nothing is baked in about corners or transparency: the launcher masks, and an icon
 * with alpha renders as black on iOS.
 */

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "public", "icons");

/** brand-600 from tailwind.config.ts — the same blue as every primary button. */
const BRAND = [0x0e, 0x42, 0x9f];
const WHITE = [0xff, 0xff, 0xff];

/**
 * The spark, in the 512×512 space `icon.svg` uses: the same six vertices, centred on
 * (256, 256), 320 units tall. Keep the two in step if the mark ever changes.
 */
const BOLT = [
  [300, 96],
  [176, 288],
  [248, 288],
  [212, 416],
  [336, 224],
  [264, 224],
];
const BOLT_HEIGHT = 320;

const SUPERSAMPLE = 4;

/** Even-odd ray casting, so the concave bolt needs no triangulation. */
function insideBolt(x, y) {
  let inside = false;
  for (let i = 0, j = BOLT.length - 1; i < BOLT.length; j = i++) {
    const [xi, yi] = BOLT[i];
    const [xj, yj] = BOLT[j];
    const crosses = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** The icon's RGB pixels: brand field, white mark, `boltRatio` of the height. */
function renderPixels(size, boltRatio) {
  const big = size * SUPERSAMPLE;
  const scale = (boltRatio * size) / BOLT_HEIGHT;
  const centre = size / 2;

  const large = Buffer.alloc(big * big * 3);
  for (let py = 0; py < big; py++) {
    for (let px = 0; px < big; px++) {
      // Supersampled pixel → 512-space, which is where the geometry is defined.
      const x512 = 256 + ((px + 0.5) / SUPERSAMPLE - centre) / scale;
      const y512 = 256 + ((py + 0.5) / SUPERSAMPLE - centre) / scale;
      const colour = insideBolt(x512, y512) ? WHITE : BRAND;
      const at = (py * big + px) * 3;
      large[at] = colour[0];
      large[at + 1] = colour[1];
      large[at + 2] = colour[2];
    }
  }

  // Box-filter the 4×4 blocks back down: this is the antialiasing.
  const pixels = Buffer.alloc(size * size * 3);
  const samples = SUPERSAMPLE * SUPERSAMPLE;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const at = ((y * SUPERSAMPLE + sy) * big + (x * SUPERSAMPLE + sx)) * 3;
          r += large[at];
          g += large[at + 1];
          b += large[at + 2];
        }
      }
      const at = (y * size + x) * 3;
      pixels[at] = Math.round(r / samples);
      pixels[at + 1] = Math.round(g / samples);
      pixels[at + 2] = Math.round(b / samples);
    }
  }
  return pixels;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A truecolour (RGB, 8-bit) PNG, no interlace and no alpha channel. */
function encodePng(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  // Every scanline carries a leading filter byte; 0 means "no filter".
  const stride = size * 3 + 1;
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;
    pixels.copy(raw, y * stride + 1, y * size * 3, (y + 1) * size * 3);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * The four files the manifest and iOS need. 192 and 512 are Chrome's install
 * criteria; the maskable one is Android's adaptive icon; 180 is what iOS uses
 * because it ignores the manifest entirely.
 */
const ICONS = [
  { file: "icon-192.png", size: 192, boltRatio: 0.64 },
  { file: "icon-512.png", size: 512, boltRatio: 0.64 },
  { file: "icon-maskable-512.png", size: 512, boltRatio: 0.46 },
  { file: "apple-touch-icon.png", size: 180, boltRatio: 0.64 },
];

mkdirSync(OUT_DIR, { recursive: true });

for (const icon of ICONS) {
  const png = encodePng(icon.size, renderPixels(icon.size, icon.boltRatio));
  writeFileSync(join(OUT_DIR, icon.file), png);
  console.log(
    `${icon.file.padEnd(26)} ${icon.size}×${icon.size}  ${(png.length / 1024).toFixed(1)} kB`
  );
}
