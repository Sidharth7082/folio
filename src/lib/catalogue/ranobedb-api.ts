/**
 * RanobeDB public API client (v0).
 *
 *   API:   https://ranobedb.org/api/v0
 *   Docs:  https://ranobedb.org/api/docs/v0
 *   Images: https://images.ranobedb.org/<filename>
 *
 * The API is read-only, **non-commercial use only**, and its data is licensed
 * ODbL-1.0 / DbCL-1.0. RanobeDB asks callers to stay under 60 requests/minute,
 * which this module enforces proactively.
 *
 * This file deliberately has no relative imports so it can be unit tested
 * directly. Network failures resolve to `null` rather than throwing, so the app
 * can fall back to the local dump.
 */

export const RANOBEDB_API_BASE =
  process.env.RANOBEDB_API_BASE ?? "https://ranobedb.org/api/v0";

export const RANOBEDB_IMAGE_BASE = "https://images.ranobedb.org";

/** RanobeDB sends "no end date" as this sentinel. */
const OPEN_ENDED = 99999999;

/** Keep comfortably below RanobeDB's 60 requests/minute guidance. */
const REQUESTS_PER_MINUTE = 50;

/* -------------------------------------------------------------------------
   Covers
   ------------------------------------------------------------------------- */

const COVER_FILENAME = /^[A-Za-z0-9_-]{1,80}\.(?:jpg|jpeg|png|webp|gif|avif)$/i;

/**
 * RanobeDB image filenames are opaque but predictable. Only allow that charset
 * so a filename can never redirect the fetch to another host or path.
 */
export function isSafeCoverFilename(filename: string): boolean {
  return COVER_FILENAME.test(filename);
}

/** Absolute CDN URL for a cover, or null when the filename is unusable. */
export function coverImageUrl(filename: string | null | undefined): string | null {
  if (!filename || !isSafeCoverFilename(filename)) return null;
  return `${RANOBEDB_IMAGE_BASE}/${filename}`;
}

/* -------------------------------------------------------------------------
   Politeness limiter
   ------------------------------------------------------------------------- */

let windowStartedAt = 0;
let windowCount = 0;
let queue: Promise<void> = Promise.resolve();

/** Test hook: forget limiter state between cases. */
export function resetRateLimiter(): void {
  windowStartedAt = 0;
  windowCount = 0;
  queue = Promise.resolve();
}

function acquireSlot(): Promise<void> {
  const scheduled = queue.then(async () => {
    const now = Date.now();
    if (now - windowStartedAt >= 60_000) {
      windowStartedAt = now;
      windowCount = 0;
    }
    if (windowCount >= REQUESTS_PER_MINUTE) {
      const waitMs = Math.max(0, 60_000 - (now - windowStartedAt));
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      windowStartedAt = Date.now();
      windowCount = 0;
    }
    windowCount += 1;
  });

  queue = scheduled.catch(() => undefined);
  return scheduled;
}

/* -------------------------------------------------------------------------
   Response types (as documented for v0)
   ------------------------------------------------------------------------- */

export interface ApiImage {
  id: number;
  filename: string;
  width: number;
  height: number;
  spoiler: boolean;
  nsfw: boolean;
}

export interface ApiSeriesListItem {
  id: number;
  title: string;
  title_orig: string | null;
  romaji: string | null;
  romaji_orig: string | null;
  lang: string;
  olang: string;
  hidden: boolean;
  locked: boolean;
  c_num_books: number;
  c_start_date: number;
  c_end_date: number;
  book: { id: number; image: ApiImage | null } | null;
  volumes: { count: string | number } | null;
}

export interface ApiSeriesList {
  series: ApiSeriesListItem[];
  count: string;
  currentPage: number;
  totalPages: number;
}

export interface ApiStaff {
  role_type: string;
  name: string;
  romaji: string | null;
  staff_id: number;
  note: string;
  lang: string | null;
}

export interface ApiPublisher {
  id: number;
  name: string;
  romaji: string | null;
  publisher_type: string;
  lang: string;
}

export interface ApiTag {
  id: number;
  name: string;
  ttype: string;
}

export interface ApiBook {
  id: number;
  title: string;
  title_orig: string | null;
  romaji: string | null;
  c_release_date: number;
  sort_order: number;
  book_type: string;
  image: ApiImage | null;
}

export interface ApiTitle {
  title: string;
  romaji: string | null;
  lang: string;
  official: boolean;
}

export interface ApiSeriesDetail {
  id: number;
  title: string;
  title_orig: string | null;
  romaji: string | null;
  romaji_orig: string | null;
  description: string;
  lang: string;
  olang: string;
  publication_status: string;
  start_date: number;
  end_date: number;
  hidden: boolean;
  locked: boolean;
  web_novel: string | null;
  website: string | null;
  mal_id: number | null;
  anilist_id: number | null;
  rating: number | null;
  num_reviews: number | null;
  book_description: { description: string; description_ja: string } | null;
  books: ApiBook[];
  titles: ApiTitle[];
  publishers: ApiPublisher[];
  staff: ApiStaff[];
  tags: ApiTag[];
}

/* -------------------------------------------------------------------------
   Normalised views used by the UI
   ------------------------------------------------------------------------- */

export interface ApiSeriesView {
  id: number;
  title: string;
  titleOrig: string | null;
  romaji: string | null;
  status: string;
  numBooks: number;
  startDate: number | null;
  endDate: number | null;
  coverFilename: string | null;
  /** NSFW covers are never displayed. */
  coverIsNsfw: boolean;
}

export interface ApiSeriesDetailView extends ApiSeriesView {
  description: string;
  authors: string[];
  artists: string[];
  otherStaff: string[];
  publishers: string[];
  tags: string[];
  altTitles: string[];
  malId: number | null;
  anilistId: number | null;
  rating: number | null;
  numReviews: number | null;
  webNovel: string | null;
  website: string | null;
  books: {
    id: number;
    title: string;
    sortOrder: number;
    coverFilename: string | null;
  }[];
}

/* -------------------------------------------------------------------------
   Mapping (pure)
   ------------------------------------------------------------------------- */

/**
 * RanobeDB expresses "unknown" as the sentinel 99999999, and a zero date is
 * meaningless. Both become null here — the same rule the date formatter uses,
 * so the local dump and the live API render dates identically.
 */
function normaliseDate(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value >= OPEN_ENDED || value < 10000101 ? null : value;
}

/** Prefer the romanised staff name, falling back to the native form. */
function staffDisplayName(staff: ApiStaff): string {
  const romaji = typeof staff.romaji === "string" ? staff.romaji.trim() : "";
  return romaji || (staff.name ?? "").trim();
}

export function mapSeriesListItem(item: ApiSeriesListItem): ApiSeriesView {
  const image = item.book?.image ?? null;
  const volumes = item.volumes?.count;
  const volumeCount = typeof volumes === "string" ? Number.parseInt(volumes, 10) : volumes;

  return {
    id: item.id,
    title: item.title || item.title_orig || item.romaji || `Series #${item.id}`,
    titleOrig: item.title_orig,
    romaji: item.romaji ?? item.romaji_orig,
    status: "unknown",
    numBooks: Number.isFinite(volumeCount as number)
      ? (volumeCount as number)
      : item.c_num_books,
    startDate: normaliseDate(item.c_start_date),
    endDate: normaliseDate(item.c_end_date),
    coverFilename: image?.filename ?? null,
    coverIsNsfw: Boolean(image?.nsfw),
  };
}

export function mapSeriesDetail(detail: ApiSeriesDetail): ApiSeriesDetailView {
  const cover = detail.books.find((book) => book.image)?.image ?? null;

  const authors: string[] = [];
  const artists: string[] = [];
  const otherStaff: string[] = [];
  for (const staff of detail.staff ?? []) {
    const name = staffDisplayName(staff);
    if (!name) continue;
    const target =
      staff.role_type === "author"
        ? authors
        : staff.role_type === "artist"
          ? artists
          : otherStaff;
    if (!target.includes(name)) target.push(name);
  }

  const altTitles = (detail.titles ?? [])
    .map((entry) => entry.title)
    .filter((title): title is string => Boolean(title) && title !== detail.title);

  const description =
    detail.book_description?.description?.trim() ||
    detail.description?.trim() ||
    "";

  return {
    id: detail.id,
    title: detail.title || detail.title_orig || `Series #${detail.id}`,
    titleOrig: detail.title_orig,
    romaji: detail.romaji ?? detail.romaji_orig,
    status: detail.publication_status ?? "unknown",
    numBooks: (detail.books ?? []).length,
    startDate: normaliseDate(detail.start_date),
    endDate: normaliseDate(detail.end_date),
    coverFilename: cover?.filename ?? null,
    coverIsNsfw: Boolean(cover?.nsfw),
    description,
    authors,
    artists,
    otherStaff,
    publishers: (detail.publishers ?? []).map((publisher) => publisher.name).filter(Boolean),
    tags: (detail.tags ?? []).map((tag) => tag.name).filter(Boolean),
    altTitles,
    malId: detail.mal_id ?? null,
    anilistId: detail.anilist_id ?? null,
    rating: typeof detail.rating === "number" ? detail.rating : null,
    numReviews: typeof detail.num_reviews === "number" ? detail.num_reviews : null,
    webNovel: detail.web_novel ?? null,
    website: detail.website ?? null,
    books: (detail.books ?? [])
      .map((book) => ({
        id: book.id,
        title: book.title || `Volume ${book.sort_order}`,
        sortOrder: book.sort_order ?? 0,
        coverFilename: book.image?.filename ?? null,
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder),
  };
}

/* -------------------------------------------------------------------------
   Requests
   ------------------------------------------------------------------------- */

export interface ApiRequestOptions {
  timeoutMs?: number;
  /** How long a successful response may be reused. 0 disables caching. */
  ttlMs?: number;
}

/**
 * Short-lived in-memory response cache.
 *
 * The homepage rails call the public API on every render, so without this a
 * burst of traffic could burn through RanobeDB's 60 requests/minute guidance.
 * Only successful responses are cached, so a transient failure is never
 * remembered and recovers on the next request.
 */
const DEFAULT_TTL_MS = 10 * 60 * 1000;
const responseCache = new Map<string, { expiresAt: number; value: unknown }>();

/** Test hook: drop every cached response. */
export function clearApiCache(): void {
  responseCache.clear();
}

/** Values accepted in a query string, including repeated array filters. */
export type ApiParamValue = string | number | boolean | (string | number)[] | undefined;
export type ApiParamSet = Record<string, ApiParamValue>;

/** Percent-safe query building, including repeated params for array filters. */
export function buildQuery(params: ApiParamSet): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      for (const entry of value) search.append(key, String(entry));
    } else {
      search.append(key, String(value));
    }
  }
  return search.toString();
}

async function requestJson<T>(
  path: string,
  params: ApiParamSet = {},
  options: ApiRequestOptions = {},
): Promise<T | null> {
  const query = buildQuery(params);
  const key = `${path}?${query}`;
  const ttl = options.ttlMs ?? DEFAULT_TTL_MS;

  if (ttl > 0) {
    const hit = responseCache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value as T;
  }

  const url = `${RANOBEDB_API_BASE}${key}`;
  await acquireSlot();

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(options.timeoutMs ?? 12_000),
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) return null;

    const payload = (await response.json()) as T;
    if (ttl > 0) responseCache.set(key, { expiresAt: Date.now() + ttl, value: payload });
    return payload;
  } catch {
    // Offline, timeout, bad JSON: callers fall back to the local catalogue.
    return null;
  }
}

export interface ApiSearchParams {
  q?: string;
  page?: number;
  limit?: number;
  pubStatus?: string;
  sort?: string;
  tagsInclude?: number[];
  genresInclude?: number[];
}

export interface ApiSearchResult {
  items: ApiSeriesView[];
  total: number;
  page: number;
  totalPages: number;
}

/** Search series through the live API. Returns null when unreachable. */
export async function apiSearchSeries(
  params: ApiSearchParams = {},
  options: ApiRequestOptions = {},
): Promise<ApiSearchResult | null> {
  const limit = Math.min(Math.max(params.limit ?? 24, 1), 100);
  const page = Math.max(params.page ?? 1, 1);

  const payload = await requestJson<ApiSeriesList>(
    "/series",
    {
      q: params.q,
      page,
      limit,
      pubStatus: params.pubStatus,
      sort: params.sort,
      tagsInclude: params.tagsInclude,
      genresInclude: params.genresInclude,
    },
    options,
  );

  if (!payload || !Array.isArray(payload.series)) return null;

  const total = Number.parseInt(String(payload.count ?? ""), 10);

  return {
    items: payload.series.map(mapSeriesListItem),
    total: Number.isFinite(total) ? total : payload.series.length,
    page: payload.currentPage ?? page,
    totalPages: payload.totalPages ?? 1,
  };
}

/** One series with live detail, or null when unreachable or missing. */
export async function apiGetSeries(
  id: number,
  options: ApiRequestOptions = {},
): Promise<ApiSeriesDetailView | null> {
  if (!Number.isFinite(id) || id <= 0) return null;

  const payload = await requestJson<{ series: ApiSeriesDetail }>(
    `/series/${Math.trunc(id)}`,
    {},
    options,
  );
  if (!payload?.series) return null;

  return mapSeriesDetail(payload.series);
}

/* -------------------------------------------------------------------------
   Releases
   ------------------------------------------------------------------------- */

export interface ApiRelease {
  id: number;
  title: string;
  release_date: number;
  release_date_parsed: string | null;
  lang: string;
  format: string;
  pages: number | null;
  isbn13: string | null;
  website: string | null;
  image: ApiImage | null;
}

export interface ApiReleaseList {
  releases: ApiRelease[];
  count: string;
  currentPage: number;
  totalPages: number;
}

export interface ApiReleaseView {
  id: number;
  title: string;
  releaseDate: number;
  releaseDateParsed: string | null;
  lang: string;
  format: string;
  pages: number | null;
  website: string | null;
  coverFilename: string | null;
  coverIsNsfw: boolean;
}

export function mapRelease(item: ApiRelease): ApiReleaseView {
  return {
    id: item.id,
    title: item.title || "Untitled release",
    releaseDate: item.release_date,
    releaseDateParsed: item.release_date_parsed ?? null,
    lang: item.lang ?? "ja",
    format: item.format ?? "digital",
    pages: item.pages ?? null,
    website: item.website ?? null,
    coverFilename: item.image?.filename ?? null,
    coverIsNsfw: Boolean(item.image?.nsfw),
  };
}

export interface ApiReleaseQuery {
  /** ISO `YYYY-MM-DD`, inclusive. */
  minDate?: string;
  maxDate?: string;
  sort?: string;
  limit?: number;
  languages?: string[];
  formats?: string[];
}

/** Browse print/digital/audio releases. Returns null when unreachable. */
export async function apiGetReleases(
  query: ApiReleaseQuery = {},
  options: ApiRequestOptions = {},
): Promise<ApiReleaseView[] | null> {
  const limit = Math.min(Math.max(query.limit ?? 14, 1), 100);

  const payload = await requestJson<ApiReleaseList>(
    "/releases",
    {
      minDate: query.minDate,
      maxDate: query.maxDate,
      sort: query.sort,
      limit,
      rl: query.languages,
      rf: query.formats,
    },
    options,
  );

  if (!payload || !Array.isArray(payload.releases)) return null;
  return payload.releases.map(mapRelease);
}

/** True when the API answers a cheap probe — used to pick a mode. */
export async function apiIsReachable(options: ApiRequestOptions = {}): Promise<boolean> {
  const payload = await requestJson<unknown>("/tags", { limit: 1 }, options);
  return payload !== null;
}
