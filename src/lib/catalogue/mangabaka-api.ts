/**
 * MangaBaka public API client (v1).
 *
 *   API:      https://api.mangabaka.org
 *   Docs:     https://mangabaka.org/data/api
 *   Explorer: https://mangabaka.org/data/api/explorer
 *
 * Public endpoints are read-only and need no key. MangaBaka's own data is
 * licensed CC BY-NC-SA 4.0 — non-commercial, attribution required — and it also
 * republishes records from AniList, MyAnimeList, Kitsu, MangaUpdates, Shikimori
 * and Anime-Planet, each under its own terms. Attribution is surfaced in the UI.
 *
 * Rate limits are per IP and are only charged for *uncached* requests:
 *   search  30/min        (shared across the search endpoint)
 *   default 180/min       (everything else)
 * Responses keep their own short-lived cache here as well, so a rendered page
 * that asks twice costs one upstream request.
 *
 * MangaBaka covers manga as well as novels, so requests default to
 * `type=novel` — this app is a light-novel room, and narrowing the search also
 * removes a whole class of near-miss matches.
 *
 * This file deliberately has no relative imports so it can be unit tested
 * directly. Network failures resolve to `null` rather than throwing.
 */

export const MANGABAKA_API_BASE =
  process.env.MANGABAKA_API_BASE ?? "https://api.mangabaka.org";

/** Stay under MangaBaka's 30/min search allowance. */
const SEARCH_REQUESTS_PER_MINUTE = 25;

/** Stay under MangaBaka's 180/min default allowance. */
const DEFAULT_REQUESTS_PER_MINUTE = 150;

/** Only ever render links that point back at MangaBaka itself. */
const ALLOWED_LINK_HOSTS = new Set(["mangabaka.org", "www.mangabaka.org"]);

/* -------------------------------------------------------------------------
   Politeness limiter
   ------------------------------------------------------------------------- */

interface Limiter {
  acquire(): Promise<void>;
  reset(): void;
}

/** A leaky window limiter: at most `requestsPerMinute` slots per rolling minute. */
function createLimiter(requestsPerMinute: number): Limiter {
  let windowStartedAt = 0;
  let windowCount = 0;
  let queue: Promise<void> = Promise.resolve();

  return {
    acquire(): Promise<void> {
      const scheduled = queue.then(async () => {
        const now = Date.now();
        if (now - windowStartedAt >= 60_000) {
          windowStartedAt = now;
          windowCount = 0;
        }
        if (windowCount >= requestsPerMinute) {
          const waitMs = Math.max(0, 60_000 - (now - windowStartedAt));
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          windowStartedAt = Date.now();
          windowCount = 0;
        }
        windowCount += 1;
      });

      queue = scheduled.catch(() => undefined);
      return scheduled;
    },
    reset() {
      windowStartedAt = 0;
      windowCount = 0;
      queue = Promise.resolve();
    },
  };
}

const searchLimiter = createLimiter(SEARCH_REQUESTS_PER_MINUTE);
const defaultLimiter = createLimiter(DEFAULT_REQUESTS_PER_MINUTE);

/** Test hook: forget limiter state between cases. */
export function resetMangaBakaLimiter(): void {
  searchLimiter.reset();
  defaultLimiter.reset();
}

/* -------------------------------------------------------------------------
   Response shapes (the subset this app reads)
   ------------------------------------------------------------------------- */

export interface MangaBakaPublisher {
  id: number;
  name: string;
  language: string | null;
  type: string | null;
}

export interface MangaBakaSeries {
  id: number;
  state: string | null;
  merged_with: number | null;
  canonical_url: string | null;
  title: string | null;
  native_title: string | null;
  romanized_title: string | null;
  description: string | null;
  year: number | null;
  status: string | null;
  type: string | null;
  original_language: string | null;
  /** Community score on a 0-100 scale. */
  rating: number | null;
  is_licensed: boolean | null;
  content_rating: string | null;
  final_volume: string | null;
  total_chapters: string | null;
  publishers: MangaBakaPublisher[] | null;
  genres: string[] | null;
  tags: string[] | null;
  last_updated_at: string | null;
}

interface MangaBakaListResponse {
  status: number;
  message?: string;
  data?: MangaBakaSeries[];
  pagination?: { count: number; page: number; limit: number };
}

interface MangaBakaItemResponse {
  status: number;
  message?: string;
  data?: MangaBakaSeries;
}

/** Normalised for display, with the app's own naming. */
export interface MangaBakaView {
  id: number;
  title: string;
  nativeTitle: string | null;
  romajiTitle: string | null;
  description: string;
  year: number | null;
  status: string | null;
  type: string | null;
  /** MangaBaka's raw 0-100 community score. */
  ratingOutOf100: number | null;
  /** The same score on the 0-10 scale used elsewhere in the app. */
  ratingOutOf10: number | null;
  isLicensed: boolean;
  contentRating: string | null;
  totalChapters: string | null;
  finalVolume: string | null;
  genres: string[];
  tags: string[];
  publishers: { name: string; language: string | null; type: string | null }[];
  url: string | null;
  lastUpdatedAt: string | null;
}

/* -------------------------------------------------------------------------
   Pure helpers
   ------------------------------------------------------------------------- */

/**
 * Fold a title down to a comparison key.
 *
 * MangaBaka and RanobeDB punctuate differently — the same series is
 * "Re:ZERO -Starting Life in Another World-" and "Re:Zero -Starting Life in
 * Another World-", and "86 -Eighty Six-" versus "86―EIGHTY-SIX". Case,
 * punctuation and spacing all have to go before the two can be compared.
 */
export function normaliseTitle(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  return value
    // NFC, not NFKD. NFKD *decomposes* voiced kana (ゼ becomes セ plus a combining
    // dakuten) and a letter-only class then strips that mark, turning the title
    // into nonsense like "re セ ロから…". Composing instead leaves Japanese intact.
    .normalize("NFC")
    .toLowerCase()
    // Keep letters, digits and marks from any script. An ASCII-only class would
    // erase Japanese entirely, leaving an empty key or a stray fragment ("re")
    // that collides with unrelated series — which is how a wrong score gets
    // attached to a page.
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, " ")
    .trim();
}

/**
 * Whether two titles are the same once punctuation is ignored.
 *
 * Deliberately exact: a fuzzy match would happily attach the wrong series'
 * rating and description, and a confidently wrong score is worse than none.
 */
export function titlesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normaliseTitle(a);
  const right = normaliseTitle(b);
  return left.length > 0 && left === right;
}

/** A canonical MangaBaka page URL, or null when the API gave us something else. */
export function mangaBakaSeriesUrl(raw: { canonical_url?: string | null }): string | null {
  const value = raw.canonical_url;
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (!ALLOWED_LINK_HOSTS.has(url.hostname.toLowerCase())) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function mapMangaBakaSeries(raw: MangaBakaSeries): MangaBakaView | null {
  if (!raw || typeof raw.id !== "number" || !Number.isFinite(raw.id)) return null;

  const rating = typeof raw.rating === "number" && Number.isFinite(raw.rating) ? raw.rating : null;

  const title =
    raw.title?.trim() ||
    raw.romanized_title?.trim() ||
    raw.native_title?.trim() ||
    `MangaBaka #${raw.id}`;

  return {
    id: raw.id,
    title,
    nativeTitle: raw.native_title?.trim() || null,
    romajiTitle: raw.romanized_title?.trim() || null,
    description: raw.description ?? "",
    year: typeof raw.year === "number" && raw.year > 0 ? raw.year : null,
    status: raw.status ?? null,
    type: raw.type ?? null,
    ratingOutOf100: rating,
    // MangaBaka scores out of 100; the rest of the app shows 0-10.
    ratingOutOf10: rating === null ? null : Math.round((rating / 10) * 10) / 10,
    isLicensed: raw.is_licensed === true,
    contentRating: raw.content_rating ?? null,
    totalChapters: raw.total_chapters ?? null,
    finalVolume: raw.final_volume ?? null,
    genres: Array.isArray(raw.genres) ? raw.genres.filter(Boolean) : [],
    tags: Array.isArray(raw.tags) ? raw.tags.filter(Boolean) : [],
    publishers: Array.isArray(raw.publishers)
      ? raw.publishers
          .filter((publisher) => publisher && typeof publisher.name === "string")
          .map((publisher) => ({
            name: publisher.name,
            language: publisher.language ?? null,
            type: publisher.type ?? null,
          }))
      : [],
    url: mangaBakaSeriesUrl(raw),
    lastUpdatedAt: raw.last_updated_at ?? null,
  };
}

/**
 * Choose the record that corresponds to `title`, or null.
 *
 * Only active records with an exact normalised title match are eligible.
 * `merged_with` marks a record that has been merged into another one, and
 * following it blindly would attach a duplicate's data to the page.
 */
export function pickBestMatch(
  results: MangaBakaSeries[],
  title: string,
  options: { year?: number | null } = {},
): MangaBakaSeries | null {
  const eligible = (results ?? []).filter(
    (entry) =>
      entry &&
      typeof entry.id === "number" &&
      entry.merged_with === null &&
      (entry.state === null || entry.state === "active") &&
      titlesMatch(entry.title, title),
  );

  if (eligible.length === 0) return null;
  if (eligible.length === 1) return eligible[0];

  const wantedYear = typeof options.year === "number" ? options.year : null;
  return eligible.reduce((best, entry) => {
    const bestYearHit = wantedYear !== null && best.year === wantedYear ? 1 : 0;
    const yearHit = wantedYear !== null && entry.year === wantedYear ? 1 : 0;
    if (yearHit !== bestYearHit) return yearHit > bestYearHit ? entry : best;
    return entry.id < best.id ? entry : best;
  });
}

/* -------------------------------------------------------------------------
   Request cache
   ------------------------------------------------------------------------- */

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const responseCache = new Map<string, { expiresAt: number; value: unknown }>();

/** Test hook: drop every cached response. */
export function clearMangaBakaCache(): void {
  responseCache.clear();
}

export interface MangaBakaRequestOptions {
  /** Cache lifetime in ms; 0 disables reading and writing the cache. */
  ttlMs?: number;
  timeoutMs?: number;
}

async function requestJson<T>(
  path: string,
  params: Record<string, string | number | undefined>,
  options: MangaBakaRequestOptions = {},
  kind: "search" | "default" = "default",
): Promise<T | null> {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    search.append(key, String(value));
  }
  const query = search.toString();
  const key = `${path}?${query}`;
  const ttl = options.ttlMs ?? DEFAULT_TTL_MS;

  if (ttl > 0) {
    const hit = responseCache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value as T;
  }

  const limiter = kind === "search" ? searchLimiter : defaultLimiter;
  await limiter.acquire();

  try {
    const response = await fetch(`${MANGABAKA_API_BASE}${path}${query ? `?${query}` : ""}`, {
      signal: AbortSignal.timeout(options.timeoutMs ?? 12_000),
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) return null;

    const payload = (await response.json()) as T;
    if (ttl > 0) responseCache.set(key, { expiresAt: Date.now() + ttl, value: payload });
    return payload;
  } catch {
    // Offline, timeout, bad JSON: callers simply render nothing.
    return null;
  }
}

/* -------------------------------------------------------------------------
   Endpoints
   ------------------------------------------------------------------------- */

export interface MangaBakaSearchOptions {
  limit?: number;
  page?: number;
  /** Series type filter; defaults to novels. Pass null to search everything. */
  type?: string | null;
  ttlMs?: number;
}

/** Raw search, returning whatever MangaBaka matched. */
export async function searchMangaBakaSeries(
  query: string,
  options: MangaBakaSearchOptions = {},
): Promise<MangaBakaSeries[]> {
  const trimmed = query?.trim();
  if (!trimmed) return [];

  const payload = await requestJson<MangaBakaListResponse>(
    "/v1/series/search",
    {
      q: trimmed,
      type: options.type === null ? undefined : (options.type ?? "novel"),
      limit: options.limit ?? 5,
      page: options.page && options.page > 1 ? options.page : undefined,
    },
    { ttlMs: options.ttlMs },
    "search",
  );

  if (!payload || payload.status !== 200 || !Array.isArray(payload.data)) return [];
  return payload.data;
}

/**
 * Find the MangaBaka record for a series we already know about, by title.
 *
 * Returns null whenever the match is not exact, which is the common case for
 * series MangaBaka splits differently (its "Ascendance of a Bookworm: Part 1"
 * is one RanobeDB series). Refusing to guess is what keeps the enrichment
 * trustworthy.
 */
export async function findMangaBakaSeries(
  title: string,
  options: { year?: number | null; limit?: number; ttlMs?: number } = {},
): Promise<MangaBakaView | null> {
  const results = await searchMangaBakaSeries(title, {
    limit: options.limit ?? 5,
    ttlMs: options.ttlMs,
  });
  const match = pickBestMatch(results, title, { year: options.year ?? null });
  return match ? mapMangaBakaSeries(match) : null;
}

/** One series by MangaBaka id. */
export async function getMangaBakaSeries(
  id: number,
  options: MangaBakaRequestOptions = {},
): Promise<MangaBakaView | null> {
  if (!Number.isFinite(id)) return null;

  const payload = await requestJson<MangaBakaItemResponse>(
    `/v1/series/${Math.trunc(id)}`,
    {},
    options,
    "default",
  );
  if (!payload || payload.status !== 200 || !payload.data) return null;
  return mapMangaBakaSeries(payload.data);
}

/** Whether the API answers at all, used to skip work when it is down. */
export async function mangaBakaIsReachable(options: MangaBakaRequestOptions = {}): Promise<boolean> {
  const view = await getMangaBakaSeries(84926, { ...options, ttlMs: options.ttlMs ?? 10 * 60 * 1000 });
  return view !== null;
}
