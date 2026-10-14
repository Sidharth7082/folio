/*
 * Finding a phrase in a book.
 *
 * The whole book is already parsed and in memory by the time a search runs, so
 * this is a plain scan. There is no index to build and no server to ask, and the
 * results cannot disagree with the text on screen, because it is the same text.
 *
 * Only the first matches are kept. A common word in a 992-chapter novel matches
 * thousands of times, and a list nobody will scroll through is worse than one
 * that says how much it left out.
 */

const MOST = 150;

/** How much of the sentence around a match to show. */
const AROUND = 45;

export function findInBook(chapters, query, limit = MOST) {
  const needle = typeof query === "string" ? query.trim().toLowerCase() : "";
  if (needle.length < 2) return { matches: [], total: 0, limited: false };

  const matches = [];
  let total = 0;

  for (let chapter = 0; chapter < chapters.length; chapter += 1) {
    const blocks = chapters[chapter]?.blocks ?? [];

    for (let block = 0; block < blocks.length; block += 1) {
      const text = blocks[block];
      const haystack = text.toLowerCase();

      for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) {
        total += 1;
        // Keep counting after the list is full, so the count can be honest
        // about how much is not shown.
        if (matches.length >= limit) continue;

        matches.push({
          chapter,
          block,
          start: at,
          end: at + needle.length,
          before: text.slice(Math.max(0, at - AROUND), at),
          hit: text.slice(at, at + needle.length),
          after: text.slice(at + needle.length, at + needle.length + AROUND),
        });
      }
    }
  }

  return { matches, total, limited: total > matches.length };
}
