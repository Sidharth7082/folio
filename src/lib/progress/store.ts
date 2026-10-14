/**
 * Client-side persistence for library, reading progress and reader settings.
 *
 * Deliberately framework-free: a tiny external store that React binds to with
 * `useSyncExternalStore`. Everything lives in `localStorage` for v1, behind a
 * shape that a server-side sync could later replace without touching the UI.
 *
 * Storage is only ever touched on the client, and only after first subscription,
 * so server rendering stays deterministic.
 */

export type ReaderTheme = "light" | "sepia" | "dark";
export type ReaderFont = "serif" | "sans";
export type ReaderAlign = "left" | "justify";

export interface ReadingProgress {
  novelSlug: string;
  chapterIndex: number;
  chapterTitle: string;
  /** Scroll position through the chapter, 0..1. */
  offset: number;
  updatedAt: string;
}

export interface ReaderSettings {
  theme: ReaderTheme;
  font: ReaderFont;
  /** Body font size in px. */
  fontSize: number;
  /** Unitless line-height multiplier. */
  lineHeight: number;
  /** Measure in `ch` units. */
  width: number;
  align: ReaderAlign;
}

export interface ReaderState {
  hydrated: boolean;
  library: string[];
  progress: Record<string, ReadingProgress>;
  settings: ReaderSettings;
}

export const DEFAULT_SETTINGS: ReaderSettings = {
  theme: "dark",
  font: "serif",
  fontSize: 19,
  lineHeight: 1.75,
  width: 68,
  align: "left",
};

export const SETTINGS_BOUNDS = {
  fontSize: { min: 15, max: 28, step: 1 },
  lineHeight: { min: 1.3, max: 2.2, step: 0.05 },
  width: { min: 45, max: 95, step: 1 },
} as const;

const KEYS = {
  library: "nr:library:v1",
  progress: "nr:progress:v1",
  settings: "nr:settings:v1",
} as const;

const SERVER_STATE: ReaderState = Object.freeze({
  hydrated: false,
  library: [],
  progress: {},
  settings: DEFAULT_SETTINGS,
});

let state: ReaderState = SERVER_STATE;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function isBrowser() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readJson<T>(key: string): T | null {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota or private-mode failures are non-fatal: the session stays in memory.
  }
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function normaliseSettings(value: Partial<ReaderSettings> | null): ReaderSettings {
  const source = { ...DEFAULT_SETTINGS, ...(value ?? {}) };
  return {
    theme: source.theme === "light" || source.theme === "sepia" ? source.theme : "dark",
    font: source.font === "sans" ? "sans" : "serif",
    fontSize: clamp(source.fontSize, SETTINGS_BOUNDS.fontSize.min, SETTINGS_BOUNDS.fontSize.max),
    lineHeight: clamp(
      source.lineHeight,
      SETTINGS_BOUNDS.lineHeight.min,
      SETTINGS_BOUNDS.lineHeight.max,
    ),
    width: clamp(source.width, SETTINGS_BOUNDS.width.min, SETTINGS_BOUNDS.width.max),
    align: source.align === "justify" ? "justify" : "left",
  };
}

function hydrate() {
  if (state.hydrated || !isBrowser()) return;

  const library = readJson<string[]>(KEYS.library);
  const progress = readJson<Record<string, ReadingProgress>>(KEYS.progress);
  const settings = readJson<Partial<ReaderSettings>>(KEYS.settings);

  state = {
    hydrated: true,
    library: Array.isArray(library) ? library.filter((slug) => typeof slug === "string") : [],
    progress:
      progress && typeof progress === "object"
        ? Object.fromEntries(
            Object.entries(progress).filter(
              ([, value]) =>
                value &&
                typeof value === "object" &&
                typeof value.novelSlug === "string" &&
                Number.isFinite(value.chapterIndex),
            ),
          )
        : {},
    settings: normaliseSettings(settings),
  };
  emit();
}

function commit(next: Partial<ReaderState>) {
  state = { ...state, ...next };
  emit();
}

export const readerStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    hydrate();
    return () => {
      listeners.delete(listener);
    };
  },

  getSnapshot(): ReaderState {
    return state;
  },

  getServerSnapshot(): ReaderState {
    return SERVER_STATE;
  },

  /** Library ----------------------------------------------------------------- */

  isInLibrary(slug: string): boolean {
    return state.library.includes(slug);
  },

  toggleLibrary(slug: string): boolean {
    const has = state.library.includes(slug);
    const library = has
      ? state.library.filter((entry) => entry !== slug)
      : [slug, ...state.library];
    writeJson(KEYS.library, library);
    commit({ library });
    return !has;
  },

  /** Progress ---------------------------------------------------------------- */

  getProgress(slug: string): ReadingProgress | null {
    return state.progress[slug] ?? null;
  },

  recordProgress(entry: Omit<ReadingProgress, "updatedAt"> & { updatedAt?: string }) {
    const progress: ReadingProgress = {
      ...entry,
      offset: clamp(entry.offset, 0, 1),
      updatedAt: entry.updatedAt ?? new Date().toISOString(),
    };
    const next = { ...state.progress, [entry.novelSlug]: progress };
    writeJson(KEYS.progress, next);
    commit({ progress: next });
  },

  clearProgress(slug: string) {
    if (!(slug in state.progress)) return;
    const next = { ...state.progress };
    delete next[slug];
    writeJson(KEYS.progress, next);
    commit({ progress: next });
  },

  /** Settings ---------------------------------------------------------------- */

  updateSettings(patch: Partial<ReaderSettings>) {
    const settings = normaliseSettings({ ...state.settings, ...patch });
    writeJson(KEYS.settings, settings);
    commit({ settings });
  },

  resetSettings() {
    writeJson(KEYS.settings, DEFAULT_SETTINGS);
    commit({ settings: DEFAULT_SETTINGS });
  },

  /** Most recently read entry, newest first. */
  continueReading(limit = 6): ReadingProgress[] {
    return Object.values(state.progress)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);
  },
};
