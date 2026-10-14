/**
 * Tests for the MangaBaka API client's pure logic.
 *
 * The matching rules carry the most risk in this integration: a fuzzy match
 * would silently attach another series' score, so these pin the behaviour of
 * the exact-match gate. No network is used here.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  mangaBakaSeriesUrl,
  mapMangaBakaSeries,
  normaliseTitle,
  pickBestMatch,
  titlesMatch,
} from "../src/lib/catalogue/mangabaka-api.ts";

type RawSeries = Parameters<typeof mapMangaBakaSeries>[0];

/** A minimal eligible record; override fields per test. */
function series(overrides: Partial<RawSeries> = {}): RawSeries {
  return {
    id: 1,
    state: "active",
    merged_with: null,
    canonical_url: "https://mangabaka.org/novel/1/Example",
    title: "Example",
    native_title: null,
    romanized_title: null,
    description: null,
    year: 2020,
    status: "releasing",
    type: "novel",
    original_language: "ja",
    rating: 80,
    is_licensed: false,
    content_rating: "safe",
    final_volume: null,
    total_chapters: null,
    publishers: null,
    genres: null,
    tags: null,
    last_updated_at: null,
    ...overrides,
  } as RawSeries;
}

describe("normaliseTitle", () => {
  it("folds the punctuation differences between the two databases", () => {
    // RanobeDB and MangaBaka punctuate these differently.
    assert.equal(
      normaliseTitle("Re:ZERO -Starting Life in Another World-"),
      normaliseTitle("Re:Zero -Starting Life in Another World-"),
    );
    assert.equal(normaliseTitle("86 -Eighty Six-"), normaliseTitle("86―EIGHTY-SIX"));
  });

  it("returns an empty key for anything unusable", () => {
    assert.equal(normaliseTitle(null), "");
    assert.equal(normaliseTitle(undefined), "");
    assert.equal(normaliseTitle("  !!!  "), "");
  });

  it("keeps non-Latin scripts instead of erasing them", () => {
    // An ASCII-only character class deleted Japanese outright, leaving a stray
    // fragment ("Re:ゼロ…" became "re") that then matched unrelated series.
    assert.equal(normaliseTitle("撲殺天使ドクロちゃん"), "撲殺天使ドクロちゃん");
    assert.equal(normaliseTitle("Re:ゼロから始める異世界生活"), "re ゼロから始める異世界生活");
    assert.notEqual(normaliseTitle("Re:ゼロから始める異世界生活"), "re");
  });

  it("does not merge a native title with an unrelated Latin one", () => {
    assert.notEqual(
      normaliseTitle("転生したらスライムだった件"),
      normaliseTitle("That Time I Got Reincarnated as a Slime"),
    );
  });
});

describe("titlesMatch", () => {
  it("matches across case and punctuation", () => {
    assert.equal(titlesMatch("Mushoku Tensei: Jobless Reincarnation", "mushoku tensei jobless reincarnation"), true);
  });

  it("refuses a partial title, so a split series never matches its part", () => {
    // MangaBaka models "Ascendance of a Bookworm" as separate parts.
    assert.equal(titlesMatch("Ascendance of a Bookworm", "Ascendance of a Bookworm: Part 1"), false);
    assert.equal(titlesMatch("Re:ZERO", "Re:ZERO Ex"), false);
  });

  it("never matches on an empty key", () => {
    assert.equal(titlesMatch("", ""), false);
    assert.equal(titlesMatch(null, null), false);
  });
});

describe("mangaBakaSeriesUrl", () => {
  it("accepts a canonical MangaBaka URL", () => {
    assert.equal(
      mangaBakaSeriesUrl({ canonical_url: "https://mangabaka.org/novel/84926/Re-Zero" }),
      "https://mangabaka.org/novel/84926/Re-Zero",
    );
  });

  it("rejects any other host, so the API cannot redirect our links", () => {
    assert.equal(mangaBakaSeriesUrl({ canonical_url: "https://evil.example/novel/1" }), null);
    assert.equal(mangaBakaSeriesUrl({ canonical_url: "https://mangabaka.org.evil.example/x" }), null);
  });

  it("rejects non-https and unusable values", () => {
    assert.equal(mangaBakaSeriesUrl({ canonical_url: "http://mangabaka.org/x" }), null);
    assert.equal(mangaBakaSeriesUrl({ canonical_url: "not a url" }), null);
    assert.equal(mangaBakaSeriesUrl({ canonical_url: null }), null);
  });
});

describe("mapMangaBakaSeries", () => {
  it("converts the 0-100 score to the app's 0-10 scale", () => {
    assert.equal(mapMangaBakaSeries(series({ rating: 84.9966 }))?.ratingOutOf10, 8.5);
    assert.equal(mapMangaBakaSeries(series({ rating: 77.1 }))?.ratingOutOf10, 7.7);
    assert.equal(mapMangaBakaSeries(series({ rating: 100 }))?.ratingOutOf10, 10);
  });

  it("keeps an absent score absent rather than reporting zero", () => {
    const view = mapMangaBakaSeries(series({ rating: null }));
    assert.equal(view?.ratingOutOf100, null);
    assert.equal(view?.ratingOutOf10, null);
  });

  it("rejects a record with no usable id", () => {
    assert.equal(mapMangaBakaSeries(series({ id: Number.NaN })), null);
  });

  it("falls back through the title fields and defaults the rest", () => {
    const view = mapMangaBakaSeries(
      series({ title: null, romanized_title: "Romaji Name", native_title: null, genres: null, tags: null }),
    );
    assert.equal(view?.title, "Romaji Name");
    assert.deepEqual(view?.genres, []);
    assert.deepEqual(view?.publishers, []);
  });
});

describe("pickBestMatch", () => {
  it("returns the exact match", () => {
    const match = pickBestMatch(
      [series({ id: 7, title: "Classroom of the Elite" })],
      "Classroom of the Elite",
    );
    assert.equal(match?.id, 7);
  });

  it("returns null rather than a near miss", () => {
    const match = pickBestMatch(
      [
        series({ id: 1, title: "Ascendance of a Bookworm: Part 1" }),
        series({ id: 2, title: "Ascendance of a Bookworm: Royal Academy Stories" }),
      ],
      "Ascendance of a Bookworm",
    );
    assert.equal(match, null);
  });

  it("skips records merged into another", () => {
    const match = pickBestMatch(
      [
        series({ id: 1, title: "Example", merged_with: 9 }),
        series({ id: 2, title: "Example" }),
      ],
      "Example",
    );
    assert.equal(match?.id, 2);
  });

  it("skips records that are no longer active", () => {
    const match = pickBestMatch(
      [series({ id: 1, title: "Example", state: "deleted" })],
      "Example",
    );
    assert.equal(match, null);
  });

  it("breaks a tie on the year we already know", () => {
    const match = pickBestMatch(
      [series({ id: 5, title: "Example", year: 1999 }), series({ id: 6, title: "Example", year: 2020 })],
      "Example",
      { year: 2020 },
    );
    assert.equal(match?.id, 6);
  });

  it("is deterministic when nothing distinguishes the candidates", () => {
    const match = pickBestMatch(
      [series({ id: 6, title: "Example" }), series({ id: 5, title: "Example" })],
      "Example",
    );
    assert.equal(match?.id, 5);
  });
});
