"use client";

import Link from "next/link";

import { Cover } from "@/components/catalog/cover";
import { SectionRow } from "@/components/catalog/novel-grid";
import { Shelf, ShelfItem } from "@/components/home/shelf";
import { useContinueReading, useHydrated } from "@/lib/progress/hooks";
import type { Novel } from "@/lib/content/types";

interface ContinueReadingProps {
  novels: Novel[];
}

/**
 * Shows in-progress novels with a per-title progress bar.
 *
 * Rendered on the client only, because reading progress lives in the browser.
 * The whole section — heading included — disappears when there is nothing to
 * resume, so the home page never shows an orphaned heading.
 */
export function ContinueReading({ novels }: ContinueReadingProps) {
  const hydrated = useHydrated();
  const entries = useContinueReading(8);

  if (!hydrated || entries.length === 0) return null;

  const bySlug = new Map(novels.map((novel) => [novel.slug, novel]));

  return (
    <SectionRow title="Continue reading" kicker="Pick up where you left off">
      <Shelf>
        {entries.map((entry) => {
          const novel = bySlug.get(entry.novelSlug);
          if (!novel) return null;

          const percent = Math.round(Math.min(1, Math.max(0, entry.offset)) * 100);

          return (
            <ShelfItem key={entry.novelSlug}>
              <Link
                href={`/novel/${novel.slug}/${entry.chapterIndex}`}
                className="group block focus-visible:outline-none"
              >
                <div className="lift relative aspect-2/3 w-full overflow-hidden rounded-xl border border-line bg-surface-2 shadow-[var(--shadow)]">
                  <Cover src={novel.cover} title={novel.title} sizes="176px" />
                  <span className="absolute bottom-2 left-2 rounded-md bg-black/65 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
                    Ch. {entry.chapterIndex}
                  </span>
                </div>

                <div className="mt-3 min-w-0">
                  <p className="truncate text-sm font-semibold transition-colors duration-300 group-hover:text-accent">
                    {novel.title}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted">
                    {entry.chapterTitle || `Chapter ${entry.chapterIndex}`}
                  </p>

                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-2">
                      <div
                        className="h-full rounded-full bg-accent transition-[width] duration-700 ease-out"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                    <span className="text-[11px] tabular-nums text-muted">{percent}%</span>
                  </div>
                </div>
              </Link>
            </ShelfItem>
          );
        })}
      </Shelf>
    </SectionRow>
  );
}
