/**
 * Read-only access to the local MangaBaka catalogue.
 *
 * Produced by `scripts/import-mangabaka.mjs`, with `scripts/link-mangabaka.mjs`
 * adding the `catalogue_match` table that maps RanobeDB series ids to MangaBaka
 * records. Both are metadata only — no novel text, no chapter content.
 *
 * This exists so a series page can show a MangaBaka score without a network call:
 * the alternative is a live title search per page view, which costs a request
 * against a 30/minute budget and fails whenever the API is down.
 *
 * MangaBaka's own data is CC BY-NC-SA 4.0 and attribution is required; it
 * republishes AniList, MyAnimeList, Kitsu, MangaUpdates, Shikimori and
 * Anime-Planet records under each provider's own terms.
 *
 * The file is only ever opened read-only.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { MangaBakaView } from "./mangabaka-api";

export const MANGABAKA_PATH = process.env.NOVEL_READER_MANGABAKA_DB
  ? path.resolve(process.env.NOVEL_READER_MANGABAKA_DB)
  : path.join(process.cwd(), "data", "mangabaka.db");

let handle: DatabaseSync | null = null;

/** Whether a linked MangaBaka catalogue is present on disk. */
export function hasMangaBakaCatalogue(): boolean {
  return existsSync(MANGABAKA_PATH);
}

/**
 * The open read-only database, or null when nothing has been imported.
 * Callers must handle null so the app works without this catalogue.
 */
export function getMangaBakaCatalogue(): DatabaseSync | null {
  if (!hasMangaBakaCatalogue()) return null;
  if (handle) return handle;

  try {
    handle = new DatabaseSync(MANGABAKA_PATH, { readOnly: true });
    return handle;
  } catch {
    return null;
  }
}

interface LocalRow {
  id: number;
  title: string;
  native_title: string | null;
  romanized_title: string | null;
  description: string;
  year: number | null;
  status: string | null;
  type: string | null;
  content_rating: string | null;
  rating: number | null;
  is_licensed: number;
  final_volume: string | null;
  total_chapters: string | null;
  canonical_url: string | null;
  last_updated_at: string | null;
}

function toView(row: LocalRow): MangaBakaView {
  const rating = typeof row.rating === "number" && row.rating > 0 ? row.rating : null;
  return {
    id: row.id,
    title: row.title,
    nativeTitle: row.native_title,
    romajiTitle: row.romanized_title,
    description: row.description ?? "",
    year: row.year,
    status: row.status,
    type: row.type,
    ratingOutOf100: rating,
    // Stored on MangaBaka's 0-100 scale; the rest of the app shows 0-10.
    ratingOutOf10: rating === null ? null : Math.round((rating / 10) * 10) / 10,
    isLicensed: row.is_licensed === 1,
    contentRating: row.content_rating,
    totalChapters: row.total_chapters,
    finalVolume: row.final_volume,
    genres: [],
    tags: [],
    publishers: [],
    url: row.canonical_url,
    lastUpdatedAt: row.last_updated_at,
  };
}

/**
 * The MangaBaka record linked to a RanobeDB series, or null.
 *
 * Returns null both when there is no local catalogue and when the linker refused
 * to match — the caller cannot tell the difference, and does not need to.
 */
export function getLocalMangaBaka(ranobedbSeriesId: number): MangaBakaView | null {
  const db = getMangaBakaCatalogue();
  if (!db || !Number.isFinite(ranobedbSeriesId)) return null;

  try {
    const row = db
      .prepare(
        `SELECT s.id, s.title, s.native_title, s.romanized_title, s.description, s.year,
                s.status, s.type, s.content_rating, s.rating, s.is_licensed,
                s.final_volume, s.total_chapters, s.canonical_url, s.last_updated_at
           FROM catalogue_match m
           JOIN series s ON s.id = m.mangabaka_id
          WHERE m.ranobedb_series_id = ?`,
      )
      .get(ranobedbSeriesId) as unknown as LocalRow | undefined;

    return row ? toView(row) : null;
  } catch {
    // A database from an older schema simply yields nothing.
    return null;
  }
}

/** Provenance numbers from the import and link steps. */
export function mangaBakaLocalStats(): {
  series: number;
  linked: number;
  generatedAt: string | null;
} {
  const db = getMangaBakaCatalogue();
  if (!db) return { series: 0, linked: 0, generatedAt: null };

  try {
    const counts = db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM series) AS series,
                (SELECT COUNT(*) FROM catalogue_match) AS linked`,
      )
      .get() as { series: number; linked: number } | undefined;

    const meta = db
      .prepare("SELECT value FROM meta WHERE key = 'generated_at'")
      .get() as { value: string } | undefined;

    return {
      series: counts?.series ?? 0,
      linked: counts?.linked ?? 0,
      generatedAt: meta?.value ?? null,
    };
  } catch {
    return { series: 0, linked: 0, generatedAt: null };
  }
}
