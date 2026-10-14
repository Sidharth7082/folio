/**
 * Content model for the reader.
 *
 * Everything here is loaded from the local `content/` directory, which only
 * ever holds material the operator is allowed to publish: their own writing,
 * their own licensed translations, or public-domain works.
 */

export type NovelStatus = "ongoing" | "completed" | "hiatus" | "unknown";

/** Metadata for one chapter, without the body. */
export interface ChapterMeta {
  /** 1-based position in reading order. */
  index: number;
  /** Stable file-derived id, e.g. "0007-a-quiet-town". */
  slug: string;
  title: string;
  wordCount: number;
}

/** Metadata for one novel. */
export interface Novel {
  slug: string;
  title: string;
  author: string;
  /** Public path to the cover image, or null when none was provided. */
  cover: string | null;
  synopsis: string;
  genres: string[];
  status: NovelStatus;
  /** Editorial labels such as "Editor's Choice". */
  badges: string[];
  addedAt: string;
  updatedAt: string;
  chapterCount: number;
  latestChapter: ChapterMeta | null;
}

/** A novel plus its full chapter list. */
export interface NovelWithChapters extends Novel {
  chapters: ChapterMeta[];
}

/** One chapter with its body, split into paragraphs for rendering. */
export interface Chapter extends ChapterMeta {
  novelSlug: string;
  paragraphs: string[];
}

/** The on-disk shape of `content/<slug>/novel.json`. */
export interface NovelFile {
  title?: string;
  author?: string;
  cover?: string;
  synopsis?: string;
  genres?: string[];
  status?: string;
  badges?: string[];
  addedAt?: string;
  updatedAt?: string;
}
