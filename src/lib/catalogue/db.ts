/**
 * Read-only access to the RanobeDB catalogue database.
 *
 * The database is produced by `scripts/import-ranobedb.mjs` and is metadata
 * only: titles, authors, tags, dates and cover filenames. It contains no novel
 * text.
 *
 * RanobeDB data is licensed ODbL-1.0 / DbCL-1.0 and attribution is required.
 * This module only ever opens the file read-only.
 */
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { catalogueDbPath } from "@/lib/config/paths";

export const CATALOGUE_PATH = catalogueDbPath();

let handle: DatabaseSync | null = null;

/** Whether an imported catalogue is present on disk. */
export function hasCatalogue(): boolean {
  return existsSync(CATALOGUE_PATH);
}

/**
 * The open read-only database, or null when nothing has been imported yet.
 * Callers must handle null so the app still works without a catalogue.
 */
export function getCatalogue(): DatabaseSync | null {
  if (!hasCatalogue()) return null;
  if (handle) return handle;

  try {
    handle = new DatabaseSync(CATALOGUE_PATH, { readOnly: true });
    return handle;
  } catch {
    return null;
  }
}
