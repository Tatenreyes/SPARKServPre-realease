/**
 * Rasterises a square brand-icon PNG into the four app icons the manifest and
 * the root layout declare.
 *
 *   npm run icons:brand
 *
 * ## Why this exists
 *
 * `scripts/generate-icons.mjs` draws the placeholder mark from vector geometry,
 * so it cannot consume supplied artwork. This one takes the artwork as given and
 * writes the sizes `src/app/manifest.ts` and `src/app/layout.tsx` ask for, with
 * no image library: a PNG is a signature, chunks and a zlib stream, and Node
 * already has zlib.
 *
 * ## The decisions it makes for you
 *
 * - **No alpha in the output.** iOS renders alpha as black, so every icon is
 *   written as truecolour (colour type 2, exactly as `generate-icons.mjs` does):
 *   transparency is composited onto an opaque field first. `--bg` picks that
 *   field, default the brand blue.
 * - **The maskable icon keeps a safe area.** Android may crop to a circle of 80%
 *   of the canvas, so a cut-out mark is drawn at 46% of the height — the ratio
 *   the placeholder used. A source already opaque edge to edge is used
 *   full-bleed instead, because padding it would only add a visible frame.
 * - **Box filtering on the way down**, so the artwork does not alias at 192px.
 *
 * `npm run test:pwa` parses every file this writes, so a mistake here fails the
 * suite rather than shipping a broken install.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";

const SOURCE = "public/icons/sparkserv-icon-light.png";
const BRAND_BLUE = "#0E429F";

/** Output files, the size each must be and whether it needs the safe area. */
const TARGETS = [
  { file: "public/icons/icon-192.png", size: 192, maskable: false },
  { file: "public/icons/icon-512.png", size: 512, maskable: false },
  { file: "public/icons/apple-touch-icon.png", size: 180, maskable: false },
  { file: "public/icons/icon-maskable-512.png", size: 512, maskable: true },
];

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** `#RRGGBB` to `[r, g, b]`. */
function parseHex(hex) {
  const value = hex.replace("#", "");
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

/**
 * Decodes an 8-bit, non-interlaced PNG of colour type 0, 2, 3, 4 or 6 into RGBA.
 *
 * Only what an exported icon actually uses is supported, and anything else is
 * rejected loudly: a silently mis-decoded icon is worse than a refused one.
 */
function decodePng(buffer) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < signature.length; i += 1) {
    if (buffer[i] !== signature[i]) throw new Error("not a PNG");
  }

  let header = null;
  let palette = null;
  const idat = [];
  let offset = 8;

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === "PLTE") {
      palette = Buffer.from(data);
    } else if (type === "IDAT") {
      idat.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }

  if (!header) throw new Error("no IHDR chunk");
  if (header.bitDepth !== 8) throw new Error(`unsupported bit depth ${header.bitDepth}`);
  if (header.interlace !== 0) throw new Error("interlaced PNGs are not supported");

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[header.colorType];
  if (!channels) throw new Error(`unsupported colour type ${header.colorType}`);

  const { width, height } = header;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  const flat = Buffer.alloc(height * stride);

  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const out = flat.subarray(y * stride, (y + 1) * stride);
    const prior = y > 0 ? flat.subarray((y - 1) * stride, y * stride) : null;

    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? out[x - channels] : 0;
      const b = prior ? prior[x] : 0;
      const c = prior && x >= channels ? prior[x - channels] : 0;
      let value = line[x];

      if (filter === 1) {
        value += a;
      } else if (filter === 2) {
        value += b;
      } else if (filter === 3) {
        value += (a + b) >> 1;
      } else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) {
        throw new Error(`unknown scanline filter ${filter}`);
      }

      out[x] = value & 0xff;
    }
  }

  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const at = i * channels;
    let r;
    let g;
    let blue;
    let alpha = 255;

    if (header.colorType === 3) {
      const entry = flat[at] * 3;
      r = palette[entry];
      g = palette[entry + 1];
      blue = palette[entry + 2];
    } else if (header.colorType === 0 || header.colorType === 4) {
      r = flat[at];
      g = flat[at];
      blue = flat[at];
      if (header.colorType === 4) alpha = flat[at + 1];
    } else {
      r = flat[at];
      g = flat[at + 1];
      blue = flat[at + 2];
      if (header.colorType === 6) alpha = flat[at + 3];
    }

    rgba[i * 4] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = blue;
    rgba[i * 4 + 3] = alpha;
  }

  return { width, height, rgba };
}

/** True when any pixel is not fully opaque. */
function hasTransparency({ rgba }) {
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] !== 255) return true;
  }
  return false;
}

/** The opaque colour a pixel resolves to when drawn over `field`. */
function over(r, g, b, alpha, field) {
  const t = alpha / 255;
  return [
    Math.round(r * t + field[0] * (1 - t)),
    Math.round(g * t + field[1] * (1 - t)),
    Math.round(b * t + field[2] * (1 - t)),
  ];
}

/**
 * Renders the artwork into a `size` square by box filtering, so every output
 * pixel is the average of the source pixels it covers — which is what keeps the
 * edges from aliasing at 192px.
 *
 * `scale` is the fraction of the square the artwork occupies; the rest is the
 * `field`, which is what gives the maskable icon its safe area.
 */
function render({ width, height, rgba }, size, scale, field) {
  const out = Buffer.alloc(size * size * 3);
  const box = Math.round(size * scale);
  const inset = Math.round((size - box) / 2);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const target = (y * size + x) * 3;
      const inside = x >= inset && x < inset + box && y >= inset && y < inset + box;

      if (!inside) {
        out[target] = field[0];
        out[target + 1] = field[1];
        out[target + 2] = field[2];
        continue;
      }

      const x0 = Math.floor(((x - inset) * width) / box);
      const x1 = Math.max(x0 + 1, Math.floor(((x - inset + 1) * width) / box));
      const y0 = Math.floor(((y - inset) * height) / box);
      const y1 = Math.max(y0 + 1, Math.floor(((y - inset + 1) * height) / box));

      let r = 0;
      let g = 0;
      let b = 0;
      let alpha = 0;
      let count = 0;

      for (let sy = y0; sy < y1; sy += 1) {
        for (let sx = x0; sx < x1; sx += 1) {
          const at = (sy * width + sx) * 4;
          r += rgba[at];
          g += rgba[at + 1];
          b += rgba[at + 2];
          alpha += rgba[at + 3];
          count += 1;
        }
      }

      const [rr, gg, bb] = over(r / count, g / count, b / count, alpha / count, field);
      out[target] = rr;
      out[target + 1] = gg;
      out[target + 2] = bb;
    }
  }

  return out;
}

/** Truecolour (colour type 2) with no alpha, so iOS cannot paint it black. */
function encodePng(rgb, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  const stride = size * 3;
  const raw = Buffer.alloc(size * (stride + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0; // filter type 0
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, crc]);
  };

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Reports what the artwork actually contains — how much of the canvas it covers,
 * where its bounding box sits and its average colour — so a tile and its padding
 * can be chosen from the file rather than by eye.
 */
function report({ width, height, rgba }) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let opaque = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  const histogram = new Map();

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      if (rgba[at + 3] < 8) continue;
      const red = rgba[at];
      const green = rgba[at + 1];
      const blue = rgba[at + 2];
      opaque += 1;
      r += red;
      g += green;
      b += blue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const bucket = ((red >> 4) << 8) | ((green >> 4) << 4) | (blue >> 4);
      histogram.set(bucket, (histogram.get(bucket) ?? 0) + 1);
    }
  }

  const percent = (value, total) => `${((value / total) * 100).toFixed(1)}%`;
  const channel = (value) => Math.round(value / opaque).toString(16).padStart(2, "0");

  console.log(`coverage ${percent(opaque, width * height)} of the canvas is opaque`);
  console.log(`art      x ${percent(minX, width)}..${percent(maxX, width)}, y ${percent(minY, height)}..${percent(maxY, height)}`);
  console.log(`colour   #${channel(r)}${channel(g)}${channel(b)} — the average of those pixels`);

  const common = [...histogram.entries()].sort((one, two) => two[1] - one[1]).slice(0, 5);
  for (const [bucket, count] of common) {
    const hex = [((bucket >> 8) & 0xf) * 17, ((bucket >> 4) & 0xf) * 17, (bucket & 0xf) * 17]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    console.log(`         #${hex}  ${percent(count, opaque)} of the mark`);
  }
}

function main() {
  const at = process.argv.indexOf("--bg");
  const field = parseHex(at > -1 ? process.argv[at + 1] : BRAND_BLUE);
  const source = decodePng(readFileSync(SOURCE));

  if (process.argv.includes("--report")) {
    console.log(`source  ${SOURCE}  ${source.width}x${source.height}`);
    report(source);
    return;
  }

  const transparent = hasTransparency(source);
  const maskScale = transparent ? 0.46 : 1;

  console.log(
    `source  ${SOURCE}  ${source.width}x${source.height}  ` +
      (transparent ? "has transparency" : "opaque edge to edge"),
  );
  console.log(
    `field   #${field.map((v) => v.toString(16).padStart(2, "0")).join("")}` +
      `  maskable art at ${Math.round(maskScale * 100)}%`,
  );

  for (const { file, size, maskable } of TARGETS) {
    const png = encodePng(render(source, size, maskable ? maskScale : 1, field), size);
    writeFileSync(file, png);
    console.log(`${file}  ${size}x${size}  ${png.length} bytes`);
  }
}

main();
