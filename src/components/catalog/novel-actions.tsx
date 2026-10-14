"use client";

import Link from "next/link";

import { readerStore, useHydrated, useProgress, useIsInLibrary } from "@/lib/progress";

interface NovelActionsProps {
  novelSlug: string;
  chapterCount: number;
}

export function NovelActions({ novelSlug, chapterCount }: NovelActionsProps) {
  const hydrated = useHydrated();
  const inLibrary = useIsInLibrary(novelSlug);
  const progress = useProgress(novelSlug);

  const resumeIndex =
    hydrated && progress && progress.chapterIndex <= chapterCount ? progress.chapterIndex : null;
  const readIndex = resumeIndex ?? 1;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Link
        href={`/novel/${novelSlug}/${readIndex}`}
        className="sheen group/cta inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-accent-ink transition-transform duration-300 hover:-translate-y-0.5 active:translate-y-0"
      >
        {resumeIndex && resumeIndex > 1 ? `Continue chapter ${resumeIndex}` : "Start reading"}
        <span aria-hidden className="transition-transform duration-300 group-hover/cta:translate-x-0.5">
          →
        </span>
      </Link>

      <button
        type="button"
        onClick={() => readerStore.toggleLibrary(novelSlug)}
        aria-pressed={hydrated ? inLibrary : undefined}
        className={[
          "rounded-xl border px-5 py-2.5 text-sm font-semibold transition-all duration-300 hover:-translate-y-0.5",
          hydrated && inLibrary
            ? "border-accent bg-accent/10 text-accent"
            : "border-line-strong hover:bg-surface-2",
        ].join(" ")}
      >
        {hydrated && inLibrary ? "In library ✓" : "Add to library"}
      </button>

      {hydrated && progress ? (
        <button
          type="button"
          onClick={() => readerStore.clearProgress(novelSlug)}
          className="text-xs text-muted underline-offset-2 hover:text-ink hover:underline"
        >
          Reset progress
        </button>
      ) : null}
    </div>
  );
}
