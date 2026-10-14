/**
 * Tests for the extended importer: the fields added when the fuller RanobeDB
 * import started carrying volumes, staff credits, publishers and releases.
 *
 * Everything here is pure, so no dump and no database are needed.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildBookRows,
  buildBookStaffRows,
  buildBookTitleRows,
  buildCatalogue,
  buildPublisherRows,
  buildSeriesRows,
  buildStaffRows,
  normaliseDate,
  parseCopyLine,
  roleLabel,
  splitCopyFields,
  textOrNull,
} from "../scripts/import-ranobedb.mjs";

/** Narrow an optional lookup, failing loudly if the fixture is wrong. */
function pick<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`fixture is missing ${what}`);
  return value;
}

/** A miniature slice of parsed dump state, shaped like the reader's output. */
function fixture() {
  return {
    series: new Map<number, unknown>([
      [
        10,
        {
          hidden: "f",
          publication_status: "ongoing",
          start_date: "20140124",
          end_date: "99999999",
          c_num_books: "2",
          c_average: "8049",
          c_popularity: "513",
          web_novel: "f",
          c_fully_translated: "f",
          mal_id: null,
          anilist_id: null,
          description: "",
        },
      ],
    ]),
    seriesTitles: new Map<number, unknown[]>([
      [10, [{ lang: "en", official: "t", title: "Series EN", romaji: null }]],
    ]),
    seriesTags: new Map<number, number[]>([[10, [1]]]),
    seriesBooks: new Map<number, unknown[]>([
      [
        10,
        [
          { bookId: 100, order: 1, bookType: "main" },
          { bookId: 101, order: 2, bookType: "main" },
        ],
      ],
    ]),
    tags: new Map<number, unknown>([[1, { name: "fantasy", ttype: "genre" }]]),
    books: new Map<number, unknown>([
      [
        100,
        {
          imageId: 5,
          releaseDate: 20140124,
          olang: "ja",
          description: "English synopsis.",
          descriptionJa: "日本語",
        },
      ],
      [101, { imageId: null, releaseDate: null, olang: "ja", description: "", descriptionJa: "" }],
    ]),
    bookTitles: new Map<number, unknown[]>([
      [
        100,
        [
          { lang: "en", official: "t", title: "Vol 1 EN", romaji: null },
          { lang: "ja", official: "t", title: "Vol 1 JA", romaji: "Vol 1 Romaji" },
        ],
      ],
    ]),
    bookEditions: new Map(),
    bookStaff: new Map<number, unknown[]>([
      [
        100,
        [
          { aliasId: 1, role: "author", note: null },
          { aliasId: 2, role: "translator", note: null },
        ],
      ],
    ]),
    staff: new Map<number, unknown>([
      [1, { website: null, twitterId: null }],
      [2, { website: "https://example.test", twitterId: "ex" }],
    ]),
    staffAlias: new Map<number, unknown>([
      [1, { staffId: 1, main: true, name: "長月達平", romaji: "Nagatsuki Tappei" }],
      [2, { staffId: 2, main: true, name: "Dale DeLucia", romaji: "" }],
    ]),
    images: new Map<number, string>([[5, "cover.jpg"]]),
    publishers: new Map<number, unknown>([
      [7, { name: "Yen Press", romaji: "", lang: "en", website: "https://yenpress.com" }],
    ]),
    publisherRelations: [],
    releases: new Map<number, unknown>([
      [
        900,
        {
          releaseDate: 20160719,
          format: "digital",
          lang: "en",
          title: "Vol 1 release",
          romaji: null,
          isbn13: "9780316398398",
          website: "https://yenpress.com/x",
          pages: 304,
          duration: null,
          imageId: null,
        },
      ],
    ]),
    releaseBooks: [{ releaseId: 900, bookId: 100, rtype: "main" }],
    releasePublishers: [{ releaseId: 900, publisherId: 7, publisherType: "publisher" }],
    seriesRelations: [],
  };
}

describe("normaliseDate", () => {
  it("rejects every spelling of 'no date' the dump uses", () => {
    // Blank, the open-ended sentinel, and values below the YYYYMMDD floor all
    // mean unknown; a truthiness check would turn each into a real date.
    assert.equal(normaliseDate(""), null);
    assert.equal(normaliseDate(null), null);
    assert.equal(normaliseDate(undefined), null);
    assert.equal(normaliseDate("99999999"), null);
    assert.equal(normaliseDate("1234"), null);
    assert.equal(normaliseDate("not a date"), null);
  });

  it("keeps a real YYYYMMDD date", () => {
    assert.equal(normaliseDate("20140124"), 20140124);
    assert.equal(normaliseDate(20160719), 20160719);
  });
});

describe("roleLabel", () => {
  it("labels the roles RanobeDB uses", () => {
    assert.equal(roleLabel("author"), "Author");
    assert.equal(roleLabel("translator"), "Translator");
    assert.equal(roleLabel("narrator"), "Narrator");
  });

  it("capitalises a role it has never seen, rather than dropping it", () => {
    assert.equal(roleLabel("colourist"), "Colourist");
    assert.equal(roleLabel(""), "Staff");
  });
});

describe("textOrNull", () => {
  it("treats blank and non-strings as absent", () => {
    assert.equal(textOrNull("   "), null);
    assert.equal(textOrNull(null), null);
    assert.equal(textOrNull(42), null);
  });

  it("trims real text", () => {
    assert.equal(textOrNull("  hi  "), "hi");
  });
});

describe("splitCopyFields", () => {
  it("splits without decoding, so escapes survive reassembly", () => {
    assert.deepEqual(splitCopyFields("a\\tb\tc"), ["a\\tb", "c"]);
    assert.deepEqual(parseCopyLine("a\\tb\tc"), ["a\tb", "c"]);
  });

  it("still converts the null marker", () => {
    assert.deepEqual(parseCopyLine("\\N\tx"), [null, "x"]);
  });
});

describe("buildSeriesRows with the extended fields", () => {
  it("scales c_average from thousandths to a 0-10 rating", () => {
    const [row] = buildSeriesRows(fixture());
    assert.equal(row.rating, 8.049);
    assert.equal(row.popularity, 513);
  });

  it("leaves an absent rating null rather than reporting zero", () => {
    const data = fixture();
    data.series.set(10, { ...(data.series.get(10) as object), c_average: "" });
    const [row] = buildSeriesRows(data);
    assert.equal(row.rating, null);
  });

  it("normalises the open-ended end date to null", () => {
    const [row] = buildSeriesRows(fixture());
    assert.equal(row.start_date, 20140124);
    assert.equal(row.end_date, null);
  });

  it("survives a staff alias with no romaji and no name", () => {
    const data = fixture();
    data.staffAlias.set(1, { staffId: 1, main: true, name: null, romaji: null });
    const [row] = buildSeriesRows(data);
    assert.deepEqual(row.authors, []);
  });
});

describe("buildBookRows", () => {
  it("attaches each volume to its series and resolves its cover", () => {
    const rows = buildBookRows(fixture());
    assert.equal(rows.length, 2);

    const first = pick(rows.find((row) => row.id === 100), "book 100");
    assert.equal(first.series_id, 10);
    assert.equal(first.sort_order, 1);
    assert.equal(first.image_filename, "cover.jpg");
    assert.equal(first.title_en, "Vol 1 EN");
    assert.equal(first.description, "English synopsis.");

    const second = pick(rows.find((row) => row.id === 101), "book 101");
    assert.equal(second.image_filename, null);
    assert.equal(second.release_date, null);
  });

  it("tolerates a book whose text fields are missing entirely", () => {
    const data = fixture();
    data.books.set(100, { imageId: null, releaseDate: null, olang: null });
    const rows = buildBookRows(data);
    assert.equal(pick(rows.find((row) => row.id === 100), "book 100").description, "");
  });
});

describe("buildBookTitleRows", () => {
  it("keeps every language variant, including the romaji", () => {
    const rows = buildBookTitleRows(fixture());
    assert.equal(rows.length, 2);
    const ja = pick(rows.find((row) => row.lang === "ja"), "the ja title");
    assert.equal(ja.title, "Vol 1 JA");
    assert.equal(ja.romaji, "Vol 1 Romaji");
    assert.equal(ja.official, 1);
  });

  it("drops a title row that carries no text at all", () => {
    const data = fixture();
    data.bookTitles.set(100, [{ lang: "en", official: "f", title: "", romaji: "" }]);
    assert.deepEqual(buildBookTitleRows(data), []);
  });
});

describe("buildStaffRows", () => {
  it("resolves a person's display name from their main alias", () => {
    const rows = buildStaffRows(fixture());
    const author = pick(rows.find((row) => row.id === 1), "staff 1");
    assert.equal(author.name, "長月達平");
    assert.equal(author.romaji, "Nagatsuki Tappei");
  });

  it("falls back to a placeholder rather than an empty name", () => {
    const data = fixture();
    data.staffAlias.clear();
    const rows = buildStaffRows(data);
    assert.equal(pick(rows.find((row) => row.id === 1), "staff 1").name, "Staff #1");
  });
});

describe("buildPublisherRows", () => {
  it("carries the website through for linking", () => {
    const [row] = buildPublisherRows(fixture());
    assert.equal(row.name, "Yen Press");
    assert.equal(row.website, "https://yenpress.com");
  });
});

describe("buildBookStaffRows", () => {
  it("flattens credits, keeping the role", () => {
    const rows = buildBookStaffRows(fixture());
    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.map((row) => row.role).sort(),
      ["author", "translator"],
    );
  });
});

describe("buildCatalogue", () => {
  it("assembles every table and passes links through untouched", () => {
    const catalogue = buildCatalogue(fixture());
    assert.equal(catalogue.seriesRows.length, 1);
    assert.equal(catalogue.bookRows.length, 2);
    assert.equal(catalogue.staffRows.length, 2);
    assert.equal(catalogue.staffAliasRows.length, 2);
    assert.equal(catalogue.bookStaffRows.length, 2);
    assert.equal(catalogue.publisherRows.length, 1);
    assert.equal(catalogue.releaseRows.length, 1);
    assert.deepEqual(catalogue.releaseBooks, [{ releaseId: 900, bookId: 100, rtype: "main" }]);
    assert.deepEqual(catalogue.releasePublishers, [
      { releaseId: 900, publisherId: 7, publisherType: "publisher" },
    ]);
  });

  it("normalises an embedded release date rather than storing the sentinel", () => {
    const data = fixture();
    data.releases.set(900, {
      ...(data.releases.get(900) as object),
      releaseDate: 99999999,
    });
    const [release] = buildCatalogue(data).releaseRows;
    assert.equal(release.release_date, null);
  });
});
