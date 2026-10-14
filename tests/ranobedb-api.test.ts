/**
 * Tests for the RanobeDB API client: filename safety, query building, response
 * mapping, and network failure handling.
 *
 * `fetch` is stubbed, so these tests never touch the network.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  apiGetReleases,
  buildQuery,
  clearApiCache,
  coverImageUrl,
  isSafeCoverFilename,
  mapRelease,
  mapSeriesDetail,
  mapSeriesListItem,
  resetRateLimiter,
} from "../src/lib/catalogue/ranobedb-api.ts";
import type { ApiRelease, ApiSeriesDetail } from "../src/lib/catalogue/ranobedb-api.ts";

const realFetch = globalThis.fetch;
let requestedUrls: string[] = [];

function stubFetch(payload: unknown, status = 200) {
  globalThis.fetch = (async (input: string | URL | Request) => {
    requestedUrls.push(String(input));
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

function stubFetchFailure(error: Error) {
  globalThis.fetch = (async () => {
    throw error;
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  requestedUrls = [];
  resetRateLimiter();
  clearApiCache();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("isSafeCoverFilename", () => {
  it("accepts RanobeDB-style filenames", () => {
    for (const name of ["yFXvSMvTHBpI464b.jpg", "abc_123-X.webp", "a.png"]) {
      assert.equal(isSafeCoverFilename(name), true, name);
    }
  });

  it("rejects traversal, separators and other extensions", () => {
    for (const name of [
      "../secret.jpg",
      "a/b.jpg",
      "a\\b.jpg",
      "cover.php",
      "cover.jpg.exe",
      "cover",
      "",
      "https://evil.example/x.jpg",
      `${"a".repeat(90)}.jpg`,
    ]) {
      assert.equal(isSafeCoverFilename(name), false, name);
    }
  });
});

describe("coverImageUrl", () => {
  it("builds a URL on the fixed RanobeDB image host", () => {
    assert.equal(coverImageUrl("abc.jpg"), "https://images.ranobedb.org/abc.jpg");
  });

  it("returns null for unusable or missing filenames", () => {
    assert.equal(coverImageUrl("../x.jpg"), null);
    assert.equal(coverImageUrl(null), null);
    assert.equal(coverImageUrl(""), null);
  });
});

describe("buildQuery", () => {
  it("skips empty values", () => {
    assert.equal(buildQuery({ q: "", page: undefined, limit: 24 }), "limit=24");
  });

  it("repeats array parameters", () => {
    assert.equal(buildQuery({ rl: ["en", "ja"] }), "rl=en&rl=ja");
  });

  it("encodes spaces and special characters", () => {
    assert.equal(buildQuery({ q: "seishun buta" }), "q=seishun+buta");
    assert.equal(buildQuery({ sort: "Num. books desc" }), "sort=Num.+books+desc");
  });
});

describe("mapSeriesListItem", () => {
  it("maps core fields and takes the cover from the featured book", () => {
    const view = mapSeriesListItem({
      id: 3,
      title: "Vampire Hunter D",
      title_orig: "吸血鬼ハンター",
      romaji: null,
      romaji_orig: "Kyuuketsuki Hunter",
      lang: "en",
      olang: "ja",
      hidden: false,
      locked: false,
      c_num_books: 58,
      c_start_date: 19830131,
      c_end_date: 99999999,
      book: {
        id: 3,
        image: {
          id: 3,
          filename: "yFXvSMvTHBpI464b.jpg",
          width: 240,
          height: 345,
          spoiler: false,
          nsfw: false,
        },
      },
      volumes: { count: 58 },
    });

    assert.equal(view.id, 3);
    assert.equal(view.title, "Vampire Hunter D");
    assert.equal(view.numBooks, 58);
    assert.equal(view.coverFilename, "yFXvSMvTHBpI464b.jpg");
    assert.equal(view.coverIsNsfw, false);
    assert.equal(view.startDate, 19830131);
    // Sentinel end date becomes null rather than year 99999999.
    assert.equal(view.endDate, null);
  });

  it("handles a missing book and a string volume count", () => {
    const view = mapSeriesListItem({
      id: 7,
      title: "Untitled",
      title_orig: null,
      romaji: "Untitled romaji",
      romaji_orig: null,
      lang: "ja",
      olang: "ja",
      hidden: false,
      locked: false,
      c_num_books: 3,
      c_start_date: 0,
      c_end_date: 0,
      book: null,
      volumes: { count: "12" },
    });

    assert.equal(view.coverFilename, null);
    assert.equal(view.numBooks, 12);
    // A zero date is not a date; it normalises to null like the sentinel does.
    assert.equal(view.startDate, null);
    assert.equal(view.endDate, null);
  });

  it("normalises the open-ended sentinel start date too", () => {
    const view = mapSeriesListItem({
      id: 8,
      title: "Unknown start",
      title_orig: null,
      romaji: null,
      romaji_orig: null,
      lang: "ja",
      olang: "ja",
      hidden: false,
      locked: false,
      c_num_books: 1,
      c_start_date: 99999999,
      c_end_date: 99999999,
      book: null,
      volumes: null,
    });

    assert.equal(view.startDate, null);
    assert.equal(view.endDate, null);
  });

  it("flags NSFW covers so the UI can withhold them", () => {
    const view = mapSeriesListItem({
      id: 9,
      title: "NSFW",
      title_orig: null,
      romaji: null,
      romaji_orig: null,
      lang: "ja",
      olang: "ja",
      hidden: false,
      locked: false,
      c_num_books: 1,
      c_start_date: 0,
      c_end_date: 0,
      book: {
        id: 1,
        image: {
          id: 1,
          filename: "x.jpg",
          width: 1,
          height: 1,
          spoiler: false,
          nsfw: true,
        },
      },
      volumes: null,
    });

    assert.equal(view.coverIsNsfw, true);
  });
});

describe("mapSeriesDetail", () => {
  const detail = {
    id: 3,
    title: "Vampire Hunter D",
    title_orig: "吸血鬼ハンター",
    romaji: null,
    romaji_orig: null,
    description: "",
    lang: "en",
    olang: "ja",
    publication_status: "ongoing",
    start_date: 19830131,
    end_date: 99999999,
    hidden: false,
    locked: false,
    web_novel: null,
    website: null,
    mal_id: 111,
    anilist_id: null,
    rating: 8.123,
    num_reviews: 12,
    book_description: { description: "English synopsis.", description_ja: "日本語" },
    books: [
      {
        id: 2,
        title: "Volume 2",
        title_orig: null,
        romaji: null,
        c_release_date: 19840101,
        sort_order: 2,
        book_type: "main",
        image: {
          id: 2,
          filename: "vol2.jpg",
          width: 1,
          height: 1,
          spoiler: false,
          nsfw: false,
        },
      },
      {
        id: 1,
        title: "Volume 1",
        title_orig: null,
        romaji: null,
        c_release_date: 19830131,
        sort_order: 1,
        book_type: "main",
        image: null,
      },
    ],
    titles: [
      { title: "Vampire Hunter D", romaji: null, lang: "en", official: true },
      { title: "吸血鬼ハンター", romaji: "Kyuuketsuki Hunter", lang: "ja", official: true },
    ],
    publishers: [
      { id: 5, name: "Dark Horse", romaji: null, publisher_type: "publisher", lang: "en" },
    ],
    staff: [
      {
        role_type: "author",
        name: "菊地秀行",
        romaji: "Kikuchi Hideyuki",
        staff_id: 2,
        note: "",
        lang: null,
      },
      {
        role_type: "artist",
        name: "天野喜孝",
        romaji: "Amano Yoshitaka",
        staff_id: 3,
        note: "",
        lang: null,
      },
      {
        role_type: "translator",
        name: "Kevin Leahy",
        romaji: null,
        staff_id: 4,
        note: "",
        lang: "en",
      },
    ],
    tags: [{ id: 26, name: "anime tie-in", ttype: "tag" }],
  } as unknown as ApiSeriesDetail;

  it("prefers the romanised synopsis source and falls back correctly", () => {
    assert.equal(mapSeriesDetail(detail).description, "English synopsis.");
  });

  it("separates credits by role and romanises names", () => {
    const view = mapSeriesDetail(detail);
    assert.deepEqual(view.authors, ["Kikuchi Hideyuki"]);
    assert.deepEqual(view.artists, ["Amano Yoshitaka"]);
    assert.deepEqual(view.otherStaff, ["Kevin Leahy"]);
  });

  it("sorts volumes by sort order and takes the first available cover", () => {
    const view = mapSeriesDetail(detail);
    assert.deepEqual(
      view.books.map((book) => book.title),
      ["Volume 1", "Volume 2"],
    );
    assert.equal(view.coverFilename, "vol2.jpg");
  });

  it("excludes the primary title from alternate titles", () => {
    assert.deepEqual(mapSeriesDetail(detail).altTitles, ["吸血鬼ハンター"]);
  });

  it("carries publishers, tags, ids and rating", () => {
    const view = mapSeriesDetail(detail);
    assert.deepEqual(view.publishers, ["Dark Horse"]);
    assert.deepEqual(view.tags, ["anime tie-in"]);
    assert.equal(view.malId, 111);
    assert.equal(view.rating, 8.123);
    assert.equal(view.endDate, null);
  });
});

describe("apiSearchSeries / apiGetSeries", () => {
  it("maps a successful search and sends the query", async () => {
    const { apiSearchSeries } = await import("../src/lib/catalogue/ranobedb-api.ts");
    stubFetch({
      series: [
        {
          id: 3,
          title: "Vampire Hunter D",
          title_orig: null,
          romaji: null,
          romaji_orig: null,
          lang: "en",
          olang: "ja",
          hidden: false,
          locked: false,
          c_num_books: 58,
          c_start_date: 19830131,
          c_end_date: 99999999,
          book: null,
          volumes: { count: 58 },
        },
      ],
      count: "1",
      currentPage: 1,
      totalPages: 1,
    });

    const result = await apiSearchSeries({ q: "vampire hunter d", page: 1, limit: 24 });
    assert.ok(result);
    assert.equal(result.total, 1);
    assert.equal(result.items[0].title, "Vampire Hunter D");
    assert.match(requestedUrls[0], /\/series\?/);
    assert.match(requestedUrls[0], /q=vampire\+hunter\+d/);
    assert.match(requestedUrls[0], /limit=24/);
  });

  it("returns null on a non-200 response", async () => {
    const { apiSearchSeries } = await import("../src/lib/catalogue/ranobedb-api.ts");
    stubFetch({ error: "nope" }, 500);
    assert.equal(await apiSearchSeries({ q: "x" }), null);
  });

  it("returns null when the network throws", async () => {
    const { apiSearchSeries } = await import("../src/lib/catalogue/ranobedb-api.ts");
    stubFetchFailure(new Error("offline"));
    assert.equal(await apiSearchSeries({ q: "x" }), null);
  });

  it("returns null for an unknown series id quickly", async () => {
    const { apiGetSeries } = await import("../src/lib/catalogue/ranobedb-api.ts");
    stubFetchFailure(new Error("should not be called"));
    assert.equal(await apiGetSeries(0), null);
    assert.equal(requestedUrls.length, 0);
  });
});

describe("mapRelease", () => {
  const base = {
    id: 112200,
    title: "Genius in the Library: This Bookish Rookie Will Save the Day!",
    release_date: 20261014,
    release_date_parsed: "2026-10-14",
    lang: "en",
    format: "digital",
    pages: null,
    isbn13: null,
    website: "https://j-novel.club/series/genius-in-the-library",
  };

  it("maps a release and its cover", () => {
    const view = mapRelease({
      ...base,
      image: {
        id: 41716,
        filename: "BuwnqwIh90j4uoAM.jpg",
        width: 240,
        height: 355,
        spoiler: false,
        nsfw: false,
      },
    } as unknown as ApiRelease);

    assert.equal(view.id, 112200);
    assert.equal(view.coverFilename, "BuwnqwIh90j4uoAM.jpg");
    assert.equal(view.coverIsNsfw, false);
    assert.equal(view.releaseDateParsed, "2026-10-14");
    assert.equal(view.lang, "en");
    assert.equal(view.format, "digital");
    assert.equal(view.website, "https://j-novel.club/series/genius-in-the-library");
  });

  it("tolerates a missing image", () => {
    const view = mapRelease({ ...base, image: null } as unknown as ApiRelease);
    assert.equal(view.coverFilename, null);
    assert.equal(view.coverIsNsfw, false);
  });

  it("falls back to a placeholder title", () => {
    const view = mapRelease({ ...base, title: "", image: null } as unknown as ApiRelease);
    assert.equal(view.title, "Untitled release");
  });
});

describe("response cache", () => {
  const emptyPage = { releases: [], count: "0", currentPage: 1, totalPages: 0 };

  it("reuses a successful response instead of re-requesting", async () => {
    stubFetch(emptyPage);
    await apiGetReleases({ minDate: "2026-10-15" });
    await apiGetReleases({ minDate: "2026-10-15" });
    assert.equal(requestedUrls.length, 1);
  });

  it("does not cache a failure, so a retry can succeed", async () => {
    stubFetch({ error: "boom" }, 500);
    assert.equal(await apiGetReleases({ minDate: "2026-10-16" }), null);

    stubFetch(emptyPage);
    const second = await apiGetReleases({ minDate: "2026-10-16" });
    assert.ok(second);
    assert.equal(requestedUrls.length, 2);
  });

  it("can be bypassed with ttlMs: 0", async () => {
    stubFetch(emptyPage);
    await apiGetReleases({ minDate: "2026-10-17" }, { ttlMs: 0 });
    await apiGetReleases({ minDate: "2026-10-17" }, { ttlMs: 0 });
    assert.equal(requestedUrls.length, 2);
  });
});
