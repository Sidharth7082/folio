"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { ReaderSettings } from "@/components/reader/reader-settings";
import { TocDrawer } from "@/components/reader/toc-drawer";
import { readerStore, useReaderSettings } from "@/lib/progress";
import type { Chapter, ChapterMeta } from "@/lib/content/types";

interface ReaderShellProps {
  novelSlug: string;
  novelTitle: string;
  chapter: Chapter;
  chapters: ChapterMeta[];
}

export function ReaderShell({ novelSlug, novelTitle, chapter, chapters }: ReaderShellProps) {
  const router = useRouter();
  const settings = useReaderSettings();

  const [tocOpen, setTocOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scrollPct, setScrollPct] = useState(0);
  const [showTop, setShowTop] = useState(false);

  const prevIndex = chapter.index > 1 ? chapter.index - 1 : null;
  const nextIndex = chapter.index < chapters.length ? chapter.index + 1 : null;

  const currentTitle = chapter.title;

  /* Restore the saved position for this chapter, then record that we are here. */
  useEffect(() => {
    const saved = readerStore.getProgress(novelSlug);
    const sameChapter = saved?.chapterIndex === chapter.index;
    const targetOffset = sameChapter && saved ? saved.offset : 0;

    readerStore.recordProgress({
      novelSlug,
      chapterIndex: chapter.index,
      chapterTitle: currentTitle,
      offset: targetOffset,
    });

    let first = 0;
    let second = 0;
    first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        const maxScroll = Math.max(
          0,
          document.documentElement.scrollHeight - window.innerHeight,
        );
        window.scrollTo({ top: Math.round(targetOffset * maxScroll), behavior: "instant" });
        setScrollPct(targetOffset);
      });
    });

    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [novelSlug, chapter.index, currentTitle]);

  /* Persist scroll position, throttled to animation frames and a trailing timeout. */
  useEffect(() => {
    let frame = 0;
    let saveTimer: ReturnType<typeof setTimeout> | undefined;

    const ratio = () => {
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      if (maxScroll <= 0) return 0;
      return Math.min(1, Math.max(0, window.scrollY / maxScroll));
    };

    const persist = () => {
      readerStore.recordProgress({
        novelSlug,
        chapterIndex: chapter.index,
        chapterTitle: currentTitle,
        offset: ratio(),
      });
    };

    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const value = ratio();
        setScrollPct(value);
        setShowTop(value > 0.25);

        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(persist, 400);
      });
    };

    const flush = () => {
      if (saveTimer) clearTimeout(saveTimer);
      persist();
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", flush);

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", flush);
      if (frame) cancelAnimationFrame(frame);
      if (saveTimer) clearTimeout(saveTimer);
      flush();
    };
  }, [novelSlug, chapter.index, currentTitle]);

  const go = useCallback(
    (index: number | null) => {
      if (index === null) return;
      router.push(`/novel/${novelSlug}/${index}`);
    },
    [novelSlug, router],
  );

  /* Keyboard shortcuts: arrows or j/k to move, Escape to dismiss overlays. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      switch (event.key) {
        case "Escape":
          setTocOpen(false);
          setSettingsOpen(false);
          break;
        case "ArrowRight":
        case "l":
          go(nextIndex);
          break;
        case "ArrowLeft":
        case "h":
          go(prevIndex);
          break;
        case "t":
          setTocOpen((open) => !open);
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, nextIndex, prevIndex]);

  const proseStyle: React.CSSProperties = {
    fontFamily:
      settings.font === "serif"
        ? "var(--font-serif)"
        : "var(--font-geist-sans), system-ui, sans-serif",
    fontSize: `${settings.fontSize}px`,
    lineHeight: settings.lineHeight,
    maxWidth: `${settings.width}ch`,
    textAlign: settings.align,
  };

  return (
    <div
      data-reader-theme={settings.theme}
      className="min-h-screen bg-[var(--reader-bg)] text-[var(--reader-fg)]"
    >
      {/* Reading progress */}
      <div
        className="fixed left-0 top-0 z-40 h-0.5 bg-accent transition-[width] duration-150"
        style={{ width: `${scrollPct * 100}%` }}
        aria-hidden
      />

      <div className="sticky top-16 z-30 border-b border-[var(--reader-rule)] bg-[var(--reader-bg)]/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-2 px-4 py-2.5">
          <button
            type="button"
            onClick={() => setTocOpen(true)}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-[var(--reader-rule)]"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 6h16M4 12h16M4 18h10" strokeLinecap="round" />
            </svg>
            Chapters
          </button>

          <div className="min-w-0 flex-1 text-center">
            <Link
              href={`/novel/${novelSlug}`}
              className="block truncate text-xs font-medium text-[var(--reader-fg-muted)] hover:text-accent"
            >
              {novelTitle}
            </Link>
            <p className="truncate text-sm font-semibold">{currentTitle}</p>
          </div>

          <div className="relative flex items-center gap-1">
            <button
              type="button"
              onClick={() => go(prevIndex)}
              disabled={prevIndex === null}
              aria-label="Previous chapter"
              className="rounded-lg px-2.5 py-2 text-sm transition-colors hover:bg-[var(--reader-rule)] disabled:opacity-30"
            >
              ←
            </button>
            <button
              type="button"
              onClick={() => go(nextIndex)}
              disabled={nextIndex === null}
              aria-label="Next chapter"
              className="rounded-lg px-2.5 py-2 text-sm transition-colors hover:bg-[var(--reader-rule)] disabled:opacity-30"
            >
              →
            </button>
            <button
              type="button"
              onClick={() => setSettingsOpen((open) => !open)}
              aria-label="Reading settings"
              aria-expanded={settingsOpen}
              className="rounded-lg px-2.5 py-2 text-sm transition-colors hover:bg-[var(--reader-rule)]"
            >
              Aa
            </button>

            <ReaderSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
          </div>
        </div>
      </div>

      <article className="mx-auto w-full px-5 pb-24 pt-12">
        <header className="mx-auto" style={{ maxWidth: `${settings.width}ch` }}>
          <p className="text-xs font-medium uppercase tracking-widest text-[var(--reader-fg-muted)]">
            Chapter {chapter.index}
          </p>
          <h1 className="mt-2 font-semibold tracking-tight" style={{ fontSize: "1.6em" }}>
            {currentTitle}
          </h1>
          <p className="mt-2 text-xs text-[var(--reader-fg-muted)]">
            {chapter.wordCount.toLocaleString()} words
            {chapter.wordCount > 0
              ? ` · ~${Math.max(1, Math.round(chapter.wordCount / 220))} min read`
              : ""}
          </p>
          <hr className="mt-6 border-[var(--reader-rule)]" />
        </header>

        <div className="reader-prose mx-auto mt-8" style={proseStyle}>
          {chapter.paragraphs.map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </div>

        <nav className="mx-auto mt-16 flex flex-col gap-3 sm:flex-row" style={{ maxWidth: `${settings.width}ch` }}>
          {prevIndex !== null ? (
            <Link
              href={`/novel/${novelSlug}/${prevIndex}`}
              className="flex-1 rounded-xl border border-[var(--reader-rule)] p-4 transition-colors hover:bg-[var(--reader-rule)]"
            >
              <span className="text-xs text-[var(--reader-fg-muted)]">← Previous</span>
              <span className="mt-1 block truncate text-sm font-medium">
                {chapters[prevIndex - 1]?.title ?? `Chapter ${prevIndex}`}
              </span>
            </Link>
          ) : (
            <span className="hidden flex-1 sm:block" />
          )}

          {nextIndex !== null ? (
            <Link
              href={`/novel/${novelSlug}/${nextIndex}`}
              className="flex-1 rounded-xl border border-[var(--reader-rule)] p-4 text-right transition-colors hover:bg-[var(--reader-rule)]"
            >
              <span className="text-xs text-[var(--reader-fg-muted)]">Next →</span>
              <span className="mt-1 block truncate text-sm font-medium">
                {chapters[nextIndex - 1]?.title ?? `Chapter ${nextIndex}`}
              </span>
            </Link>
          ) : (
            <span className="flex-1 rounded-xl border border-[var(--reader-rule)] p-4 text-right text-sm text-[var(--reader-fg-muted)]">
              You have reached the latest chapter.
            </span>
          )}
        </nav>
      </article>

      {showTop ? (
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="fixed bottom-6 right-6 z-30 rounded-full border border-[var(--reader-rule)] bg-[var(--reader-bg)]/90 px-4 py-2 text-xs font-medium shadow-lg backdrop-blur transition-colors hover:bg-[var(--reader-rule)]"
        >
          Top ↑
        </button>
      ) : null}

      <TocDrawer
        novelSlug={novelSlug}
        chapters={chapters}
        currentIndex={chapter.index}
        open={tocOpen}
        onClose={() => setTocOpen(false)}
      />
    </div>
  );
}
