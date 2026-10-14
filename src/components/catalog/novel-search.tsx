"use client";

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
          <p className="rounded-xl border border-line bg-surface p-6 text-sm text-muted">
            Nothing matched that search.
          </p>
        ) : (
          <NovelGrid novels={results} priorityCount={4} />
        )}
      </div>
    </div>
  );
}
