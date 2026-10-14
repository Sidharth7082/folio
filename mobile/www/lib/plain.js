/*
 * Plain-text books.
 *
 * A .txt has no structure to read, so chapters come from headings. The pattern
 * is the one the server-side importer settled on after real books broke it:
 * accept "Chapter 12", "PROLOGUE", "Part ii", and the Markdown form
 * "## Chapter 12", because scraped novels routinely keep their hashes even when
 * the download is plain text.
 *
 * Text with no headings at all still has to open, as one chapter named after the
 * file, rather than being refused.
 */

const HEADING =
  /^\s{0,3}#{0,6}\s{0,3}(chapter\s+[0-9ivxlcdm]+|prologue|epilogue|interlude|part\s+[0-9ivxlcdm]+)\b.*$/i;

/** A heading's text, without its Markdown hashes or stray spacing. */
function titleOf(line) {
  return line
    .trim()
    .replace(/^#{1,6}\s*/, "")
    .replace(/\s+/g, " ");
}

export function readPlainText(text, fallbackTitle) {
  // Strip a byte-order mark and normalise line endings, so a Windows file and a
  // Unix one produce identical chapters.
  const body = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");

  const lines = body.split("\n");
  const chapters = [];
  let current = null;

  for (const line of lines) {
    // The length guard stops a sentence that happens to begin with "Chapter"
    // from being taken for a heading.
    if (HEADING.test(line) && line.trim().length <= 90) {
      if (current) chapters.push(current);
      current = { title: titleOf(line), lines: [] };
    } else if (current) {
      current.lines.push(line);
    } else {
      // Anything before the first heading is front matter. It is folded into the
      // first chapter below rather than becoming an untitled one of its own.
      current = { title: null, lines: [line] };
    }
  }
  if (current) chapters.push(current);

  const built = chapters
    .map((chapter) => ({
      title: chapter.title,
      blocks: toBlocks(chapter.lines.join("\n")),
    }))
    .filter((chapter) => chapter.blocks.length > 0);

  if (built.length === 0) {
    return { chapters: [{ title: fallbackTitle, blocks: toBlocks(body) }] };
  }

  if (built[0].title === null) {
    if (built.length === 1) {
      return { chapters: [{ title: fallbackTitle, blocks: built[0].blocks }] };
    }
    const [lead, ...rest] = built;
    rest[0] = { title: rest[0].title, blocks: [...lead.blocks, ...rest[0].blocks] };
    return { chapters: rest };
  }

  return { chapters: built };
}

/**
 * Paragraphs, from loose text.
 *
 * Blank lines separate paragraphs where the file uses them; a file with none
 * gets each line as its own paragraph, which reads far better than one
 * impenetrable wall.
 */
function toBlocks(text) {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const paras = trimmed
    .split(/\n{2,}/)
    .map((para) => para.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  if (paras.length > 1) return paras;

  return trimmed
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}
