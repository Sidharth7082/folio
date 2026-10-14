import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { Cover } from "@/components/catalog/cover";
import { NovelActions } from "@/components/catalog/novel-actions";
import { getNovel, getNovelSlugs } from "@/lib/content/repository";

const STATUS_LABEL: Record<string, string> = {
  ongoing: "Ongoing",
  completed: "Completed",
  hiatus: "On hiatus",
  unknown: "Status unknown",
};

export async function generateStaticParams() {
  const slugs = await getNovelSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const novel = await getNovel(slug);
  if (!novel) return { title: "Novel not found" };

  return {
    title: novel.title,
    description: novel.synopsis,
  };
}

export default async function NovelPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const novel = await getNovel(slug);
  if (!novel) notFound();

  return (
    <div className="mx-auto w-full max-w-6xl px-5 pb-16">
      <nav aria-label="Breadcrumb" className="pt-6 text-sm text-muted">
        <Link href="/" className="hover:text-ink">
          Home
        </Link>
        <span className="px-2 opacity-50">/</span>
        <Link href="/browse" className="hover:text-ink">
          Browse
        </Link>
        <span className="px-2 opacity-50">/</span>
        <span className="text-ink">{novel.title}</span>
      </nav>

      <header className="mt-6 grid gap-8 sm:grid-cols-[220px_1fr]">
        <div className="relative mx-auto aspect-2/3 w-[200px] overflow-hidden rounded-xl border border-line bg-surface-2 shadow-[var(--shadow)] sm:mx-0 sm:w-full">
          <Cover src={novel.cover} title={novel.title} sizes="220px" priority />
        </div>

        <div>
          <div className="flex flex-wrap items-center gap-2">
            {novel.badges.map((badge) => (
              <span
                key={badge}
                className="rounded-md bg-accent px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-accent-ink"
              >
                {badge}
              </span>
            ))}
            <span className="rounded-md border border-line px-2 py-1 text-[11px] font-medium text-muted">
              {STATUS_LABEL[novel.status] ?? "Unknown"}
            </span>
          </div>

          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            {novel.title}
          </h1>
          <p className="mt-2 text-sm text-muted">
            by {novel.author} · {novel.chapterCount} chapter
            {novel.chapterCount === 1 ? "" : "s"}
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            {novel.genres.map((genre) => (
              <Link
                key={genre}
                href={`/genre/${genre.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                className="rounded-full border border-line px-2.5 py-1 text-xs text-muted transition-colors hover:border-line-strong hover:text-ink"
              >
                {genre}
              </Link>
            ))}
          </div>

          <p className="mt-5 max-w-2xl text-sm leading-6 text-muted">{novel.synopsis}</p>

          <div className="mt-6">
            <NovelActions novelSlug={novel.slug} chapterCount={novel.chapterCount} />
          </div>
        </div>
      </header>

      <section className="mt-12">
        <h2 className="mb-4 text-lg font-semibold tracking-tight">
          Chapters
          <span className="ml-2 text-sm font-normal text-muted">{novel.chapters.length}</span>
        </h2>

        {novel.chapters.length === 0 ? (
          <p className="rounded-xl border border-line bg-surface p-6 text-sm text-muted">
            No chapters have been added to this novel yet.
          </p>
        ) : (
          <ol className="max-h-[32rem] divide-y divide-line overflow-y-auto rounded-xl border border-line bg-surface">
            {novel.chapters.map((chapter) => (
              <li key={chapter.slug}>
                <Link
                  href={`/novel/${novel.slug}/${chapter.index}`}
                  className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-surface-2"
                >
                  <span className="w-10 shrink-0 text-xs tabular-nums text-muted">
                    {String(chapter.index).padStart(3, "0")}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">{chapter.title}</span>
                  <span className="shrink-0 text-xs text-muted">
                    {chapter.wordCount.toLocaleString()} words
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
