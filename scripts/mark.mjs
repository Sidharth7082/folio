/**
 * Folio's mark, in one place.
 *
 * The favicon, the web manifest icons, the Apple touch icon and the Android
 * launcher icons all render from this, so the app cannot end up wearing two
 * different logos depending on how it was installed.
 *
 * No dependencies: it returns SVG strings, and whatever needs pixels rasterises
 * them.
 */

export const ACCENT = "#e6b566";
export const INK_TOP = "#1a2130";
export const INK_BOTTOM = "#0a0c11";

/** The open book itself, without any plate behind it. */
export const GLYPH_PATHS = [
  "M256 176 L256 388",
  "M256 176 C232 154 196 144 156 144 C142 144 130 146 118 150 L118 362 C130 358 142 356 156 356 C196 356 232 366 256 388",
  "M256 176 C280 154 316 144 356 144 C370 144 382 146 394 150 L394 362 C382 358 370 356 356 356 C316 356 280 366 256 388",
];

/**
 * The mark on its plate.
 *
 * The artwork stays inside the middle 80% of the canvas, which is the safe zone
 * Android keeps when it masks a launcher icon into a circle or squircle.
 * Everything outside that is background, so the mark survives any shape.
 *
 * @param {number} size      Rendered pixel size.
 * @param {object} [options]
 * @param {boolean} [options.maskable] Fill the square; the platform adds corners.
 * @param {number} [options.stroke]    Stroke weight, for small sizes.
 */
export function markSvg(size, { maskable = false, stroke = 24 } = {}) {
  // A fold radius proportional to the canvas, so every size looks the same.
  const radius = maskable ? 0 : Math.round(size * 0.22);
  const paths = GLYPH_PATHS.map((d) => `    <path d="${d}"/>`).join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">
  <defs>
    <linearGradient id="ink" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${INK_TOP}"/>
      <stop offset="1" stop-color="${INK_BOTTOM}"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="${(radius / size) * 512}" ry="${(radius / size) * 512}" fill="url(#ink)"/>
  <g fill="none" stroke="${ACCENT}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">
${paths}
  </g>
</svg>`;
}

/**
 * The mark with no plate and no rounding, sized to fill its canvas.
 *
 * Android's adaptive icons want the foreground on its own so the launcher can
 * animate and mask the two layers separately.
 */
export function foregroundSvg(size, { stroke = 24 } = {}) {
  const paths = GLYPH_PATHS.map((d) => `    <path d="${d}"/>`).join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">
  <g fill="none" stroke="${ACCENT}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">
${paths}
  </g>
</svg>`;
}
