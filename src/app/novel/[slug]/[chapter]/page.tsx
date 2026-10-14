import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { ReaderShell } from "@/components/reader/reader-shell";
import { getChapter, getNovel, getNovelSlugs } from "@/lib/content/repository";

export async function generateStaticParams() {
  const slugs = await getNovelSlugs();
  const params = await Promise.all(
    slugs.map(async (slug) => {
      const novel = await getNovel(slug);
      return (novel?.chapters ?? []).map((chapter) => ({
        slug,
        chapter: String(chapter.index),
      }));
    }),
  );
  return params.flat();
}

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
