import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import type { Metadata } from "next";

import { MangaBakaPanel, MangaBakaPanelSkeleton } from "@/components/catalogue/mangabaka-panel";
import {
  Chip,
  CreditsList,
  PublishersList,
  RatingBadge,
  ReleasesList,
  Section,
  VolumeGrid,
} from "@/components/catalogue/record-parts";
import { formatCatalogueDate, formatCatalogueYear } from "@/components/catalogue/series-card";
import { getCatalogueSeries } from "@/lib/catalogue/queries";
import { apiGetSeries } from "@/lib/catalogue/ranobedb-api";

/**
 * The catalogue holds ~23k series, so this route is rendered on demand rather
 * than prerendered. `instant = false` marks it as an intentionally blocking
 * navigation under Cache Components.
 */
export const instant = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const series = getCatalogueSeries(Number.parseInt(id, 10));
  if (!series) return { title: "Series not found" };
  return {
    title: series.title,
    description: series.description.slice(0, 160) || undefined,
  };
}

export default async function CatalogueSeriesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const seriesId = Number.parseInt(id, 10);
  if (!Number.isFinite(seriesId)) notFound();

  const series = getCatalogueSeries(seriesId);
  if (!series) notFound();

  const startYear = formatCatalogueYear(series.startDate);
  const endLabel = series.endDate ? formatCatalogueYear(series.endDate) : "ongoing";
  const period = startYear ? (series.endDate ? `${startYear}–${endLabel}` : `${startYear}–`) : null;
  const altTitles = [series.titleJa, series.romaji].filter(
    (value): value is string => Boolean(value) && value !== series.title,
  );

  // RanobeDB carries a series-level synopsis for only a couple of hundred
  // series, but an English synopsis for thousands of individual volumes.
  // Falling back to the opening volume is useful as long as the page is honest
  // about where the text came from.
  const openingVolume = series.volumes.find((volume) => volume.description.trim().length > 0);
  const synopsis = series.description.trim() || openingVolume?.description.trim() || "";
  const synopsisSource = series.description.trim()
    ? "series record"
    : openingVolume
      ? `volume ${openingVolume.sortOrder > 0 ? openingVolume.sortOrder : openingVolume.id}`
      : null;

  return (
    <div className="mx-auto w-full max-w-3xl px-5 pb-16">
      <nav className="pt-8 text-sm text-muted">
        <Link href="/catalogue" className="hover:text-accent">
          ← Catalogue
        </Link>
      </nav>

      <header className="mt-6">
        <h1 className="text-3xl font-semibold tracking-tight">{series.title}</h1>
        {altTitles.length > 0 ? (
          <p className="mt-2 text-sm text-muted">{altTitles.join(" · ")}</p>
        ) : null}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <RatingBadge rating={series.rating} />
          {series.webNovel ? (
            <span className="rounded-full border border-line bg-surface px-3 py-1 text-xs text-muted">
              Web novel
            </span>
          ) : null}
          {series.fullyTranslated ? (
            <span className="rounded-full border border-line bg-surface px-3 py-1 text-xs text-muted">
              Fully translated
            </span>
          ) : null}
        </div>
      </header>

      {series.imageFilename ? (
        <div className="relative mt-6 aspect-2/3 w-44 overflow-hidden rounded-xl border border-line bg-surface-2 shadow-[var(--shadow)]">
          <Image
            src={`/api/cover/${series.imageFilename}`}
            alt={`${series.title} cover`}
            fill
            sizes="176px"
            priority
            className="object-cover"
          />
        </div>
      ) : null}

      <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-4 rounded-xl border border-line bg-surface p-5 text-sm sm:grid-cols-4">
        <Detail label="Author">
          {series.authors.length > 0 ? series.authors.join(", ") : "Unknown"}
        </Detail>
        <Detail label="Status">{series.status}</Detail>
        <Detail label="Books">{series.numBooks > 0 ? series.numBooks : "—"}</Detail>
        <Detail label="Published">{period ?? "—"}</Detail>
      </dl>

      {/* Genres and demographics are a closed vocabulary; free tags are not, so
          they read as a separate, quieter row. */}
      {series.genres.length > 0 || series.demographics.length > 0 ? (
        <div className="mt-6 flex flex-wrap gap-2">
          {[...series.genres, ...series.demographics].map((genre) => (
            <Chip key={genre} href={`/catalogue?tag=${encodeURIComponent(genre)}`} tone="accent">
              {genre}
            </Chip>
          ))}
        </div>
      ) : null}

      {series.tags.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {series.tags.map((tag) => (
            <Chip key={tag} href={`/catalogue?tag=${encodeURIComponent(tag)}`}>
              {tag}
            </Chip>
          ))}
        </div>
      ) : null}

      {synopsis ? (
        <Section
          title="Synopsis"
          hint={synopsisSource ? `from the ${synopsisSource}` : undefined}
        >
          <p className="whitespace-pre-line text-sm leading-7">{synopsis}</p>
        </Section>
      ) : (
        <Suspense fallback={<LiveDetailSkeleton />}>
          <LiveDetail id={series.id} />
        </Suspense>
      )}

      <Section title="Volumes" hint={`${series.volumes.length} recorded`}>
        <VolumeGrid volumes={series.volumes} />
      </Section>

      <div className="lg:grid lg:gap-x-10">
        <Section title="Staff">
          <CreditsList credits={series.credits} />
        </Section>
        <Section title="Publishers">
          <PublishersList publishers={series.publishers} />
        </Section>
      </div>

      <Section title="Releases" hint="every dated edition on record">
        <ReleasesList releases={series.releases} />
      </Section>

      {/* Streamed separately so a slow or unreachable third party never delays
          the record itself; renders nothing when there is no exact match. */}
      <Suspense fallback={<MangaBakaPanelSkeleton />}>
        <MangaBakaPanel
          seriesId={series.id}
          title={series.title}
          year={series.startDate ? Math.floor(series.startDate / 10000) : null}
          localRatingLabel={series.rating !== null ? `${series.rating.toFixed(1)} / 10` : null}
        />
      </Suspense>

      <section className="mt-8 rounded-xl border border-line bg-surface p-5 text-sm leading-6 text-muted">
        <p>
          <span className="font-medium text-ink">This is a catalogue record.</span> It describes the
          series — it does not contain the novel. Nothing here is readable, and no text is
          downloaded.
        </p>
        <p className="mt-3">
          If you hold the rights to this work, add it under{" "}
          <Link href="/browse" className="text-accent hover:underline">
            Browse
          </Link>{" "}
          and it will be readable.
        </p>
      </section>

      {(series.malId || series.anilistId) && (
        <p className="mt-6 text-xs text-muted">
          External ids:{" "}
          {series.malId ? `MyAnimeList ${series.malId}` : null}
          {series.malId && series.anilistId ? " · " : null}
          {series.anilistId ? `AniList ${series.anilistId}` : null}
        </p>
      )}

      <footer className="mt-10 border-t border-line pt-6 text-xs leading-5 text-muted">
        Series #{series.id} · imported{" "}
        {formatCatalogueDate(series.startDate) ?? "date unknown"}. Catalogue data from RanobeDB,
        licensed ODbL-1.0 / DbCL-1.0.
      </footer>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-1 truncate">{children}</dd>
    </div>
  );
}

function LiveDetailSkeleton() {
  return <p className="mt-8 text-sm text-muted">Loading live details from RanobeDB…</p>;
}

/**
 * Fallback only. Now that the dump supplies volumes, credits, publishers and
 * releases, the API is needed for exactly one thing it still does better: an
 * English synopsis when neither the series nor its opening volume has one.
 * Renders nothing when the API is unreachable, so the page works offline.
 */
async function LiveDetail({ id }: { id: number }) {
  // The API client reads the clock for its TTL cache and rate limiter. Next
  // refuses to prerender an unstable value, so opt into request-time rendering
  // before touching it — otherwise this logs an error on every build.
  await connection();

  const live = await apiGetSeries(id);
  if (!live?.description) return null;

  return (
    <Section title="Synopsis" hint="from the RanobeDB API">
      <p className="whitespace-pre-line text-sm leading-7">{live.description}</p>
    </Section>
  );
}
