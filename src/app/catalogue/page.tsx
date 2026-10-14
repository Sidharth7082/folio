import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";

import { SeriesCard } from "@/components/catalogue/series-card";
import { hasCatalogue } from "@/lib/catalogue/db";
import { catalogueStats, listCatalogueTags, searchCatalogue } from "@/lib/catalogue/queries";
import { apiSearchSeries } from "@/lib/catalogue/ranobedb-api";
import type { CatalogueSort } from "@/lib/catalogue/types";

export const metadata: Metadata = {
  title: "Catalogue",
  description:
    "A searchable light-novel catalogue built from the RanobeDB open database (metadata only).",
};

const PAGE_SIZE = 24;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const STATUS_OPTIONS = [
  { value: "", label: "All" },
  { value: "ongoing", label: "Ongoing" },
  { value: "completed", label: "Completed" },
  { value: "unknown", label: "Unknown" },
];

const SORT_OPTIONS: { value: CatalogueSort; label: string }[] = [
  { value: "books", label: "Most books" },
  { value: "title", label: "Title A–Z" },
  { value: "newest", label: "Newest" },
];

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function buildHref(params: Record<string, string>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const query = search.toString();
  return query ? `/catalogue?${query}` : "/catalogue";
}

export default async function CataloguePage({ searchParams }: { searchParams: SearchParams }) {
  const local = hasCatalogue();
  const stats = local ? catalogueStats() : null;

  return (
    <div className="mx-auto w-full max-w-6xl px-5 pb-16">
      <header className="pt-10">
        <h1 className="text-3xl font-semibold tracking-tight">Catalogue</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
          {stats ? `${stats.series.toLocaleString()} light-novel series from the ` : "Light-novel series from the "}
          <span className="text-ink">RanobeDB</span> open database — titles, authors, tags and
          dates. This is bibliographic metadata: it contains{" "}
          <span className="text-ink">no novel text</span>. Series you have the rights to read live
          under <span className="text-ink">Browse</span>.
        </p>
      </header>

      <Suspense fallback={<p className="mt-10 text-sm text-muted">Loading catalogue…</p>}>
        {local ? (
          <CatalogueBrowser searchParams={searchParams} />
        ) : (
          <LiveCatalogueBrowser searchParams={searchParams} />
        )}
      </Suspense>

      <footer className="mt-14 border-t border-line pt-6 text-xs leading-5 text-muted">
        <p>
          Catalogue data from{" "}
          <a
            className="text-accent hover:underline"
            href="https://ranobedb.org"
            target="_blank"
            rel="noreferrer noopener"
          >
            RanobeDB
          </a>
          , licensed{" "}
          <abbr title="Open Database License">ODbL-1.0</abbr> (database) and{" "}
          <abbr title="Database Contents License">DbCL-1.0</abbr> (contents). Attribution required.
        </p>
        {stats?.generatedAt ? (
          <p className="mt-1">
            Imported {stats.generatedAt.slice(0, 10)}
            {stats.sourceFile ? ` from ${stats.sourceFile}` : ""}.
          </p>
        ) : null}
      </footer>
    </div>
  );
}

async function CatalogueBrowser({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const q = first(params.q);
  const tag = first(params.tag);
  const status = first(params.status);
  const sort = first(params.sort) as CatalogueSort;
  const requestedPage = Number.parseInt(first(params.page), 10) || 1;

  const tags = listCatalogueTags(24);
  const result = searchCatalogue({ q, tag, status, sort, page: requestedPage, pageSize: PAGE_SIZE });

  const base = { q, tag, status, sort };

  return (
    <div>
      <form action="/catalogue" method="get" className="mt-8 flex flex-wrap items-center gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search title, author, or tag…"
          aria-label="Search the catalogue"
          className="min-w-64 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-line-strong"
        />
        {tag ? <input type="hidden" name="tag" value={tag} /> : null}
        <select
          name="sort"
          defaultValue={sort || "books"}
          aria-label="Sort order"
          className="rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-line-strong"
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          name="status"
          defaultValue={status}
          aria-label="Publication status"
          className="rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-line-strong"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value || "all"} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink"
        >
          Search
        </button>
      </form>

      {tags.length > 0 ? (
        <div className="mt-5 flex flex-wrap gap-2">
          {tag ? (
            <Link
              href={buildHref({ ...base, tag: "", page: "" })}
              className="rounded-full border border-accent bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink"
            >
              {tag} ✕
            </Link>
          ) : null}
          {tags
            .filter((entry) => entry.name !== tag)
            .map((entry) => (
              <Link
                key={entry.name}
                href={buildHref({ ...base, tag: entry.name, page: "" })}
                className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm text-muted transition-colors hover:border-line-strong hover:text-ink"
              >
                {entry.name}
                <span className="ml-1.5 opacity-50">{entry.count}</span>
              </Link>
            ))}
        </div>
      ) : null}

      <p className="mt-6 text-sm text-muted">
        {result.total.toLocaleString()} series
        {q ? ` matching “${q}”` : ""}
        {tag ? ` tagged ${tag}` : ""}
        {result.total > 0 ? ` · page ${result.page} of ${result.totalPages}` : ""}
      </p>

      {result.items.length === 0 ? (
        <p className="mt-6 rounded-xl border border-line bg-surface p-6 text-sm text-muted">
          Nothing matched. Try a different spelling, or clear the filters.
        </p>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
          {result.items.map((series) => (
            <SeriesCard
              key={series.id}
              id={series.id}
              title={series.title}
              authors={series.authors}
              numBooks={series.numBooks}
              status={series.status}
              startDate={series.startDate}
              coverFilename={series.coverFilename}
            />
          ))}
        </div>
      )}

      {result.totalPages > 1 ? (
        <nav
          aria-label="Pagination"
          className="mt-10 flex items-center justify-between gap-4 text-sm"
        >
          {result.page > 1 ? (
            <Link
              href={buildHref({ ...base, page: String(result.page - 1) })}
              className="rounded-lg border border-line px-4 py-2 font-medium transition-colors hover:border-line-strong"
            >
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted">
            Page {result.page} / {result.totalPages.toLocaleString()}
          </span>
          {result.page < result.totalPages ? (
            <Link
              href={buildHref({ ...base, page: String(result.page + 1) })}
              className="rounded-lg border border-line px-4 py-2 font-medium transition-colors hover:border-line-strong"
            >
              Next →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}

/** Local sort keys map onto the API's own sort vocabulary. */
const API_SORT: Record<CatalogueSort, string> = {
  books: "Num. books desc",
  title: "Title asc",
  newest: "Start date desc",
};

/**
 * Read-only browsing straight from the RanobeDB API, used when no local dump
 * has been imported. Slower than the SQLite path and limited to one API page at
 * a time, but it means the catalogue works out of the box.
 */
async function LiveCatalogueBrowser({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const q = first(params.q);
  const status = first(params.status);
  const sort = first(params.sort) as CatalogueSort;
  const requestedPage = Number.parseInt(first(params.page), 10) || 1;

  const result = await apiSearchSeries({
    q,
    page: requestedPage,
    limit: PAGE_SIZE,
    pubStatus: status || undefined,
    sort: API_SORT[sort] ?? API_SORT.books,
  });

  if (!result) return <CatalogueNotImported />;

  const base = { q, status, sort };

  return (
    <div>
      <p className="mt-8 rounded-xl border border-line bg-surface p-4 text-xs leading-5 text-muted">
        <span className="font-medium text-ink">Live API mode.</span> No local dump was imported, so
        these results come straight from the RanobeDB API. Import a dump for offline, full-catalogue
        browsing with tag filters.
      </p>

      <form action="/catalogue" method="get" className="mt-5 flex flex-wrap items-center gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search titles…"
          aria-label="Search the catalogue"
          className="min-w-64 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-line-strong"
        />
        <select
          name="sort"
          defaultValue={sort || "books"}
          aria-label="Sort order"
          className="rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-line-strong"
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          name="status"
          defaultValue={status}
          aria-label="Publication status"
          className="rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-line-strong"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value || "all"} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink"
        >
          Search
        </button>
      </form>

      <p className="mt-6 text-sm text-muted">
        {result.total.toLocaleString()} series
        {q ? ` matching “${q}”` : ""} · page {result.page} of {result.totalPages.toLocaleString()}
      </p>

      {result.items.length === 0 ? (
        <p className="mt-6 rounded-xl border border-line bg-surface p-6 text-sm text-muted">
          Nothing matched. Try a different spelling, or clear the filters.
        </p>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
          {result.items.map((series) => (
            <SeriesCard
              key={series.id}
              id={series.id}
              title={series.title}
              numBooks={series.numBooks}
              startDate={series.startDate}
              coverFilename={series.coverFilename}
              showCover={!series.coverIsNsfw}
            />
          ))}
        </div>
      )}

      {result.totalPages > 1 ? (
        <nav aria-label="Pagination" className="mt-10 flex items-center justify-between gap-4 text-sm">
          {result.page > 1 ? (
            <Link
              href={buildHref({ ...base, page: String(result.page - 1) })}
              className="rounded-lg border border-line px-4 py-2 font-medium transition-colors hover:border-line-strong"
            >
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted">
            Page {result.page} / {result.totalPages.toLocaleString()}
          </span>
          {result.page < result.totalPages ? (
            <Link
              href={buildHref({ ...base, page: String(result.page + 1) })}
              className="rounded-lg border border-line px-4 py-2 font-medium transition-colors hover:border-line-strong"
            >
              Next →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}

function CatalogueNotImported() {
  return (
    <div className="mt-10 max-w-3xl">
      <h2 className="text-xl font-semibold tracking-tight">
        Catalogue unavailable
      </h2>
      <p className="mt-3 text-sm leading-6 text-muted">
        No local catalogue was found at{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5">data/catalogue.db</code>, and the
        RanobeDB API could not be reached. Browse works offline either way.
      </p>
      <ol className="mt-6 space-y-3 text-sm text-muted">
        <li>
          <span className="font-medium text-ink">1.</span> Download a dump from{" "}
          <a
            className="text-accent hover:underline"
            href="https://ranobedb.org/database-dumps"
            target="_blank"
            rel="noreferrer noopener"
          >
            ranobedb.org/database-dumps
          </a>
          .
        </li>
        <li>
          <span className="font-medium text-ink">2.</span> Import it:
          <code className="mt-2 block rounded bg-surface-2 px-3 py-2">
            npm run catalogue:import -- ~/Downloads/rndb-db-public-latest.dump.gz
          </code>
        </li>
        <li>
          <span className="font-medium text-ink">3.</span> Reload this page.
        </li>
      </ol>
      <p className="mt-6 text-xs leading-5 text-muted">
        RanobeDB is metadata only — importing it adds a catalogue to browse, not novels to read.
      </p>
    </div>
  );
}
