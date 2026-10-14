/**
 * Tests for the bulk importer: discovery, sidecar metadata, cover pickup,
 * skip/overwrite behaviour and heading extraction.
 *
 * Everything is written into a throwaway temp directory via the
 * NOVEL_READER_CONTENT_DIR / NOVEL_READER_COVERS_DIR overrides, so the real
 * `content/` folder is never touched.
 */
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

/** The parts of scripts/ingest.mjs these tests exercise. */
interface IngestModule {
  isSupportedFile(fileName: string): boolean;
  deriveTitle(filePath: string): string;
  toGenreList(value: unknown): string[];
  discoverFiles(rootDir: string, options?: { recursive?: boolean }): Promise<string[]>;
  ingestOne(
    file: string,
    options?: Record<string, unknown>,
  ): Promise<{
    slug: string;
    title: string;
    chapterCount: number;
    skipped: boolean;
    dryRun: boolean;
    cover: string | null;
  }>;
  findCoverHref(
    opf: string,
    manifest: Map<string, { href: string; type: string }>,
  ): { href: string; mediaType: string } | null;
  coverExtension(href: string, mediaType?: string): string;
}

let ingest: IngestModule;
let scratch: string;
let batchDir: string;
let headingsDir: string;
let contentDir: string;
let coversDir: string;

async function chapterFiles(slug: string): Promise<string[]> {
  const dir = path.join(contentDir, slug, "chapters");
  return (await fs.readdir(dir)).sort();
}

/** The `title:` values from each chapter file, in reading order. */
async function chapterTitles(slug: string): Promise<string[]> {
  const files = await chapterFiles(slug);
  return Promise.all(
    files.map(async (file) => {
      const raw = await fs.readFile(path.join(contentDir, slug, "chapters", file), "utf8");
      const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
      const title = front ? /^title:\s*(.*)$/m.exec(front[1]) : null;
      return title ? title[1].trim().replace(/^"(.*)"$/, "$1") : "";
    }),
  );
}

async function readNovelJson(slug: string): Promise<Record<string, unknown>> {
  const raw = await fs.readFile(path.join(contentDir, slug, "novel.json"), "utf8");
  return JSON.parse(raw);
}

describe("EPUB cover discovery", () => {
  it("follows the EPUB 2 <meta name=\"cover\"> declaration", () => {
    const opf = '<meta name="cover" content="cover-image"/>';
    const manifest = new Map([["cover-image", { href: "cover.jpg", type: "image/jpeg" }]]);
    assert.deepEqual(ingest.findCoverHref(opf, manifest), {
      href: "cover.jpg",
      mediaType: "image/jpeg",
    });
  });

  it("follows the EPUB 3 properties=\"cover-image\" attribute", () => {
    const opf = '<item id="img" href="art.png" media-type="image/png" properties="cover-image"/>';
    assert.deepEqual(ingest.findCoverHref(opf, new Map()), {
      href: "art.png",
      mediaType: "image/png",
    });
  });

  it("never mistakes a cover.xhtml wrapper page for the cover image", () => {
    // Many EPUBs ship both a wrapper page and the image. Returning the page would
    // write an HTML document into public/covers/ and show a broken cover.
    const opf = '<meta name="cover" content="cover"/>';
    const htmlOnly = new Map([
      ["cover", { href: "cover.xhtml", type: "application/xhtml+xml" }],
    ]);
    assert.equal(ingest.findCoverHref(opf, htmlOnly), null);
  });

  it("falls back to a manifest image whose name says cover", () => {
    const manifest = new Map([
      ["ch1", { href: "ch1.xhtml", type: "application/xhtml+xml" }],
      ["art", { href: "images/the-cover.jpeg", type: "image/jpeg" }],
    ]);
    assert.deepEqual(ingest.findCoverHref("<package/>", manifest), {
      href: "images/the-cover.jpeg",
      mediaType: "image/jpeg",
    });
  });

  it("returns null when the book has no cover", () => {
    const manifest = new Map([["ch1", { href: "ch1.xhtml", type: "application/xhtml+xml" }]]);
    assert.equal(ingest.findCoverHref("<package/>", manifest), null);
  });

  it("maps a media type, then the file name, to an extension", () => {
    assert.equal(ingest.coverExtension("cover.jpg", "image/jpeg"), ".jpg");
    assert.equal(ingest.coverExtension("art", "image/png"), ".png");
    assert.equal(ingest.coverExtension("art.JPEG", ""), ".jpeg");
    assert.equal(ingest.coverExtension("mystery", "application/octet-stream"), ".jpg");
  });
});

/**
 * Scraped novels keep their Markdown markers even when the download is plain
 * text. Treating those as prose collapsed an entire book into a single chapter
 * named after the file, which left it unreadable in the reader.
 */
describe("Markdown headings inside a .txt", () => {
  it("splits on them instead of treating the whole file as one chapter", async () => {
    const result = await ingest.ingestOne(path.join(headingsDir, "hashed.txt"));
    assert.equal(result.chapterCount, 3);
  });

  it("strips the hashes and any stray spacing from the titles", async () => {
    assert.deepEqual(await chapterTitles("hashed"), ["Chapter 1", "Chapter 2", "EPILOGUE"]);
  });

  it("still folds a heading-less .txt into a single chapter", async () => {
    const result = await ingest.ingestOne(path.join(headingsDir, "prose.txt"));
    assert.equal(result.chapterCount, 1);
  });

  it("does not split on prose that merely mentions a chapter", async () => {
    const result = await ingest.ingestOne(path.join(headingsDir, "mention.txt"));
    assert.equal(result.chapterCount, 1);
  });
});

before(async () => {
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), "folio-ingest-"));
  contentDir = path.join(scratch, "content");
  coversDir = path.join(scratch, "covers");

  process.env.NOVEL_READER_CONTENT_DIR = contentDir;
  process.env.NOVEL_READER_COVERS_DIR = coversDir;

  // Imported only after the env overrides are in place.
  ingest = (await import("../scripts/ingest.mjs")) as unknown as IngestModule;

  batchDir = path.join(scratch, "batch");
  await fs.mkdir(path.join(batchDir, "nested"), { recursive: true });

  await fs.writeFile(
    path.join(batchDir, "alpha.txt"),
    "Chapter 1: Alpha\n\nBody one.\n\nChapter 2: Omega\n\nBody two.\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(batchDir, "solo.txt"),
    "Chapter 1: Solo Heading\n\nOnly body.\n",
    "utf8",
  );
  await fs.writeFile(path.join(batchDir, "beta.md"), "# Beta One\n\nBeta body.\n", "utf8");
  await fs.writeFile(
    path.join(batchDir, "beta.json"),
    JSON.stringify({ title: "Beta Chronicle", author: "Fixture", genres: ["Fantasy"] }),
    "utf8",
  );
  await fs.writeFile(path.join(batchDir, "alpha.png"), "fake-image-bytes", "utf8");
  await fs.writeFile(path.join(batchDir, "notes.pdf"), "unsupported", "utf8");
  await fs.writeFile(
    path.join(batchDir, "nested", "gamma.txt"),
    "Chapter 1: Gamma\n\nGamma body.\n",
    "utf8",
  );

  // Kept out of `batchDir` so the discovery tests still see exactly the three
  // books they expect.
  headingsDir = path.join(scratch, "headings");
  await fs.mkdir(headingsDir, { recursive: true });
  await fs.writeFile(
    path.join(headingsDir, "hashed.txt"),
    "# Chapter 1\n\nFirst body.\n\n## Chapter 2\n\nSecond body.\n\n# EPILOGUE\n\nLast body.\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(headingsDir, "prose.txt"),
    "One long body of text.\n\nWith no headings anywhere in it.\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(headingsDir, "mention.txt"),
    "It was Chapter 3 of the book, he said.\n\nAnd the prose went on.\n",
    "utf8",
  );
});

after(async () => {
  await fs.rm(scratch, { recursive: true, force: true });
});

describe("isSupportedFile", () => {
  it("accepts txt, md, markdown and epub", () => {
    for (const name of ["a.txt", "a.md", "a.markdown", "a.epub", "a.EPUB"]) {
      assert.equal(ingest.isSupportedFile(name), true, name);
    }
  });

  it("rejects everything else", () => {
    for (const name of ["a.pdf", "a.json", "a.png", "a"]) {
      assert.equal(ingest.isSupportedFile(name), false, name);
    }
  });
});

describe("deriveTitle", () => {
  it("turns file names into readable titles", () => {
    assert.equal(ingest.deriveTitle("/tmp/the_long_road.txt"), "the long road");
  });

  it("collapses repeated whitespace", () => {
    assert.equal(ingest.deriveTitle("a  b.epub"), "a b");
  });
});

describe("toGenreList", () => {
  it("splits comma-separated strings", () => {
    assert.deepEqual(ingest.toGenreList("Fantasy, Adventure"), ["Fantasy", "Adventure"]);
  });

  it("passes arrays through", () => {
    assert.deepEqual(ingest.toGenreList(["Fantasy"]), ["Fantasy"]);
  });

  it("returns an empty list for anything else", () => {
    assert.deepEqual(ingest.toGenreList(undefined), []);
    assert.deepEqual(ingest.toGenreList(42), []);
  });
});

describe("discoverFiles", () => {
  it("finds top-level books and ignores unsupported files", async () => {
    const found = (await ingest.discoverFiles(batchDir)).map((file) => path.basename(file));
    assert.deepEqual(found, ["alpha.txt", "beta.md", "solo.txt"]);
  });

  it("stays out of subfolders by default", async () => {
    const found = await ingest.discoverFiles(batchDir);
    assert.equal(found.some((file) => file.includes("nested")), false);
  });

  it("walks subfolders when asked", async () => {
    const found = await ingest.discoverFiles(batchDir, { recursive: true });
    assert.equal(found.some((file) => file.endsWith(path.join("nested", "gamma.txt"))), true);
  });
});

describe("ingestOne", () => {
  it("writes chapters and metadata, using the file name as the title", async () => {
    const result = await ingest.ingestOne(path.join(batchDir, "alpha.txt"));

    assert.equal(result.slug, "alpha");
    assert.equal(result.title, "alpha");
    assert.equal(result.chapterCount, 2);
    assert.equal(result.skipped, false);

    const chapters = await chapterFiles("alpha");
    assert.equal(chapters.length, 2);

    const metadata = await readNovelJson("alpha");
    assert.equal(metadata.title, "alpha");
    assert.equal(metadata.author, "Unknown author");
  });

  it("picks up a sibling image as the cover", async () => {
    const result = await ingest.ingestOne(path.join(batchDir, "alpha.txt"), { overwrite: true });
    assert.equal(result.cover, "/api/book-cover/alpha.png");
    assert.equal(await fs.readFile(path.join(coversDir, "alpha.png"), "utf8"), "fake-image-bytes");
    assert.equal((await readNovelJson("alpha")).cover, "/api/book-cover/alpha.png");
  });

  it("applies sidecar metadata", async () => {
    const result = await ingest.ingestOne(path.join(batchDir, "beta.md"));

    assert.equal(result.slug, "beta-chronicle");
    assert.equal(result.title, "Beta Chronicle");

    const metadata = await readNovelJson("beta-chronicle");
    assert.equal(metadata.author, "Fixture");
    assert.deepEqual(metadata.genres, ["Fantasy"]);
  });

  it("extracts a lone heading as the chapter title, not the body", async () => {
    await ingest.ingestOne(path.join(batchDir, "solo.txt"));

    const chapters = await chapterFiles("solo");
    assert.deepEqual(chapters, ["0001-chapter-1-solo-heading.md"]);

    const contents = await fs.readFile(path.join(contentDir, "solo", "chapters", chapters[0]), "utf8");
    assert.match(contents, /title: "Chapter 1: Solo Heading"/);
    assert.match(contents, /Only body\./);
    assert.equal(contents.includes("Chapter 1: Solo Heading\n\nOnly body"), false);
  });

  it("skips an existing novel unless overwrite is set", async () => {
    const skipped = await ingest.ingestOne(path.join(batchDir, "alpha.txt"));
    assert.equal(skipped.skipped, true);

    const replaced = await ingest.ingestOne(path.join(batchDir, "alpha.txt"), { overwrite: true });
    assert.equal(replaced.skipped, false);
  });

  it("writes nothing in dry-run mode", async () => {
    const result = await ingest.ingestOne(path.join(batchDir, "nested", "gamma.txt"), {
      dryRun: true,
    });

    assert.equal(result.dryRun, true);
    assert.equal(result.slug, "gamma");

    const exists = await fs
      .access(path.join(contentDir, "gamma", "novel.json"))
      .then(() => true)
      .catch(() => false);
    assert.equal(exists, false);
  });

  it("rejects unsupported extensions", async () => {
    await assert.rejects(
      () => ingest.ingestOne(path.join(batchDir, "notes.pdf")),
      /unsupported file type/,
    );
  });
});
