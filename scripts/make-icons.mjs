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

import { ACCENT, GLYPH_PATHS, INK_BOTTOM, foregroundSvg, markSvg } from "./mark.mjs";

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

/**
 * The Android project's resource folder, relative to the repo root.
 *
 * Capacitor scaffolds this with its own teal placeholder logo, which has to be
 * overwritten or the installed app wears another project's branding.
 */
const ANDROID_RES = "mobile/android/app/src/main/res";

/** Densities Android expects, with the size each bucket needs in pixels. */
const ANDROID_LAUNCHER = [
  { dir: "mipmap-mdpi", icon: 48, foreground: 108 },
  { dir: "mipmap-hdpi", icon: 72, foreground: 162 },
  { dir: "mipmap-xhdpi", icon: 96, foreground: 216 },
  { dir: "mipmap-xxhdpi", icon: 144, foreground: 324 },
  { dir: "mipmap-xxxhdpi", icon: 192, foreground: 432 },
];

/** The launch screens Capacitor scaffolds, at the sizes it uses. */
const ANDROID_SPLASH = [
  { dir: "drawable-port-mdpi", width: 320, height: 480 },
  { dir: "drawable-port-hdpi", width: 480, height: 800 },
  { dir: "drawable-port-xhdpi", width: 720, height: 1280 },
  { dir: "drawable-port-xxhdpi", width: 960, height: 1600 },
  { dir: "drawable-port-xxxhdpi", width: 1280, height: 1920 },
  { dir: "drawable-land-mdpi", width: 480, height: 320 },
  { dir: "drawable-land-hdpi", width: 800, height: 480 },
  { dir: "drawable-land-xhdpi", width: 1280, height: 720 },
  { dir: "drawable-land-xxhdpi", width: 1600, height: 960 },
  { dir: "drawable-land-xxxhdpi", width: 1920, height: 1280 },
];

/** The mark centred on the app's background, for a launch screen. */
function splashSvg(width, height) {
  const mark = Math.round(Math.min(width, height) * 0.32);
  const scale = mark / 512;
  const x = (width - mark) / 2;
  const y = (height - mark) / 2;
  const paths = GLYPH_PATHS.map((d) => `    <path d="${d}"/>`).join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${INK_BOTTOM}"/>
  <g transform="translate(${x} ${y}) scale(${scale})" fill="none" stroke="${ACCENT}" stroke-width="24" stroke-linecap="round" stroke-linejoin="round">
${paths}
  </g>
</svg>`;
}

/** Launcher icons and launch screens for the Android shell. */
async function writeAndroidIcons() {
  const resRoot = path.join(projectRoot, ANDROID_RES);

  try {
    await fs.access(resRoot);
  } catch {
    console.log("\nNo Android project found; skipping its icons.");
    return;
  }

  console.log("");

  for (const bucket of ANDROID_LAUNCHER) {
    const dir = path.join(resRoot, bucket.dir);
    await fs.mkdir(dir, { recursive: true });

    // The legacy square and round icons carry their own plate, because older
    // Android (and some launchers today) put them on the screen unchanged.
    const plate = await sharp(Buffer.from(markSvg(bucket.icon)))
      .png({ compressionLevel: 9 })
      .toBuffer();
    await fs.writeFile(path.join(dir, "ic_launcher.png"), plate);
    await fs.writeFile(path.join(dir, "ic_launcher_round.png"), plate);

    // The adaptive foreground has no plate: the launcher supplies the background
    // from `@color/ic_launcher_background` and masks the two layers separately.
    await sharp(Buffer.from(foregroundSvg(bucket.foreground)))
      .png({ compressionLevel: 9 })
      .toFile(path.join(dir, "ic_launcher_foreground.png"));

    console.log(`${ANDROID_RES}/${bucket.dir}/  icon ${bucket.icon}px, foreground ${bucket.foreground}px`);
  }

  for (const screen of ANDROID_SPLASH) {
    const dir = path.join(resRoot, screen.dir);
    await fs.mkdir(dir, { recursive: true });
    await sharp(Buffer.from(splashSvg(screen.width, screen.height)))
      .png({ compressionLevel: 9 })
      .toFile(path.join(dir, "splash.png"));
  }

  console.log(`${ANDROID_RES}/drawable-*/  splash  ${ANDROID_SPLASH.length} screens`);
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

  await writeAndroidIcons();
}

await main();
