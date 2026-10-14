import Image from "next/image";
import Link from "next/link";

import { languageLabel } from "./release-card";
import { formatCatalogueDate } from "./series-card";
import type {
  CatalogueCredit,
  CataloguePublisherRef,
  CatalogueRelease,
  CatalogueVolume,
} from "@/lib/catalogue/types";

const FORMAT_LABEL: Record<string, string> = {
  digital: "Digital",
  print: "Print",
  audio: "Audio",
};

/** Group rows by a key, keeping first-seen order so output stays stable. */
function groupBy<T>(rows: T[], keyOf: (row: T) => string): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }
  return [...groups];
}

function LanguageGroupHeading({ code, count }: { code: string; count: number }) {
  return (
    <p className="text-xs font-medium uppercase tracking-wide text-muted">
      {code === "unknown" ? "Other" : languageLabel(code)}
      <span className="ml-2 font-normal normal-case tracking-normal">({count})</span>
    </p>
  );
}

/** A record-page section with the small uppercase heading used throughout. */
export function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <h2 className="flex flex-wrap items-baseline gap-x-3 text-sm font-semibold uppercase tracking-widest text-muted">
        {title}
        {hint ? <span className="font-normal normal-case tracking-normal">{hint}</span> : null}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** A pill linking into a filtered catalogue view. */
export function Chip({
  href,
  children,
  tone = "plain",
}: {
  href: string;
  children: React.ReactNode;
  tone?: "plain" | "accent";
}) {
  const classes =
    tone === "accent"
      ? "border-transparent bg-accent-soft text-accent hover:bg-accent-soft/80"
      : "border-line bg-surface text-muted hover:border-line-strong hover:text-ink";

  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${classes}`}
    >
      {children}
    </Link>
  );
}

/**
 * RanobeDB's own score. Shown only when it actually has scores — most series
 * have no rating at all, and a "0.0" would be a claim we cannot support.
 */
export function RatingBadge({ rating }: { rating: number | null }) {
  if (rating === null) return null;
  return (
    <span
      className="inline-flex items-baseline gap-1.5 rounded-full border border-line bg-surface px-3 py-1"
      title="RanobeDB's average user score"
    >
      <span aria-hidden className="text-accent">
        ★
      </span>
      <span className="text-sm font-semibold text-ink">{rating.toFixed(1)}</span>
      <span className="text-xs text-muted">/ 10</span>
    </span>
  );
}

/**
 * The volume strip. Every volume links to its own record page; where RanobeDB
 * has a cover filename we show it, and the cover proxy fetches it on demand.
 */
export function VolumeGrid({ volumes }: { volumes: CatalogueVolume[] }) {
  if (volumes.length === 0) {
    return <p className="text-sm text-muted">No volumes are recorded for this series.</p>;
  }

  return (
    <ul className="grid grid-cols-3 gap-x-4 gap-y-6 sm:grid-cols-5 lg:grid-cols-6">
      {volumes.map((volume) => (
        <li key={volume.id}>
          <Link href={`/catalogue/book/${volume.id}`} className="group block">
            <div className="relative grid aspect-2/3 place-items-center overflow-hidden rounded-lg border border-line bg-surface-2 p-2 text-center shadow-[var(--shadow)]">
              <span className="line-clamp-4 font-serif text-xs leading-snug text-muted">
                {volume.title}
              </span>
              {volume.coverFilename ? (
                <Image
                  src={`/api/cover/${volume.coverFilename}`}
                  alt=""
                  fill
                  sizes="(max-width: 640px) 30vw, 150px"
                  loading="lazy"
                  className="absolute inset-0 object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                />
              ) : null}
              <span className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
                #{volume.sortOrder > 0 ? volume.sortOrder : volume.id}
              </span>
            </div>
            <p className="mt-2 line-clamp-2 text-xs leading-snug text-muted transition-colors group-hover:text-ink">
              {volume.title}
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Staff credits, grouped by role. The romanised name leads where we have one. */
export function CreditsList({ credits }: { credits: CatalogueCredit[] }) {
  if (credits.length === 0) {
    return <p className="text-sm text-muted">No credits are recorded for this work.</p>;
  }

  return (
    <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
      {groupBy(credits, (credit) => credit.roleLabel).map(([role, people]) => (
        <div key={role}>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted">{role}</dt>
          <dd className="mt-1.5 space-y-1 text-sm leading-6">
            {people.map((person) => (
              <span key={`${person.staffId}-${person.role}`} className="block">
                {person.romaji ?? person.name}
                {person.romaji && person.romaji !== person.name ? (
                  <span className="ml-2 text-xs text-muted">{person.name}</span>
                ) : null}
              </span>
            ))}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Publishers and imprints, split by language. RanobeDB records both in the same
 * table and tags which is which, so the pair reads as "Yen Press publisher,
 * Yen On imprint".
 */
export function PublishersList({ publishers }: { publishers: CataloguePublisherRef[] }) {
  if (publishers.length === 0) {
    return <p className="text-sm text-muted">No publishers are recorded for this work.</p>;
  }

  return (
    <div className="space-y-5">
      {groupBy(publishers, (publisher) => publisher.lang ?? "unknown").map(([lang, list]) => (
        <div key={lang}>
          <LanguageGroupHeading code={lang} count={list.length} />
          <ul className="mt-2.5 space-y-2">
            {list.map((publisher) => (
              <li
                key={`${publisher.id}-${publisher.publisherType}`}
                className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm"
              >
                {publisher.website ? (
                  <a
                    href={publisher.website}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-accent hover:underline"
                  >
                    {publisher.name}
                  </a>
                ) : (
                  <span>{publisher.name}</span>
                )}
                <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">
                  {publisher.publisherType}
                </span>
                {publisher.romaji && publisher.romaji !== publisher.name ? (
                  <span className="text-xs text-muted">{publisher.romaji}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** Dated releases, grouped by language, newest data first within each language. */
export function ReleasesList({ releases }: { releases: CatalogueRelease[] }) {
  if (releases.length === 0) {
    return <p className="text-sm text-muted">No releases are recorded for this work.</p>;
  }

  return (
    <div className="space-y-6">
      {groupBy(releases, (release) => release.lang ?? "unknown").map(([lang, list]) => (
        <div key={lang}>
          <LanguageGroupHeading code={lang} count={list.length} />
          <ul className="mt-2">
            {list.map((release) => (
              <li
                key={release.id}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line py-2 last:border-b-0"
              >
                <span className="w-20 shrink-0 font-mono text-xs text-muted">
                  {formatCatalogueDate(release.releaseDate) ?? "—"}
                </span>
                <span className="min-w-0 flex-1 text-sm">
                  {release.title ?? release.romaji ?? `Release #${release.id}`}
                </span>
                {release.pages ? (
                  <span className="text-xs text-muted">{release.pages} pp</span>
                ) : null}
                {release.format ? (
                  <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">
                    {FORMAT_LABEL[release.format] ?? release.format}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** Dated releases, grouped by language, newest data first within each language. */