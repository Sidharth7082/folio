/**
 * Unit tests for the pure content-parsing helpers.
 *
 * Run with: npm test   (Node's built-in test runner + native TypeScript)
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  countWords,
  ordinalFromFileName,
  parseChapterSource,
  slugify,
  splitParagraphs,
  titleFromFileName,
} from "../src/lib/content/parse.ts";

describe("parseChapterSource", () => {
  it("strips a frontmatter title and keeps the body", () => {
    const result = parseChapterSource('---\ntitle: "The Start"\n---\n\nHello world.\n');
    assert.equal(result.title, "The Start");
    assert.equal(result.text, "Hello world.");
  });

  it("handles unquoted titles", () => {
    assert.equal(parseChapterSource("---\ntitle: Plain\n---\n\nBody").title, "Plain");
  });

  it("returns the whole text when there is no frontmatter", () => {
    const result = parseChapterSource("Just body text.");
    assert.equal(result.title, null);
    assert.equal(result.text, "Just body text.");
  });

  it("normalises CRLF and strips a BOM", () => {
    const result = parseChapterSource("---\r\ntitle: X\r\n---\r\n\r\nA\r\nB");
    assert.equal(result.title, "X");
    assert.equal(result.text, "A\nB");
  });
});

describe("splitParagraphs", () => {
  it("splits on blank lines and folds soft wraps", () => {
    assert.deepEqual(splitParagraphs("one\ntwo\n\nthree"), ["one two", "three"]);
  });

  it("drops empty blocks and trims", () => {
    assert.deepEqual(splitParagraphs("\n\n  a  \n\n\n\n b \n\n"), ["a", "b"]);
  });

  it("returns an empty list for blank input", () => {
    assert.deepEqual(splitParagraphs("   \n\n  "), []);
  });
});

describe("countWords", () => {
  it("counts words across paragraphs", () => {
    assert.equal(countWords(["one two three", "four"]), 4);
  });

  it("keeps hyphenated and apostrophised words whole", () => {
    assert.equal(countWords(["well-known don't"]), 2);
  });

  it("ignores punctuation-only paragraphs", () => {
    assert.equal(countWords(["***"]), 0);
  });
});

describe("titleFromFileName", () => {
  it("drops the ordinal and title-cases the rest", () => {
    assert.equal(titleFromFileName("0007-a-quiet-town.md"), "A Quiet Town");
  });

  it("falls back to the raw base name", () => {
    assert.equal(titleFromFileName("0003.txt"), "0003");
  });
});

describe("slugify", () => {
  it("produces url-safe lowercase slugs", () => {
    assert.equal(slugify("Science Fiction"), "science-fiction");
  });

  it("strips diacritics and collapses separators", () => {
    assert.equal(slugify("Café  —  Vol. 2!"), "cafe-vol-2");
  });
});

describe("ordinalFromFileName", () => {
  it("reads a leading number", () => {
    assert.equal(ordinalFromFileName("0042-x.md"), 42);
  });

  it("returns null when there is no leading number", () => {
    assert.equal(ordinalFromFileName("prologue.md"), null);
  });
});
