import type { Metadata } from "next";

import { NovelSearch } from "@/components/catalog/novel-search";
import { listNovels } from "@/lib/content/repository";
import { summarizeNovel } from "@/lib/content/summarize";

export const metadata: Metadata = {
  title: "Search",
  description: "Search the library by title, author, or genre.",
};

export default async function SearchPage() {
  const novels = await listNovels();

  return (
    <div className="mx-auto w-full max-w-6xl px-5 pb-16">
      <header className="pt-10">
        <h1 className="text-3xl font-semibold tracking-tight">Search</h1>
      </header>

      <div className="mt-8">
        <NovelSearch novels={novels.map(summarizeNovel)} />
      </div>
    </div>
  );
}
