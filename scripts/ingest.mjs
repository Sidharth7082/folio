#!/usr/bin/env node
/**
 * Ingest script: turn files you are allowed to publish into reader content.
 *
 * Single file:
 *   node scripts/ingest.mjs book.epub --title "My Novel" [options]
 *
 * Whole folder (bulk):
 *   node scripts/ingest.mjs ./books [--recursive] [--dry-run] [--overwrite]
 *
 * Options
 *   --title     Novel title        (bulk: defaults to the file name)
 *   --author    Author name        (default: "Unknown author")
 *   --genres    Comma-separated genres
 *   --synopsis  Short description
 *   --cover     Public cover path  (bulk: auto-detected sibling image)
 *   --status    ongoing|completed|hiatus
 *   --slug      Override the slug  (single file only)
 *   --recursive Walk subfolders    (bulk)
 *   --dry-run   Report what would happen without writing
 *   --overwrite Replace a novel that is already in content/
 *
 * Per-book metadata in bulk mode: place a JSON sidecar next to the book,
 * either `Book.epub.json` or `Book.json`, with any of the fields above, e.g.
 *   { "title": "…", "author": "…", "genres": ["Fantasy"], "synopsis": "…" }
 * Embedded EPUB title/author are used when no sidecar or flag supplies them.
 *
 * Only ingest material you own the rights to, or that is public domain.
 * This script never downloads anything; you supply the files.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/**
 * Where things live, resolved on use rather than at import time.
 *
 * This file is imported by the app's import API route, and a bundler inlines it
 * into a context where `import.meta.dirname` is undefined — resolving at module
 * scope made the entire route fail to load. Falling back to the working
 * directory keeps the CLI identical, since the npm scripts run from the project
 * root.
 */
function projectRoot() {
  const here = import.meta.dirname;
  return here ? path.resolve(here, "..") : process.cwd();
}

/** Overridable so tests can ingest into a scratch directory. */
function contentDir() {
  return process.env.NOVEL_READER_CONTENT_DIR
    ? path.resolve(process.env.NOVEL_READER_CONTENT_DIR)
    : path.join(projectRoot(), "content");
}

function coversDir() {
  return process.env.NOVEL_READER_COVERS_DIR
    ? path.resolve(process.env.NOVEL_READER_COVERS_DIR)
    : path.join(projectRoot(), "public", "covers");
}

const SUPPORTED_EXTENSIONS = new Set([".txt", ".md", ".markdown", ".epub"]);
const COVER_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif", ".svg"];

/** Image media types an EPUB cover is allowed to be. */
const COVER_MEDIA_EXTENSIONS = new Map([
  ["image/jpeg", ".jpg"],
  ["image/jpg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
  ["image/avif", ".avif"],
  ["image/svg+xml", ".svg"],
]);

/** Pick an extension, trusting the OPF's declared media type first. */
export function coverExtension(href, mediaType) {
  const fromType = COVER_MEDIA_EXTENSIONS.get(String(mediaType ?? "").toLowerCase());
  if (fromType) return fromType;
  const lower = String(href ?? "").toLowerCase();
  return COVER_EXTENSIONS.find((extension) => lower.endsWith(extension)) ?? ".jpg";
}

/**
 * Where the cover image lives inside an EPUB, or null.
 *
 * Handles both conventions: the EPUB 2 `<meta name="cover" content="id">`
 * declaration and the EPUB 3 `properties="cover-image"` attribute. The last
 * fallback deliberately skips non-image items — many EPUBs ship a `cover.xhtml`
 * wrapper page, and picking that would write an HTML document as the cover.
 */
export function findCoverHref(opf, manifest) {
  const metaId = /<meta\b[^>]*\bname="cover"[^>]*\bcontent="([^"]+)"/i.exec(opf)?.[1];
  if (metaId && manifest.has(metaId)) {
    const item = manifest.get(metaId);
    if (item.type.startsWith("image/")) return { href: item.href, mediaType: item.type };
  }

  for (const match of opf.matchAll(/<item\b[^>]*>/g)) {
    const tag = match[0];
    if (!/\bproperties="[^"]*\bcover-image\b/.test(tag)) continue;
    const href = /\bhref="([^"]+)"/.exec(tag)?.[1];
    const type = /\bmedia-type="([^"]+)"/.exec(tag)?.[1] ?? "";
    if (href && type.startsWith("image/")) return { href, mediaType: type };
  }

  for (const [id, item] of manifest) {
    if (!item.type.startsWith("image/")) continue;
    if (/cover/i.test(id) || /cover/i.test(item.href)) {
      return { href: item.href, mediaType: item.type };
    }
  }
  return null;
}

const CHAPTER_HEADING =
  /^\s{0,3}(chapter\s+[0-9ivxlcdm]+|prologue|epilogue|interlude|part\s+[0-9ivxlcdm]+)\b.*$/i;

function parseArgs(argv) {
  const options = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        options[key] = true;
      } else {
        options[key] = value;
        i += 1;
      }
    } else {
      positional.push(token);
    }
  }
  return { options, positional };
}

function slugify(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function decodeEntities(value) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function htmlToPlainText(html) {
  return decodeEntities(
    html
      .replace(/<\?xml[\s\S]*?\?>/g, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<(br|\/p|\/div|\/h[1-6]|\/li)\s*\/?>/gi, "\n\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Split one long body of text into chapters on heading lines. */
function splitByHeadings(text) {
  const lines = text.split("\n");
  const chapters = [];
  let current = null;

  for (const line of lines) {
    if (CHAPTER_HEADING.test(line) && line.trim().length <= 90) {
      if (current) chapters.push(current);
      current = { title: line.trim().replace(/\s+/g, " "), body: [] };
    } else if (current) {
      current.body.push(line);
    } else {
      current = { title: null, body: [line] };
    }
  }
  if (current) chapters.push(current);

  const withBody = chapters
    .map((chapter) => ({
      title: chapter.title,
      body: chapter.body.join("\n").trim(),
    }))
    .filter((chapter) => chapter.body.length > 0);

  if (withBody.length === 0) return null;
  // Text before the first heading is front matter: fold it into chapter one
  // rather than emitting a separate, untitled chapter. No headings at all
  // means the caller should fall back to a single filename-titled chapter.
  if (withBody[0].title === null) {
    if (withBody.length === 1) return null;
    const [lead, ...rest] = withBody;
    return [
      { title: rest[0].title, body: `${lead.body}\n\n${rest[0].body}` },
      ...rest.slice(1),
    ];
  }

  return withBody;
}

/** Split Markdown on `# ` headings. */
function splitMarkdown(text) {
  const matches = [...text.matchAll(/^#\s+(.+?)\s*$/gm)];
  if (matches.length === 0) return null;

  return matches.map((match, index) => {
    const start = match.index + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : text.length;
    return {
      title: match[1].trim(),
      body: text.slice(start, end).trim(),
    };
  });
}

function toChapters(rawText, format, fallbackTitle) {
  const text = rawText.replace(/\r\n/g, "\n").replace(/^\uFEFF/, "").trim();
  let chapters = null;

  if (format === "markdown") chapters = splitMarkdown(text);
  if (!chapters) chapters = splitByHeadings(text);
  if (!chapters) {
    chapters = [{ title: fallbackTitle, body: text }];
  }
  return chapters;
}

async function readEpub(file) {
  const { default: AdmZip } = await import("adm-zip");
  const zip = new AdmZip(file);

  const container = zip.getEntry("META-INF/container.xml");
  if (!container) throw new Error("Not a valid EPUB: missing META-INF/container.xml");

  const containerXml = container.getData().toString("utf8");
  const rootPath = /full-path="([^"]+)"/.exec(containerXml)?.[1];
  if (!rootPath) throw new Error("Not a valid EPUB: no rootfile declaration");

  const opfEntry = zip.getEntry(rootPath);
  if (!opfEntry) throw new Error(`EPUB rootfile not found: ${rootPath}`);
  const opf = opfEntry.getData().toString("utf8");
  const opfDir = path.posix.dirname(rootPath);

  const title = decodeEntities(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i.exec(opf)?.[1]?.trim() ?? "");
  const author = decodeEntities(
    /<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i.exec(opf)?.[1]?.trim() ?? "",
  );

  const manifest = new Map();
  for (const item of opf.matchAll(/<item\b[^>]*>/g)) {
    const tag = item[0];
    const id = /id="([^"]+)"/.exec(tag)?.[1];
    const href = /href="([^"]+)"/.exec(tag)?.[1];
    const type = /media-type="([^"]+)"/.exec(tag)?.[1] ?? "";
    if (id && href) manifest.set(id, { href, type });
  }

  const spine = [];
  for (const itemref of opf.matchAll(/<itemref\b[^>]*>/g)) {
    const idref = /idref="([^"]+)"/.exec(itemref[0])?.[1];
    if (idref && manifest.has(idref)) spine.push(manifest.get(idref).href);
  }

  const documents = spine.length > 0 ? spine : [...manifest.values()].map((item) => item.href);

  // The cover lives in the archive alongside the chapters and is usually the
  // only image in the book, so it has to be lifted out separately.
  let cover = null;
  const coverInfo = findCoverHref(opf, manifest);
  if (coverInfo) {
    const coverPath = path.posix.normalize(path.posix.join(opfDir, coverInfo.href));
    const coverEntry = zip.getEntry(coverPath);
    if (coverEntry) {
      cover = {
        data: coverEntry.getData(),
        extension: coverExtension(coverInfo.href, coverInfo.mediaType),
      };
    }
  }

  const chapters = [];
  for (const href of documents) {
    if (!/\.x?html?$/i.test(href)) continue;
    const entryPath = path.posix.normalize(path.posix.join(opfDir, href));
    const entry = zip.getEntry(entryPath);
    if (!entry) continue;

    const html = entry.getData().toString("utf8");
    const heading = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i.exec(html)?.[1];
    const plain = htmlToPlainText(html);
    if (plain.replace(/\s/g, "").length < 40) continue;

    chapters.push({
      title: heading ? htmlToPlainText(heading).slice(0, 120) : null,
      body: plain,
    });
  }

  if (chapters.length === 0) throw new Error("No readable chapters found in EPUB");

  return { chapters, title, author, cover };
}

/* -------------------------------------------------------------------------
   Discovery + per-book ingestion
   ------------------------------------------------------------------------- */

/** Whether a file name has a supported content extension. */
export function isSupportedFile(fileName) {
  return SUPPORTED_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

/** Human-readable title from a file name: `the_long_road.txt` -> `the long road`. */
export function deriveTitle(filePath) {
  const base = path.basename(filePath, path.extname(filePath));
  return base.replace(/_+/g, " ").replace(/\s+/g, " ").trim();
}

/** Accepts `"a,b"` or `["a","b"]` and returns a clean list. */
export function toGenreList(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

/** Every ingestable file under a directory, in natural order. */
export async function discoverFiles(rootDir, { recursive = false } = {}) {
  const found = [];
  const entries = await fs.readdir(rootDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (recursive) found.push(...(await discoverFiles(full, { recursive })));
    } else if (entry.isFile() && isSupportedFile(entry.name)) {
      found.push(full);
    }
  }

  return found.sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
}

/** Optional `<book>.json` or `<book>.epub.json` metadata beside the book. */
async function readSidecar(file) {
  const candidates = [`${file}.json`, file.replace(/\.[^.]+$/, ".json")];
  for (const candidate of candidates) {
    const raw = await fs.readFile(candidate, "utf8").catch(() => null);
    if (raw === null) continue;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      // A malformed sidecar is not fatal; fall back to flags and embedded data.
    }
  }
  return null;
}

/** A sibling image sharing the book's base name becomes its cover. */
async function findSiblingCover(file) {
  const base = file.replace(/\.[^.]+$/, "");
  for (const extension of COVER_EXTENSIONS) {
    const candidate = `${base}${extension}`;
    if (await pathExists(candidate)) return { candidate, extension };
  }
  return null;
}

async function writeChapters(chaptersDir, chapters) {
  await fs.mkdir(chaptersDir, { recursive: true });

  for (const [index, chapter] of chapters.entries()) {
    const ordinal = String(index + 1).padStart(4, "0");
    const name = chapter.title
      ? slugify(chapter.title) || `chapter-${ordinal}`
      : `chapter-${ordinal}`;
    const body = chapter.body
      .split(/\n{2,}/)
      .map((block) => block.replace(/\n+/g, " ").trim())
      .filter(Boolean)
      .join("\n\n");

    const contents = chapter.title
      ? `---\ntitle: ${JSON.stringify(chapter.title)}\n---\n\n${body}\n`
      : `${body}\n`;

    await fs.writeFile(path.join(chaptersDir, `${ordinal}-${name}.md`), contents, "utf8");
  }
}

/**
 * Ingest a single book. Returns a result describing what happened and throws
 * only on unrecoverable problems, so a bulk run can continue past a bad file.
 */
export async function ingestOne(file, options = {}) {
  const extension = path.extname(file).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new Error(`unsupported file type "${extension}"`);
  }

  const sidecar = await readSidecar(file);
  const pick = (key, fallback = "") => {
    if (typeof options[key] === "string" && options[key].length > 0) return options[key];
    if (sidecar && sidecar[key] !== undefined) return sidecar[key];
    return fallback;
  };

  let title = String(pick("title"));
  let author = String(pick("author"));
  let chapters;

  let embeddedCover = null;
  if (extension === ".epub") {
    const epub = await readEpub(file);
    title = title || epub.title;
    author = author || epub.author;
    chapters = epub.chapters;
    embeddedCover = epub.cover ?? null;
  } else {
    const raw = await fs.readFile(file, "utf8");
    const format = extension === ".txt" ? "text" : "markdown";
    chapters = toChapters(raw, format, title || deriveTitle(file));
  }

  // In bulk there is no per-file --title, so the file name is the last resort.
  if (!title) title = deriveTitle(file) || "Untitled";

  const slugSource =
    typeof options.slug === "string" && options.slug.length > 0
      ? options.slug
      : typeof sidecar?.slug === "string" && sidecar.slug.length > 0
        ? sidecar.slug
        : title;
  const slug = slugify(slugSource);
  if (!slug) throw new Error(`could not derive a slug from "${title}"`);

  const novelDir = path.join(contentDir(), slug);
  const metadataPath = path.join(novelDir, "novel.json");

  const alreadyPresent = await pathExists(metadataPath);
  if (alreadyPresent && !options.overwrite) {
    return {
      slug,
      title,
      chapterCount: chapters.length,
      skipped: true,
      dryRun: false,
      cover: null,
    };
  }

  // Cover resolution order: explicit flag/sidecar, a sibling image, then a cover
  // embedded in the book itself.
  let cover = String(pick("cover") || "");
  let copiedCover = null;
  if (!cover) {
    const sibling = await findSiblingCover(file);
    if (sibling) {
      const target = path.join(coversDir(), `${slug}${sibling.extension.toLowerCase()}`);
      if (!options.dryRun) {
        await fs.mkdir(coversDir(), { recursive: true });
        await fs.copyFile(sibling.candidate, target);
      }
      cover = `/api/book-cover/${path.basename(target)}`;
      copiedCover = cover;
    }
  }

  if (!cover && embeddedCover) {
    const target = path.join(coversDir(), `${slug}${embeddedCover.extension}`);
    if (!options.dryRun) {
      await fs.mkdir(coversDir(), { recursive: true });
      await fs.writeFile(target, embeddedCover.data);
    }
    cover = `/api/book-cover/${path.basename(target)}`;
    copiedCover = cover;
  }

  if (!options.dryRun) {
    await writeChapters(path.join(novelDir, "chapters"), chapters);

    // Preserve the original added date when replacing a novel.
    let addedAt = new Date().toISOString().slice(0, 10);
    if (alreadyPresent) {
      const existing = await fs.readFile(metadataPath, "utf8").catch(() => null);
      if (existing) {
        try {
          const previous = JSON.parse(existing);
          if (typeof previous.addedAt === "string" && previous.addedAt) {
            addedAt = previous.addedAt;
          }
        } catch {
          // Ignore an unreadable previous record.
        }
      }
    }

    const metadata = {
      title,
      author: author || "Unknown author",
      cover: cover || null,
      synopsis: String(pick("synopsis")),
      genres: toGenreList(pick("genres", [])),
      status: String(pick("status", "ongoing")),
      addedAt,
      updatedAt: new Date().toISOString().slice(0, 10),
    };

    await fs.writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  }

  return {
    slug,
    title,
    chapterCount: chapters.length,
    skipped: false,
    dryRun: Boolean(options.dryRun),
    cover: copiedCover,
  };
}

/* -------------------------------------------------------------------------
   CLI
   ------------------------------------------------------------------------- */

const USAGE = `Usage:
  node scripts/ingest.mjs <file.(txt|md|epub)> --title "..." [options]
  node scripts/ingest.mjs <folder> [--recursive] [--dry-run] [--overwrite]

Options:
  --title <text>      Novel title (bulk: defaults to the file name)
  --author <text>     Author name
  --genres <a,b>      Comma-separated genres
  --synopsis <text>   Short description
  --cover <path>      Public cover path (bulk: auto-detected sibling image)
  --status <text>     ongoing | completed | hiatus
  --slug <text>       Override the slug (single file only)
  --recursive         Walk subfolders (bulk)
  --dry-run           Show what would be ingested, writing nothing
  --overwrite         Replace novels already present in content/

Bulk metadata: drop a JSON sidecar next to any book (Book.epub.json or
Book.json) with any of the fields above, e.g.
  { "title": "...", "author": "...", "genres": ["Fantasy"], "synopsis": "..." }`;

async function reportSummary(results) {
  const { ingested, skipped, failed } = results;
  console.log("");
  console.log(
    `Done: ${ingested.length} ingested, ${skipped.length} skipped, ${failed.length} failed.`,
  );
  if (failed.length > 0) {
    console.log("");
    for (const failure of failed) console.log(`  ! ${failure.label}: ${failure.error}`);
  }
  if (ingested.length > 0) await revalidateReader();
}

async function main() {
  const { options, positional } = parseArgs(process.argv.slice(2));
  const input = positional[0];

  if (!input || options.help) {
    console.log(USAGE);
    process.exit(input ? 0 : 1);
  }

  const target = path.resolve(process.cwd(), input);
  const stats = await fs.stat(target).catch(() => null);
  if (!stats) throw new Error(`no such file or folder: ${input}`);

  const shared = {
    overwrite: Boolean(options.overwrite || options.force),
    dryRun: Boolean(options["dry-run"]),
  };

  /* ---- Bulk: a folder of books ---------------------------------------- */
  if (stats.isDirectory()) {
    const files = await discoverFiles(target, { recursive: Boolean(options.recursive) });
    if (files.length === 0) {
      console.log(`No .txt, .md or .epub files found in ${input}.`);
      return;
    }

    console.log(
      `${shared.dryRun ? "Would ingest" : "Ingesting"} ${files.length} file(s) from ${input}` +
        `${options.recursive ? " (recursive)" : ""}\n`,
    );

    const results = { ingested: [], skipped: [], failed: [] };

    for (const file of files) {
      const label = path.relative(target, file) || path.basename(file);
      try {
        // `slug` is deliberately not shared across files, or they would collide.
        const result = await ingestOne(file, { ...options, ...shared, slug: undefined });

        if (result.skipped) {
          results.skipped.push({ label, slug: result.slug });
          console.log(`  skip  ${label}  (content/${result.slug} already exists)`);
        } else {
          results.ingested.push(result);
          console.log(
            `  ok    ${label}  ->  content/${result.slug}  ` +
              `(${result.chapterCount} chapter${result.chapterCount === 1 ? "" : "s"}` +
              `${result.cover ? ", cover" : ""})`,
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.failed.push({ label, error: message });
        console.log(`  fail  ${label}  ${message}`);
      }
    }

    await reportSummary(results);
    if (results.failed.length > 0) process.exitCode = 1;
    return;
  }

  /* ---- Single file ----------------------------------------------------- */
  const result = await ingestOne(target, { ...options, ...shared });
  if (result.skipped) {
    console.log(`Skipped: content/${result.slug} already exists (pass --overwrite to replace).`);
    return;
  }

  console.log(
    `${shared.dryRun ? "Would ingest" : "Ingested"} "${result.title}" -> content/${result.slug} ` +
      `(${result.chapterCount} chapter${result.chapterCount === 1 ? "" : "s"}` +
      `${result.cover ? ", cover" : ""})`,
  );
  if (!shared.dryRun) await revalidateReader();
}

/**
 * Ask a running server to drop its cached content reads.
 *
 * Page reads are cached for 30 days, so without this a newly ingested book is
 * invisible in /browse and on the home page until the app is rebuilt. Best
 * effort by design: if no server is listening, the book is still ingested and
 * simply appears after the next build.
 *
 * Override the target with NOVEL_READER_REVALIDATE_URL when serving on another
 * port, e.g. http://localhost:3100/api/revalidate-content.
 */
async function revalidateReader() {
  const url =
    process.env.NOVEL_READER_REVALIDATE_URL ??
    "http://localhost:3000/api/revalidate-content";

  try {
    const response = await fetch(url, { method: "POST", signal: AbortSignal.timeout(2500) });
    if (response.ok) {
      console.log("  Asked the running server to refresh its content cache.");
      return;
    }
  } catch {
    // No server listening, or one too old to have the route.
  }

  console.log(
    "  No server answered to refresh its cache — restart or rebuild before this " +
      "book appears in /browse and on the home page.",
  );
}

const invokedDirectly =
  typeof import.meta.main === "boolean"
    ? import.meta.main
    : Boolean(process.argv[1]) &&
      path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`ingest failed: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
}
