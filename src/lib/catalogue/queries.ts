/**
 * Catalogue queries against the imported RanobeDB SQLite database.
 *
 * All functions are synchronous and return empty results when no catalogue has
 * been imported, so the app degrades gracefully instead of throwing.
 */
import { getCatalogue } from "./db";
import type {
  CatalogueCredit,
  CataloguePage,
  CataloguePublisherRef,
  CatalogueQuery,
  CatalogueRelease,
  CatalogueSeries,
  CatalogueSeriesDetail,
  CatalogueSort,
  CatalogueStats,
  CatalogueTagCount,
  CatalogueTitle,
  CatalogueVolume,
  CatalogueVolumeDetail,
} from "./types";

const TAG_SEPARATOR = String.fromCharCode(31);
const DEFAULT_PAGE_SIZE = 24;

/** Enough releases for one series without letting a long runner flood the page. */
const SERIES_RELEASE_LIMIT = 60;

interface SeriesRow {
  id: number;
  title_en: string | null;
  title_ja: string | null;
  romaji: string | null;
  status: string;
  num_books: number;
  authors: string | null;
  start_date: number | null;
  end_date: number | null;
  image_filename: string | null;
  tags: string | null;
  genres?: string | null;
  demographics?: string | null;
  rating?: number | null;
  popularity?: number | null;
  description?: string | null;
  mal_id?: number | null;
  anilist_id?: number | null;
  web_novel?: number | null;
  fully_translated?: number | null;
}

/** Whitelisted sort orders — never interpolate user input into SQL. */
const ORDER_BY: Record<CatalogueSort, string> = {
  books: "s.num_books DESC, s.id ASC",
  title: "COALESCE(s.title_en, s.title_ja, s.romaji, '') COLLATE NOCASE ASC, s.id ASC",
  newest: "COALESCE(s.start_date, 0) DESC, s.id ASC",
};

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function normaliseSort(sort: string | undefined): CatalogueSort {
  return sort === "title" || sort === "newest" ? sort : "books";
}

function parseAuthors(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((name) => typeof name === "string") : [];
  } catch {
    return [];
  }
}

function displayTitle(row: SeriesRow): string {
  return row.title_en || row.title_ja || row.romaji || `Series #${row.id}`;
}

function toSeries(row: SeriesRow): CatalogueSeries {
  return {
    id: row.id,
    title: displayTitle(row),
    titleEn: row.title_en,
    titleJa: row.title_ja,
    romaji: row.romaji,
    status: row.status,
    numBooks: row.num_books,
    authors: parseAuthors(row.authors),
    tags: row.tags ? row.tags.split(TAG_SEPARATOR).filter(Boolean) : [],
    startDate: row.start_date,
    endDate: row.end_date,
    hasCover: Boolean(row.image_filename),
    coverFilename: row.image_filename,
    rating: typeof row.rating === "number" && row.rating > 0 ? row.rating : null,
    popularity: typeof row.popularity === "number" && row.popularity > 0 ? row.popularity : null,
  };
}

const SELECT_COLUMNS = `
  s.id, s.title_en, s.title_ja, s.romaji, s.status, s.num_books, s.authors,
  s.start_date, s.end_date, s.image_filename, s.rating, s.popularity,
  (SELECT group_concat(t.name, char(31))
     FROM series_tag st JOIN tag t ON t.id = st.tag_id
    WHERE st.series_id = s.id) AS tags`;

function buildFilters(query: CatalogueQuery): { where: string; params: (string | number)[] } {
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  const q = query.q?.trim().toLowerCase();
  if (q) {
    clauses.push("s.search_text LIKE ? ESCAPE '\\'");
    params.push(`%${q.replace(/[%_\\]/g, (char) => `\\${char}`)}%`);
  }

  const tag = query.tag?.trim().toLowerCase();
  if (tag) {
    clauses.push(
      "EXISTS (SELECT 1 FROM series_tag st JOIN tag t ON t.id = st.tag_id WHERE st.series_id = s.id AND lower(t.name) = ?)",
    );
    params.push(tag);
  }

  const status = query.status?.trim().toLowerCase();
  if (status && status !== "all") {
    clauses.push("s.status = ?");
    params.push(status);
  }

  return { where: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

/** Page through the catalogue with optional search, tag and status filters. */
export function searchCatalogue(query: CatalogueQuery = {}): CataloguePage {
  const pageSize = clamp(query.pageSize ?? DEFAULT_PAGE_SIZE, 1, 100);
  const db = getCatalogue();
  if (!db) return { items: [], total: 0, page: 1, pageSize, totalPages: 0 };

  const { where, params } = buildFilters(query);

  const countRow = db
    .prepare(`SELECT COUNT(*) AS n FROM series s ${where}`)
    .get(...params) as { n: number } | undefined;
  const total = countRow?.n ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = clamp(query.page ?? 1, 1, totalPages);

  const rows = db
    .prepare(
      `SELECT ${SELECT_COLUMNS} FROM series s ${where}
       ORDER BY ${ORDER_BY[normaliseSort(query.sort)]}
       LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, (page - 1) * pageSize) as unknown as SeriesRow[];

  return { items: rows.map(toSeries), total, page, pageSize, totalPages };
}

/* -------------------------------------------------------------------------
   Relation loading

   These walk the tables added by the fuller import: volumes, staff credits,
   publishers/imprints and dated releases. Every query is scoped by a single
   indexed id, so a detail page costs a handful of cheap lookups.
   ------------------------------------------------------------------------- */

type CatalogueDb = NonNullable<ReturnType<typeof getCatalogue>>;

const ROLE_LABELS: Record<string, string> = {
  author: "Author",
  artist: "Artist",
  translator: "Translator",
  editor: "Editor",
  narrator: "Narrator",
  staff: "Staff",
};

/** Authors first, then artists, then everyone else. */
const ROLE_ORDER: Record<string, number> = {
  author: 0,
  artist: 1,
  translator: 2,
  editor: 3,
  narrator: 4,
  staff: 5,
};

function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role.charAt(0).toUpperCase() + role.slice(1);
}

interface VolumeRow {
  id: number;
  series_id: number | null;
  sort_order: number;
  title_en: string | null;
  title_ja: string | null;
  romaji: string | null;
  description: string;
  release_date: number | null;
  olang: string | null;
  image_filename: string | null;
}

interface CreditRow {
  staff_id: number;
  name: string;
  romaji: string | null;
  role: string;
}

interface PublisherRow {
  id: number;
  name: string;
  romaji: string | null;
  lang: string | null;
  website: string | null;
  publisher_type: string;
}

interface ReleaseRow {
  id: number;
  release_date: number | null;
  format: string | null;
  lang: string | null;
  title: string | null;
  romaji: string | null;
  isbn13: string | null;
  website: string | null;
  pages: number | null;
}

const VOLUME_COLUMNS = `
  b.id, b.series_id, b.sort_order, b.title_en, b.title_ja, b.romaji,
  b.description, b.release_date, b.olang, b.image_filename`;

const RELEASE_COLUMNS = `
  r.id, r.release_date, r.format, r.lang, r.title, r.romaji,
  r.isbn13, r.website, r.pages`;

/** Credits point at an alias, which points at a person. */
const CREDIT_SELECT = `
  SELECT st.id AS staff_id, st.name AS name, st.romaji AS romaji, bs.role AS role
    FROM book b
    JOIN book_staff bs ON bs.book_id = b.id
    JOIN staff_alias sa ON sa.id = bs.staff_alias_id
    JOIN staff st ON st.id = sa.staff_id`;

function volumeTitle(row: VolumeRow): string {
  return (
    row.title_en?.trim() ||
    row.title_ja?.trim() ||
    row.romaji?.trim() ||
    `Volume ${row.sort_order > 0 ? row.sort_order : row.id}`
  );
}

function toVolume(row: VolumeRow): CatalogueVolume {
  return {
    id: row.id,
    seriesId: row.series_id,
    sortOrder: row.sort_order,
    title: volumeTitle(row),
    titleEn: row.title_en,
    titleJa: row.title_ja,
    romaji: row.romaji,
    description: row.description ?? "",
    releaseDate: row.release_date,
    olang: row.olang,
    coverFilename: row.image_filename,
  };
}

function toCredits(rows: CreditRow[]): CatalogueCredit[] {
  return rows
    .map((row) => ({
      staffId: row.staff_id,
      name: row.name,
      romaji: row.romaji,
      role: row.role,
      roleLabel: roleLabel(row.role),
      isTranslator: row.role === "translator",
    }))
    .sort((a, b) => {
      const byRole = (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9);
      if (byRole !== 0) return byRole;
      return (a.romaji ?? a.name).localeCompare(b.romaji ?? b.name);
    });
}

function toPublishers(rows: PublisherRow[]): CataloguePublisherRef[] {
  return rows
    .map((row) => ({
      id: row.id,
      name: row.name,
      romaji: row.romaji,
      lang: row.lang,
      website: row.website,
      publisherType: row.publisher_type || "publisher",
    }))
    .sort((a, b) => {
      const byLang = (a.lang ?? "\uffff").localeCompare(b.lang ?? "\uffff");
      if (byLang !== 0) return byLang;
      // A parent publisher reads before the imprints that sit under it.
      if (a.publisherType !== b.publisherType) {
        return a.publisherType === "publisher" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
}

/** Release id -> the names of the publishers tied to it. */
function releasePublisherNames(db: CatalogueDb, releaseIds: number[]): Map<number, string[]> {
  const names = new Map<number, string[]>();
  if (releaseIds.length === 0) return names;

  const placeholders = releaseIds.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT rp.release_id AS release_id, p.name AS name
         FROM release_publisher rp
         JOIN publisher p ON p.id = rp.publisher_id
        WHERE rp.release_id IN (${placeholders})`,
    )
    .all(...releaseIds) as unknown as { release_id: number; name: string }[];

  for (const row of rows) {
    const list = names.get(row.release_id) ?? [];
    if (!list.includes(row.name)) list.push(row.name);
    names.set(row.release_id, list);
  }
  return names;
}

function toReleases(db: CatalogueDb, rows: ReleaseRow[]): CatalogueRelease[] {
  const names = releasePublisherNames(db, rows.map((row) => row.id));
  return rows.map((row) => ({
    id: row.id,
    releaseDate: row.release_date,
    format: row.format,
    lang: row.lang,
    title: row.title,
    romaji: row.romaji,
    isbn13: row.isbn13,
    website: row.website,
    pages: row.pages,
    publisherNames: names.get(row.id) ?? [],
  }));
}

/** Volumes in reading order. */
export function listSeriesVolumes(seriesId: number): CatalogueVolume[] {
  const db = getCatalogue();
  if (!db || !Number.isFinite(seriesId)) return [];

  const rows = db
    .prepare(
      `SELECT ${VOLUME_COLUMNS} FROM book b
        WHERE b.series_id = ?
        ORDER BY b.sort_order ASC, b.id ASC`,
    )
    .all(seriesId) as unknown as VolumeRow[];

  return rows.map(toVolume);
}

/** Everyone credited anywhere in a series, de-duplicated by person and role. */
export function listSeriesCredits(seriesId: number): CatalogueCredit[] {
  const db = getCatalogue();
  if (!db || !Number.isFinite(seriesId)) return [];

  return toCredits(
    db
      .prepare(`${CREDIT_SELECT} WHERE b.series_id = ? GROUP BY st.id, bs.role`)
      .all(seriesId) as unknown as CreditRow[],
  );
}

/** Publishers and imprints across a series, grouped by language in the UI. */
export function listSeriesPublishers(seriesId: number): CataloguePublisherRef[] {
  const db = getCatalogue();
  if (!db || !Number.isFinite(seriesId)) return [];

  return toPublishers(
    db
      .prepare(
        `SELECT p.id, p.name, p.romaji, p.lang, p.website, rp.publisher_type
           FROM release_publisher rp
           JOIN publisher p ON p.id = rp.publisher_id
           JOIN release_book rb ON rb.release_id = rp.release_id
           JOIN book b ON b.id = rb.book_id
          WHERE b.series_id = ?
          GROUP BY p.id, rp.publisher_type`,
      )
      .all(seriesId) as unknown as PublisherRow[],
  );
}

export function listSeriesReleases(
  seriesId: number,
  limit: number = SERIES_RELEASE_LIMIT,
): CatalogueRelease[] {
  const db = getCatalogue();
  if (!db || !Number.isFinite(seriesId)) return [];

  const rows = db
    .prepare(
      `SELECT ${RELEASE_COLUMNS}
         FROM release r
         JOIN release_book rb ON rb.release_id = r.id
         JOIN book b ON b.id = rb.book_id
        WHERE b.series_id = ?
        GROUP BY r.id
        ORDER BY r.release_date IS NULL, r.release_date ASC, r.id ASC
        LIMIT ?`,
    )
    .all(seriesId, clamp(limit, 1, 500)) as unknown as ReleaseRow[];

  return toReleases(db, rows);
}

/** One series by id, with its volumes, credits, publishers and releases. */
export function getCatalogueSeries(id: number): CatalogueSeriesDetail | null {
  const db = getCatalogue();
  if (!db || !Number.isFinite(id)) return null;

  const row = db
    .prepare(
      `SELECT ${SELECT_COLUMNS}, s.description, s.mal_id, s.anilist_id,
              s.web_novel, s.fully_translated
         FROM series s WHERE s.id = ?`,
    )
    .get(id) as unknown as SeriesRow | undefined;

  if (!row) return null;

  // RanobeDB files genres, demographics and free tags in one table, told apart
  // by ttype. Splitting them here is what lets the page show real genre chips
  // instead of a flat wall of tags.
  const tagRows = db
    .prepare(
      `SELECT t.name AS name, t.ttype AS ttype
         FROM series_tag st JOIN tag t ON t.id = st.tag_id
        WHERE st.series_id = ?
        ORDER BY t.name`,
    )
    .all(id) as unknown as { name: string; ttype: string }[];

  const byType = (type: string) =>
    tagRows.filter((tag) => tag.ttype === type).map((tag) => tag.name);

  return {
    ...toSeries(row),
    description: row.description ?? "",
    malId: row.mal_id ?? null,
    anilistId: row.anilist_id ?? null,
    imageFilename: row.image_filename,
    webNovel: row.web_novel === 1,
    fullyTranslated: row.fully_translated === 1,
    genres: byType("genre"),
    demographics: byType("demographic"),
    tags: byType("tag"),
    volumes: listSeriesVolumes(id),
    credits: listSeriesCredits(id),
    publishers: listSeriesPublishers(id),
    releases: listSeriesReleases(id),
  };
}

/** One volume with its credits, publishers, releases and every known title. */
export function getCatalogueVolume(bookId: number): CatalogueVolumeDetail | null {
  const db = getCatalogue();
  if (!db || !Number.isFinite(bookId)) return null;

  const row = db
    .prepare(
      `SELECT ${VOLUME_COLUMNS},
              COALESCE(s.title_en, s.title_ja, s.romaji) AS series_title
         FROM book b
         LEFT JOIN series s ON s.id = b.series_id
        WHERE b.id = ?`,
    )
    .get(bookId) as unknown as (VolumeRow & { series_title: string | null }) | undefined;

  if (!row) return null;

  const credits = toCredits(
    db
      .prepare(`${CREDIT_SELECT} WHERE b.id = ? GROUP BY st.id, bs.role`)
      .all(bookId) as unknown as CreditRow[],
  );

  const publishers = toPublishers(
    db
      .prepare(
        `SELECT p.id, p.name, p.romaji, p.lang, p.website, rp.publisher_type
           FROM release_publisher rp
           JOIN publisher p ON p.id = rp.publisher_id
           JOIN release_book rb ON rb.release_id = rp.release_id
          WHERE rb.book_id = ?
          GROUP BY p.id, rp.publisher_type`,
      )
      .all(bookId) as unknown as PublisherRow[],
  );

  const releases = toReleases(
    db,
    db
      .prepare(
        `SELECT ${RELEASE_COLUMNS}
           FROM release r
           JOIN release_book rb ON rb.release_id = r.id
          WHERE rb.book_id = ?
          GROUP BY r.id
          ORDER BY r.release_date IS NULL, r.release_date ASC, r.id ASC`,
      )
      .all(bookId) as unknown as ReleaseRow[],
  );

  const titles: CatalogueTitle[] = (
    db
      .prepare(
        `SELECT lang, official, title, romaji FROM book_title
          WHERE book_id = ?
          ORDER BY official DESC, lang`,
      )
      .all(bookId) as unknown as {
      lang: string | null;
      official: number;
      title: string | null;
      romaji: string | null;
    }[]
  ).map((title) => ({
    lang: title.lang,
    official: title.official === 1,
    title: title.title,
    romaji: title.romaji,
  }));

  // Neighbours are found in SQL rather than in memory: a long series would
  // otherwise mean loading every volume just to find the two adjacent ones.
  const neighbour = (direction: "previous" | "next") => {
    const comparison = direction === "previous" ? "<" : ">";
    const order = direction === "previous" ? "DESC" : "ASC";
    return db
      .prepare(
        `SELECT id, COALESCE(title_en, title_ja, romaji) AS title
           FROM book
          WHERE series_id = ? AND (sort_order ${comparison} ? OR (sort_order = ? AND id ${comparison} ?))
          ORDER BY sort_order ${order}, id ${order}
          LIMIT 1`,
      )
      .get(row.series_id, row.sort_order, row.sort_order, row.id) as unknown as
      | { id: number; title: string | null }
      | undefined;
  };

  const previous = neighbour("previous");
  const next = neighbour("next");

  return {
    ...toVolume(row),
    seriesTitle: row.series_title,
    credits,
    publishers,
    releases,
    titles,
    previous: previous ? { id: previous.id, title: previous.title ?? `#${previous.id}` } : null,
    next: next ? { id: next.id, title: next.title ?? `#${next.id}` } : null,
  };
}

/** Tags ordered by how many series carry them. */
export function listCatalogueTags(limit = 40): CatalogueTagCount[] {
  const db = getCatalogue();
  if (!db) return [];

  return db
    .prepare(
      `SELECT t.name AS name, COUNT(st.series_id) AS count
         FROM tag t JOIN series_tag st ON st.tag_id = t.id
        GROUP BY t.id
        ORDER BY count DESC, t.name ASC
        LIMIT ?`,
    )
    .all(clamp(limit, 1, 500)) as unknown as CatalogueTagCount[];
}

/** Headline numbers plus provenance from the import. */
export function catalogueStats(): CatalogueStats {
  const empty: CatalogueStats = {
    series: 0,
    withEnglishTitle: 0,
    tags: 0,
    generatedAt: null,
    sourceFile: null,
    books: 0,
    releases: 0,
    staff: 0,
    publishers: 0,
    malformedRows: 0,
  };

  const db = getCatalogue();
  if (!db) return empty;

  const row = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM series) AS series,
         (SELECT COUNT(*) FROM series WHERE title_en IS NOT NULL) AS withEnglishTitle,
         (SELECT COUNT(*) FROM tag) AS tags,
         (SELECT COUNT(*) FROM book) AS books,
         (SELECT COUNT(*) FROM release) AS releases,
         (SELECT COUNT(*) FROM staff) AS staff,
         (SELECT COUNT(*) FROM publisher) AS publishers`,
    )
    .get() as
    | {
        series: number;
        withEnglishTitle: number;
        tags: number;
        books: number;
        releases: number;
        staff: number;
        publishers: number;
      }
    | undefined;

  const metaRows = db.prepare("SELECT key, value FROM meta").all() as unknown as {
    key: string;
    value: string;
  }[];
  const meta = new Map(metaRows.map((entry) => [entry.key, entry.value]));

  return {
    series: row?.series ?? 0,
    withEnglishTitle: row?.withEnglishTitle ?? 0,
    tags: row?.tags ?? 0,
    books: row?.books ?? 0,
    releases: row?.releases ?? 0,
    staff: row?.staff ?? 0,
    publishers: row?.publishers ?? 0,
    malformedRows: Number(meta.get("malformed_rows") ?? 0) || 0,
    generatedAt: meta.get("generated_at") ?? null,
    sourceFile: meta.get("source_file") ?? null,
  };
}
