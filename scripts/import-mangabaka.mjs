#!/usr/bin/env node
/**
 * Convert a MangaBaka database dump into a local SQLite catalogue.
 *
 *   node scripts/import-mangabaka.mjs <series.full.json.tar.gz> [options]
 *
 * The dump is a single JSON array several gigabytes long, so it is streamed and
 * split element by element — never parsed whole. Each record is then projected
 * down to the fields this app shows.
 *
 * That projection is not optional. A raw record is ~20 KB and most of it is
 * unusable here:
 *
 *   source            raw upstream API blobs from six providers (the bulk of the file)
 *   tags_v2           ~5 KB of tag objects per series; `tags` already has the names
 *   cover.x150/x250/x350   nine base64 imgproxy URLs per series, ~1.9 KB
 *   popularity.history      a year of daily snapshots
 *   relationships_v2, secondary_titles, links_v2, genres_v2
 *
 * Dropping those takes a record to roughly a tenth of its size, which is what
 * makes a local copy practical at all.
 *
 * MangaBaka's own data is CC BY-NC-SA 4.0 — non-commercial, attribution
 * required — and it republishes AniList, MyAnimeList, Kitsu, MangaUpdates,
 * Shikimori and Anime-Planet records under each provider's own terms. The app
 * attributes both.
 *
 * Options:
 *   --out <path>   Output SQLite file (default: data/mangabaka.db)
 *   --types <list> Comma-separated types to keep (default: novel)
 *   --all-types    Keep every type (manga, manhwa, manhua, oel, other, ...)
 */
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { normaliseTitle } from "../src/lib/catalogue/mangabaka-api.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const DEFAULT_OUT = path.join(ROOT, "data", "mangabaka.db");

/** The app is a light-novel room, so only novels are imported by default. */
const DEFAULT_TYPES = ["novel"];

/**
 * Only images MangaBaka itself serves are stored.
 *
 * Raw cover URLs point at whichever provider supplied the record — measured
 * across the active novels that is anilist.co (9,020), myanimelist.net (3,870),
 * mangaupdates.com (856) and kitsu.app (399), alongside MangaBaka's own hosts.
 * Those belong to third parties with their own terms, so this app does not
 * hotlink them. MangaBaka's image proxy serves a pre-sized variant of the same
 * artwork from its own domain, which is what gets stored instead.
 */
const ALLOWED_IMAGE_HOSTS = new Set([
  "images.mangabaka.dev",
  "cdn.mangabaka.dev",
  "ap-proxy.mangabaka.dev",
]);

/** Only these hosts may appear as a canonical page URL. */
const ALLOWED_PAGE_HOSTS = new Set(["mangabaka.org", "www.mangabaka.org"]);

/** Cap the title aliases indexed per series, so one prolific entry cannot balloon. */
const MAX_TITLE_KEYS = 24;

/* -------------------------------------------------------------------------
   Streaming JSON array reader (pure, exported for tests)
   ------------------------------------------------------------------------- */

/**
 * Yield each top-level element of a JSON array as its own string.
 *
 * `scanned` carries the scan position across chunks. Without it the opening
 * brace of a part-read element gets counted twice and `depth` desynchronises,
 * which silently truncates records.
 */
export async function* readJsonArrayElements(stream) {
  let buf = "";
  let scanned = 0;
  let depth = 0;
  let inStr = false;
  let esc = false;
  let start = -1;

  for await (const chunk of stream) {
    buf += chunk;
    for (let i = scanned; i < buf.length; i += 1) {
      const c = buf[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === "{") {
        if (depth === 0) start = i;
        depth += 1;
      } else if (c === "}") {
        depth -= 1;
        if (depth === 0 && start >= 0) {
          yield buf.slice(start, i + 1);
          start = -1;
        }
      }
    }
    // Keep only the unfinished element so memory stays bounded.
    scanned = buf.length;
    if (start >= 0) {
      buf = buf.slice(start);
      scanned -= start;
      start = 0;
    } else {
      buf = "";
      scanned = 0;
    }
  }
}

/* -------------------------------------------------------------------------
   Projection (pure, exported for tests)
   ------------------------------------------------------------------------- */

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

/** A trusted https URL from `value`, or null. Guards against hostile dumps. */
function safeUrl(value, allowedHosts) {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (!allowedHosts.has(url.hostname.toLowerCase())) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function mangabakaCoverUrl(raw) {
  // MangaBaka's own storage first, then its image proxy. A provider-hosted
  // `raw.url` fails the allowlist above and falls through to the proxy.
  return (
    safeUrl(raw?.cover?.raw?.url, ALLOWED_IMAGE_HOSTS) ??
    safeUrl(raw?.cover?.x250?.x2, ALLOWED_IMAGE_HOSTS) ??
    safeUrl(raw?.cover?.x150?.x2, ALLOWED_IMAGE_HOSTS)
  );
}

export function mangabakaPageUrl(raw) {
  return safeUrl(raw?.canonical_url, ALLOWED_PAGE_HOSTS);
}

/** A positive integer year, or null. */
function yearOf(value) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value < 3000
    ? value
    : null;
}

function stringList(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => typeof entry === "string" && entry.trim().length > 0).map((s) => s.trim());
}

/**
 * Whether a record should be imported.
 *
 * `merged` records are duplicates that MangaBaka has folded into another entry;
 * importing them would put two rows behind one series and let the matcher pick
 * the wrong one. `deleted` is self-explanatory.
 */
export function isImportable(raw, types) {
  if (!raw || typeof raw.id !== "number" || !Number.isFinite(raw.id)) return false;
  if (raw.state !== "active") return false;
  if (raw.merged_with !== null && raw.merged_with !== undefined) return false;
  if (types && !types.has(raw.type)) return false;
  return true;
}

/**
 * Every name this series is known by, as normalised lookup keys.
 *
 * Matching on all aliases rather than just the display title is what lets a
 * RanobeDB romanisation line up with a MangaBaka native title.
 */
export function titleKeysFor(raw) {
  const candidates = [
    raw.title,
    raw.romanized_title,
    raw.native_title,
    ...stringList(raw.titles?.map?.((t) => t?.title)),
    ...stringList(raw.aliases),
  ];

  if (raw.titles && Array.isArray(raw.titles)) {
    for (const entry of raw.titles) {
      if (entry && typeof entry.title === "string") candidates.push(entry.title);
    }
  }
  if (raw.secondary_titles && typeof raw.secondary_titles === "object") {
    for (const group of Object.values(raw.secondary_titles)) {
      if (Array.isArray(group)) {
        for (const entry of group) {
          if (entry && typeof entry.title === "string") candidates.push(entry.title);
        }
      }
    }
  }

  const keys = new Set();
  for (const candidate of candidates) {
    const key = normaliseTitle(candidate);
    if (key.length >= 2) keys.add(key);
    if (keys.size >= MAX_TITLE_KEYS) break;
  }
  return [...keys];
}

/** Reduce one dump record to the shape the app stores. */
export function projectSeries(raw) {
  const rating =
    typeof raw.rating === "number" && Number.isFinite(raw.rating) && raw.rating > 0
      ? raw.rating
      : null;

  const popularityCurrent = raw.popularity?.global?.current;

  const titles = (Array.isArray(raw.titles) ? raw.titles : [])
    .filter((entry) => entry && typeof entry.title === "string" && entry.title.trim().length > 0)
    .map((entry) => ({
      language: firstString(entry.language),
      title: entry.title.trim(),
      isPrimary: entry.is_primary === true ? 1 : 0,
      note: firstString(entry.note),
    }));

  const publishers = (Array.isArray(raw.publishers) ? raw.publishers : [])
    .filter((entry) => entry && typeof entry.name === "string" && entry.name.trim().length > 0)
    .map((entry) => ({
      name: entry.name.trim(),
      language: firstString(entry.language),
      type: firstString(entry.type),
      url: safeUrl(entry.canonical_url, ALLOWED_PAGE_HOSTS),
    }));

  return {
    series: {
      id: Math.trunc(raw.id),
      title:
        firstString(raw.title, raw.romanized_title, raw.native_title) ?? `MangaBaka #${raw.id}`,
      title_key: normaliseTitle(firstString(raw.title, raw.romanized_title, raw.native_title)),
      native_title: firstString(raw.native_title),
      romanized_title: firstString(raw.romanized_title),
      description: typeof raw.description === "string" ? raw.description : "",
      cover_url: mangabakaCoverUrl(raw),
      year: yearOf(raw.year),
      status: firstString(raw.status),
      type: firstString(raw.type) ?? "unknown",
      original_language: firstString(raw.original_language),
      content_rating: firstString(raw.content_rating),
      rating,
      popularity: typeof popularityCurrent === "number" ? popularityCurrent : null,
      is_licensed: raw.is_licensed === true ? 1 : 0,
      has_anime: raw.has_anime === true ? 1 : 0,
      final_volume: firstString(raw.final_volume),
      total_chapters: firstString(raw.total_chapters),
      canonical_url: mangabakaPageUrl(raw),
      last_updated_at: firstString(raw.last_updated_at),
    },
    authors: [
      ...stringList(raw.authors).map((name) => ({ name, role: "author" })),
      ...stringList(raw.artists).map((name) => ({ name, role: "artist" })),
    ],
    // genres are a separate list from tags in the dump; both matter for display.
    tags: [
      ...stringList(raw.genres).map((name) => ({ name, kind: "genre" })),
      ...stringList(raw.tags).map((name) => ({ name, kind: "tag" })),
    ],
    titles,
    publishers,
    titleKeys: titleKeysFor(raw),
  };
}

/* -------------------------------------------------------------------------
   SQLite
   ------------------------------------------------------------------------- */

const SCHEMA = `
PRAGMA journal_mode = OFF;
PRAGMA synchronous = OFF;

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE series (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  title_key TEXT NOT NULL,
  native_title TEXT,
  romanized_title TEXT,
  description TEXT NOT NULL DEFAULT '',
  cover_url TEXT,
  year INTEGER,
  status TEXT,
  type TEXT NOT NULL,
  original_language TEXT,
  content_rating TEXT,
  rating REAL,
  popularity INTEGER,
  is_licensed INTEGER NOT NULL DEFAULT 0,
  has_anime INTEGER NOT NULL DEFAULT 0,
  final_volume TEXT,
  total_chapters TEXT,
  canonical_url TEXT,
  last_updated_at TEXT
);

/* Every alias a series is known by, normalised once at import time so matching
   against the RanobeDB catalogue is an index lookup rather than a title scan. */
CREATE TABLE title_key (
  key TEXT NOT NULL,
  series_id INTEGER NOT NULL,
  PRIMARY KEY (key, series_id)
);

CREATE TABLE series_author (
  series_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  PRIMARY KEY (series_id, name, role)
);

CREATE TABLE series_tag (
  series_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  PRIMARY KEY (series_id, name, kind)
);

CREATE TABLE series_title (
  series_id INTEGER NOT NULL,
  language TEXT,
  title TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  note TEXT
);

CREATE TABLE series_publisher (
  series_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  language TEXT,
  type TEXT,
  url TEXT,
  PRIMARY KEY (series_id, name, type)
);

CREATE INDEX idx_mb_series_key ON series(title_key);
CREATE INDEX idx_mb_series_rating ON series(rating DESC);
CREATE INDEX idx_mb_series_popularity ON series(popularity DESC);
CREATE INDEX idx_mb_title_key ON title_key(key);
CREATE INDEX idx_mb_author_series ON series_author(series_id);
CREATE INDEX idx_mb_tag_series ON series_tag(series_id);
CREATE INDEX idx_mb_title_series ON series_title(series_id);
CREATE INDEX idx_mb_publisher_series ON series_publisher(series_id);
`;

async function writeDatabase(outPath, records, stats, dumpPath, types) {
  mkdirSync(path.dirname(outPath), { recursive: true });
  rmSync(outPath, { force: true });

  const db = new DatabaseSync(outPath);
  db.exec(SCHEMA);

  const insertSeries = db.prepare(`
    INSERT OR REPLACE INTO series (id, title, title_key, native_title, romanized_title,
      description, cover_url, year, status, type, original_language, content_rating,
      rating, popularity, is_licensed, has_anime, final_volume, total_chapters,
      canonical_url, last_updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertKey = db.prepare("INSERT OR IGNORE INTO title_key (key, series_id) VALUES (?, ?)");
  const insertAuthor = db.prepare(
    "INSERT OR IGNORE INTO series_author (series_id, name, role) VALUES (?, ?, ?)",
  );
  const insertTag = db.prepare(
    "INSERT OR IGNORE INTO series_tag (series_id, name, kind) VALUES (?, ?, ?)",
  );
  const insertTitle = db.prepare(
    "INSERT INTO series_title (series_id, language, title, is_primary, note) VALUES (?, ?, ?, ?, ?)",
  );
  const insertPublisher = db.prepare(
    "INSERT OR IGNORE INTO series_publisher (series_id, name, language, type, url) VALUES (?, ?, ?, ?, ?)",
  );
  const insertMeta = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");

  db.exec("BEGIN");
  try {
    // Records arrive as they are parsed, so nothing larger than a single
    // record is ever held in memory.
    for await (const record of records) {
      const s = record.series;
      insertSeries.run(
        s.id, s.title, s.title_key, s.native_title, s.romanized_title, s.description,
        s.cover_url, s.year, s.status, s.type, s.original_language, s.content_rating,
        s.rating, s.popularity, s.is_licensed, s.has_anime, s.final_volume,
        s.total_chapters, s.canonical_url, s.last_updated_at,
      );
      for (const key of record.titleKeys) insertKey.run(key, s.id);
      for (const author of record.authors) insertAuthor.run(s.id, author.name, author.role);
      for (const tag of record.tags) insertTag.run(s.id, tag.name, tag.kind);
      for (const title of record.titles) {
        insertTitle.run(s.id, title.language, title.title, title.isPrimary, title.note);
      }
      for (const publisher of record.publishers) {
        insertPublisher.run(s.id, publisher.name, publisher.language, publisher.type, publisher.url);
      }
    }

    for (const [key, value] of Object.entries({
      source_file: path.basename(dumpPath),
      generated_at: new Date().toISOString(),
      series_count: String(stats.imported),
      types: types ? [...types].sort().join(",") : "all",
      skipped_merged: String(stats.skippedMerged),
      skipped_type: String(stats.skippedType),
      license:
        "CC BY-NC-SA 4.0 (MangaBaka) — attribution required; upstream providers under their own terms",
      source_counts: JSON.stringify(stats.counts),
    })) {
      insertMeta.run(key, value);
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}

/* -------------------------------------------------------------------------
   CLI
   ------------------------------------------------------------------------- */

function parseArgs(argv) {
  const options = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) options[key] = true;
      else {
        options[key] = value;
        i += 1;
      }
    } else positional.push(token);
  }
  return { options, positional };
}

const USAGE = `Usage:
  node scripts/import-mangabaka.mjs <series.full.json.tar.gz> [options]

Options:
  --out <path>    Output SQLite file (default: data/mangabaka.db)
  --types <list>  Comma-separated types to keep (default: novel)
  --all-types     Keep every type (manga, manhwa, manhua, oel, other, ...)

Only the fields this app displays are stored. The dump's bulky extras — the raw
upstream provider blobs, tag objects, cover size variants and popularity
history — are dropped, which is what makes a local copy practical.

MangaBaka data is CC BY-NC-SA 4.0; attribution is required. Upstream providers
(AniList, MyAnimeList, Kitsu, MangaUpdates, Shikimori, Anime-Planet) keep their
own terms.`;

async function* gunzipTarMember(dumpPath, member) {
  const tar = spawn("tar", ["-xzOf", dumpPath, member]);
  tar.stderr.on("data", () => {});
  yield* readJsonArrayElements(tar.stdout);
}

async function main() {
  const { options, positional } = parseArgs(process.argv.slice(2));
  const input = positional[0];

  if (!input || options.help) {
    console.log(USAGE);
    process.exit(input ? 0 : 1);
  }

  const dumpPath = path.resolve(process.cwd(), input);
  const outPath =
    options.out === undefined || options.out === true
      ? DEFAULT_OUT
      : path.resolve(process.cwd(), options.out);

  const types = options["all-types"]
    ? null
    : new Set(
        typeof options.types === "string"
          ? options.types.split(",").map((t) => t.trim()).filter(Boolean)
          : DEFAULT_TYPES,
      );

  console.log(`Reading ${path.basename(dumpPath)} …`);
  const started = Date.now();

  const stats = {
    imported: 0,
    skippedMerged: 0,
    skippedType: 0,
    unparseable: 0,
    withRating: 0,
    withDescription: 0,
    withCover: 0,
    counts: {},
  };
  let seen = 0;

  // The archive is one JSON array of ~500k records, so it is streamed and
  // projected element by element straight into SQLite.
  async function* records() {
    for await (const raw of gunzipTarMember(dumpPath, "series.full.json")) {
      seen += 1;
      if (seen % 100000 === 0) {
        process.stderr.write(`  ${seen} read, ${stats.imported} kept\n`);
      }
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        stats.unparseable += 1;
        continue;
      }
      const type = parsed.type ?? "unknown";
      stats.counts[type] = (stats.counts[type] ?? 0) + 1;

      if (parsed.state !== "active") {
        stats.skippedMerged += 1;
        continue;
      }
      if (types && !types.has(parsed.type)) {
        stats.skippedType += 1;
        continue;
      }
      if (!isImportable(parsed, types)) continue;

      const record = projectSeries(parsed);
      stats.imported += 1;
      if (record.series.rating !== null) stats.withRating += 1;
      if (record.series.description.length > 0) stats.withDescription += 1;
      if (record.series.cover_url !== null) stats.withCover += 1;
      yield record;
    }
  }

  await writeDatabase(outPath, records(), stats, dumpPath, types);

  const sizeMb = (statSync(outPath).size / 1048576).toFixed(1);
  const { withRating, withDescription, withCover } = stats;

  console.log(
    `  ${((Date.now() - started) / 1000).toFixed(0)}s — wrote ${path.relative(ROOT, outPath)} (${sizeMb} MB)`,
  );
  console.log(`  read        ${String(seen).padStart(7)}`);
  console.log(`  imported    ${String(stats.imported).padStart(7)}   types: ${types ? [...types].join(",") : "all"}`);
  console.log(`  with rating ${String(withRating).padStart(7)}   (${((100 * withRating) / stats.imported).toFixed(1)}%)`);
  console.log(`  with descr. ${String(withDescription).padStart(7)}`);
  console.log(`  with cover  ${String(withCover).padStart(7)}`);
  console.log(`  skipped     ${String(stats.skippedMerged).padStart(7)} not active/merged, ${stats.skippedType} other type`);
  if (stats.unparseable > 0) console.log(`  unparseable ${stats.unparseable}`);
  console.log("  Licence: CC BY-NC-SA 4.0 — attribute MangaBaka and its providers.");
}

const invokedDirectly =
  typeof import.meta.main === "boolean"
    ? import.meta.main
    : Boolean(process.argv[1]) && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`import failed: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
}
