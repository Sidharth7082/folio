import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { ReaderShell } from "@/components/reader/reader-shell";
import { getChapter } from "@/lib/content/repository";

/**
 * Chapters are deliberately not prerendered.
 *
 * The library is whatever the reader has imported, so the full chapter list only
 * exists once the files are on disk. Enumerating it at build time produced one
 * prerendered page per chapter — 2,424 pages and 1.7 GB of build output for a
 * two-book library — and scaled with every book added.
 *
 * `getChapter` is cached, so the first request for a chapter pays for the render
 * and later ones are served from the cache, which is the same deal without the
 * build-time cost.
 *
 * `instant = false` marks the route as intentionally blocking, which it has to
 * be: there is no chapter to show until the file has been read.
 */
export const instant = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; chapter: string }>;
}): Promise<Metadata> {
  const { slug, chapter } = await params;
  const result = await getChapter(slug, Number.parseInt(chapter, 10));
  if (!result) return { title: "Chapter not found" };

  return {
    title: `${result.novel.title} — ${result.chapter.title}`,
  };
}

export default async function ChapterPage({
  params,
}: {
  params: Promise<{ slug: string; chapter: string }>;
}) {
  const { slug, chapter } = await params;
  const index = Number.parseInt(chapter, 10);
  if (!Number.isFinite(index)) notFound();

  const result = await getChapter(slug, index);
  if (!result) notFound();

  return (
    <ReaderShell
      novelSlug={result.novel.slug}
      novelTitle={result.novel.title}
      chapter={result.chapter}
      chapters={result.novel.chapters}
    />
  );
}
