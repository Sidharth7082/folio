import path from "node:path";

/**
 * Where Folio keeps the things that are yours: your books, their covers, and the
 * imported catalogues.
 *
 * One root, so the app can run from anywhere — a git checkout, a Docker volume,
 * or a data directory next to a packaged build. Set `FOLIO_HOME` to point at it.
 *
 * When `FOLIO_HOME` is unset this resolves to the working directory, which is
 * exactly the layout a checkout already uses, so an existing install keeps
 * working untouched.
 *
 * The per-directory overrides still win, because they exist so tests can redirect
 * a single directory into a scratch space without moving everything.
 */

/** The data root: `FOLIO_HOME`, else the working directory. */
export function folioHome(): string {
  const configured = process.env.FOLIO_HOME;
  return configured ? path.resolve(configured) : process.cwd();
}

/** True when a separate data root is configured, so the layout differs. */
export function hasConfiguredHome(): boolean {
  return Boolean(process.env.FOLIO_HOME);
}

/** The novels, one folder each. */
export function contentDir(): string {
  const override = process.env.NOVEL_READER_CONTENT_DIR;
  return override ? path.resolve(override) : path.join(folioHome(), "content");
}

/**
 * Book covers.
 *
 * A checkout keeps them in `public/covers`, where they are also reachable as
 * static files. A configured home uses a plain `covers` folder, since nothing
 * there is served statically — book covers go through `/api/book-cover/<file>`,
 * which reads from disk and so is not affected by the static file list a server
 * builds at boot.
 */
export function coversDir(): string {
  const override = process.env.NOVEL_READER_COVERS_DIR;
  if (override) return path.resolve(override);
  return hasConfiguredHome()
    ? path.join(folioHome(), "covers")
    : path.join(folioHome(), "public", "covers");
}

/** The RanobeDB-derived catalogue. */
export function catalogueDbPath(): string {
  const override = process.env.NOVEL_READER_CATALOGUE_DB;
  return override ? path.resolve(override) : path.join(folioHome(), "data", "catalogue.db");
}

/** The MangaBaka-derived catalogue and its link table. */
export function mangaBakaDbPath(): string {
  const override = process.env.NOVEL_READER_MANGABAKA_DB;
  return override ? path.resolve(override) : path.join(folioHome(), "data", "mangabaka.db");
}

/** Cached RanobeDB cover images, fetched on demand. */
export function remoteCoverCacheDir(): string {
  return path.join(folioHome(), "data", "covers");
}
