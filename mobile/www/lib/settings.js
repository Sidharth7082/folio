/*
 * Reader settings: what the text looks like, and how that is remembered.
 *
 * The variable names are deliberately the ones LNReader documents
 * (`--readerSettings-*` and `--theme-*`), so any custom CSS written for that app
 * applies here without editing. That is the whole reason to match them rather
 * than pick prettier names.
 *
 * Stored in localStorage rather than IndexedDB: this is a handful of scalars,
 * it is read on every render, and it is worthless enough that a wipe is not
 * worth protecting against.
 */

const KEY = "folio.reader";

/**
 * Reader themes.
 *
 * Separate from the app's own light/dark, because reading is its own context: a
 * sepia page at midnight is a reasonable thing to want while the rest of the app
 * stays dark. `system` is the only one that follows the device.
 */
export const THEMES = {
  system: { label: "System", followsDevice: true },
  light: { label: "Light", background: "#ffffff", text: "#23262d", muted: "#6b7280", surface: "#f2eee7", line: "#e5e0d7", accent: "#9a6b18" },
  sepia: { label: "Sepia", background: "#f6ecd9", text: "#3d3227", muted: "#7d6d57", surface: "#f1e5cf", line: "#e0d0b4", accent: "#8a5a12" },
  dark: { label: "Dark", background: "#0c0e13", text: "#dfe3ec", muted: "#8d96ac", surface: "#171b26", line: "#232a39", accent: "#e6b566" },
  black: { label: "Black", background: "#000000", text: "#c8ccd6", muted: "#7d8494", surface: "#0d0d0f", line: "#1e1e22", accent: "#e6b566" },
};

/** Font stacks, named by what they are rather than which family they name. */
export const FONTS = {
  system: { label: "System", stack: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  serif: { label: "Serif", stack: 'Georgia, "Times New Roman", serif' },
  sans: { label: "Sans", stack: 'Helvetica, Arial, sans-serif' },
  mono: { label: "Mono", stack: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
};

export const DEFAULTS = {
  theme: "system",
  fontFamily: "system",
  textSize: 18,
  lineHeight: 1.6,
  textAlign: "left",
  padding: 20,
  customCss: "",
  speechRate: 1,
  speechAdvance: true,
};

/** Bounds that keep a slider from producing unreadable text. */
export const LIMITS = {
  textSize: { min: 13, max: 30, step: 1 },
  lineHeight: { min: 1.2, max: 2.2, step: 0.05 },
  padding: { min: 0, max: 48, step: 2 },
  speechRate: { min: 0.5, max: 2, step: 0.05 },
};

function clamp(value, { min, max }) {
  return Math.min(max, Math.max(min, value));
}

/** Whatever was stored, forced into a shape the reader can rely on. */
function sanitise(raw) {
  const merge = { ...DEFAULTS, ...(raw ?? {}) };

  return {
    theme: THEMES[merge.theme] ? merge.theme : DEFAULTS.theme,
    fontFamily: FONTS[merge.fontFamily] ? merge.fontFamily : DEFAULTS.fontFamily,
    textSize: clamp(Number(merge.textSize) || DEFAULTS.textSize, LIMITS.textSize),
    lineHeight: clamp(Number(merge.lineHeight) || DEFAULTS.lineHeight, LIMITS.lineHeight),
    textAlign: merge.textAlign === "justify" ? "justify" : "left",
    padding: clamp(Number(merge.padding) ?? DEFAULTS.padding, LIMITS.padding),
    customCss: typeof merge.customCss === "string" ? merge.customCss : "",
    speechRate: clamp(Number(merge.speechRate) || DEFAULTS.speechRate, LIMITS.speechRate),
    // Off only when it was explicitly turned off: reading on into the next
    // chapter is what someone listening to a book wants by default.
    speechAdvance: merge.speechAdvance !== false,
  };
}

export function loadSettings() {
  try {
    return sanitise(JSON.parse(globalThis.localStorage.getItem(KEY) ?? "null"));
  } catch {
    return sanitise(null);
  }
}

export function saveSettings(settings) {
  try {
    globalThis.localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // A full or blocked store is not worth interrupting reading over.
  }
}

/**
 * Apply a settings object to the reader.
 *
 * Two sets of variables, because they answer different questions:
 *
 *   --readerSettings-*  what the reader was told to do
 *   --theme-*           the colours those choices resolved to
 *
 * The theme colours are filled in here rather than in CSS so that a custom
 * stylesheet has one place to read from, whichever theme is active.
 */
export function applySettings(element, settings) {
  const theme = THEMES[settings.theme];
  const resolved = theme?.followsDevice ? resolveSystemTheme() : theme;
  const font = FONTS[settings.fontFamily];

  const px = (value) => `${value}px`;
  const set = (name, value) => element.style.setProperty(name, value);

  set("--readerSettings-theme", resolved.background);
  set("--readerSettings-textColor", resolved.text);
  set("--readerSettings-textSize", px(settings.textSize));
  set("--readerSettings-lineHeight", String(settings.lineHeight));
  set("--readerSettings-textAlign", settings.textAlign);
  set("--readerSettings-padding", px(settings.padding));
  set("--readerSettings-fontFamily", font.stack);

  // The two highlights the voice paints, derived from the theme rather than
  // declared in CSS so that they follow whichever theme is active.
  set("--folio-speech", fade(resolved.accent, 0.22));
  set("--folio-speech-word", fade(resolved.accent, 0.5));

  set("--theme-primary", resolved.accent);
  set("--theme-onPrimary", resolved.background);
  set("--theme-secondary", resolved.muted);
  set("--theme-onSecondary", resolved.background);
  set("--theme-surface", resolved.surface);
  set("--theme-onSurface", resolved.text);
  set("--theme-surfaceVariant", resolved.surface);
  set("--theme-onSurfaceVariant", resolved.muted);
  set("--theme-outline", resolved.line);

  // `data-theme` lets plain CSS branch on the theme when a variable will not do.
  element.dataset.theme = settings.theme;
}

/** The device's own preference, used when the theme is set to System. */
function resolveSystemTheme() {
  const light = globalThis.matchMedia?.("(prefers-color-scheme: light)").matches;
  return light ? THEMES.light : THEMES.dark;
}

/** A hex colour at some transparency, for the highlights. */
function fade(hex, alpha) {
  const value = Number.parseInt(hex.slice(1), 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

/**
 * Inject custom CSS.
 *
 * A `<style>` element rather than inline styles, so the user's rules can use
 * selectors and `@media`. It replaces the previous block rather than appending,
 * so editing the CSS does not stack copies.
 */
export function applyCustomCss(css) {
  const existing = document.getElementById("folio-custom-css");
  if (!css.trim()) {
    existing?.remove();
    return;
  }

  const style = existing ?? document.createElement("style");
  style.id = "folio-custom-css";
  style.textContent = css;
  if (!existing) document.head.append(style);
}
