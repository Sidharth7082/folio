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
import { collectChunks, createSpeech, firstAt } from "./lib/tts.js";
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
  readAloud: document.getElementById("read-aloud"),
  player: document.getElementById("player"),
  speakPrev: document.getElementById("speak-prev"),
  speakToggle: document.getElementById("speak-toggle"),
  speakNext: document.getElementById("speak-next"),
  speakRate: document.getElementById("speak-rate"),
  speakStop: document.getElementById("speak-stop"),
  playerNow: document.getElementById("player-now"),
  speechRate: document.getElementById("speech-rate"),
  speechRateOut: document.getElementById("speech-rate-out"),
  advanceChips: document.getElementById("advance-chips"),
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

  els.advanceChips.replaceChildren(
    chip("Stop", !settings.speechAdvance, () => {
      settings.speechAdvance = false;
      persist();
      renderChips();
    }),
    chip("Keep reading", settings.speechAdvance, () => {
      settings.speechAdvance = true;
      persist();
      renderChips();
    }),
  );
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
  wireRange(els.speechRate, els.speechRateOut, "speechRate", formatRate);

  // Only once the finger is off the slider: re-speaking on every step of a drag
  // would stutter through the sentence.
  els.speechRate.addEventListener("change", () => speech.refresh());

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
   Reading aloud
   ------------------------------------------------------------------------- */

/** The speeds the chip steps through; the slider covers everything between. */
const RATES = [0.75, 1, 1.25, 1.5, 2];

let ttsPlugin = null;

/**
 * The speech plugin, if this build has one.
 *
 * The bridge belongs to the native shell, and on a build without one — the app
 * opened in an ordinary browser — there is simply no voice. That has to be a
 * survivable state rather than a crash, so this answers with null. It waits a
 * moment because the bridge is injected around the time the first script runs.
 */
async function findSpeech() {
  if (ttsPlugin) return ttsPlugin;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const found = globalThis.Capacitor?.Plugins?.FolioTts;
    if (found) {
      ttsPlugin = found;
      speech.attach(found);
      return found;
    }
    await new Promise((done) => setTimeout(done, 100));
  }

  return null;
}

const speech = createSpeech({
  plugin: () => ttsPlugin,
  rate: () => settings.speechRate,
  language: () => state.parsed?.language ?? "",
  onState: renderPlayer,
  onError: (message) => toast(message, 5000),
  onChapterEnd: afterChapterSpoken,
});

function formatRate(value) {
  return `${Number(value.toFixed(2))}×`;
}

function renderPlayer() {
  const { open, playing, index, total } = speech.state();

  els.player.hidden = !open;
  els.playerNow.textContent = open ? `${index + 1} / ${total}` : "";
  els.reader.classList.toggle("reading-aloud", open);
  els.readAloud.classList.toggle("on", open);
  if (!open) return;

  els.speakToggle.dataset.state = playing ? "playing" : "paused";
  els.speakToggle.setAttribute("aria-label", playing ? "Pause reading" : "Carry on reading");
  els.speakRate.textContent = formatRate(settings.speechRate);
  els.speakPrev.disabled = index === 0;
  els.speakNext.disabled = index >= total - 1;
}

/** Tap the speed chip to step through the presets, wrapping round. */
function cycleRate() {
  settings.speechRate = RATES.find((value) => value > settings.speechRate + 0.001) ?? RATES[0];
  persist();

  // The slider in the settings sheet has to follow, or it would still show the
  // speed from before the chip was tapped.
  els.speechRate.value = String(settings.speechRate);
  els.speechRateOut.textContent = formatRate(settings.speechRate);

  renderPlayer();
  speech.refresh();
}

async function startSpeaking() {
  const engine = await findSpeech();
  if (!engine) {
    toast("This build has no speech bridge, so there is nothing to read with.");
    return;
  }

  const status = await engine.status().catch(() => null);
  if (!status?.available) {
    toast(status?.reason ?? "This phone has no text-to-speech engine.");
    return;
  }

  const chunks = collectChunks(els.chapter);
  if (!chunks.length) {
    toast("There is nothing in this chapter to read.");
    return;
  }

  // Start where the eye already is, rather than sending someone back to the top
  // of a chapter they are halfway through.
  const bar = els.reader.querySelector(".reader-bar");
  const from = firstAt(chunks, (bar?.getBoundingClientRect().bottom ?? 0) + 8);

  speech.load(chunks);
  speech.start(from);
}

/** Read the chapter on screen from its first sentence. */
function speakFromStart() {
  const chunks = collectChunks(els.chapter);
  if (!chunks.length) return;
  speech.load(chunks);
  speech.start(0);
}

/** A chapter that ended because it was being listened to, not tapped through. */
function afterChapterSpoken() {
  if (!settings.speechAdvance) {
    speech.stop();
    toast("End of chapter.");
    return;
  }

  if (state.chapter + 1 >= (state.parsed?.chapters.length ?? 0)) {
    speech.stop();
    toast("That was the last chapter.");
    return;
  }

  goToChapter(state.chapter + 1);
  speakFromStart();
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
  speech.stop();

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

/**
 * Turning the page by hand.
 *
 * Someone listening who skips ahead expects to keep listening — stopping dead
 * because the chapter changed would be the wrong kind of surprise.
 */
function turnChapter(delta) {
  const target = state.chapter + delta;
  if (target < 0 || target >= (state.parsed?.chapters.length ?? 0)) return;

  const before = speech.state();
  if (before.open) speech.stop();

  goToChapter(target);
  if (before.playing) speakFromStart();
}

function closeReader() {
  speech.stop();
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
els.prev.addEventListener("click", () => turnChapter(-1));
els.next.addEventListener("click", () => turnChapter(1));

els.readAloud.addEventListener("click", () => {
  if (speech.state().open) speech.stop();
  else void startSpeaking();
});

els.speakToggle.addEventListener("click", () => {
  if (speech.state().playing) speech.pause();
  else speech.resume();
});

els.speakPrev.addEventListener("click", () => speech.previous());
els.speakNext.addEventListener("click", () => speech.next());
els.speakStop.addEventListener("click", () => speech.stop());
els.speakRate.addEventListener("click", () => cycleRate());

/**
 * The hardware back button.
 *
 * Leaving a chapter should return to the library, not close the app — which is
 * what Android would otherwise do as soon as the WebView cannot go back.
 */
bridge?.Plugins?.App?.addListener?.("backButton", () => {
  // Settings is a sheet over the reader, and the voice is over the text, so back
  // puts away whichever of them is on top before it closes the book.
  if (!els.settings.hidden) els.settings.hidden = true;
  else if (speech.state().open) speech.stop();
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
  // Resolved up front, so the first tap on Listen does not wait for the bridge
  // and a build without one finds out immediately.
  void findSpeech();
  await renderLibrary();
  bridge?.Plugins?.SplashScreen?.hide?.().catch(() => {});
}

void start();
