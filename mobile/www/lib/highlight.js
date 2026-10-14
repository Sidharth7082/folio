/*
 * Pointing at text, and painting it.
 *
 * Anything that needs to refer to a piece of a chapter — the voice reading a
 * sentence, a search result — does it by character offset into the rendered
 * text, turned into a DOM Range at the moment it is needed. The chapter itself
 * is never rewritten: it is rendered once, exactly as the book wrote it, so a
 * highlight appearing and moving cannot disturb the markup or the reader's own
 * custom CSS. Highlighting a sentence that runs across three lines is the same
 * operation as highlighting one word.
 *
 * The painting goes through the browser's highlight registry, which takes those
 * ranges directly.
 */

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

/** The text of an element, as the offsets are counted against it. */
export function textOf(element) {
  return nodeMap(element).text;
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

/** A Range covering [start, end) of an element's text, or null if it cannot. */
export function rangeFor(element, start, end) {
  const map = nodeMap(element);
  const from = locate(map, start);
  const to = locate(map, end);
  if (!from || !to) return null;

  const range = document.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  return range;
}

/** Whether this browser has a highlight registry to paint into. */
export function canPaint() {
  return typeof Highlight === "function" && Boolean(globalThis.CSS?.highlights);
}

/** Paint a range under a name, replacing whatever that name held before. */
export function paint(name, range) {
  if (!range || !canPaint()) return false;
  globalThis.CSS.highlights.set(name, new Highlight(range));
  return true;
}

export function unpaint(name) {
  if (canPaint()) globalThis.CSS.highlights.delete(name);
}
