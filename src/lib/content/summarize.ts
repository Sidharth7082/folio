import type { Novel, NovelWithChapters } from "./types";

/** Drop the chapter list so summaries can cross the server/client boundary cheaply. */
export function summarizeNovel(novel: NovelWithChapters): Novel {
  return {
    slug: novel.slug,
    title: novel.title,
    author: novel.author,
    cover: novel.cover,
    synopsis: novel.synopsis,
    genres: novel.genres,
    status: novel.status,
    badges: novel.badges,
    addedAt: novel.addedAt,
    updatedAt: novel.updatedAt,
    chapterCount: novel.chapterCount,
    latestChapter: novel.latestChapter,
  };
}
