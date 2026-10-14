/**
 * The data-root rules.
 *
 * These matter because every other module now resolves its paths here, so a
 * mistake in this file moves an existing library out from under its owner. The
 * first test is the important one: with nothing configured, the layout must be
 * byte-for-byte what a plain checkout already uses.
 */
import assert from "node:assert/strict";
import path from "node:path";
import test, { afterEach } from "node:test";

import {
  catalogueDbPath,
  contentDir,
  coversDir,
  folioHome,
  hasConfiguredHome,
  mangaBakaDbPath,
  remoteCoverCacheDir,
} from "../src/lib/config/paths.ts";

const VARS = [
  "FOLIO_HOME",
  "NOVEL_READER_CONTENT_DIR",
  "NOVEL_READER_COVERS_DIR",
  "NOVEL_READER_CATALOGUE_DB",
  "NOVEL_READER_MANGABAKA_DB",
] as const;

function clear() {
  for (const name of VARS) delete process.env[name];
}

afterEach(clear);

test("unconfigured, reproduces the checkout layout exactly", () => {
  clear();
  const cwd = process.cwd();

  assert.equal(folioHome(), cwd);
  assert.equal(hasConfiguredHome(), false);

  assert.equal(contentDir(), path.join(cwd, "content"));
  assert.equal(coversDir(), path.join(cwd, "public", "covers"));
  assert.equal(catalogueDbPath(), path.join(cwd, "data", "catalogue.db"));
  assert.equal(mangaBakaDbPath(), path.join(cwd, "data", "mangabaka.db"));
  assert.equal(remoteCoverCacheDir(), path.join(cwd, "data", "covers"));
});

test("FOLIO_HOME moves every path under one root", () => {
  clear();
  process.env.FOLIO_HOME = "/srv/folio";

  assert.equal(hasConfiguredHome(), true);
  assert.equal(contentDir(), "/srv/folio/content");
  assert.equal(catalogueDbPath(), "/srv/folio/data/catalogue.db");
  assert.equal(mangaBakaDbPath(), "/srv/folio/data/mangabaka.db");
  assert.equal(remoteCoverCacheDir(), "/srv/folio/data/covers");

  // Covers drop the `public/` segment: nothing in a configured home is served
  // as a static file, so there is no reason for the extra level.
  assert.equal(coversDir(), "/srv/folio/covers");
});

test("a relative FOLIO_HOME is resolved against the working directory", () => {
  clear();
  process.env.FOLIO_HOME = "folio-data";
  assert.equal(folioHome(), path.resolve("folio-data"));
  assert.equal(contentDir(), path.join(path.resolve("folio-data"), "content"));
});

test("a per-directory override beats FOLIO_HOME", () => {
  clear();
  process.env.FOLIO_HOME = "/srv/folio";
  process.env.NOVEL_READER_CONTENT_DIR = "/tmp/scratch-books";
  process.env.NOVEL_READER_COVERS_DIR = "/tmp/scratch-covers";
  process.env.NOVEL_READER_CATALOGUE_DB = "/tmp/scratch.db";

  assert.equal(contentDir(), "/tmp/scratch-books");
  assert.equal(coversDir(), "/tmp/scratch-covers");
  assert.equal(catalogueDbPath(), "/tmp/scratch.db");

  // Untouched directories still follow the home.
  assert.equal(mangaBakaDbPath(), "/srv/folio/data/mangabaka.db");
});

test("paths resolve on every call, not once at import", () => {
  clear();
  const before = contentDir();

  process.env.FOLIO_HOME = "/srv/late";
  assert.equal(contentDir(), "/srv/late/content");
  assert.notEqual(contentDir(), before);

  // This is what lets the tests redirect ingest into a scratch directory, and
  // what lets the CLI honour an override set after the module loads.
  clear();
  assert.equal(contentDir(), before);
});
