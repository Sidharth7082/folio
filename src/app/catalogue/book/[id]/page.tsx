import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import {
  CreditsList,
  PublishersList,
  ReleasesList,
  Section,
} from "@/components/catalogue/record-parts";
import { languageLabel } from "@/components/catalogue/release-card";
import { formatCatalogueDate } from "@/components/catalogue/series-card";
import { getCatalogueVolume } from "@/lib/catalogue/queries";

/**
 * Volume records are looked up by id, so this route renders on demand.
 * `instant = false` marks it as intentionally blocking under Cache Components.
 */
export const instant = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const volume = getCatalogueVolume(Number.parseInt(id, 10));
  if (!volume) return { title: "Volume not found" };
  return {
    title: volume.seriesTitle ? `${volume.title} — ${volume.seriesTitle}` : volume.title,
    description: volume.description.slice(0, 160) || undefined,
  };
}

export default async function CatalogueVolumePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const bookId = Number.parseInt(id, 10);
  if (!Number.isFinite(bookId)) notFound();

  const volume = getCatalogueVolume(bookId);
  if (!volume) notFound();

  const altTitles = [volume.titleJa, volume.romaji].filter(
    (value): value is string => Boolean(value) && value !== volume.title,
  );

  const released = formatCatalogueDate(volume.releaseDate);

  return (
    <div className="mx-auto w-full max-w-3xl px-5 pb-16">
      <nav className="flex flex-wrap items-center gap-x-2 pt-8 text-sm text-muted">
        <Link href="/catalogue" className="hover:text-accent">
          ← Catalogue
        </Link>
        {volume.seriesId ? (
          <>
            <span aria-hidden>/</span>
            <Link href={`/catalogue/${volume.seriesId}`} className="hover:text-accent">
              {volume.seriesTitle ?? `Series #${volume.seriesId}`}
            </Link>
          </>
        ) : null}
      </nav>

      <header className="mt-6 flex flex-col gap-6 sm:flex-row sm:items-start">
        {volume.coverFilename ? (
          <div className="relative aspect-2/3 w-40 shrink-0 overflow-hidden rounded-xl border border-line bg-surface-2 shadow-[var(--shadow)]">
            <Image
              src={`/api/cover/${volume.coverFilename}`}
              alt={`${volume.title} cover`}
              fill
              sizes="160px"
              priority
              className="object-cover"
            />
          </div>
        ) : null}

        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{volume.title}</h1>
          {altTitles.length > 0 ? (
            <p className="mt-2 text-sm text-muted">{altTitles.join(" · ")}</p>
          ) : null}
          <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            {volume.sortOrder > 0 ? (
              <span className="rounded-full border border-line bg-surface px-3 py-1 text-xs">
                Volume {volume.sortOrder}
              </span>
            ) : null}
            {released ? <span>Released {released}</span> : <span>Release date unknown</span>}
            {volume.olang ? (
              <span className="rounded-full border border-line bg-surface px-2.5 py-1 text-xs">
                Original: {languageLabel(volume.olang)}
              </span>
            ) : null}
          </p>
        </div>
      </header>

      {volume.description ? (
        <Section title="Description">
          <p className="whitespace-pre-line text-sm leading-7">{volume.description}</p>
        </Section>
      ) : null}

      {volume.titles.length > 0 ? (
        <Section title="Titles" hint="every name this volume is known by">
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
            {volume.titles.map((title, index) => (
              <li
                key={`${title.lang ?? "unknown"}-${index}`}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 text-sm"
              >
                <span className="w-20 shrink-0 font-mono text-xs text-muted">
                  {title.lang ? languageLabel(title.lang) : "Unknown"}
                </span>
                <span className="min-w-0 flex-1 break-words">{title.title ?? title.romaji}</span>
                {title.romaji && title.romaji !== title.title ? (
                  <span className="text-xs text-muted">{title.romaji}</span>
                ) : null}
                {title.official ? (
                  <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">
                    official
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="Staff">
        <CreditsList credits={volume.credits} />
      </Section>

      <Section title="Publishers">
        <PublishersList publishers={volume.publishers} />
      </Section>

      <Section title="Releases" hint="this volume, every edition on record">
        <ReleasesList releases={volume.releases} />
      </Section>

      {volume.previous || volume.next ? (
        <nav className="mt-10 grid gap-3 sm:grid-cols-2">
          {volume.previous ? (
            <Link
              href={`/catalogue/book/${volume.previous.id}`}
              className="rounded-xl border border-line bg-surface p-4 text-sm transition-colors hover:border-line-strong"
            >
              <span className="text-xs uppercase tracking-wide text-muted">← Previous</span>
              <span className="mt-1 block line-clamp-2">{volume.previous.title}</span>
            </Link>
          ) : (
            <span />
          )}
          {volume.next ? (
            <Link
              href={`/catalogue/book/${volume.next.id}`}
              className="rounded-xl border border-line bg-surface p-4 text-right text-sm transition-colors hover:border-line-strong sm:col-start-2"
            >
              <span className="text-xs uppercase tracking-wide text-muted">Next →</span>
              <span className="mt-1 block line-clamp-2">{volume.next.title}</span>
            </Link>
          ) : null}
        </nav>
      ) : null}

      <section className="mt-10 rounded-xl border border-line bg-surface p-5 text-sm leading-6 text-muted">
        <p>
          <span className="font-medium text-ink">This is a catalogue record for one volume.</span>{" "}
          It describes the book — it does not contain it. No text is stored or downloaded.
        </p>
      </section>

      <footer className="mt-10 border-t border-line pt-6 text-xs leading-5 text-muted">
        Volume #{volume.id}
        {volume.seriesId ? (
          <>
            {" in "}
            <Link href={`/catalogue/${volume.seriesId}`} className="text-accent hover:underline">
              {volume.seriesTitle ?? `series #${volume.seriesId}`}
            </Link>
          </>
        ) : null}
        . Catalogue data from RanobeDB, licensed ODbL-1.0 / DbCL-1.0.
      </footer>
    </div>
  );
}
