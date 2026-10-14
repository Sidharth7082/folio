#!/usr/bin/env node
/**
 * Convert a RanobeDB public database dump into a local SQLite catalogue.
 *
 *   node scripts/import-ranobedb.mjs <rndb-db-public-latest.dump.gz> [--out data/catalogue.db] [--limit N]
 *
 * The dump is PostgreSQL plain-text (`pg_dump`), so no PostgreSQL server is
 * needed: this streams the gzip, parses the COPY blocks, and writes a small
 * normalised SQLite file the app can query.
 *
 * RanobeDB is metadata only — titles, authors, tags, releases, cover filenames.
 * It contains no novel text, and this script never downloads anything else.
 *
 * RanobeDB data is published under the Open Database License (ODbL), with
 * individual contents under the Database Contents License (DbCL). Attribution
 * to RanobeDB is required wherever this data is shown or redistributed.
 */
import { createGunzip } from "node:zlib";
import { createReadStream, mkdirSync, rmSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");
const DEFAULT_OUT = path.join(ROOT, "data", "catalogue.db");

/** Sentinel RanobeDB uses for "no end date". */
const OPEN_ENDED = 99999999;

/* -------------------------------------------------------------------------
   COPY-format parsing (pure, exported for tests)
   ------------------------------------------------------------------------- */

/** Resolve PostgreSQL COPY text escapes: `\t`, `\n`, `\r`, `\\`. */
export function unescapeField(value) {
  return value.replace(/\\(.)/g, (_, char) => {
    if (char === "t") return "\t";
    if (char === "n") return "\n";
    if (char === "r") return "\r";
    return char;
  });
}

/** Split one raw COPY data line into still-escaped tab-separated fields. */
export function splitCopyFields(line) {
  const raw = line.endsWith("\r") ? line.slice(0, -1) : line;
  return raw.split("\t");
}

/** Split one COPY data line into fields, converting `\N` to null. */
export function parseCopyLine(line) {
  return splitCopyFields(line).map((field) => (field === "\\N" ? null : unescapeField(field)));
}

/** Parse `COPY public.<table> (a, b, c) FROM stdin;` into its parts. */
export function parseCopyHeader(line) {
  const match = /^COPY (?:public\.)?"?([\w]+)"?\s*\(([^)]*)\)\s*FROM stdin;/.exec(line);
  if (!match) return null;
  return {
    table: match[1],
    columns: match[2].split(",").map((column) => column.trim().replace(/^"|"$/g, "")),
  };
}

/**
 * PostgreSQL dumps booleans as the text `t` / `f`, so a truthiness check would
 * treat `"f"` as official. Compare explicitly (and tolerate real booleans).
 */
export function isOfficialFlag(value) {
  return value === "t" || value === true;
}

/** Prefer an official English title, then any English title. */
export function chooseTitles(rows) {
  const byLang = (lang) => rows.filter((row) => row.lang === lang);
  const english = byLang("en");
  const japanese = byLang("ja");
  const pick = (list) => list.find((row) => isOfficialFlag(row.official)) ?? list[0] ?? null;

  const en = pick(english);
  const ja = pick(japanese);
  const anyRow = en ?? ja ?? rows[0] ?? null;

  return {
    titleEn: en?.title ?? null,
    titleJa: ja?.title ?? null,
    romaji: en?.romaji ?? ja?.romaji ?? anyRow?.romaji ?? null,
  };
}

/* -------------------------------------------------------------------------
   Dump reading
   ------------------------------------------------------------------------- */

const WANTED = new Set([
  "series",
  "series_title",
  "series_relation",
  "series_tag",
  "tag",
  "series_book",
  "book",
  "book_title",
  "book_edition",
  "book_staff_alias",
  "staff",
  "staff_alias",
  "image",
  "publisher",
  "publisher_relation",
  "release",
  "release_book",
  "release_publisher",
]);

/** The one role that fills a series' author line. */
const AUTHOR_ROLE = "author";

/** Display labels for RanobeDB's staff role vocabulary. */
const ROLE_LABELS = {
  author: "Author",
  artist: "Artist",
  translator: "Translator",
  editor: "Editor",
  narrator: "Narrator",
  staff: "Staff",
};

/** Label a staff role, tolerating roles RanobeDB adds later. */
export function roleLabel(role) {
  if (typeof role !== "string" || role.length === 0) return "Staff";
  return ROLE_LABELS[role] ?? role.charAt(0).toUpperCase() + role.slice(1);
}

/**
 * RanobeDB says "no date" in three different ways: an empty string, the
 * 99999999 open-ended sentinel, and occasionally a value below the YYYYMMDD
 * floor. All three mean unknown, so they become null rather than a bogus date.
 * A raw truthiness check would turn every one of them into a real date.
 */
export function normaliseDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (numeric < 10000101 || numeric >= OPEN_ENDED) return null;
  return Math.trunc(numeric);
}

/** Coerce a COPY field to an integer, treating blank and `\N` as absent. */
function numericOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : null;
}

/** Trim a string field, returning null when there is nothing left. */
export function textOrNull(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Trim a string field, returning "" for anything that is not a string. */
function trimmed(value) {
  return typeof value === "string" ? value.trim() : "";
}

export async function readDump(dumpPath) {
  const data = {    series: new Map(),
    seriesTitles: new Map(),
    seriesRelations: [],
    tags: new Map(),
    seriesTags: new Map(),
    seriesBooks: new Map(),
    books: new Map(),
    bookTitles: new Map(),
    bookEditions: new Map(),
    bookStaff: new Map(),
    staff: new Map(),
    staffAlias: new Map(),
    images: new Map(),
    publishers: new Map(),
    publisherRelations: [],
    releases: new Map(),
    releaseBooks: [],
    releasePublishers: [],
  };

  const stream = createReadStream(dumpPath).pipe(createGunzip());
  const lines = createInterface({ input: stream, crlfDelay: Infinity });

  let current = null;
  let columns = null;
  let insideCopy = false;
  const seen = new Map();

  // A text field in the source can carry a raw line break, which splits one
  // logical COPY row across two physical lines. Fields are buffered until the
  // row is as wide as its table, then decoded as a single record.
  let pendingFields = null;
  let malformed = 0;

  for await (const line of lines) {
    if (!insideCopy) {
      if (line.startsWith("COPY ")) {
        const header = parseCopyHeader(line);
        pendingFields = null;
        if (header && WANTED.has(header.table)) {
          current = header.table;
          columns = header.columns;
          insideCopy = true;
          seen.set(current, 0);
        } else {
          current = null;
          columns = null;
          insideCopy = header !== null;
        }
      }
      continue;
    }

    if (line === "\\.") {
      if (pendingFields !== null) {
        malformed += 1;
        pendingFields = null;
      }
      insideCopy = false;
      current = null;
      columns = null;
      continue;
    }

    if (current === null) continue;

    pendingFields =
      pendingFields === null ? splitCopyFields(line) : pendingFields.concat(splitCopyFields(line));
    if (pendingFields.length < columns.length) continue;

    if (pendingFields.length > columns.length) {
      // An unescaped tab as well as a line break. The original field boundaries
      // are unknowable, so drop the record instead of storing a corrupt one.
      malformed += 1;
      pendingFields = null;
      continue;
    }

    const values = pendingFields.map((field) => (field === "\\N" ? null : unescapeField(field)));
    pendingFields = null;
    const row = {};
    for (let i = 0; i < columns.length; i += 1) row[columns[i]] = values[i] ?? null;
    seen.set(current, (seen.get(current) ?? 0) + 1);

    switch (current) {
      case "series":
        data.series.set(Number(row.id), row);
        break;
      case "series_title": {
        const id = Number(row.series_id);
        const list = data.seriesTitles.get(id) ?? [];
        list.push(row);
        data.seriesTitles.set(id, list);
        break;
      }
      case "series_relation":
        data.seriesRelations.push({
          parentId: Number(row.id_parent),
          childId: Number(row.id_child),
          relationType: textOrNull(row.relation_type) ?? "",
        });
        break;
      case "tag":
        data.tags.set(Number(row.id), { name: row.name, ttype: row.ttype });
        break;
      case "series_tag": {
        const id = Number(row.series_id);
        const list = data.seriesTags.get(id) ?? [];
        list.push(Number(row.tag_id));
        data.seriesTags.set(id, list);
        break;
      }
      case "series_book": {
        const id = Number(row.series_id);
        const list = data.seriesBooks.get(id) ?? [];
        list.push({
          bookId: Number(row.book_id),
          order: Number(row.sort_order) || 0,
          bookType: textOrNull(row.book_type),
        });
        data.seriesBooks.set(id, list);
        break;
      }
      case "book":
        data.books.set(Number(row.id), {
          imageId: numericOrNull(row.image_id),
          releaseDate: normaliseDate(row.release_date),
          olang: textOrNull(row.olang),
          description: typeof row.description === "string" ? row.description : "",
          descriptionJa: typeof row.description_ja === "string" ? row.description_ja : "",
        });
        break;
      case "book_title": {
        const id = Number(row.book_id);
        const list = data.bookTitles.get(id) ?? [];
        list.push(row);
        data.bookTitles.set(id, list);
        break;
      }
      case "book_edition": {
        const id = Number(row.book_id);
        const list = data.bookEditions.get(id) ?? [];
        list.push({
          eid: numericOrNull(row.eid),
          lang: textOrNull(row.lang),
          title: textOrNull(row.title),
        });
        data.bookEditions.set(id, list);
        break;
      }
      case "book_staff_alias": {
        const id = Number(row.book_id);
        const list = data.bookStaff.get(id) ?? [];
        list.push({
          aliasId: Number(row.staff_alias_id),
          role: textOrNull(row.role_type) ?? "staff",
          note: textOrNull(row.note),
        });
        data.bookStaff.set(id, list);
        break;
      }
      case "staff":
        data.staff.set(Number(row.id), {
          website: textOrNull(row.website),
          twitterId: textOrNull(row.twitter_id),
        });
        break;
      case "staff_alias":
        data.staffAlias.set(Number(row.id), {
          staffId: Number(row.staff_id),
          main: isOfficialFlag(row.main_alias),
          name: typeof row.name === "string" ? row.name : "",
          romaji: typeof row.romaji === "string" ? row.romaji : "",
        });
        break;
      case "image":
        data.images.set(Number(row.id), row.filename);
        break;
      case "publisher":
        data.publishers.set(Number(row.id), {
          name: typeof row.name === "string" ? row.name : "",
          romaji: typeof row.romaji === "string" ? row.romaji : "",
          lang: textOrNull(row.lang),
          website: textOrNull(row.website),
        });
        break;
      case "publisher_relation":
        data.publisherRelations.push({
          parentId: Number(row.id_parent),
          childId: Number(row.id_child),
          relationType: textOrNull(row.relation_type) ?? "",
        });
        break;
      case "release":
        data.releases.set(Number(row.id), {
          releaseDate: normaliseDate(row.release_date),
          format: textOrNull(row.format),
          lang: textOrNull(row.lang),
          title: textOrNull(row.title),
          romaji: textOrNull(row.romaji),
          isbn13: textOrNull(row.isbn13),
          website: textOrNull(row.website),
          pages: numericOrNull(row.pages),
          duration: numericOrNull(row.duration),
          imageId: numericOrNull(row.image_id),
        });
        break;
      case "release_book":
        data.releaseBooks.push({
          releaseId: Number(row.release_id),
          bookId: Number(row.book_id),
          rtype: textOrNull(row.rtype) ?? "",
        });
        break;
      case "release_publisher":
        data.releasePublishers.push({
          releaseId: Number(row.release_id),
          publisherId: Number(row.publisher_id),
          publisherType: textOrNull(row.publisher_type) ?? "",
        });
        break;
      default:
        break;
    }
  }

  return { data, counts: Object.fromEntries(seen), malformed };
}

/* -------------------------------------------------------------------------
   Row building
   ------------------------------------------------------------------------- */

export function buildSeriesRows(data) {
  const rows = [];

  for (const [seriesId, series] of data.series) {
    if (isOfficialFlag(series.hidden)) continue;

    const titles = chooseTitles(data.seriesTitles.get(seriesId) ?? []);
    const tagIds = data.seriesTags.get(seriesId) ?? [];
    const tagNames = tagIds
      .map((tagId) => data.tags.get(tagId)?.name)
      .filter((name) => typeof name === "string" && name.length > 0)
      .sort();

    const books = [...(data.seriesBooks.get(seriesId) ?? [])].sort((a, b) => a.order - b.order);

    // Authors are shown romanised where RanobeDB has a romanisation, but the
    // native form is kept in the search text so either spelling will match.
    const authors = [];
    const authorTerms = [];
    let coverFilename = null;
    for (const book of books) {
      for (const link of data.bookStaff.get(book.bookId) ?? []) {
        if (link.role !== AUTHOR_ROLE) continue;
        const alias = data.staffAlias.get(link.aliasId);
        if (!alias) continue;

        const romaji = trimmed(alias.romaji);
        const native = trimmed(alias.name);
        const display = romaji || native;

        if (display && !authors.includes(display)) authors.push(display);
        for (const term of [romaji, native]) {
          if (term && !authorTerms.includes(term)) authorTerms.push(term);
        }
      }
      if (coverFilename === null) {
        const imageId = data.books.get(book.bookId)?.imageId;
        if (imageId !== null && imageId !== undefined) {
          coverFilename = data.images.get(imageId) ?? null;
        }
      }
    }

    // c_average is stored as thousandths (8049 means 8.049), so scale it to a
    // normal 0-10 rating instead of advertising a four-digit score. It is blank
    // for most series, and null rather than 0 keeps an absent rating hidden
    // instead of claiming the series scored zero.
    const ratingThousandths = Number(series.c_average);

    rows.push({
      id: seriesId,
      title_en: titles.titleEn,
      title_ja: titles.titleJa,
      romaji: titles.romaji,
      status: series.publication_status ?? "unknown",
      start_date: normaliseDate(series.start_date),
      end_date: normaliseDate(series.end_date),
      num_books: Number(series.c_num_books) || books.length,
      mal_id: numericOrNull(series.mal_id),
      anilist_id: numericOrNull(series.anilist_id),
      image_filename: coverFilename,
      description: typeof series.description === "string" ? series.description : "",
      authors,
      tagNames,
      tagIds,
      rating:
        Number.isFinite(ratingThousandths) && ratingThousandths > 0
          ? ratingThousandths / 1000
          : null,
      popularity: numericOrNull(series.c_popularity),
      web_novel: isOfficialFlag(series.web_novel) ? 1 : 0,
      fully_translated: isOfficialFlag(series.c_fully_translated) ? 1 : 0,
      search_text: [
        titles.titleEn,
        titles.titleJa,
        titles.romaji,
        ...authorTerms,
        ...tagNames,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase(),
    });
  }

  rows.sort((a, b) => a.id - b.id);
  return rows;
}

/**
 * Every volume, carrying the series it belongs to and its position in it. The
 * link table is inverted here so a book can be looked up on its own.
 */
export function buildBookRows(data) {
  const seriesOf = new Map();
  const orderOf = new Map();
  const typeOf = new Map();

  for (const [seriesId, links] of data.seriesBooks) {
    for (const link of links) {
      if (seriesOf.has(link.bookId)) continue;
      seriesOf.set(link.bookId, seriesId);
      orderOf.set(link.bookId, link.order);
      typeOf.set(link.bookId, link.bookType);
    }
  }

  const rows = [];
  for (const [bookId, book] of data.books) {
    const titles = chooseTitles(data.bookTitles.get(bookId) ?? []);
    rows.push({
      id: bookId,
      series_id: seriesOf.get(bookId) ?? null,
      sort_order: orderOf.get(bookId) ?? 0,
      book_type: typeOf.get(bookId) ?? null,
      title_en: titles.titleEn,
      title_ja: titles.titleJa,
      romaji: titles.romaji,
      description: typeof book.description === "string" ? book.description : "",
      description_ja: typeof book.descriptionJa === "string" ? book.descriptionJa : "",
      release_date: normaliseDate(book.releaseDate),
      olang: book.olang,
      image_filename: book.imageId === null ? null : (data.images.get(book.imageId) ?? null),
    });
  }

  rows.sort((a, b) => a.id - b.id);
  return rows;
}

/** Every title a volume is known by, in every language, as the "Titles" tab shows. */
export function buildBookTitleRows(data) {
  const rows = [];
  for (const [bookId, titles] of data.bookTitles) {
    for (const title of titles) {
      const text = textOrNull(title.title);
      const romaji = textOrNull(title.romaji);
      if (text === null && romaji === null) continue;
      rows.push({
        book_id: bookId,
        lang: textOrNull(title.lang),
        official: isOfficialFlag(title.official) ? 1 : 0,
        title: text,
        romaji,
      });
    }
  }
  return rows;
}

/** People, with their display name resolved from their main alias. */
export function buildStaffRows(data) {
  const best = new Map();
  for (const alias of data.staffAlias.values()) {
    const current = best.get(alias.staffId);
    if (!current || (alias.main && !current.main)) best.set(alias.staffId, alias);
  }

  const rows = [];
  for (const [staffId, meta] of data.staff) {
    const alias = best.get(staffId);
    rows.push({
      id: staffId,
      name: trimmed(alias?.name) || trimmed(alias?.romaji) || `Staff #${staffId}`,
      romaji: trimmed(alias?.romaji) || null,
      website: meta.website,
      twitter_id: meta.twitterId,
    });
  }

  rows.sort((a, b) => a.id - b.id);
  return rows;
}

/** Credits point at an alias, not at a person, so both are kept. */
export function buildStaffAliasRows(data) {
  const rows = [];
  for (const [aliasId, alias] of data.staffAlias) {
    rows.push({
      id: aliasId,
      staff_id: alias.staffId,
      is_main: alias.main ? 1 : 0,
      name: alias.name,
      romaji: alias.romaji,
    });
  }
  rows.sort((a, b) => a.id - b.id);
  return rows;
}

export function buildBookStaffRows(data) {
  const rows = [];
  for (const [bookId, links] of data.bookStaff) {
    for (const link of links) {
      rows.push({
        book_id: bookId,
        staff_alias_id: link.aliasId,
        role: link.role,
        note: link.note,
      });
    }
  }
  return rows;
}

export function buildPublisherRows(data) {
  const rows = [];
  for (const [id, publisher] of data.publishers) {
    rows.push({
      id,
      name: trimmed(publisher.name) || trimmed(publisher.romaji) || `Publisher #${id}`,
      romaji: trimmed(publisher.romaji) || null,
      lang: publisher.lang,
      website: publisher.website,
    });
  }
  rows.sort((a, b) => a.id - b.id);
  return rows;
}

export function buildReleaseRows(data) {
  const rows = [];
  for (const [id, release] of data.releases) {
    rows.push({
      id,
      release_date: normaliseDate(release.releaseDate),
      format: release.format,
      lang: release.lang,
      title: release.title,
      romaji: release.romaji,
      isbn13: release.isbn13,
      website: release.website,
      pages: release.pages,
      duration: release.duration,
      image_filename: release.imageId === null ? null : (data.images.get(release.imageId) ?? null),
    });
  }
  rows.sort((a, b) => a.id - b.id);
  return rows;
}

/** Everything the database needs, assembled from one dump read. */
export function buildCatalogue(data) {
  return {
    seriesRows: buildSeriesRows(data),
    bookRows: buildBookRows(data),
    bookTitleRows: buildBookTitleRows(data),
    staffRows: buildStaffRows(data),
    staffAliasRows: buildStaffAliasRows(data),
    bookStaffRows: buildBookStaffRows(data),
    publisherRows: buildPublisherRows(data),
    releaseRows: buildReleaseRows(data),
    publisherRelations: data.publisherRelations,
    seriesRelations: data.seriesRelations,
    releaseBooks: data.releaseBooks,
    releasePublishers: data.releasePublishers,
  };
}

/* -------------------------------------------------------------------------
   SQLite writing
   ------------------------------------------------------------------------- */

const SCHEMA = `
PRAGMA journal_mode = OFF;
PRAGMA synchronous = OFF;

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE tag (id INTEGER PRIMARY KEY, name TEXT NOT NULL, ttype TEXT NOT NULL);
CREATE TABLE series (
  id INTEGER PRIMARY KEY,
  title_en TEXT,
  title_ja TEXT,
  romaji TEXT,
  status TEXT NOT NULL,
  start_date INTEGER,
  end_date INTEGER,
  num_books INTEGER NOT NULL DEFAULT 0,
  mal_id INTEGER,
  anilist_id INTEGER,
  image_filename TEXT,
  description TEXT NOT NULL DEFAULT '',
  authors TEXT NOT NULL DEFAULT '[]',
  rating REAL,
  popularity INTEGER,
  web_novel INTEGER NOT NULL DEFAULT 0,
  fully_translated INTEGER NOT NULL DEFAULT 0,
  search_text TEXT NOT NULL
);
CREATE TABLE series_tag (
  series_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY (series_id, tag_id)
);
CREATE TABLE series_relation (
  parent_id INTEGER NOT NULL,
  child_id INTEGER NOT NULL,
  relation_type TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (parent_id, child_id)
);
CREATE TABLE book (
  id INTEGER PRIMARY KEY,
  series_id INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  book_type TEXT,
  title_en TEXT,
  title_ja TEXT,
  romaji TEXT,
  description TEXT NOT NULL DEFAULT '',
  description_ja TEXT NOT NULL DEFAULT '',
  release_date INTEGER,
  olang TEXT,
  image_filename TEXT
);
CREATE TABLE book_title (
  book_id INTEGER NOT NULL,
  lang TEXT,
  official INTEGER NOT NULL DEFAULT 0,
  title TEXT,
  romaji TEXT
);
CREATE TABLE staff (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  romaji TEXT,
  website TEXT,
  twitter_id TEXT
);
CREATE TABLE staff_alias (
  id INTEGER PRIMARY KEY,
  staff_id INTEGER,
  is_main INTEGER NOT NULL DEFAULT 0,
  name TEXT,
  romaji TEXT
);
CREATE TABLE book_staff (
  book_id INTEGER NOT NULL,
  staff_alias_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  note TEXT,
  PRIMARY KEY (book_id, staff_alias_id, role)
);
CREATE TABLE publisher (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  romaji TEXT,
  lang TEXT,
  website TEXT
);
CREATE TABLE publisher_relation (
  parent_id INTEGER NOT NULL,
  child_id INTEGER NOT NULL,
  relation_type TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (parent_id, child_id)
);
CREATE TABLE release (
  id INTEGER PRIMARY KEY,
  release_date INTEGER,
  format TEXT,
  lang TEXT,
  title TEXT,
  romaji TEXT,
  isbn13 TEXT,
  website TEXT,
  pages INTEGER,
  duration INTEGER,
  image_filename TEXT
);
CREATE TABLE release_book (
  release_id INTEGER NOT NULL,
  book_id INTEGER NOT NULL,
  rtype TEXT,
  PRIMARY KEY (release_id, book_id)
);
CREATE TABLE release_publisher (
  release_id INTEGER NOT NULL,
  publisher_id INTEGER NOT NULL,
  publisher_type TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (release_id, publisher_id, publisher_type)
);

CREATE INDEX idx_series_tag_tag ON series_tag(tag_id);
CREATE INDEX idx_series_status_books ON series(status, num_books DESC);
CREATE INDEX idx_series_books ON series(num_books DESC);
CREATE INDEX idx_series_rating ON series(rating DESC);
CREATE INDEX idx_series_popularity ON series(popularity DESC);
CREATE INDEX idx_book_series ON book(series_id, sort_order);
CREATE INDEX idx_book_title_book ON book_title(book_id);
CREATE INDEX idx_staff_alias_staff ON staff_alias(staff_id);
CREATE INDEX idx_book_staff_book ON book_staff(book_id);
CREATE INDEX idx_book_staff_alias ON book_staff(staff_alias_id);
CREATE INDEX idx_publisher_relation_child ON publisher_relation(child_id);
CREATE INDEX idx_release_date ON release(release_date);
CREATE INDEX idx_release_book_book ON release_book(book_id);
CREATE INDEX idx_release_publisher_pub ON release_publisher(publisher_id);
`;

function writeDatabase(outPath, catalogue, tags, counts, dumpPath, limit, malformed) {
  mkdirSync(path.dirname(outPath), { recursive: true });
  rmSync(outPath, { force: true });

  const db = new DatabaseSync(outPath);
  db.exec(SCHEMA);

  /** Prepare once, then run over every row inside the open transaction. */
  const runAll = (sql, rows, toParams) => {
    const statement = db.prepare(sql);
    for (const row of rows) statement.run(...toParams(row));
  };

  db.exec("BEGIN");
  try {
    runAll("INSERT INTO tag (id, name, ttype) VALUES (?, ?, ?)", [...tags], ([id, tag]) => [
      id,
      tag.name,
      tag.ttype,
    ]);

    runAll(
      `INSERT INTO series (id, title_en, title_ja, romaji, status, start_date, end_date,
         num_books, mal_id, anilist_id, image_filename, description, authors, rating,
         popularity, web_novel, fully_translated, search_text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      catalogue.seriesRows,
      (row) => [
        row.id,
        row.title_en,
        row.title_ja,
        row.romaji,
        row.status,
        row.start_date,
        row.end_date,
        row.num_books,
        row.mal_id,
        row.anilist_id,
        row.image_filename,
        row.description,
        JSON.stringify(row.authors),
        row.rating,
        row.popularity,
        row.web_novel,
        row.fully_translated,
        row.search_text,
      ],
    );

    runAll(
      "INSERT OR IGNORE INTO series_tag (series_id, tag_id) VALUES (?, ?)",
      catalogue.seriesRows.flatMap((row) => row.tagIds.map((tagId) => [row.id, tagId])),
      ([seriesId, tagId]) => [seriesId, tagId],
    );

    runAll(
      "INSERT OR IGNORE INTO series_relation (parent_id, child_id, relation_type) VALUES (?, ?, ?)",
      catalogue.seriesRelations,
      (row) => [row.parentId, row.childId, row.relationType],
    );

    runAll(
      `INSERT INTO book (id, series_id, sort_order, book_type, title_en, title_ja, romaji,
         description, description_ja, release_date, olang, image_filename)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      catalogue.bookRows,
      (row) => [
        row.id,
        row.series_id,
        row.sort_order,
        row.book_type,
        row.title_en,
        row.title_ja,
        row.romaji,
        row.description,
        row.description_ja,
        row.release_date,
        row.olang,
        row.image_filename,
      ],
    );

    runAll(
      "INSERT INTO book_title (book_id, lang, official, title, romaji) VALUES (?, ?, ?, ?, ?)",
      catalogue.bookTitleRows,
      (row) => [row.book_id, row.lang, row.official, row.title, row.romaji],
    );

    runAll(
      "INSERT INTO staff (id, name, romaji, website, twitter_id) VALUES (?, ?, ?, ?, ?)",
      catalogue.staffRows,
      (row) => [row.id, row.name, row.romaji, row.website, row.twitter_id],
    );

    runAll(
      "INSERT INTO staff_alias (id, staff_id, is_main, name, romaji) VALUES (?, ?, ?, ?, ?)",
      catalogue.staffAliasRows,
      (row) => [row.id, row.staff_id, row.is_main, row.name, row.romaji],
    );

    runAll(
      "INSERT OR IGNORE INTO book_staff (book_id, staff_alias_id, role, note) VALUES (?, ?, ?, ?)",
      catalogue.bookStaffRows,
      (row) => [row.book_id, row.staff_alias_id, row.role, row.note],
    );

    runAll(
      "INSERT INTO publisher (id, name, romaji, lang, website) VALUES (?, ?, ?, ?, ?)",
      catalogue.publisherRows,
      (row) => [row.id, row.name, row.romaji, row.lang, row.website],
    );

    runAll(
      "INSERT OR IGNORE INTO publisher_relation (parent_id, child_id, relation_type) VALUES (?, ?, ?)",
      catalogue.publisherRelations,
      (row) => [row.parentId, row.childId, row.relationType],
    );

    runAll(
      `INSERT INTO release (id, release_date, format, lang, title, romaji, isbn13, website,
         pages, duration, image_filename)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      catalogue.releaseRows,
      (row) => [
        row.id,
        row.release_date,
        row.format,
        row.lang,
        row.title,
        row.romaji,
        row.isbn13,
        row.website,
        row.pages,
        row.duration,
        row.image_filename,
      ],
    );

    runAll(
      "INSERT OR IGNORE INTO release_book (release_id, book_id, rtype) VALUES (?, ?, ?)",
      catalogue.releaseBooks,
      (row) => [row.releaseId, row.bookId, row.rtype],
    );

    runAll(
      "INSERT OR IGNORE INTO release_publisher (release_id, publisher_id, publisher_type) VALUES (?, ?, ?)",
      catalogue.releasePublishers,
      (row) => [row.releaseId, row.publisherId, row.publisherType],
    );

    const insertMeta = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
    for (const [key, value] of Object.entries({
      source_file: path.basename(dumpPath),
      generated_at: new Date().toISOString(),
      series_count: String(catalogue.seriesRows.length),
      book_count: String(catalogue.bookRows.length),
      release_count: String(catalogue.releaseRows.length),
      staff_count: String(catalogue.staffRows.length),
      publisher_count: String(catalogue.publisherRows.length),
      tag_count: String(tags.size),
      limit: limit === null ? "" : String(limit),
      malformed_rows: String(malformed),
      license: "ODbL-1.0 (data) / DbCL-1.0 (contents) — attribution: RanobeDB",
      source_counts: JSON.stringify(counts),
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
  node scripts/import-ranobedb.mjs <rndb-db-public-latest.dump.gz> [options]

Options:
  --out <path>   Output SQLite file (default: data/catalogue.db)
  --limit <n>    Only import the first n series (useful for a quick look)

Notes:
  Every table in the dump is imported: series, volumes, staff credits,
  publishers, imprints, releases and covers. A few dump rows carry raw line
  breaks inside text fields; rows that cannot be decoded unambiguously are
  skipped and reported rather than stored corrupted.

RanobeDB is metadata only and contains no novel text.
Data: ODbL-1.0 · Contents: DbCL-1.0 · Attribution: RanobeDB`;

async function main() {
  const { options, positional } = parseArgs(process.argv.slice(2));
  const input = positional[0];

  if (!input || options.help) {
    console.log(USAGE);
    process.exit(input ? 0 : 1);
  }

  const dumpPath = path.resolve(process.cwd(), input);
  const outPath = options.out === undefined || options.out === true
    ? DEFAULT_OUT
    : path.resolve(process.cwd(), options.out);
  const limit = typeof options.limit === "string" ? Number.parseInt(options.limit, 10) : null;

  console.log(`Reading ${path.basename(dumpPath)} …`);
  const started = Date.now();
  const { data, counts, malformed } = await readDump(dumpPath);

  const catalogue = buildCatalogue(data);
  // --limit trims the series table only, so it stays a fast smoke test.
  if (limit !== null && Number.isFinite(limit) && limit > 0) {
    catalogue.seriesRows = catalogue.seriesRows.slice(0, limit);
  }

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  const series = catalogue.seriesRows;
  const books = catalogue.bookRows;

  writeDatabase(outPath, catalogue, data.tags, counts, dumpPath, limit, malformed);

  const sizeMb = (statSync(outPath).size / 1048576).toFixed(1);
  const padded = (n) => String(n).padStart(7);

  console.log(`  parsed in ${elapsed}s — wrote ${path.relative(ROOT, outPath)} (${sizeMb} MB)`);
  console.log(`  series          ${padded(series.length)}   with English title ${series.filter((row) => row.title_en).length}, with author ${series.filter((row) => row.authors.length > 0).length}, with rating ${series.filter((row) => row.rating !== null).length}`);
  console.log(`  books/volumes   ${padded(books.length)}   with synopsis ${books.filter((row) => row.description.length > 0).length}, with cover ${books.filter((row) => row.image_filename).length}`);
  console.log(`  credits         ${padded(catalogue.bookStaffRows.length)}   across ${catalogue.staffRows.length} staff (${catalogue.staffAliasRows.length} aliases)`);
  console.log(`  publishers      ${padded(catalogue.publisherRows.length)}   relations ${catalogue.publisherRelations.length}`);
  console.log(`  releases        ${padded(catalogue.releaseRows.length)}   links ${catalogue.releaseBooks.length}, publisher ties ${catalogue.releasePublishers.length}`);
  console.log("  Cover filenames only — nothing is downloaded by this script.");
  if (malformed > 0) {
    console.log(
      `  skipped ${malformed} unparseable row(s) (raw line breaks in text fields) — see --help`,
    );
  }
  console.log("  Licence: ODbL-1.0 / DbCL-1.0 — attribute RanobeDB.");
}

const invokedDirectly =
  typeof import.meta.main === "boolean"
    ? import.meta.main
    : Boolean(process.argv[1]) &&
      path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`import failed: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
}
