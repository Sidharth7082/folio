import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { GenreChips } from "@/components/catalog/genre-chips";
import { NovelGrid } from "@/components/catalog/novel-grid";
import { getNovelsByGenre, listGenres } from "@/lib/content/repository";
import { summarizeNovel } from "@/lib/content/summarize";

export async function generateStaticParams() {
  const genres = await listGenres();
  return genres.map((genre) => ({ tag: genre.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tag: string }>;
}): Promise<Metadata> {
  const { tag } = await params;
  const genres = await listGenres();
  const genre = genres.find((entry) => entry.slug === tag);
  return { title: genre ? genre.tag : "Genre" };
}

export default async function GenrePage({ params }: { params: Promise<{ tag: string }> }) {
  const { tag } = await params;
  const [genres, novels] = await Promise.all([listGenres(), getNovelsByGenre(tag)]);
  const genre = genres.find((entry) => entry.slug === tag);
  if (!genre) notFound();

  return (
    <div className="mx-auto w-full max-w-6xl px-5 pb-16">
      <header className="pt-10">
        <h1 className="text-3xl font-semibold tracking-tight">{genre.tag}</h1>
        <p className="mt-2 text-sm text-muted">
          {novels.length} novel{novels.length === 1 ? "" : "s"} tagged {genre.tag}.
        </p>
      </header>

      <div className="mt-6">
        <GenreChips genres={genres} activeSlug={genre.slug} />
      </div>

      <div className="mt-10">
        <NovelGrid novels={novels.map(summarizeNovel)} priorityCount={4} />
      </div>
    </div>
  );
}
