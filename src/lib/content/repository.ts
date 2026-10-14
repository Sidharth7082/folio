/**
 * Server-side content repository.
 *
 * Reads novels from `content/<slug>/` on disk. All public functions are
 * wrapped in the `use cache` directive so they participate in Next.js's
 * prerendered static shell — the content is immutable build input, never
 * request-dependent.
 *
 * Layout:
 *   content/<slug>/novel.json     -> metadata
 *   content/<slug>/chapters/*.md  -> one file per chapter, ordered by name
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { cacheLife, cacheTag } from "next/cache";

import {
  countWords,
  parseChapterSource,
  slugify,
  splitParagraphs,
  titleFromFileName,
} from "./parse";
import type {
  Chapter,
  ChapterMeta,
  NovelFile,
  NovelStatus,
  NovelWithChapters,
} from "./types";

const CONTENT_DIR = path.join(process.cwd(), "content");
const CHAPTER_DIR = "chapters";
const CHAPTER_EXTENSIONS = new Set([".md", ".markdown", ".txt"]);

const EMPTY_SYNOPSIS = "No synopsis has been provided for this title yet.";

async function listDirectory(dir: string) {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function readText(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
}

function normaliseStatus(value: string | undefined): NovelStatus {
  switch ((value ?? "").toLowerCase()) {
    case "ongoing":
    case "completed":
    case "hiatus":
      return value!.toLowerCase() as NovelStatus;
    default:
      return "unknown";
  }
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** Read and order the chapter files for one novel. */
async function readChapterSources(slug: string) {
  const dir = path.join(CONTENT_DIR, slug, CHAPTER_DIR);
  const entries = await listDirectory(dir);

  const files = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        CHAPTER_EXTENSIONS.has(path.extname(entry.name).toLowerCase()),
    )
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));

  return files;
}

async function buildChapterMetas(slug: string): Promise<ChapterMeta[]> {
  const files = await readChapterSources(slug);
  const metas: ChapterMeta[] = [];

  for (const [position, fileName] of files.entries()) {
    const raw = await readText(path.join(CONTENT_DIR, slug, CHAPTER_DIR, fileName));
    if (raw === null) continue;

    const parsed = parseChapterSource(raw);
    const paragraphs = splitParagraphs(parsed.text);
    metas.push({
      index: position + 1,
      slug: fileName.replace(/\.[^.]+$/, ""),
      title: parsed.title ?? titleFromFileName(fileName),
      wordCount: countWords(paragraphs),
    });
  }

  return metas;
}

async function loadNovel(slug: string): Promise<NovelWithChapters | null> {
  const raw = await readText(path.join(CONTENT_DIR, slug, "novel.json"));
  if (raw === null) return null;

  let file: NovelFile;
  try {
    file = JSON.parse(raw) as NovelFile;
  } catch {
    return null;
  }

  const chapters = await buildChapterMetas(slug);
  const latestChapter = chapters.length > 0 ? chapters[chapters.length - 1] : null;

  return {
    slug,
    title: file.title?.trim() || slug,
    author: file.author?.trim() || "Unknown author",
    cover: file.cover?.trim() || null,
    synopsis: file.synopsis?.trim() || EMPTY_SYNOPSIS,
    genres: asStringArray(file.genres),
    status: normaliseStatus(file.status),
    badges: asStringArray(file.badges),
    addedAt: file.addedAt?.trim() || "",
    updatedAt: file.updatedAt?.trim() || file.addedAt?.trim() || "",
    chapterCount: chapters.length,
    latestChapter,
    chapters,
  };
}

/** Every novel slug present on disk, alphabetically. */
export async function getNovelSlugs(): Promise<string[]> {
  "use cache";
  cacheLife("max");
  cacheTag("content");

  const entries = await listDirectory(CONTENT_DIR);
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith("."))
    .sort();
}

/** Every novel, with chapter lists, sorted by most recently updated. */
export async function listNovels(): Promise<NovelWithChapters[]> {
  "use cache";
  cacheLife("max");
  cacheTag("content");

  const slugs = await getNovelSlugs();
  const novels = await Promise.all(slugs.map((slug) => loadNovel(slug)));
  const present = novels.filter((novel): novel is NovelWithChapters => novel !== null);

  return present.sort((a, b) => {
    const byUpdate = b.updatedAt.localeCompare(a.updatedAt);
    if (byUpdate !== 0) return byUpdate;
    return a.title.localeCompare(b.title);
  });
}

/** One novel with its chapter list, or null when the slug is unknown. */
export async function getNovel(slug: string): Promise<NovelWithChapters | null> {
  "use cache";
  cacheLife("max");
  cacheTag("content");

  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  return loadNovel(slug);
}

/** One chapter by 1-based index, or null when out of range. */
export async function getChapter(
  slug: string,
  index: number,
): Promise<{ novel: NovelWithChapters; chapter: Chapter } | null> {
  "use cache";
  cacheLife("max");
  cacheTag("content");

  if (!Number.isInteger(index) || index < 1) return null;

  const novel = await getNovel(slug);
  if (!novel) return null;

  const meta = novel.chapters[index - 1];
  if (!meta) return null;

  const raw = await readText(
    path.join(CONTENT_DIR, slug, CHAPTER_DIR, `${meta.slug}.md`),
  );
  const source = raw ?? (await readTextFallback(slug, meta.slug));
  if (source === null) return null;

  const parsed = parseChapterSource(source);

  return {
    novel,
    chapter: {
      ...meta,
      title: parsed.title ?? meta.title,
      novelSlug: slug,
      paragraphs: splitParagraphs(parsed.text),
    },
  };
}

async function readTextFallback(slug: string, chapterSlug: string) {
  for (const extension of [".markdown", ".txt"]) {
    const value = await readText(
      path.join(CONTENT_DIR, slug, CHAPTER_DIR, `${chapterSlug}${extension}`),
    );
    if (value !== null) return value;
  }
  return null;
}

/** All genres across the library, most common first. */
export async function listGenres(): Promise<{ tag: string; slug: string; count: number }[]> {
  "use cache";
  cacheLife("max");
  cacheTag("content");

  const novels = await listNovels();
  const counts = new Map<string, number>();
  for (const novel of novels) {
    for (const genre of novel.genres) {
      counts.set(genre, (counts.get(genre) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, slug: slugify(tag), count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** Novels carrying one genre, matched on its slugified form. */
export async function getNovelsByGenre(genreSlug: string): Promise<NovelWithChapters[]> {
  "use cache";
  cacheLife("max");
  cacheTag("content");

  const novels = await listNovels();
  return novels.filter((novel) =>
    novel.genres.some((genre) => slugify(genre) === genreSlug),
  );
}
