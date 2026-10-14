import { Suspense } from "react";
import Link from "next/link";

import { Cover } from "@/components/catalog/cover";
import { ContinueReading } from "@/components/catalog/continue-reading";
import { GenreChips } from "@/components/catalog/genre-chips";
import { NovelGrid, SectionRow } from "@/components/catalog/novel-grid";
import {
  CatalogueAttribution,
  NewEnglishReleasesRail,
  PopularSeriesRail,
  RailSkeleton,
  RecentReleasesRail,
  UpcomingReleasesRail,
} from "@/components/home/discover-rails";
import { Hero } from "@/components/home/hero";
import { Reveal } from "@/components/home/reveal";
import { getNovelSlugs, listGenres, listNovels } from "@/lib/content/repository";
import { summarizeNovel } from "@/lib/content/summarize";
import type { NovelWithChapters } from "@/lib/content/types";

export default async function HomePage() {
  const novels = await listNovels();
  const genres = await listGenres();

  if (novels.length === 0) {
    return <EmptyLibrary />;
  }

  const featured = pickFeatured(novels);
  const trending = [...novels]
    .sort((a, b) => b.chapterCount - a.chapterCount || a.title.localeCompare(b.title))
    .slice(0, 8);
  const latest = novels.slice(0, 6);

  const stats = {
    novels: novels.length,
    chapters: novels.reduce((total, novel) => total + novel.chapterCount, 0),
    genres: genres.length,
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-5 pb-20">
      <Hero novel={featured} stats={stats} />

      {genres.length > 0 ? (
        <Reveal>
          <SectionRow title="Browse by genre" kicker="Jump straight to a mood">
            <GenreChips genres={genres} />
          </SectionRow>
        </Reveal>
      ) : null}

      <Reveal>
        <ContinueReading novels={novels.map(summarizeNovel)} />
      </Reveal>

      <Reveal>
        <SectionRow
          title="Trending"
          kicker="The longest-running series in your library"
          href="/browse"
        >
          <NovelGrid novels={trending.map(summarizeNovel)} priorityCount={4} />
        </SectionRow>
      </Reveal>

      <Reveal>
        <SectionRow title="Latest updates" kicker="Most recently updated" href="/browse">
          <ul className="overflow-hidden rounded-2xl border border-line bg-surface">
            {latest.map((novel) => (
              <LatestRow key={novel.slug} novel={novel} />
            ))}
          </ul>
        </SectionRow>
      </Reveal>

      {/* Discovery rails stream in from the RanobeDB API; they render nothing
          when it is unreachable, so the page still works offline. */}
      <Suspense
        fallback={<RailSkeleton title="Most popular series" kicker="Ranked by RanobeDB readers" />}
      >
        <PopularSeriesRail />
      </Suspense>

      <Suspense
        fallback={
          <RailSkeleton title="Upcoming releases" kicker="Shipping soon, across every language" />
        }
      >
        <UpcomingReleasesRail />
      </Suspense>

      <Suspense
        fallback={<RailSkeleton title="Recently released" kicker="Out in the last three weeks" />}
      >
        <RecentReleasesRail />
      </Suspense>

      <Suspense
        fallback={<RailSkeleton title="New in English" kicker="English releases from the past 30 days" />}
      >
        <NewEnglishReleasesRail />
      </Suspense>

      <CatalogueAttribution />
    </div>
  );
}

function pickFeatured(novels: NovelWithChapters[]): NovelWithChapters {
  return (
    novels.find((novel) => novel.badges.some((badge) => /editor/i.test(badge))) ?? novels[0]
  );
}

function LatestRow({ novel }: { novel: NovelWithChapters }) {
  const latest = novel.latestChapter;

  return (
    <li className="border-b border-line last:border-b-0">
      <div className="group/row flex items-center gap-4 p-4 transition-colors duration-300 hover:bg-surface-2">
        <div className="relative h-16 w-11 shrink-0 overflow-hidden rounded-md bg-surface-2">
          <Cover src={novel.cover} title={novel.title} sizes="44px" />
        </div>

        <div className="min-w-0 flex-1">
          <Link
            href={`/novel/${novel.slug}`}
            className="block truncate text-sm font-semibold transition-colors duration-300 group-hover/row:text-accent"
          >
            {novel.title}
          </Link>
          <p className="mt-0.5 truncate text-xs text-muted">
            {novel.genres.slice(0, 3).join(" · ") || "Uncategorised"}
            {novel.updatedAt ? ` · ${novel.updatedAt}` : ""}
          </p>
        </div>

        {latest ? (
          <Link
            href={`/novel/${novel.slug}/${latest.index}`}
            className="group/btn inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-muted transition-colors duration-300 hover:border-line-strong hover:text-ink"
          >
            Ch. {latest.index}
            <span
              aria-hidden
              className="transition-transform duration-300 group-hover/btn:translate-x-0.5"
            >
              →
            </span>
          </Link>
        ) : null}
      </div>
    </li>
  );
}

async function EmptyLibrary() {
  const slugs = await getNovelSlugs();

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-24">
      <h1 className="text-3xl font-semibold tracking-tight">No novels yet</h1>
      <p className="mt-3 text-sm leading-6 text-muted">
        Folio reads from the local{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5">content/</code> directory. Add
        one novel per folder and it will appear here.
      </p>
      <ol className="mt-6 space-y-3 text-sm text-muted">
        <li>
          <span className="font-medium text-ink">1.</span> Create{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5">content/my-novel/novel.json</code>.
        </li>
        <li>
          <span className="font-medium text-ink">2.</span> Add chapter files under{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5">chapters/</code>.
        </li>
        <li>
          <span className="font-medium text-ink">3.</span> Or import an existing file with{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5">
            npm run ingest -- book.epub --title &quot;...&quot;
          </code>
          .
        </li>
      </ol>
      <p className="mt-6 text-xs text-muted">Currently detected novel folders: {slugs.length}</p>
    </div>
  );
}

