"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type { ChapterMeta } from "@/lib/content/types";

interface TocDrawerProps {
  novelSlug: string;
  chapters: ChapterMeta[];
  currentIndex: number;
  open: boolean;
  onClose: () => void;
}

export function TocDrawer({
  novelSlug,
  chapters,
  currentIndex,
  open,
  onClose,
}: TocDrawerProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return chapters;
    return chapters.filter(
      (chapter) =>
        chapter.title.toLowerCase().includes(needle) ||
        String(chapter.index).includes(needle),
    );
  }, [chapters, query]);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />

      <aside
        role="dialog"
        aria-label="Table of contents"
        className="fixed inset-y-0 left-0 z-50 flex w-[min(22rem,88vw)] flex-col border-r border-[var(--reader-border)] bg-[var(--reader-surface)] text-[var(--reader-fg)] shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-[var(--reader-border)] p-4">
          <p className="text-sm font-semibold">
            Chapters
            <span className="ml-2 font-normal text-[var(--reader-fg-muted)]">
              {chapters.length}
            </span>
          </p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-xs text-[var(--reader-fg-muted)] hover:bg-[var(--reader-surface-2)] hover:text-[var(--reader-fg)]"
          >
            Close
          </button>
        </div>

        <div className="border-b border-[var(--reader-border)] p-3">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter chapters…"
            className="w-full rounded-lg border border-[var(--reader-border)] bg-[var(--reader-surface-2)] px-3 py-2 text-sm outline-none placeholder:text-[var(--reader-fg-muted)] focus:border-[var(--reader-border)]"
          />
        </div>

        <nav className="flex-1 overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <p className="p-4 text-sm text-[var(--reader-fg-muted)]">
              No chapters match that filter.
            </p>
          ) : (
            <ul>
              {filtered.map((chapter) => {
                const active = chapter.index === currentIndex;
                return (
                  <li key={chapter.slug}>
                    <Link
                      href={`/novel/${novelSlug}/${chapter.index}`}
                      onClick={onClose}
                      aria-current={active ? "page" : undefined}
                      className={[
                        "block rounded-lg px-3 py-2 text-sm transition-colors",
                        active
                          ? "bg-accent text-accent-ink font-medium"
                          : "text-[var(--reader-fg-muted)] hover:bg-[var(--reader-surface-2)] hover:text-[var(--reader-fg)]",
                      ].join(" ")}
                    >
                      <span className="mr-2 tabular-nums opacity-70">
                        {String(chapter.index).padStart(2, "0")}
                      </span>
                      {chapter.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </nav>
      </aside>
    </>
  );
}
