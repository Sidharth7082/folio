#!/usr/bin/env node
/**
 * Link the RanobeDB catalogue to the local MangaBaka catalogue by title.
 *
 *   node scripts/link-mangabaka.mjs [--catalogue data/catalogue.db] [--mangabaka data/mangabaka.db]
 *
 * Why this exists: RanobeDB carries a community score for only ~1,200 of its
 * 23,000 series, while MangaBaka has one for about a third of its novels.
 * Linking them lifts rating coverage a long way — offline, with no API calls.
 *
 * Writes `catalogue_match` into the MangaBaka database, so the app can go from a
 * RanobeDB series id to its MangaBaka record with one indexed lookup. The
 * RanobeDB database is opened read-only and never modified.
 *
 * Matching rule, in order of trust:
 *   1. English title, then romanisation, then native title
 *   2. within a round, a candidate whose own display title matches the key wins
 *   3. otherwise, a round with exactly one candidate wins
 *   4. anything still ambiguous is refused
 *
 * Step 4 matters. Sibling works in a franchise score differently — "High School
 * DxD" against "High School DxD DX", "True High School DxD", "Junior High
 * School DxD" — and picking the most popular would confidently show the wrong
 * number. Refusing is the honest outcome.
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import process from "node:process";

import { normaliseTitle } from "../src/lib/catalogue/mangabaka-api.ts";

const ROOT = path.resolve(import.meta.dirname, "..");

/* -------------------------------------------------------------------------
   Matching (pure, exported for tests)
   ------------------------------------------------------------------------- */

/**
 * Choose a MangaBaka id from ordered lookup rounds.
 *
 * @param rounds      `[{ key, ids }]`, most trustworthy key first.
 * @param titleKeyOf  maps a candidate id to its own normalised display title.
 * @returns the chosen id, or null when nothing is conclusive.
 */
export function chooseMatch(rounds, titleKeyOf) {
  for (const round of rounds) {
    const ids = round?.ids ?? [];
    if (ids.length === 0) continue;
    if (ids.length === 1) return { id: ids[0], key: round.key, confidence: "sole" };

    // Several series share this alias, so only a candidate that carries it as its
    // own display title is a safe answer.
    const exact = ids.filter((id) => titleKeyOf(id) === round.key);
    if (exact.length === 1) return { id: exact[0], key: round.key, confidence: "exact" };
  }
  return null;
}

/**
 * The lookup keys for one RanobeDB series, most trustworthy first.
 *
 * English leads because it is the most distinctive across both databases;
 * the native title is last because short or generic Japanese titles collide
 * with spin-offs far more often.
 */
export function matchKeysFor(series) {
  const ordered = [series.title_en, series.romaji, series.title_ja];
  const seen = new Set();
  const keys = [];
  for (const value of ordered) {
    const key = normaliseTitle(value);
    if (key.length < 2 || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

/* -------------------------------------------------------------------------
   CLI
   ------------------------------------------------------------------------- */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS catalogue_match (
  ranobedb_series_id INTEGER PRIMARY KEY,
  mangabaka_id INTEGER NOT NULL,
  matched_key TEXT NOT NULL,
  confidence TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_match_mangabaka ON catalogue_match(mangabaka_id);
`;

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      options[token.slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const cataloguePath = path.resolve(ROOT, options.catalogue ?? "data/catalogue.db");
  const mangabakaPath = path.resolve(ROOT, options.mangabaka ?? "data/mangabaka.db");

  const catalogue = new DatabaseSync(cataloguePath, { readOnly: true });
  const mangabaka = new DatabaseSync(mangabakaPath);

  // alias key -> candidate MangaBaka ids
  const index = new Map();
  for (const row of mangabaka.prepare("SELECT key, series_id FROM title_key").all()) {
    const list = index.get(row.key);
    if (list) list.push(row.series_id);
    else index.set(row.key, [row.series_id]);
  }

  const titleKeyOf = new Map();
  const ratingOf = new Map();
  for (const row of mangabaka.prepare("SELECT id, title_key, rating FROM series").all()) {
    titleKeyOf.set(row.id, row.title_key);
    ratingOf.set(row.id, row.rating);
  }

  const series = catalogue
    .prepare("SELECT id, title_en, title_ja, romaji, rating FROM series")
    .all();

  const rows = [];
  let ambiguous = 0;
  let unmatched = 0;
  let gained = 0;
  let alreadyRated = 0;

  for (const entry of series) {
    const keys = matchKeysFor(entry);
    const rounds = keys.map((key) => ({ key, ids: index.get(key) ?? [] }));
    const hasAnyCandidate = rounds.some((round) => round.ids.length > 0);

    const match = chooseMatch(rounds, (id) => titleKeyOf.get(id) ?? null);
    if (!match) {
      if (hasAnyCandidate) ambiguous += 1;
      else unmatched += 1;
      continue;
    }

    // A genuine gain means RanobeDB has no score *and* MangaBaka has one.
    // Counting "RanobeDB had none" by itself would overstate this badly, since
    // about two thirds of MangaBaka's novels carry no score either.
    if (entry.rating === null && ratingOf.get(match.id) != null) gained += 1;
    if (entry.rating !== null) alreadyRated += 1;

    rows.push({
      seriesId: entry.id,
      mangabakaId: match.id,
      key: match.key,
      confidence: match.confidence,
    });
  }

  mangabaka.exec(SCHEMA);
  mangabaka.exec("DELETE FROM catalogue_match");
  const insert = mangabaka.prepare(
    "INSERT OR REPLACE INTO catalogue_match (ranobedb_series_id, mangabaka_id, matched_key, confidence) VALUES (?, ?, ?, ?)",
  );
  const meta = mangabaka.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)");

  mangabaka.exec("BEGIN");
  try {
    for (const row of rows) insert.run(row.seriesId, row.mangabakaId, row.key, row.confidence);
    for (const [key, value] of Object.entries({
      linked_at: new Date().toISOString(),
      linked_count: String(rows.length),
      linked_ambiguous: String(ambiguous),
      linked_unmatched: String(unmatched),
      linked_gained_rating: String(gained),
    })) {
      meta.run(key, value);
    }
    mangabaka.exec("COMMIT");
  } catch (error) {
    mangabaka.exec("ROLLBACK");
    throw error;
  } finally {
    catalogue.close();
    mangabaka.close();
  }

  const pct = (n) => `${((100 * n) / series.length).toFixed(1)}%`;
  console.log(`RanobeDB series        ${series.length}`);
  console.log(`  linked               ${rows.length}   (${pct(rows.length)})`);
  console.log(`    exact-title        ${rows.filter((r) => r.confidence === "exact").length}`);
  console.log(`    sole candidate     ${rows.filter((r) => r.confidence === "sole").length}`);
  console.log(`  refused (ambiguous)  ${ambiguous}   (${pct(ambiguous)})`);
  console.log(`  no candidate         ${unmatched}   (${pct(unmatched)})`);
  console.log(`  RanobeDB had rating  ${alreadyRated}`);
  console.log(`  GAINED a rating      ${gained}   (linked, but RanobeDB had none and MangaBaka has one)`);
  console.log("  Wrote catalogue_match into the MangaBaka database.");
}

const invokedDirectly =
  typeof import.meta.main === "boolean"
    ? import.meta.main
    : Boolean(process.argv[1]) && path.resolve(process.argv[1]) === path.resolve(import.meta.url.replace("file://", ""));

if (invokedDirectly) {
  try {
    main();
  } catch (error) {
    console.error(`link failed: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
