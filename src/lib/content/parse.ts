/**
 * Parsing helpers shared by the runtime content loader and the ingest script.
 * Pure functions only: no filesystem, no DOM, so they are safe on the server
 * and inside unit tests.
 */

export interface ParsedChapterSource {
  title: string | null;
  text: string;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Split an optional YAML-ish frontmatter block from the body.
 * Deliberately minimal: only `key: value` pairs, which is all the ingest
 * script and hand-written content need.
 */
export function parseChapterSource(raw: string): ParsedChapterSource {
  const normalised = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const match = FRONTMATTER.exec(normalised);
  if (!match) return { title: null, text: normalised.trim() };

  let title: string | null = null;
  for (const line of match[1].split("\n")) {
    const kv = /^title\s*:\s*(.*)$/i.exec(line.trim());
    if (kv) title = unquote(kv[1].trim());
  }
  return { title, text: normalised.slice(match[0].length).trim() };
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Turn raw chapter text into display paragraphs.
 *
 * A blank line separates paragraphs. Single newlines inside a paragraph are
 * treated as soft wraps and folded back into spaces, which is what novel
 * exports (TXT/EPUB) usually mean.
 */
export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((block) =>
      block
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .join(" ")
        .trim(),
    )
    .filter((block) => block.length > 0);
}

/** Count words across all paragraphs. */
export function countWords(paragraphs: string[]): number {
  return paragraphs.reduce((total, paragraph) => {
    const words = paragraph.match(/[\p{L}\p{N}''-]+/gu);
    return total + (words ? words.length : 0);
  }, 0);
}

/** Best-effort title from a chapter file name such as `0007-a-quiet-town.md`. */
export function titleFromFileName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "");
  const withoutOrdinal = base.replace(/^\d+[-_.\s]*/, "");
  const source = withoutOrdinal.length > 0 ? withoutOrdinal : base;
  return source
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\p{Ll}/gu, (c) => c.toUpperCase());
}

/** Leading ordinal from a chapter file name, or null when absent. */
export function ordinalFromFileName(fileName: string): number | null {
  const match = /^(\d+)/.exec(fileName);
  if (!match) return null;
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) ? value : null;
}

/** URL-safe slug for a novel or chapter id. */
export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
