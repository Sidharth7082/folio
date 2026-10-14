import { connection } from "next/server";

import { SectionRow } from "@/components/catalog/novel-grid";
import { Shelf, ShelfItem } from "@/components/home/shelf";
import { ReleaseCard } from "@/components/catalogue/release-card";
import { SeriesCard } from "@/components/catalogue/series-card";
import { addDays, toIsoDate } from "@/lib/catalogue/relative-date";
import { apiGetReleases, apiSearchSeries } from "@/lib/catalogue/ranobedb-api";

/**
 * Homepage discovery rails, streamed live from the RanobeDB API.
 *
 * Each rail is its own async component so it can be wrapped in `<Suspense>`:
 * the page shell paints immediately and the rails fill in as they arrive. When
 * the API is unreachable a rail renders nothing rather than an error, so the
 * page degrades to the local library.
 */

const RAIL_SIZE = 14;

/**
 * The current time, at request time.
 *
 * `connection()` marks the enclosing boundary as dynamic. Next refuses to
 * prerender an unstable value like `new Date()`, and it also keeps a stale
 * build-time clock from deciding which releases are "upcoming".
 */
async function requestTime(): Promise<Date> {
  await connection();
  return new Date();
}

/** Placeholder shown while a rail is streaming in. */
export function RailSkeleton({ title, kicker }: { title: string; kicker?: string }) {
  return (
    <SectionRow title={title} kicker={kicker}>
      <div className="flex gap-5 overflow-hidden" aria-hidden>
        {Array.from({ length: 7 }).map((_, index) => (
          <div key={index} className="w-[9.5rem] shrink-0 sm:w-[11rem]">
            <div className="aspect-2/3 w-full animate-pulse rounded-xl border border-line bg-surface-2" />
            <div className="mt-3 h-3 w-3/4 animate-pulse rounded-full bg-surface-2" />
            <div className="mt-2 h-3 w-1/2 animate-pulse rounded-full bg-surface-2" />
          </div>
        ))}
      </div>
    </SectionRow>
  );
}

/** Most-read series, using RanobeDB's own relevance ranking. */
export async function PopularSeriesRail() {
  // Live data: render per request rather than baking a build-time snapshot.
  await connection();

  const result = await apiSearchSeries({ sort: "Relevance desc", limit: RAIL_SIZE });
  if (!result || result.items.length === 0) return null;

  return (
    <SectionRow
      title="Most popular series"
      kicker="Ranked by RanobeDB readers"
      href="/catalogue"
      className="animate-in-soft"
    >
      <Shelf>
        {result.items.map((series) => (
          <ShelfItem key={series.id}>
            <SeriesCard
              id={series.id}
              title={series.title}
              numBooks={series.numBooks}
              startDate={series.startDate}
              coverFilename={series.coverFilename}
              showCover={!series.coverIsNsfw}
            />
          </ShelfItem>
        ))}
      </Shelf>
    </SectionRow>
  );
}

/** Releases shipping from tomorrow onwards. */
export async function UpcomingReleasesRail() {
  const now = await requestTime();
  const releases = await apiGetReleases({
    minDate: toIsoDate(addDays(now, 1)),
    sort: "Release date asc",
    limit: RAIL_SIZE,
  });
  if (!releases || releases.length === 0) return null;

  return (
    <SectionRow
      title="Upcoming releases"
      kicker="Shipping soon, across every language"
      href="/catalogue"
      className="animate-in-soft"
    >
      <Shelf>
        {releases.map((release) => (
          <ShelfItem key={release.id}>
            <ReleaseCard release={release} now={now} />
          </ShelfItem>
        ))}
      </Shelf>
    </SectionRow>
  );
}

/** Everything that has just landed, newest first. */
export async function RecentReleasesRail() {
  const now = await requestTime();
  const releases = await apiGetReleases({
    minDate: toIsoDate(addDays(now, -21)),
    maxDate: toIsoDate(now),
    sort: "Release date desc",
    limit: RAIL_SIZE,
  });
  if (!releases || releases.length === 0) return null;

  return (
    <SectionRow
      title="Recently released"
      kicker="Out in the last three weeks"
      href="/catalogue"
      className="animate-in-soft"
    >
      <Shelf>
        {releases.map((release) => (
          <ShelfItem key={release.id}>
            <ReleaseCard release={release} now={now} />
          </ShelfItem>
        ))}
      </Shelf>
    </SectionRow>
  );
}

/** English-language releases from the past month. */
export async function NewEnglishReleasesRail() {
  const now = await requestTime();
  const releases = await apiGetReleases({
    minDate: toIsoDate(addDays(now, -30)),
    maxDate: toIsoDate(now),
    languages: ["en"],
    sort: "Release date desc",
    limit: RAIL_SIZE,
  });
  if (!releases || releases.length === 0) return null;

  return (
    <SectionRow
      title="New in English"
      kicker="English releases from the past 30 days"
      href="/catalogue"
      className="animate-in-soft"
    >
      <Shelf>
        {releases.map((release) => (
          <ShelfItem key={release.id}>
            <ReleaseCard release={release} now={now} />
          </ShelfItem>
        ))}
      </Shelf>
    </SectionRow>
  );
}

/** Required attribution for the RanobeDB data shown above. */
export function CatalogueAttribution() {
  return (
    <p className="mt-14 border-t border-line pt-6 text-xs leading-5 text-muted">
      Series, release and cover data above comes from{" "}
      <a
        className="text-accent hover:underline"
        href="https://ranobedb.org"
        target="_blank"
        rel="noreferrer noopener"
      >
        RanobeDB
      </a>
      , licensed <abbr title="Open Database License">ODbL-1.0</abbr> (database) and{" "}
      <abbr title="Database Contents License">DbCL-1.0</abbr> (contents). Attribution is required;
      the API is non-commercial use only.
    </p>
  );
}
