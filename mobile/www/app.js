/*
 * Folio on a phone, with nothing behind it.
 *
 * There is no server and no configuration: books are imported from the device,
 * parsed on the device, and read on the device. The whole app is this file plus
 * three small modules.
 *
 * Written with no bundler, so it uses only browser APIs and the Capacitor bridge
 * that is injected at runtime.
 */

import { readEpub } from "./lib/epub.js";
import { readPlainText } from "./lib/plain.js";
import { getBook, listBooks, putBook, saveProgress } from "./lib/store.js";
import {
  FONTS,
  LIMITS,
  THEMES,
  applyCustomCss,
  applySettings,
  loadSettings,
  saveSettings,
} from "./lib/settings.js";

const els = {
  library: document.getElementById("library"),
  shelf: document.getElementById("shelf"),
  empty: document.getElementById("empty"),
  importButton: document.getElementById("import"),
  file: document.getElementById("file"),
  reader: document.getElementById("reader"),
  chapter: document.getElementById("chapter"),
  readerBook: document.getElementById("reader-book"),
  readerChapter: document.getElementById("reader-chapter"),
  closeReader: document.getElementById("close-reader"),
  prev: document.getElementById("prev"),
  next: document.getElementById("next"),
  position: document.getElementById("position"),
  toast: document.getElementById("toast"),
  libraryBar: document.getElementById("library-bar"),
  openSettings: document.getElementById("open-settings"),
  closeSettings: document.getElementById("close-settings"),
  settings: document.getElementById("settings"),
  themeChips: document.getElementById("theme-chips"),
  fontChips: document.getElementById("font-chips"),
  textSize: document.getElementById("text-size"),
  textSizeOut: document.getElementById("text-size-out"),
  lineHeight: document.getElementById("line-height"),
  lineHeightOut: document.getElementById("line-height-out"),
  padding: document.getElementById("padding"),
  paddingOut: document.getElementById("padding-out"),
  customCss: document.getElementById("custom-css"),
  saveCss: document.getElementById("save-css"),
};

const bridge = globalThis.Capacitor;

/** What is open, and the parsed shape of it, cached for this session. */
const state = {
  bookId: null,
  book: null,
  parsed: null,
  chapter: 0,
};

let toastTimer = null;

function toast(message, ms = 2600) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.hidden = true;
  }, ms);
}

function describeSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

/* -------------------------------------------------------------------------
   Reader settings
   ------------------------------------------------------------------------- */

let settings = loadSettings();

function persist() {
  saveSettings(settings);
  applySettings(els.reader, settings);
  applyCustomCss(settings.customCss);
}

/** Build the theme and typeface chips once, then mark the chosen one. */
function renderChips() {
  els.themeChips.replaceChildren(
    ...Object.entries(THEMES).map(([id, theme]) =>
      chip(theme.label, settings.theme === id, () => {
        settings.theme = id;
        persist();
        renderChips();
      }),
    ),
  );

  els.fontChips.replaceChildren(
    ...Object.entries(FONTS).map(([id, font]) =>
      chip(font.label, settings.fontFamily === id, () => {
        settings.fontFamily = id;
        persist();
        renderChips();
      }),
    ),
  );

  for (const button of els.settings.querySelectorAll("[data-align]")) {
    button.classList.toggle("chip-on", settings.textAlign === button.dataset.align);
  }
}

function chip(label, active, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = active ? "chip chip-on" : "chip";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

/** Point a slider at its setting, and keep the readout in step. */
function wireRange(input, output, key, format) {
  const { min, max, step } = LIMITS[key];
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(settings[key]);
  output.textContent = format(settings[key]);

  input.addEventListener("input", () => {
    settings[key] = Number(input.value);
    output.textContent = format(settings[key]);
    persist();
  });
}

function wireSettings() {
  wireRange(els.textSize, els.textSizeOut, "textSize", (v) => `${Math.round(v)}px`);
  wireRange(els.lineHeight, els.lineHeightOut, "lineHeight", (v) => v.toFixed(2));
  wireRange(els.padding, els.paddingOut, "padding", (v) => `${Math.round(v)}px`);

  for (const button of els.settings.querySelectorAll("[data-align]")) {
    button.addEventListener("click", () => {
      settings.textAlign = button.dataset.align;
      persist();
      renderChips();
    });
  }

  els.customCss.value = settings.customCss;
  els.saveCss.addEventListener("click", () => {
    settings.customCss = els.customCss.value;
    persist();
    toast("Custom CSS applied");
  });

  els.openSettings.addEventListener("click", () => {
    els.settings.hidden = false;
  });

  els.closeSettings.addEventListener("click", () => {
    els.settings.hidden = true;
  });

  // Re-resolve the palette when the device flips between light and dark, which
  // otherwise leaves the System theme showing the old one until a reload.
  globalThis.matchMedia?.("(prefers-color-scheme: light)").addEventListener?.("change", () => {
    if (settings.theme === "system") persist();
  });

  renderChips();
  persist();
}

/* -------------------------------------------------------------------------
   Import
   ------------------------------------------------------------------------- */

/**
 * A stable id from the file's name and size.
 *
 * Importing the same book twice replaces it rather than adding a second copy,
 * which is what someone re-downloading a file actually wants.
 */
function idFor(file) {
  let hash = 0;
  const key = `${file.name}:${file.size}`;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) | 0;
  }
  return `b${(hash >>> 0).toString(36)}`;
}

/** Read an imported file into the shape the library stores. */
async function parseImport(file) {
  const bytes = await file.arrayBuffer();
  const lower = file.name.toLowerCase();

  if (lower.endsWith(".epub")) {
    const book = await readEpub(bytes);
    return {
      title: book.title,
      author: book.author,
      chapters: book.chapters,
      cover: book.cover,
    };
  }

  if (lower.endsWith(".txt") || lower.endsWith(".md")) {
    const text = new TextDecoder().decode(bytes);
    const fallback = file.name.replace(/\.[^.]+$/, "");
    const { chapters } = readPlainText(text, fallback);
    return { title: fallback, author: "Unknown author", chapters, cover: null };
  }

  throw new Error("Folio reads EPUB and plain text (.txt, .md)");
}

async function importFile(file) {
  toast(`Importing ${file.name}…`, 60000);

  try {
    const parsed = await parseImport(file);
    const cover = parsed.cover
      ? new Blob([parsed.cover.bytes], { type: parsed.cover.type })
      : null;

    await putBook({
      id: idFor(file),
      title: parsed.title,
      author: parsed.author,
      chapterCount: parsed.chapters.length,
      cover,
      bytes: await file.arrayBuffer(),
      fileName: file.name,
      byteSize: file.size,
      addedAt: new Date().toISOString(),
      progress: null,
    });

    await renderLibrary();
    toast(`Added “${parsed.title}” — ${parsed.chapters.length} chapters`);
  } catch (error) {
    toast(`Could not import that: ${error.message}`, 6000);
  }
}

/* -------------------------------------------------------------------------
   Library
   ------------------------------------------------------------------------- */

async function renderLibrary() {
  const books = await listBooks();

  els.empty.hidden = books.length > 0;
  els.shelf.replaceChildren();

  for (const book of books) {
    const item = document.createElement("li");
    item.className = "book";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "book-button";
    button.addEventListener("click", () => openBook(book.id));

    const cover = document.createElement("div");
    cover.className = "cover";
    if (book.cover) {
      const img = document.createElement("img");
      img.src = URL.createObjectURL(book.cover);
      // The object URL is only needed for this render; holding it would leak a
      // copy of every cover for the life of the app.
      img.addEventListener("load", () => URL.revokeObjectURL(img.src), { once: true });
      img.alt = "";
      cover.append(img);
    } else {
      cover.classList.add("cover-blank");
      cover.append(document.createTextNode(book.title.slice(0, 1).toUpperCase()));
    }

    const meta = document.createElement("div");
    meta.className = "book-meta";

    const title = document.createElement("p");
    title.className = "book-title";
    title.textContent = book.title;

    const sub = document.createElement("p");
    sub.className = "book-sub";
    const parts = [book.author, `${book.chapterCount} chapters`].filter(Boolean);
    sub.textContent = parts.join(" · ");

    meta.append(title, sub);

    // Show how far in they are, but only once they have actually started.
    if (book.progress?.chapter) {
      const read = document.createElement("p");
      read.className = "book-progress";
      read.textContent = `Chapter ${book.progress.chapter + 1} of ${book.chapterCount}`;
      meta.append(read);
    }

    button.append(cover, meta);
    item.append(button);
    els.shelf.append(item);
  }
}

/* -------------------------------------------------------------------------
   Reader
   ------------------------------------------------------------------------- */

async function openBook(id) {
  const book = await getBook(id);
  if (!book) {
    toast("That book is no longer in the library");
    await renderLibrary();
    return;
  }

  toast("Opening…", 60000);

  try {
    // Parsing takes a second or two for a long novel, so it happens once per
    // session and the result is kept.
    if (state.bookId !== id || !state.parsed) {
      const lower = (book.fileName ?? "").toLowerCase();
      const parsed = lower.endsWith(".epub")
        ? await readEpub(book.bytes)
        : readPlainText(new TextDecoder().decode(book.bytes), book.title);

      state.parsed = parsed;
      state.bookId = id;
    }

    state.book = book;
    state.chapter = Math.min(book.progress?.chapter ?? 0, state.parsed.chapters.length - 1);

    els.readerBook.textContent = book.title;
    els.library.hidden = true;
    els.libraryBar.hidden = true;
    els.reader.hidden = false;

    renderChapter();
    els.toast.hidden = true;
  } catch (error) {
    toast(`Could not open that book: ${error.message}`, 6000);
  }
}

function renderChapter() {
  const chapters = state.parsed.chapters;
  const chapter = chapters[state.chapter];
  if (!chapter) return;

  els.readerChapter.textContent = chapter.title ?? "";

  // Built as elements rather than innerHTML: the text comes out of a book file,
  // and a novel that happens to contain markup should show it as words.
  const fragment = document.createDocumentFragment();
  for (const block of chapter.blocks) {
    const p = document.createElement("p");
    p.textContent = block;
    fragment.append(p);
  }

  els.chapter.replaceChildren(fragment);
  els.position.textContent = `${state.chapter + 1} / ${chapters.length}`;

  els.prev.disabled = state.chapter === 0;
  els.next.disabled = state.chapter === chapters.length - 1;

  // A new chapter starts at the top; without this the reader keeps the previous
  // chapter's scroll offset and opens halfway down.
  globalThis.scrollTo(0, 0);

  void saveProgress(state.bookId, { chapter: state.chapter, at: Date.now() });
}

function goToChapter(index) {
  const chapters = state.parsed?.chapters ?? [];
  if (index < 0 || index >= chapters.length) return;
  state.chapter = index;
  renderChapter();
}

function closeReader() {
  els.reader.hidden = true;
  els.library.hidden = false;
  els.libraryBar.hidden = false;
  state.parsed = null;
  state.bookId = null;
  state.book = null;
  void renderLibrary();
}

/* -------------------------------------------------------------------------
   Wiring
   ------------------------------------------------------------------------- */

els.importButton.addEventListener("click", () => els.file.click());

els.file.addEventListener("change", async () => {
  const file = els.file.files?.[0];
  // Reset first: a file input keeps its value, so picking the same book again
  // would otherwise fire no change event at all.
  els.file.value = "";
  if (file) await importFile(file);
});

els.closeReader.addEventListener("click", closeReader);
els.prev.addEventListener("click", () => goToChapter(state.chapter - 1));
els.next.addEventListener("click", () => goToChapter(state.chapter + 1));

/**
 * The hardware back button.
 *
 * Leaving a chapter should return to the library, not close the app — which is
 * what Android would otherwise do as soon as the WebView cannot go back.
 */
bridge?.Plugins?.App?.addListener?.("backButton", () => {
  // Settings is a sheet over the reader, so it is what back should close first.
  if (!els.settings.hidden) els.settings.hidden = true;
  else if (!els.reader.hidden) closeReader();
  else bridge?.Plugins?.App?.exitApp?.();
});

/** Match the launch colour to the phone's theme rather than guessing dark. */
function wireStatusBar() {
  const statusBar = bridge?.Plugins?.StatusBar;
  if (!statusBar?.setStyle) return;

  const light = globalThis.matchMedia?.("(prefers-color-scheme: light)").matches ?? false;
  statusBar.setStyle({ style: light ? "LIGHT" : "DARK" }).catch(() => {});
  statusBar.setBackgroundColor?.({ color: light ? "#f7f4ef" : "#0c0e13" }).catch(() => {});
}

async function start() {
  wireStatusBar();
  wireSettings();
  await renderLibrary();
  bridge?.Plugins?.SplashScreen?.hide?.().catch(() => {});
}

void start();
