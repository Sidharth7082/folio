/*
 * Reading a chapter aloud.
 *
 * The WebView cannot speak. `speechSynthesis` is undefined inside it — checked
 * on a device rather than assumed — so the voice comes from the phone's own
 * engine through the FolioTts plugin. Everything else happens here: where the
 * sentences are, which one is being spoken, and what the screen shows while it
 * is happening.
 *
 * The queue holds one sentence at a time instead of handing the whole chapter to
 * the engine. That buys three things: the highlight can follow the voice, pausing
 * can pick up where it left off, and a sentence the engine chokes on costs one
 * sentence rather than the rest of the chapter.
 */

/** Longest sentence worth speaking in one go, for the sake of the highlight. */
const MAX_CHARS = 240;

/*
 * Words whose full stop is not the end of a sentence.
 *
 * Only needed for `.` — `!`, `?` and the CJK terminators always end one. The
 * list stays close to the abbreviations a novel actually contains, because
 * leaving one out merges two sentences into a single breath while adding a word
 * that is not really an abbreviation splits one in half.
 */
const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "mx", "dr", "prof", "rev", "hon", "sr", "jr", "st", "vs",
  "etc", "al", "e.g", "i.e", "cf", "ca", "approx", "est", "fig", "vol", "trans",
  "inc", "ltd", "co", "corp", "univ", "dept", "gen", "col", "sgt", "capt", "lt",
  "maj", "cmdr", "adm", "gov", "sen", "rep", "pres", "mt",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
]);

/*
 * Where one sentence ends and the next begins.
 *
 * A stop needs a terminator plus whitespace after it, which is what keeps
 * "3.5" and "U.S.A." whole without needing to know about either. The CJK
 * terminators are allowed to break on their own, because those scripts put no
 * space after a full stop. Closing quotes and brackets are pulled in before the
 * break, so the highlight covers them instead of leaving them behind.
 */
const BREAK = /([.!?…]+|。|！|？)([)"'”’»」』\]]*)(\s+|(?<=[。！？」』]))/gu;

/** Text nodes of an element, and the string they concatenate into. */
const MAPS = new WeakMap();

function nodeMap(element) {
  const cached = MAPS.get(element);
  if (cached) return cached;

  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let text = "";

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    nodes.push({ node, start: text.length, end: text.length + node.data.length });
    text += node.data;
  }

  const map = { text, nodes };
  MAPS.set(element, map);
  return map;
}

/** Which text node an offset into the element's text lands in. */
function locate(map, offset) {
  for (const entry of map.nodes) {
    if (offset >= entry.start && offset <= entry.end) {
      return { node: entry.node, offset: offset - entry.start };
    }
  }
  return null;
}

/** A DOM range for a chunk, so it can be highlighted or measured. */
function rangeFor(chunk) {
  const map = nodeMap(chunk.element);
  const from = locate(map, chunk.start);
  const to = locate(map, chunk.end);
  if (!from || !to) return null;

  const range = document.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  return range;
}

/** Sentence boundaries in a run of text, as offsets. */
function sentencesOf(text) {
  const out = [];
  let start = 0;

  BREAK.lastIndex = 0;
  for (let match; (match = BREAK.exec(text)); ) {
    if (/^\.+$/.test(match[1])) {
      // `[\p{L}\p{N}.'’]` rather than letters alone so that "don't." is not
      // mistaken for a one-letter word and skipped as an initial.
      const word = (text.slice(0, match.index).match(/[\p{L}\p{N}.'’]+$/u) ?? [""])[0];
      if (ABBREVIATIONS.has(word.toLowerCase()) || word.length === 1) continue;
    }

    out.push({ start, end: match.index + match[1].length + match[2].length });
    start = match.index + match[0].length;
  }

  if (start < text.length) out.push({ start, end: text.length });
  return out;
}

/**
 * Break a span that is too long to highlight in one piece.
 *
 * Scanned from the limit backwards so the cut lands on the latest sensible
 * place — a semicolon, a dash, a comma, and only then a space — and never so
 * early that the leftover is a scrap.
 */
function carve(text, start, end) {
  const pieces = [];
  let from = start;

  while (end - from > MAX_CHARS) {
    const limit = from + MAX_CHARS;
    const floor = from + MAX_CHARS * 0.4;
    let at = -1;

    for (const soft of [";", ":", "—", ","]) {
      for (let index = limit; index > floor; index -= 1) {
        if (text[index] === soft) {
          at = index + 1;
          break;
        }
      }
      if (at > 0) break;
    }

    if (at < 0) {
      for (let index = limit; index > floor; index -= 1) {
        if (text[index] === " ") {
          at = index;
          break;
        }
      }
    }

    pieces.push({ start: from, end: at < 0 ? limit : at });
    from = at < 0 ? limit : at;
  }

  pieces.push({ start: from, end });
  return pieces;
}

/** Trim a piece to real words, or reject it. */
function tidy(text, piece) {
  let start = piece.start;
  let end = piece.end;

  while (start < end && /\s/.test(text[start])) start += 1;
  while (end > start && /\s/.test(text[end - 1])) end -= 1;
  if (end <= start) return null;

  // A paragraph of nothing but punctuation has no voice, and some engines
  // report an error for one — which, with one sentence in flight at a time,
  // would stop the chapter dead.
  if (!/[\p{L}\p{N}]/u.test(text.slice(start, end))) return null;

  return { start, end };
}

function chunksOfElement(element) {
  const { text } = nodeMap(element);
  if (!text.trim()) return [];

  const out = [];
  for (const sentence of sentencesOf(text)) {
    for (const piece of carve(text, sentence.start, sentence.end)) {
      const kept = tidy(text, piece);
      if (kept) {
        out.push({
          element,
          start: kept.start,
          end: kept.end,
          text: text.slice(kept.start, kept.end),
        });
      }
    }
  }
  return out;
}

/** Every sentence in a rendered chapter, in the order they should be spoken. */
export function collectChunks(article) {
  const chunks = [];
  for (const element of article.children) chunks.push(...chunksOfElement(element));
  return chunks;
}

/**
 * The first sentence at or below a line across the page.
 *
 * Used so that tapping Listen starts where the reader's eye already is, rather
 * than sending them back to the top of a chapter they are halfway through.
 */
export function firstAt(chunks, y) {
  for (let index = 0; index < chunks.length; index += 1) {
    const rect = rangeFor(chunks[index])?.getBoundingClientRect();
    if (rect && rect.bottom > y) return index;
  }
  return 0;
}

/** Whether this browser can paint a highlight that is not an element. */
function canPaint() {
  return typeof Highlight === "function" && Boolean(globalThis.CSS?.highlights);
}

/**
 * The player.
 *
 * `plugin` is a getter rather than the plugin itself, because on a build with
 * no native bridge there is nothing to hand over and the reader should still
 * load books.
 */
export function createSpeech({
  plugin,
  rate,
  language,
  onState = () => {},
  onError = () => {},
  onChapterEnd = () => {},
}) {
  const SAY = "folio-speech";
  const WORD = "folio-speech-word";

  let chunks = [];
  let index = 0;
  let open = false;
  let playing = false;
  let retries = 0;

  // The id of the utterance being waited on. Events for any other id are the
  // past catching up — a sentence that was skipped or stopped — and are ignored,
  // which is what keeps skipping quickly from advancing the queue twice.
  let waiting = "";

  let seq = 0;

  function state() {
    return { open, playing, index, total: chunks.length };
  }

  function publish() {
    onState(state());
  }

  function paintSentence() {
    const chunk = chunks[index];
    const range = chunk && rangeFor(chunk);
    if (!range || !canPaint()) return;
    globalThis.CSS.highlights.set(SAY, new Highlight(range));
  }

  function paintWord({ start, end }) {
    const chunk = chunks[index];
    if (!chunk || !canPaint()) return;

    const length = chunk.end - chunk.start;
    const from = Math.max(0, Math.min(start, length));
    const to = Math.max(from, Math.min(end, length));
    if (to <= from) return;

    const range = rangeFor({ element: chunk.element, start: chunk.start + from, end: chunk.start + to });
    if (range) globalThis.CSS.highlights.set(WORD, new Highlight(range));
  }

  function clearPaint() {
    if (!canPaint()) return;
    globalThis.CSS.highlights.delete(SAY);
    globalThis.CSS.highlights.delete(WORD);
  }

  /** Keep the sentence being read on screen, without dragging it around. */
  function keepVisible(chunk) {
    const rect = rangeFor(chunk)?.getBoundingClientRect();
    if (!rect) return;

    const top = 96; // clear of the reader's own bar
    const bottom = globalThis.innerHeight - 150; // clear of the player
    if (rect.top >= top && rect.bottom <= bottom) return;

    globalThis.scrollTo({ top: globalThis.scrollY + rect.top - 112, behavior: "smooth" });
  }

  function isStarting(error) {
    return error?.code === "not_ready" || /still starting/i.test(error?.message ?? "");
  }

  async function speakCurrent() {
    const chunk = chunks[index];
    if (!chunk) {
      stop();
      return;
    }

    const engine = plugin();
    if (!engine) {
      fail("This build has no speech bridge.");
      return;
    }

    waiting = `s${(seq += 1)}`;
    paintSentence();
    clearPaintWord();
    keepVisible(chunk);

    try {
      await engine.speak({
        text: chunk.text,
        id: waiting,
        rate: rate(),
        lang: language() || "",
      });
      retries = 0;
    } catch (error) {
      // The engine binds asynchronously when the app starts, so the first tap
      // can arrive before it is willing to talk.
      if (retries < 3 && isStarting(error)) {
        retries += 1;
        globalThis.setTimeout(speakCurrent, 300);
        return;
      }
      fail(error?.message ?? "The speech engine would not speak.");
    }
  }

  function clearPaintWord() {
    if (canPaint()) globalThis.CSS.highlights.delete(WORD);
  }

  function advance() {
    if (index + 1 < chunks.length) {
      index += 1;
      void speakCurrent();
      return;
    }

    // The chapter is finished. Staying open on the last sentence means Play
    // repeats it rather than doing nothing.
    playing = false;
    waiting = "";
    publish();
    onChapterEnd();
  }

  function fail(message) {
    open = false;
    playing = false;
    waiting = "";
    clearPaint();
    publish();
    onError(message);
  }

  function move(to) {
    const at = Math.max(0, Math.min(to, chunks.length - 1));
    if (at === index && playing) return;
    index = at;

    if (playing) void speakCurrent();
    else {
      paintSentence();
      clearPaintWord();
      keepVisible(chunks[index]);
      publish();
    }
  }

  function listen(engine, event, handler) {
    try {
      const handle = engine.addListener(event, handler);
      if (handle && typeof handle.catch === "function") handle.catch(() => {});
    } catch {
      // No bridge, no events; the player simply never starts.
    }
  }

  return {
    /** Hand over the plugin, once one has been found. */
    attach(engine) {
      listen(engine, "start", ({ id }) => {
        if (id === waiting && open) {
          playing = true;
          publish();
        }
      });
      listen(engine, "range", (event) => {
        if (event.id === waiting && playing) paintWord(event);
      });
      listen(engine, "done", ({ id }) => {
        if (id === waiting && playing) advance();
      });
      listen(engine, "error", ({ id, message }) => {
        if (id === waiting && playing) fail(message ?? "The speech engine failed.");
      });
      // `stopped` is deliberately ignored: stopping is how pausing and skipping
      // are implemented, so it is the player's own doing, not a failure.
    },

    load(next) {
      chunks = next;
      index = 0;
      waiting = "";
    },

    start(at = 0) {
      if (!chunks.length) return false;
      open = true;
      playing = true;
      retries = 0;
      index = Math.max(0, Math.min(at, chunks.length - 1));
      publish();
      void speakCurrent();
      return true;
    },

    pause() {
      if (!open || !playing) return;
      playing = false;
      waiting = "";
      plugin()?.stop?.()?.catch?.(() => {});
      publish();
    },

    resume() {
      if (!open || playing) return;
      playing = true;
      retries = 0;
      publish();
      void speakCurrent();
    },

    next() {
      move(index + 1);
    },

    previous() {
      move(index - 1);
    },

    /** Keep going from the sentence being spoken, after the rate changed. */
    refresh() {
      if (open && playing) void speakCurrent();
    },

    stop() {
      if (!open) return;
      open = false;
      playing = false;
      waiting = "";
      plugin()?.stop?.()?.catch?.(() => {});
      clearPaint();
      publish();
    },

    state,
  };
}
