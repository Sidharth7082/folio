"use client";

import Link from "next/link";

import { Cover } from "@/components/catalog/cover";
import { NovelGrid } from "@/components/catalog/novel-grid";
import { useHydrated, useReaderState } from "@/lib/progress";
import type { Novel } from "@/lib/content/types";

interface LibraryViewProps {
  novels: Novel[];
}

export function LibraryView({ novels }: LibraryViewProps) {
  const hydrated = useHydrated();
  const { library, progress } = useReaderState();

  if (!hydrated) {
    return <p className="mt-8 text-sm text-muted">Loading your library…</p>;
  }

  const bySlug = new Map(novels.map((novel) => [novel.slug, novel]));
  const saved = library.map((slug) => bySlug.get(slug)).filter((novel): novel is Novel => !!novel);

  const inProgress = Object.values(progress)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((entry) => ({ entry, novel: bySlug.get(entry.novelSlug) }))
    .filter(
      (item): item is { entry: (typeof progress)[string]; novel: Novel } => item.novel !== undefined,
    );

  if (saved.length === 0 && inProgress.length === 0) {
    return (
      <p className="mt-8 rounded-xl border border-line bg-surface p-6 text-sm text-muted">
        Your library is empty. Use{" "}
        <span className="text-ink">Add to library</span> on any novel, or start reading and it will
        show up here.
      </p>
    );
  }

  return (
    <div className="space-y-14">
      {inProgress.length > 0 ? (
        <section>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-muted">
            In progress
          </h2>
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
            {inProgress.map(({ entry, novel }) => (
              <li key={novel.slug} className="flex items-center gap-4 p-4 hover:bg-surface-2">
                <div className="relative h-16 w-11 shrink-0 overflow-hidden rounded-md bg-surface-2">
                  <Cover src={novel.cover} title={novel.title} sizes="44px" />
                </div>
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/novel/${novel.slug}`}
                    className="truncate text-sm font-semibold hover:text-accent"
                  >
                    {novel.title}
                  </Link>
                  <p className="mt-0.5 truncate text-xs text-muted">
                    Chapter {entry.chapterIndex} · {Math.round(entry.offset * 100)}% through
                  </p>
                </div>
                <Link
                  href={`/novel/${novel.slug}/${entry.chapterIndex}`}
                  className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink"
                >
                  Resume
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {saved.length > 0 ? (
        <section>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-muted">
            Saved ({saved.length})
          </h2>
          <NovelGrid novels={saved} />
        </section>
      ) : null}
    </div>
  );
}
