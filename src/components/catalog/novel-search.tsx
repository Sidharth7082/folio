"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { NovelGrid } from "@/components/catalog/novel-grid";
import type { Novel } from "@/lib/content/types";

interface NovelSearchProps {
  novels: Novel[];
}

export function NovelSearch({ novels }: NovelSearchProps) {
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return novels;

    return novels.filter((novel) =>
      [novel.title, novel.author, ...novel.genres]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [novels, query]);

  return (
    <div>
      <input
        type="search"
        autoFocus
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search by title, author, or genre…"
        aria-label="Search the library"
        className="w-full rounded-xl border border-line bg-surface px-4 py-3 text-sm outline-none placeholder:text-muted focus:border-line-strong"
      />

      <p className="mt-4 text-sm text-muted">
        {results.length} result{results.length === 1 ? "" : "s"}
        {query.trim() ? ` for “${query.trim()}”` : ""}
      </p>

      <div className="mt-6">
        {results.length === 0 ? (
          <div className="rounded-xl border border-line bg-surface p-6 text-sm leading-6">
            <p className="text-muted">Nothing in your library matched that.</p>
            {query.trim() ? (
              /*
               * Searching for a novel you have not added is the common case, and
               * "0 results" on its own reads as a broken search. Say what was
               * searched, and point at the catalogue, which is where a series you
               * do not own actually lives.
               */
              <p className="mt-3 text-muted">
                This searches only the books you have added, which is {novels.length} right now.
                To look for something to read, try the catalogue of ~23,000 series:{" "}
                <Link
                  href={`/catalogue?q=${encodeURIComponent(query.trim())}`}
                  className="text-accent hover:underline"
                >
                  search the catalogue for “{query.trim()}”
                </Link>
                .
              </p>
            ) : null}
          </div>
        ) : (
          <NovelGrid novels={results} priorityCount={4} />
        )}
      </div>
    </div>
  );
}
