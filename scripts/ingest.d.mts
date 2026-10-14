/**
 * Types for `scripts/ingest.mjs`, which the import API route calls directly.
 *
 * The importer is plain JavaScript so it can run as a CLI without a build step.
 * This declaration is what lets the route import it and stay type-checked; keep
 * it in step with the exports in that file.
 */

export interface IngestResult {
  slug: string;
  title: string;
  chapterCount: number;
  skipped: boolean;
  dryRun: boolean;
  cover: string | null;
}

export interface IngestOptions {
  title?: string;
  author?: string;
  slug?: string;
  cover?: string;
  genres?: string;
  synopsis?: string;
  status?: string;
  overwrite?: boolean;
  dryRun?: boolean;
  recursive?: boolean;
}

export function isSupportedFile(fileName: string): boolean;
export function deriveTitle(filePath: string): string;
export function toGenreList(value: unknown): string[];
export function discoverFiles(
  rootDir: string,
  options?: { recursive?: boolean },
): Promise<string[]>;
export function ingestOne(file: string, options?: IngestOptions): Promise<IngestResult>;
