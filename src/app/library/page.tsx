import type { Metadata } from "next";

import { LibraryView } from "@/components/catalog/library-view";
import { listNovels } from "@/lib/content/repository";
import { summarizeNovel } from "@/lib/content/summarize";

export const metadata: Metadata = {
  title: "Library",
  description: "Saved novels and reading progress.",
};

export default async function LibraryPage() {
  const novels = await listNovels();

  return (
    <div className="mx-auto w-full max-w-6xl px-5 pb-16">
      <header className="pt-10">
        <h1 className="text-3xl font-semibold tracking-tight">Library</h1>
        <p className="mt-2 text-sm text-muted">
          Stored in this browser. Nothing leaves your device.
        </p>
      </header>

      <div className="mt-8">
        <LibraryView novels={novels.map(summarizeNovel)} />
      </div>
    </div>
  );
}
