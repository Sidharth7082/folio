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
import { paint, rangeFor, unpaint } from "./lib/highlight.js";
import { readPlainText } from "./lib/plain.js";
import { findInBook } from "./lib/search.js";
import { SOURCES, labelFor, loadSources, saveSources } from "./lib/sources.js";
import { getBook, listBooks, putBook, saveProgress } from "./lib/store.js";
import { collectChunks, createSpeech, firstAt } from "./lib/tts.js";
import {
  FONTS,
  LIMITS,
  THEMES,
  applyCustomCss,
  applySettings,
  forgetBookSettings,
  hasOwnSettings,
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
  openChapters: document.getElementById("open-chapters"),
  chapters: document.getElementById("chapters"),
  closeChapters: document.getElementById("close-chapters"),
  chapterFilter: document.getElementById("chapter-filter"),
  chapterList: document.getElementById("chapter-list"),
  chapterCount: document.getElementById("chapter-count"),
  openSearch: document.getElementById("open-search"),
  search: document.getElementById("search"),
  closeSearch: document.getElementById("close-search"),
  searchText: document.getElementById("search-text"),
  searchStatus: document.getElementById("search-status"),
  searchResults: document.getElementById("search-results"),
  scopeChips: document.getElementById("scope-chips"),
  openBackup: document.getElementById("open-backup"),
  backup: document.getElementById("backup"),
  closeBackup: document.getElementById("close-backup"),
  backupText: document.getElementById("backup-text"),
  copyBackup: document.getElementById("copy-backup"),
  pasteBackup: document.getElementById("paste-backup"),
  restoreBackup: document.getElementById("restore-backup"),
  openSources: document.getElementById("open-sources"),
  sources: document.getElementById("sources"),
  sourcesList: document.getElementById("sources-list"),
  sourceList: document.getElementById("source-list"),
  sourceAdd: document.getElementById("source-add"),
  sourceUrl: document.getElementById("source-url"),
  addSource: document.getElementById("add-source"),
  closeSources: document.getElementById("close-sources"),
  sourcesBrowse: document.getElementById("sources-browse"),
  browseTitle: document.getElementById("browse-title"),
  browseUp: document.getElementById("browse-up"),
  browseList: document.getElementById("browse-list"),
  browseBack: document.getElementById("browse-back"),
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

/** Whether the sheet is changing this book's own settings or the shared ones. */
let settingsScope = "shared";

/** How each setting reads in the sheet. */
const FORMATS = {
  textSize: (value) => `${Math.round(value)}px`,
  lineHeight: (value) => value.toFixed(2),
  padding: (value) => `${Math.round(value)}px`,
  speechRate: (value) => `${Number(value.toFixed(2))}×`,
};

function apply() {
  applySettings(els.reader, settings);
  applyCustomCss(settings.customCss);
}

function persist() {
  // Into the book's own key while the sheet is set to this book, and into the
  // shared one otherwise, which is what makes the two independent.
  saveSettings(settings, settingsScope === "book" ? state.bookId : undefined);
  apply();
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

  els.scopeChips.replaceChildren(
    chip("Every book", settingsScope === "shared", () => setScope("shared")),
    chip("This book", settingsScope === "book", () => setScope("book")),
  );
}

/**
 * Where the settings in the sheet are kept.
 *
 * Going back to the shared ones throws away this book's own copy, which is the
 * only way to say "this book looks like every other book again".
 */
function setScope(scope) {
  if (scope === settingsScope) return;
  settingsScope = scope;

  if (scope === "shared" && hasOwnSettings(state.bookId)) {
    forgetBookSettings(state.bookId);
    settings = loadSettings();
    toast("This book follows the shared settings again.");
  } else if (scope === "book") {
    toast("This book keeps its own settings from now on.");
  }

  persist();
  syncSettingsInputs();
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
function wireRange(input, output, key) {
  const { min, max, step } = LIMITS[key];
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  syncRange(input, output, key);

  input.addEventListener("input", () => {
    settings[key] = Number(input.value);
    output.textContent = FORMATS[key](settings[key]);
    persist();
  });
}

/** Point a slider at its setting without listening to it. */
function syncRange(input, output, key) {
  input.value = String(settings[key]);
  output.textContent = FORMATS[key](settings[key]);
}

function wireSettings() {
  wireRange(els.textSize, els.textSizeOut, "textSize");
  wireRange(els.lineHeight, els.lineHeightOut, "lineHeight");
  wireRange(els.padding, els.paddingOut, "padding");
  wireRange(els.speechRate, els.speechRateOut, "speechRate");

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

  els.openSettings.addEventListener("click", () => openSheet(els.settings));
  els.closeSettings.addEventListener("click", closeSheets);

  // Re-resolve the palette when the device flips between light and dark, which
  // otherwise leaves the System theme showing the old one until a reload.
  globalThis.matchMedia?.("(prefers-color-scheme: light)").addEventListener?.("change", () => {
    if (settings.theme === "system") persist();
  });

  renderChips();
  persist();
}

/** Point every control in the sheet at the settings currently in force. */
function syncSettingsInputs() {
  syncRange(els.textSize, els.textSizeOut, "textSize");
  syncRange(els.lineHeight, els.lineHeightOut, "lineHeight");
  syncRange(els.padding, els.paddingOut, "padding");
  syncRange(els.speechRate, els.speechRateOut, "speechRate");
  els.customCss.value = settings.customCss;
  renderChips();
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

  // The voice paints its own highlight, and a search hit left underneath it
  // would only be confusing.
  unpaint("folio-search");

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
 * Bringing the same book in twice replaces it rather than adding a second copy,
 * which is what someone re-downloading it actually wants — whether it came from
 * the system picker or from a catalogue.
 */
function idFor(name, size) {
  let hash = 0;
  const key = `${name}:${size}`;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) | 0;
  }
  return `b${(hash >>> 0).toString(36)}`;
}

/** Read a book file, from anywhere, into the shape the library stores. */
async function parseBytes(bytes, name) {
  const lower = name.toLowerCase();

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
    const fallback = name.replace(/\.[^.]+$/, "");
    const { chapters } = readPlainText(text, fallback);
    return { title: fallback, author: "Unknown author", chapters, cover: null };
  }

  throw new Error("Folio reads EPUB and plain text (.txt, .md)");
}

/** Parse a book and put it in the library, replacing any copy already there. */
async function addBook(bytes, fileName) {
  const parsed = await parseBytes(bytes, fileName);
  const id = idFor(fileName, bytes.byteLength);

  // Where you had got to survives a re-download, which is the difference
  // between replacing a book and losing your place in it.
  const already = await getBook(id);

  await putBook({
    id,
    title: parsed.title,
    author: parsed.author,
    chapterCount: parsed.chapters.length,
    cover: parsed.cover ? new Blob([parsed.cover.bytes], { type: parsed.cover.type }) : null,
    bytes,
    fileName,
    byteSize: bytes.byteLength,
    addedAt: new Date().toISOString(),
    progress: already?.progress ?? null,
  });

  await renderLibrary();
  return parsed;
}

async function importFile(file) {
  toast(`Importing ${file.name}…`, 60000);

  try {
    const parsed = await addBook(await file.arrayBuffer(), file.name);
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
      // Clamped: a backup can carry a position from a longer version of the same
      // book, and "Chapter 8 of 3" is not a thing.
      const at = Math.min(book.progress.chapter + 1, book.chapterCount);
      read.textContent = `Chapter ${at} of ${book.chapterCount}`;
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
  closeSheets();

  // A query from the last book would be answering the wrong question.
  els.searchText.value = "";
  els.searchResults.replaceChildren();
  els.searchStatus.textContent = "";

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

    // A book may have typography of its own, and without it, the shared kind.
    settings = loadSettings(id);
    settingsScope = hasOwnSettings(id) ? "book" : "shared";
    apply();
    syncSettingsInputs();

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

  // A search hit belongs to the chapter it was found in, and this is another one.
  unpaint("folio-search");

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
 * Go to a chapter: the arrows, the list, or a search result.
 *
 * Someone listening who skips ahead expects to keep listening — stopping dead
 * because the chapter changed would be the wrong kind of surprise.
 */
function jumpToChapter(index) {
  if (index < 0 || index >= (state.parsed?.chapters.length ?? 0)) return;

  const before = speech.state();
  if (before.open) speech.stop();

  goToChapter(index);
  if (before.playing) speakFromStart();
}

function turnChapter(delta) {
  jumpToChapter(state.chapter + delta);
}

function closeReader() {
  speech.stop();
  closeSheets();
  els.reader.hidden = true;
  els.library.hidden = false;
  els.libraryBar.hidden = false;
  state.parsed = null;
  state.bookId = null;
  state.book = null;
  void renderLibrary();
}

/* -------------------------------------------------------------------------
   Chapters and search
   ------------------------------------------------------------------------- */

const sheets = [els.settings, els.chapters, els.search, els.backup, els.sources];

/** Only one sheet is open at a time; opening one puts the others away. */
function openSheet(sheet) {
  for (const other of sheets) other.hidden = other !== sheet;
  sheet.hidden = false;
}

/** Put away whatever sheet is open. Answers whether there was one. */
function closeSheets() {
  let closed = false;
  for (const sheet of sheets) {
    if (!sheet.hidden) {
      sheet.hidden = true;
      closed = true;
    }
  }
  return closed;
}

/** Every chapter, filtered by whatever is in the box. */
function renderChapterList(filter = "") {
  const chapters = state.parsed?.chapters ?? [];
  const needle = filter.trim().toLowerCase();
  const rows = [];

  for (let index = 0; index < chapters.length; index += 1) {
    const title = chapters[index].title ?? `Chapter ${index + 1}`;
    if (needle && !`${index + 1} ${title}`.toLowerCase().includes(needle)) continue;

    const number = document.createElement("span");
    number.className = "pick-number";
    number.textContent = String(index + 1);

    const label = document.createElement("span");
    label.className = "pick-title";
    label.textContent = title;

    const button = document.createElement("button");
    button.type = "button";
    button.className = index === state.chapter ? "pick pick-on" : "pick";
    button.append(number, label);
    button.addEventListener("click", () => {
      els.chapters.hidden = true;
      jumpToChapter(index);
    });

    const item = document.createElement("li");
    item.append(button);
    rows.push(item);
  }

  els.chapterList.replaceChildren(...rows);
  els.chapterCount.textContent = needle
    ? `${rows.length} of ${chapters.length}`
    : String(chapters.length);
}

function openChapterList() {
  els.chapterFilter.value = "";
  renderChapterList();

  // Opened before it is scrolled: while the sheet is hidden nothing in it has a
  // height, so a scroll position set first is quietly thrown away.
  openSheet(els.chapters);

  // Where you are has to be findable in a list of a thousand, so the list opens
  // with the current chapter in the middle. Setting scrollTop rather than
  // calling scrollIntoView, so the chapter behind the sheet does not move too.
  const current = els.chapterList.querySelector(".pick-on");
  if (current) {
    const within = current.offsetTop - els.chapterList.offsetTop;
    els.chapterList.scrollTop = within - els.chapterList.clientHeight / 2;
  }
}

/* ---- searching the book ---- */

let searchTimer = null;

function runSearch() {
  const query = els.searchText.value;
  const chapters = state.parsed?.chapters ?? [];

  if (query.trim().length < 2) {
    els.searchResults.replaceChildren();
    els.searchStatus.textContent = "Two letters or more, and it looks through every chapter.";
    return;
  }

  const { matches, total, limited } = findInBook(chapters, query);

  els.searchStatus.textContent =
    total === 0
      ? `Nothing matches “${query.trim()}”.`
      : limited
        ? `${total} matches — showing the first ${matches.length}.`
        : `${total} ${total === 1 ? "match" : "matches"}.`;

  els.searchResults.replaceChildren(
    ...matches.map((match) => {
      const where = document.createElement("span");
      where.className = "result-where";
      where.textContent = chapters[match.chapter]?.title ?? `Chapter ${match.chapter + 1}`;

      const text = document.createElement("span");
      text.className = "result-text";
      const hit = document.createElement("mark");
      hit.textContent = match.hit;
      text.append(`…${match.before}`, hit, `${match.after}…`);

      const button = document.createElement("button");
      button.type = "button";
      button.className = "result";
      button.append(where, text);
      button.addEventListener("click", () => openMatch(match));

      const item = document.createElement("li");
      item.append(button);
      return item;
    }),
  );
}

/** Open the chapter a result came from, at the match. */
function openMatch(match) {
  closeSheets();
  jumpToChapter(match.chapter);

  const block = els.chapter.children[match.block];
  const range = block && rangeFor(block, match.start, match.end);
  if (!range || !paint("folio-search", range)) return;

  const rect = range.getBoundingClientRect();
  globalThis.scrollTo({ top: Math.max(0, globalThis.scrollY + rect.top - 120), behavior: "smooth" });
}

/* -------------------------------------------------------------------------
   Backup
   ------------------------------------------------------------------------- */

/**
 * What a backup holds.
 *
 * The settings, each book's own type, and how far into each book you are. Not
 * the books themselves: they are megabytes each, and the files they came from
 * are still wherever they came from.
 */
async function buildBackup() {
  const books = await listBooks();
  const entries = {};

  for (const book of books) {
    const entry = {};
    if (book.progress) entry.progress = book.progress;
    if (hasOwnSettings(book.id)) entry.settings = loadSettings(book.id);
    if (Object.keys(entry).length) entries[book.id] = entry;
  }

  return {
    app: "folio",
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: loadSettings(),
    books: entries,
  };
}

async function openBackup() {
  openSheet(els.backup);
  els.backupText.value = "Reading the library…";
  els.backupText.value = JSON.stringify(await buildBackup(), null, 2);
}

async function copyBackup() {
  const text = els.backupText.value;

  // The native clipboard first, because the WebView refuses its own.
  const clipboard = globalThis.Capacitor?.Plugins?.FolioClipboard;
  if (clipboard) {
    try {
      await clipboard.copy({ text });
      toast("Backup copied to the clipboard.");
      return;
    } catch {
      // Fall through to the browser's own attempts below.
    }
  }

  // Selected before anything is attempted: both ways of copying below work off
  // the selection, and it is also the fallback the user is left with.
  els.backupText.focus();
  els.backupText.select();

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      toast("Backup copied to the clipboard.");
      return;
    } catch {
      // WebViews commonly refuse the async clipboard unless the app grants a
      // native permission, so try the older way before giving up.
    }
  }

  if (document.execCommand?.("copy")) {
    toast("Backup copied to the clipboard.");
    return;
  }

  toast("Copying automatically is blocked here — the text is selected, long-press to copy.", 6000);
}

/** Fill the box from the clipboard, for someone restoring onto a new phone. */
async function pasteBackup() {
  const clipboard = globalThis.Capacitor?.Plugins?.FolioClipboard;
  if (!clipboard) {
    toast("Pasting needs the native clipboard, which this build does not have.", 6000);
    return;
  }

  try {
    const { text } = await clipboard.read();
    if (!text) {
      toast("The clipboard is empty.");
      return;
    }
    els.backupText.value = text;
    toast("Pasted. Tap Restore to use it.");
  } catch (error) {
    toast(error?.message ?? "Could not read the clipboard.", 6000);
  }
}

async function restoreBackup() {
  let data;
  try {
    data = JSON.parse(els.backupText.value);
  } catch {
    toast("That is not backup text — copy the whole block, exactly.", 6000);
    return;
  }

  if (data?.app !== "folio" || !data.books || typeof data.books !== "object") {
    toast("That is not a Folio backup.", 6000);
    return;
  }

  const known = new Set((await listBooks()).map((book) => book.id));
  let restored = 0;
  let absent = 0;

  for (const [id, entry] of Object.entries(data.books)) {
    if (!known.has(id)) {
      absent += 1;
      continue;
    }
    if (entry?.progress) await saveProgress(id, entry.progress);
    if (entry?.settings) saveSettings(entry.settings, id);
    restored += 1;
  }

  if (data.settings) {
    saveSettings(data.settings);
    settings = loadSettings();
    settingsScope = "shared";
    apply();
    syncSettingsInputs();
  }

  await renderLibrary();
  toast(
    `Restored ${restored} ${restored === 1 ? "book" : "books"}` +
      (absent ? ` — ${absent} are not in this library.` : "."),
    6000,
  );
}

/* -------------------------------------------------------------------------
   Sources
   ------------------------------------------------------------------------- */

let sources = loadSources();

/** Which source is being browsed, and the feeds leading back out of it. */
let browsing = null;

function renderSources() {
  if (!sources.length) {
    const nothing = document.createElement("li");
    nothing.className = "sheet-hint";
    nothing.textContent = "Nothing yet. Add the address of a catalogue you already use.";
    els.sourceList.replaceChildren(nothing);
    return;
  }

  els.sourceList.replaceChildren(
    ...sources.map((source, index) => {
      const label = document.createElement("span");
      label.className = "pick-title";
      label.textContent = labelFor(source.id, source.config);

      const open = document.createElement("button");
      open.type = "button";
      open.className = "pick";
      open.append(label);
      open.addEventListener("click", () => void openSource(index));

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "pick-x";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `Remove ${label.textContent}`);
      remove.addEventListener("click", () => {
        sources.splice(index, 1);
        saveSources(sources);
        renderSources();
      });

      const item = document.createElement("li");
      item.className = "source-row";
      item.append(open, remove);
      return item;
    }),
  );
}

async function addSource() {
  const url = els.sourceUrl.value.trim();
  if (!url) {
    toast("Type the address first.");
    return;
  }

  // Read once before keeping it: an address that is wrong is much easier to
  // deal with now than after it has been saved and listed.
  try {
    await SOURCES.opds.browse({ url }, null);
  } catch (error) {
    toast(`That address did not answer — ${error?.message ?? error}`, 6000);
    return;
  }

  sources = sources.filter((source) => source.config.url !== url);
  sources.push({ id: "opds", config: { url } });
  saveSources(sources);

  els.sourceUrl.value = "";
  els.sourceAdd.open = false;
  renderSources();
  toast("Added. Tap it to browse.");
}

async function openSource(index) {
  browsing = { source: sources[index], href: null, trail: [] };
  els.sourcesList.hidden = true;
  els.sourcesBrowse.hidden = false;
  await showFeed(null);
}

/** Load one feed and show it. `href` of null means the source's own address. */
async function showFeed(href) {
  const { source } = browsing;
  els.browseTitle.textContent = "Loading…";
  els.browseList.replaceChildren();
  els.browseUp.disabled = browsing.trail.length === 0;

  try {
    const feed = await SOURCES[source.id].browse(source.config, href);
    browsing.href = href;
    els.browseTitle.textContent = feed.title;
    renderEntries(feed.entries);
  } catch (error) {
    els.browseTitle.textContent = "Could not read that";
    const problem = document.createElement("li");
    problem.className = "sheet-hint";
    problem.textContent = error?.message ?? String(error);
    els.browseList.replaceChildren(problem);
  }
}

function renderEntries(entries) {
  if (!entries.length) {
    const nothing = document.createElement("li");
    nothing.className = "sheet-hint";
    nothing.textContent = "Nothing in this one.";
    els.browseList.replaceChildren(nothing);
    return;
  }

  els.browseList.replaceChildren(
    ...entries.map((entry) => {
      const title = document.createElement("span");
      title.className = "pick-title";
      title.textContent = entry.title;

      const meta = document.createElement("span");
      meta.className = "result-where";
      meta.textContent = entry.kind === "feed" ? "Folder" : entry.author || "Book";

      const button = document.createElement("button");
      button.type = "button";
      button.className = "pick";
      button.append(title, meta);
      button.addEventListener("click", () => {
        if (entry.kind === "feed") {
          browsing.trail.push(browsing.href);
          void showFeed(entry.href);
        } else {
          void download(entry, button, meta);
        }
      });

      const item = document.createElement("li");
      item.append(button);
      return item;
    }),
  );
}

/** Fetch one book from a catalogue and put it in the library. */
async function download(entry, button, meta) {
  button.disabled = true;
  meta.textContent = "Downloading…";

  try {
    const { bytes, fileName } = await SOURCES[browsing.source.id].book(browsing.source.config, entry);
    meta.textContent = "Adding…";
    const parsed = await addBook(bytes, fileName);
    meta.textContent = `In your library — ${parsed.chapters.length} chapters`;
    toast(`Added “${parsed.title}”`);
  } catch (error) {
    meta.textContent = error?.message ?? "That did not work.";
    button.disabled = false;
  }
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

els.openChapters.addEventListener("click", openChapterList);
els.closeChapters.addEventListener("click", closeSheets);
els.chapterFilter.addEventListener("input", () => renderChapterList(els.chapterFilter.value));

els.openBackup.addEventListener("click", openBackup);
els.closeBackup.addEventListener("click", closeSheets);
els.copyBackup.addEventListener("click", copyBackup);
els.pasteBackup.addEventListener("click", pasteBackup);
els.restoreBackup.addEventListener("click", restoreBackup);

els.openSources.addEventListener("click", () => {
  renderSources();
  els.sourcesList.hidden = false;
  els.sourcesBrowse.hidden = true;
  openSheet(els.sources);
});
els.closeSources.addEventListener("click", closeSheets);
els.addSource.addEventListener("click", addSource);
els.browseBack.addEventListener("click", () => {
  els.sourcesBrowse.hidden = true;
  els.sourcesList.hidden = false;
});
els.browseUp.addEventListener("click", () => {
  void showFeed(browsing.trail.pop() ?? null);
});

els.openSearch.addEventListener("click", () => {
  openSheet(els.search);
  els.searchText.focus();
});
els.closeSearch.addEventListener("click", closeSheets);
els.searchText.addEventListener("input", () => {
  // Waited out, so a fast typist does not search the book once per letter.
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 200);
});

/**
 * The hardware back button.
 *
 * Leaving a chapter should return to the library, not close the app — which is
 * what Android would otherwise do as soon as the WebView cannot go back.
 */
bridge?.Plugins?.App?.addListener?.("backButton", () => {
  // A sheet is on top of everything else, so it is what back puts away first;
  // then the voice, then the book itself.
  if (closeSheets()) {
    // A sheet was open and has just been put away.
  } else if (speech.state().open) speech.stop();
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
