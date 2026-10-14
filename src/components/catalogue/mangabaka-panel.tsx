import { connection } from "next/server";

import { findMangaBakaSeries } from "@/lib/catalogue/mangabaka-api";
import { getLocalMangaBaka, hasMangaBakaCatalogue } from "@/lib/catalogue/mangabaka-local";

import { Section } from "./record-parts";

/**
 * MangaBaka data for a series, matched by exact title.
 *
 * This exists to fill the biggest hole in the local catalogue: RanobeDB carries
 * a community score for only ~1,200 of its 23,000 series, while MangaBaka has one
 * for most of them. Chapter and volume totals are new information too.
 *
 * Renders nothing when there is no exact match, which is the honest outcome for
 * series the two databases model differently — see `findMangaBakaSeries`.
 */
export async function MangaBakaPanel({
  seriesId,
  title,
  year,
  localRatingLabel,
}: {
  /** RanobeDB series id, used to look the match up in the imported catalogue. */
  seriesId: number;
  title: string;
  year: number | null;
  /** How the caller already describes a RanobeDB rating, for the comparison line. */
  localRatingLabel: string | null;
}) {
  // The API client caches with a wall-clock TTL and rate-limits per rolling
  // minute, so it reads the clock. Next refuses to prerender an unstable value,
  // and a build-time clock must never decide when a cached response expires.
  await connection();

  // Prefer the imported catalogue: no request, no rate limit, works offline.
  // Only when nothing has been imported does this fall back to a live title
  // search — and when a catalogue *is* present, an unmatched series stays
  // unmatched rather than quietly making a network call on every page view.
  const imported = hasMangaBakaCatalogue();
  const match = imported ? getLocalMangaBaka(seriesId) : await findMangaBakaSeries(title, { year });
  if (!match) return null;

  const source = imported ? "from the imported catalogue" : "from the live API";

  const facts: { label: string; value: string }[] = [];
  if (match.status) facts.push({ label: "Status", value: match.status });
  if (match.finalVolume) facts.push({ label: "Volumes", value: match.finalVolume });
  if (match.totalChapters) facts.push({ label: "Chapters", value: match.totalChapters });
  if (match.year) facts.push({ label: "Year", value: String(match.year) });
  if (match.contentRating) facts.push({ label: "Content", value: match.contentRating });

  return (
    <Section title="On MangaBaka" hint={source}>
      {match.ratingOutOf10 !== null ? (
        <p className="text-sm leading-7">
          <span aria-hidden className="text-accent">
            ★
          </span>{" "}
          <span className="text-lg font-semibold text-ink">
            {match.ratingOutOf10.toFixed(1)}
          </span>
          <span className="text-muted"> / 10</span>
          <span className="ml-2 text-xs text-muted">
            from {match.ratingOutOf100?.toFixed(1)} / 100 across MangaBaka&apos;s community scores
            {localRatingLabel ? ` · RanobeDB shows ${localRatingLabel}` : null}
          </span>
        </p>
      ) : (
        <p className="text-sm text-muted">MangaBaka has no community score for this series.</p>
      )}

      {match.isLicensed ? (
        <p className="mt-2 text-sm text-muted">
          <span className="rounded-full border border-line bg-surface px-2.5 py-1 text-xs">
            Licensed in English
          </span>
        </p>
      ) : null}

      {facts.length > 0 ? (
        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-4">
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted">
                {fact.label}
              </dt>
              <dd className="mt-1 capitalize">{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {match.url ? (
        <p className="mt-5 text-sm">
          <a
            href={match.url}
            target="_blank"
            rel="noreferrer noopener"
            className="text-accent hover:underline"
          >
            Open this series on MangaBaka
          </a>
          {/* A match can be narrower in scope than the series it is attached to,
              because MangaBaka splits some works into parts. Naming the record
              makes the score checkable instead of just asserting it. */}
          <span className="ml-2 text-xs text-muted">matched to “{match.title}”</span>
        </p>
      ) : null}

      <p className="mt-4 text-xs leading-5 text-muted">
        MangaBaka data is licensed{" "}
        <abbr title="Creative Commons Attribution-NonCommercial-ShareAlike 4.0">CC BY-NC-SA 4.0</abbr>; it
        aggregates AniList, MyAnimeList, Kitsu, MangaUpdates, Shikimori and Anime-Planet, each under
        its own terms.
      </p>
    </Section>
  );
}

/**
 * Placeholder shown while the MangaBaka lookup is in flight.
 *
 * Deliberately has no section heading: the lookup resolves to nothing whenever
 * there is no exact match, and flashing a heading that then disappears reads as
 * a failure rather than an absent extra.
 */
export function MangaBakaPanelSkeleton() {
  return (
    <p className="mt-10 text-xs text-muted">Looking this series up on MangaBaka…</p>
  );
}
