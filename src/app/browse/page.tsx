import type { Metadata } from "next";

import { GenreChips } from "@/components/catalog/genre-chips";
import { NovelGrid } from "@/components/catalog/novel-grid";
import { listGenres, listNovels } from "@/lib/content/repository";
import { summarizeNovel } from "@/lib/content/summarize";

export const metadata: Metadata = {
  title: "Browse",
  description: "Every novel in the library.",
};

export default async function BrowsePage() {
  const novels = await listNovels();
  const genres = await listGenres();

  return (
    <div className="mx-auto w-full max-w-6xl px-5 pb-16">
      <header className="pt-10">
        <h1 className="text-3xl font-semibold tracking-tight">Browse</h1>
        <p className="mt-2 text-sm text-muted">
          {novels.length} novel{novels.length === 1 ? "" : "s"} in the library.
        </p>
      </header>

      {genres.length > 0 ? (
        <div className="mt-6">
          <GenreChips genres={genres} />
        </div>
      ) : null}

      <div className="mt-10">
        {novels.length === 0 ? (
          <p className="rounded-xl border border-line bg-surface p-6 text-sm text-muted">
            Nothing here yet. Add content to the <code>content/</code> directory.
          </p>
        ) : (
          <NovelGrid novels={novels.map(summarizeNovel)} priorityCount={4} />
        )}
      </div>
    </div>
  );
}
