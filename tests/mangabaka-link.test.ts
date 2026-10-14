/**
 * Tests for the RanobeDB to MangaBaka linker.
 *
 * The interesting behaviour is what it *refuses* to match: sibling works in a
 * franchise carry different scores, so an ambiguous round must not fall back to
 * "pick the most popular". No databases are touched here.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { chooseMatch, matchKeysFor } from "../scripts/link-mangabaka.mjs";

describe("matchKeysFor", () => {
  it("orders keys English, then romaji, then native", () => {
    assert.deepEqual(
      matchKeysFor({
        title_en: "The Apothecary Diaries",
        romaji: "Kusuriya no Hitorigoto",
        title_ja: "薬屋のひとりごと",
      }),
      ["the apothecary diaries", "kusuriya no hitorigoto", "薬屋のひとりごと"],
    );
  });

  it("drops blanks, duplicates and keys too short to be meaningful", () => {
    assert.deepEqual(
      matchKeysFor({ title_en: "  ", romaji: null, title_ja: "あ" }),
      [],
    );
    assert.deepEqual(
      matchKeysFor({ title_en: "Re:Zero", romaji: "re zero", title_ja: null }),
      ["re zero"],
    );
  });
});

describe("chooseMatch", () => {
  const titles = new Map([
    [1, "high school dxd"],
    [2, "high school dxd dx"],
    [3, "true high school dxd"],
  ]);
  const titleKeyOf = (id: number) => titles.get(id) ?? null;

  it("takes a sole candidate in the most trusted round", () => {
    const result = chooseMatch([{ key: "re zero", ids: [42] }], titleKeyOf);
    assert.deepEqual(result, { id: 42, key: "re zero", confidence: "sole" });
  });

  it("prefers a candidate that carries the key as its own title", () => {
    const result = chooseMatch([{ key: "high school dxd", ids: [1, 2, 3] }], titleKeyOf);
    assert.equal(result?.id, 1);
    assert.equal(result?.confidence, "exact");
  });

  it("refuses rather than guessing between siblings", () => {
    // None of these owns the key, so there is no safe answer.
    const result = chooseMatch([{ key: "high school dxd", ids: [2, 3] }], titleKeyOf);
    assert.equal(result, null);
  });

  it("falls through to a later round when an earlier one is inconclusive", () => {
    const result = chooseMatch(
      [
        { key: "ambiguous name", ids: [1, 2, 3] },
        { key: "unique romaji", ids: [7] },
      ],
      titleKeyOf,
    );
    assert.deepEqual(result, { id: 7, key: "unique romaji", confidence: "sole" });
  });

  it("ignores rounds with no candidates", () => {
    const result = chooseMatch(
      [
        { key: "nothing", ids: [] },
        { key: "something", ids: [9] },
      ],
      titleKeyOf,
    );
    assert.equal(result?.id, 9);
  });

  it("returns null when there is nothing to go on", () => {
    assert.equal(chooseMatch([], titleKeyOf), null);
    assert.equal(chooseMatch([{ key: "x", ids: [] }], titleKeyOf), null);
    assert.equal(chooseMatch([{ key: "x" }], titleKeyOf), null);
  });

  it("does not accept a second exact match", () => {
    const both = new Map([
      [1, "same"],
      [2, "same"],
    ]);
    assert.equal(chooseMatch([{ key: "same", ids: [1, 2] }], (id: number) => both.get(id)), null);
  });
});
