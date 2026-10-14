/**
 * Tests for the RanobeDB dump importer: PostgreSQL COPY escaping, header
 * parsing, title selection, and series-row assembly.
 *
 * The converter is imported as a plain module (it only runs its CLI when
 * invoked directly), so no dump and no database are needed here.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildSeriesRows,
  chooseTitles,
  parseCopyHeader,
  parseCopyLine,
  unescapeField,
} from "../scripts/import-ranobedb.mjs";

/** A synthetic slice of parsed dump data, shaped like the converter's state. */
function fixture() {
  return {
    series: new Map<number, unknown>([
      [
        1,
        {
          hidden: "f",
          publication_status: "ongoing",
          start_date: "20200101",
          end_date: "99999999",
          c_num_books: "2",
          mal_id: "111",
          anilist_id: null,
          description: "A description.",
        },
      ],
      [
        2,
        {
          hidden: "t",
          publication_status: "completed",
          start_date: "20190101",
          end_date: "20200101",
          c_num_books: "1",
          mal_id: null,
          anilist_id: null,
          description: "",
        },
      ],
    ]),
    seriesTitles: new Map<number, unknown[]>([
      [
        1,
        [
          { lang: "ja", official: "t", title: "日本語タイトル", romaji: "nihongo title" },
          { lang: "en", official: "t", title: "English Title", romaji: null },
        ],
      ],
    ]),
    tags: new Map<number, unknown>([
      [10, { name: "fantasy", ttype: "genre" }],
      [11, { name: "isekai", ttype: "tag" }],
    ]),
    seriesTags: new Map<number, number[]>([[1, [11, 10]]]),
    seriesBooks: new Map<number, unknown[]>([
      [
        1,
        [
          { bookId: 100, order: 2 },
          { bookId: 101, order: 1 },
        ],
      ],
    ]),
    books: new Map<number, unknown>([
      [100, { imageId: null, releaseDate: null }],
      [101, { imageId: 5, releaseDate: null }],
    ]),
    bookStaff: new Map<number, unknown[]>([
      [
        100,
        [
          { aliasId: 1, role: "author" },
          { aliasId: 2, role: "artist" },
        ],
      ],
      [
        101,
        [
          { aliasId: 1, role: "author" },
          { aliasId: 3, role: "author" },
        ],
      ],
    ]),
    staffAlias: new Map<number, { name: string; romaji: string | null }>([
      // Romanised name available -> used for display.
      [1, { name: "作者一", romaji: "Author One" }],
      [2, { name: "Artist Two", romaji: null }],
      // No romanisation -> native name is the only option.
      [3, { name: "Author Three", romaji: null }],
    ]),
    images: new Map<number, string>([[5, "cover5.jpg"]]),
  };
}

describe("unescapeField", () => {
  it("decodes COPY escape sequences", () => {
    assert.equal(unescapeField("a\\tb"), "a\tb");
    assert.equal(unescapeField("a\\nb"), "a\nb");
    assert.equal(unescapeField("a\\rb"), "a\rb");
    assert.equal(unescapeField("a\\\\b"), "a\\b");
  });

  it("leaves ordinary text untouched", () => {
    assert.equal(unescapeField("plain text 100%"), "plain text 100%");
  });
});

describe("parseCopyLine", () => {
  it("splits tab-separated fields", () => {
    assert.deepEqual(parseCopyLine("1\tfoo\tbar"), ["1", "foo", "bar"]);
  });

  it("maps \\N to null", () => {
    assert.deepEqual(parseCopyLine("1\t\\N\tbar"), ["1", null, "bar"]);
  });

  it("does not split on escaped tabs inside a field", () => {
    assert.deepEqual(parseCopyLine("a\\tb\tc"), ["a\tb", "c"]);
  });

  it("tolerates a trailing carriage return", () => {
    assert.deepEqual(parseCopyLine("1\tfoo\r"), ["1", "foo"]);
  });

  it("preserves empty fields", () => {
    assert.deepEqual(parseCopyLine("1\t\t3"), ["1", "", "3"]);
  });
});

describe("parseCopyHeader", () => {
  it("extracts the table and columns", () => {
    const header = parseCopyHeader("COPY public.series (id, publication_status) FROM stdin;");
    assert.deepEqual(header, { table: "series", columns: ["id", "publication_status"] });
  });

  it("handles quoted identifiers", () => {
    const header = parseCopyHeader('COPY public."book" (id, "image_id") FROM stdin;');
    assert.deepEqual(header, { table: "book", columns: ["id", "image_id"] });
  });

  it("returns null for non-COPY lines", () => {
    assert.equal(parseCopyHeader("INSERT INTO x VALUES (1);"), null);
  });
});

describe("chooseTitles", () => {
  it("prefers an official English title", () => {
    const result = chooseTitles([
      { lang: "ja", official: "t", title: "JP", romaji: "jp" },
      { lang: "en", official: "f", title: "Unofficial EN", romaji: null },
      { lang: "en", official: "t", title: "Official EN", romaji: null },
    ]);
    assert.equal(result.titleEn, "Official EN");
    assert.equal(result.titleJa, "JP");
    assert.equal(result.romaji, "jp");
  });

  it("falls back to Japanese when there is no English title", () => {
    const result = chooseTitles([{ lang: "ja", official: "t", title: "JP", romaji: "jp" }]);
    assert.equal(result.titleEn, null);
    assert.equal(result.titleJa, "JP");
  });

  it("handles an empty title list", () => {
    assert.deepEqual(chooseTitles([]), { titleEn: null, titleJa: null, romaji: null });
  });
});

describe("buildSeriesRows", () => {
  it("builds one row per visible series", () => {
    const rows = buildSeriesRows(fixture());
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 1);
  });

  it("uses English first with Japanese alongside", () => {
    const [row] = buildSeriesRows(fixture());
    assert.equal(row.title_en, "English Title");
    assert.equal(row.title_ja, "日本語タイトル");
    assert.equal(row.romaji, "nihongo title");
  });

  it("normalises the open-ended sentinel date to null", () => {
    const [row] = buildSeriesRows(fixture());
    assert.equal(row.start_date, 20200101);
    assert.equal(row.end_date, null);
  });

  it("collects authors in book order, once each, ignoring artists", () => {
    const [row] = buildSeriesRows(fixture());
    assert.deepEqual(row.authors, ["Author One", "Author Three"]);
    assert.equal(row.authors.includes("Artist Two"), false);
  });

  it("prefers a romanised author name over the native one", () => {
    const [row] = buildSeriesRows(fixture());
    assert.equal(row.authors[0], "Author One");
    assert.equal(row.authors.includes("作者一"), false);
  });

  it("keeps native author names searchable alongside romanisations", () => {
    const [row] = buildSeriesRows(fixture());
    assert.match(row.search_text, /author one/);
    assert.match(row.search_text, /作者一/);
  });

  it("takes the cover from the earliest book with an image", () => {
    const [row] = buildSeriesRows(fixture());
    assert.equal(row.image_filename, "cover5.jpg");
  });

  it("sorts and joins tag names", () => {
    const [row] = buildSeriesRows(fixture());
    assert.deepEqual(row.tagNames, ["fantasy", "isekai"]);
    assert.deepEqual(row.tagIds, [11, 10]);
  });

  it("builds lowercase search text across titles, authors and tags", () => {
    const [row] = buildSeriesRows(fixture());
    assert.match(row.search_text, /english title/);
    assert.match(row.search_text, /author one/);
    assert.match(row.search_text, /isekai/);
    assert.equal(row.search_text, row.search_text.toLowerCase());
  });

  it("skips hidden series", () => {
    const rows = buildSeriesRows(fixture());
    assert.equal(
      rows.some((row) => row.id === 2),
      false,
    );
  });

  it("handles a series with no books, authors or tags", () => {
    const data = fixture();
    data.series.set(3, {
      hidden: "f",
      publication_status: "unknown",
      start_date: "99999999",
      end_date: "99999999",
      c_num_books: "1",
      mal_id: null,
      anilist_id: null,
      description: "",
    });
    const row = buildSeriesRows(data).find((entry) => entry.id === 3);
    assert.ok(row);
    assert.deepEqual(row.authors, []);
    assert.deepEqual(row.tagNames, []);
    assert.equal(row.image_filename, null);
    assert.equal(row.start_date, null);
  });
});
