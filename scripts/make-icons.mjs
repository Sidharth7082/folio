/**
 * Renders Folio's app icons.
 *
 * Run this by hand when the mark changes:
 *
 *   node scripts/make-icons.mjs
 *
 * The PNGs are committed, so nothing here is needed to build or run the app.
 * It lives in the repo so the icons are not inexplicable binaries — the artwork
 * is the template below, and the same source produces the favicon, the Apple
 * touch icon and every manifest size.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

import sharp from "sharp";

const ACCENT = "#e6b566";
const INK_TOP = "#1a2130";
const INK_BOTTOM = "#0a0c11";

/**
 * An open book: two pages meeting at a spine, with the bottom edge dipping to
 * the centre the way a real book falls open.
 *
 * The artwork fits inside the middle 80% of the canvas, which is the safe zone
 * Android keeps when it masks a `maskable` icon into a circle or squircle.
 * Everything outside that zone is background, so the mark survives any shape.
 */
function markSvg(size, { maskable = false, stroke = 24 } = {}) {
  // A maskable icon must fill its square: the platform supplies the corners.
  const radius = maskable ? 0 : Math.round(size * 0.22);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">
  <defs>
    <linearGradient id="ink" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${INK_TOP}"/>
      <stop offset="1" stop-color="${INK_BOTTOM}"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="${(radius / size) * 512}" ry="${(radius / size) * 512}" fill="url(#ink)"/>
  <g fill="none" stroke="${ACCENT}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">
    <path d="M256 176 L256 388"/>
    <path d="M256 176 C232 154 196 144 156 144 C142 144 130 146 118 150 L118 362 C130 358 142 356 156 356 C196 356 232 366 256 388"/>
    <path d="M256 176 C280 154 316 144 356 144 C370 144 382 146 394 150 L394 362 C382 358 370 356 356 356 C316 356 280 366 256 388"/>
  </g>
</svg>`;
}

const projectRoot = path.resolve(import.meta.dirname, "..");

const PNG_TARGETS = [
  // Android and desktop install prompts.
  { file: "public/icons/icon-192.png", size: 192, maskable: false },
  { file: "public/icons/icon-512.png", size: 512, maskable: false },
  // The padded variant Android crops to the launcher's own shape.
  { file: "public/icons/icon-maskable-512.png", size: 512, maskable: true },
  // iOS ignores the manifest and reads this.
  { file: "src/app/apple-icon.png", size: 180, maskable: false },
];

/**
 * A multi-size `.ico` holding 16, 32 and 48 px renders.
 *
 * ICO is a tiny container, and browsers have accepted PNG data inside it since
 * Vista, so the PNGs are wrapped rather than re-encoded into BMP. The small
 * sizes get a heavier stroke on purpose: the normal weight thins to under a
 * pixel at 16px and the mark turns to mush.
 */
async function buildIco() {
  const images = [];

  for (const size of [16, 32, 48]) {
    const svg = Buffer.from(markSvg(size, { stroke: 40 }));
    images.push({ size, data: await sharp(svg).png({ compressionLevel: 9 }).toBuffer() });
  }

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(images.length, 4);

  const directory = Buffer.alloc(16 * images.length);
  let offset = header.length + directory.length;

  images.forEach((image, index) => {
    const at = index * 16;
    // 256px is written as 0 in this field.
    const dimension = image.size >= 256 ? 0 : image.size;
    directory.writeUInt8(dimension, at);
    directory.writeUInt8(dimension, at + 1);
    directory.writeUInt8(0, at + 2); // palette entries
    directory.writeUInt8(0, at + 3); // reserved
    directory.writeUInt16LE(1, at + 4); // colour planes
    directory.writeUInt16LE(32, at + 6); // bits per pixel
    directory.writeUInt32LE(image.data.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += image.data.length;
  });

  return Buffer.concat([header, directory, ...images.map((image) => image.data)]);
}

async function main() {
  for (const target of PNG_TARGETS) {
    const svg = Buffer.from(markSvg(target.size, { maskable: target.maskable }));
    const out = path.join(projectRoot, target.file);
    await fs.mkdir(path.dirname(out), { recursive: true });
    await sharp(svg).png({ compressionLevel: 9 }).toFile(out);
    console.log(`${target.file}  ${target.size}x${target.size}`);
  }

  // Next serves `app/icon.svg` as the favicon, and an SVG stays crisp at any
  // tab size.
  const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" rx="112" ry="112" fill="${INK_BOTTOM}"/>
  <g fill="none" stroke="${ACCENT}" stroke-width="34" stroke-linecap="round" stroke-linejoin="round">
    <path d="M256 176 L256 388"/>
    <path d="M256 176 C232 154 196 144 156 144 C142 144 130 146 118 150 L118 362 C130 358 142 356 156 356 C196 356 232 366 256 388"/>
    <path d="M256 176 C280 154 316 144 356 144 C370 144 382 146 394 150 L394 362 C382 358 370 356 356 356 C316 356 280 366 256 388"/>
  </g>
</svg>`;

  await fs.writeFile(path.join(projectRoot, "src/app/icon.svg"), favicon, "utf8");
  console.log("src/app/icon.svg");

  // Overwrite the favicon Next scaffolds, which is the framework's own logo and
  // would otherwise win the browser tab over ours.
  await fs.writeFile(path.join(projectRoot, "src/app/favicon.ico"), await buildIco());
  console.log("src/app/favicon.ico");
}

await main();
