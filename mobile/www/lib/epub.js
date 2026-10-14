/*
 * Reading an EPUB.
 *
 * The format is three hops from bytes to chapters:
 *
 *   META-INF/container.xml  -> which .opf file describes the book
 *   the .opf                -> metadata, the manifest, and the spine (order)
 *   the spine's documents   -> the actual chapter text
 *
 * Everything is relative to the .opf's own folder, which is the usual source of
 * bugs here: an href of "chapter1.xhtml" from "OEBPS/content.opf" means
 * "OEBPS/chapter1.xhtml", not "chapter1.xhtml".
 *
 * Chapters are spine documents. Some books pack several chapters into one
 * document, which this treats as one chapter — matching how the file is meant to
 * be paginated rather than guessing at internal boundaries.
 */

import { openZip } from "./zip.js";

/** Resolve an href against the folder holding the referencing file. */
function resolve(base, href) {
  if (!base) return href;
  const parts = `${base}/${href}`.split("/");
  const out = [];
  for (const part of parts) {
    if (part === "." || part === "") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

function directoryOf(path) {
  const at = path.lastIndexOf("/");
  return at === -1 ? "" : path.slice(0, at);
}

function parseXml(text, what) {
  const doc = new DOMParser().parseFromString(text, "text/xml");
  if (doc.querySelector("parsererror")) throw new Error(`${what} is not valid XML`);
  return doc;
}

/** Text of the first element with any of these local names, namespace-agnostic. */
function textOf(parent, ...names) {
  for (const name of names) {
    const found = parent.getElementsByTagNameNS("*", name)[0];
    if (found?.textContent?.trim()) return found.textContent.trim();
  }
  return "";
}

/**
 * Turn one chapter document into blocks of text.
 *
 * Block-level elements become separate paragraphs and inline markup is dropped
 * to its text, which is what a reader needs: structure without presentation.
 * Scripts and styles are removed first so their contents cannot leak in.
 */
function extractBlocks(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, style, head").forEach((node) => node.remove());

  const body = doc.body ?? doc.documentElement;
  const blocks = [];
  const seen = new Set();

  // Scraped books carry comment residue as escaped *text*, and it arrives in
  // mangled form. One real example, verified against its character codes:
  //
  //     !--sse-->\x3C!--/sse-->
  //
  // The leading `<` was eaten when the HTML parser took it for a real comment
  // opener, and `\x3C` is a literal backslash escape rather than an escaped `<`.
  // So there is no clean `<!--...-->` to match: the residue has to be
  // reconstructed before it can be recognised.
  //
  // Reconstructed only to decide whether to drop the block; the text itself is
  // passed through untouched so no prose is ever rewritten.
  const COMMENT_ONLY = (text) =>
    text.replace(/\\x3C/gi, "<").replace(/<!--[\s\S]*?-->/g, "").trim() === "";

  const push = (text) => {
    const clean = text.replace(/\s+/g, " ").trim();
    if (!clean) return;
    if (COMMENT_ONLY(clean)) return;
    // A block whose text is already covered by its ancestor is a nested element
    // being visited twice, not a second paragraph.
    if (seen.has(clean)) return;
    seen.add(clean);
    blocks.push(clean);
  };

  for (const node of body.querySelectorAll("h1, h2, h3, h4, h5, h6, p, blockquote, li, pre, div")) {
    // Only leaf-ish blocks: a div wrapping paragraphs would otherwise swallow
    // its children's text into a single run.
    if (node.querySelector("p, div, li, blockquote, h1, h2, h3, h4, h5, h6")) continue;
    push(node.textContent ?? "");
  }

  // A document with no recognised block elements (bare text, or a layout this
  // did not anticipate) still has to render.
  if (blocks.length === 0) {
    const fallback = (body.textContent ?? "").trim();
    if (fallback) push(fallback);
  }

  return blocks;
}

/** The heading a document leads with, used as the chapter title when present. */
function headingOf(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const heading = doc.querySelector("h1, h2, h3, title");
  return heading?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

/** Title from the NCX or EPUB 3 nav document, if the book ships one. */
async function readTitles(zip, opfPath, navigation) {
  const titles = new Map();

  const load = async (item) => {
    if (!item) return;
    const path = resolve(directoryOf(opfPath), item.href);
    if (!zip.entries.has(path)) return;

    try {
      if (item.mediaType === "application/x-dtbncx+xml") {
        const doc = parseXml(await zip.readText(path), "the table of contents");
        for (const point of doc.getElementsByTagNameNS("*", "navPoint")) {
          const label = textOf(point, "navLabel", "text");
          const src = point.getElementsByTagNameNS("*", "content")[0]?.getAttribute("src");
          if (label && src) titles.set(resolve(directoryOf(path), src).split("#")[0], label);
        }
      } else {
        const doc = parseXml(await zip.readText(path), "the navigation document");
        for (const link of doc.getElementsByTagNameNS("*", "a")) {
          const href = link.getAttribute("href");
          const label = link.textContent?.replace(/\s+/g, " ").trim();
          if (label && href) titles.set(resolve(directoryOf(path), href).split("#")[0], label);
        }
      }
    } catch {
      // A broken table of contents is not a reason to refuse to open the book.
    }
  };

  await load(navigation.ncx);
  await load(navigation.nav);
  return titles;
}

/**
 * Parse an EPUB into something readable.
 *
 * Returns metadata plus chapters of plain text, so nothing downstream needs to
 * understand the format.
 */
export async function readEpub(buffer) {
  const zip = openZip(buffer);

  const container = parseXml(
    await zip.readText("META-INF/container.xml"),
    "the EPUB container",
  );
  const opfPath = container
    .getElementsByTagNameNS("*", "rootfile")[0]
    ?.getAttribute("full-path");
  if (!opfPath) throw new Error("the EPUB does not name a package document");

  const opf = parseXml(await zip.readText(opfPath), "the package document");
  const opfDir = directoryOf(opfPath);

  // The manifest maps ids to files; the spine then refers to those ids.
  //
  // The navigation documents are kept apart from that map rather than filed
  // under "nav" and "ncx" keys inside it: an id could legitimately collide with
  // either word, and the resulting bug would be a book that opens to a table of
  // contents used as a chapter.
  const manifest = new Map();
  const navigation = {};

  for (const item of opf.getElementsByTagNameNS("*", "item")) {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    if (!id || !href) continue;

    const entry = {
      href,
      path: resolve(opfDir, href),
      mediaType: item.getAttribute("media-type") ?? "",
    };
    manifest.set(id, entry);

    const properties = item.getAttribute("properties") ?? "";
    if (properties.split(/\s+/).includes("nav")) navigation.nav = entry;
    if (entry.mediaType === "application/x-dtbncx+xml") navigation.ncx = entry;
  }

  const titles = await readTitles(zip, opfPath, navigation);

  const chapters = [];
  for (const itemref of opf.getElementsByTagNameNS("*", "itemref")) {
    const item = manifest.get(itemref.getAttribute("idref") ?? "");
    if (!item || !zip.entries.has(item.path)) continue;

    const html = await zip.readText(item.path);
    const blocks = extractBlocks(html);
    if (blocks.length === 0) continue;

    chapters.push({
      title: titles.get(item.path) || headingOf(html) || `Chapter ${chapters.length + 1}`,
      blocks,
    });
  }

  if (chapters.length === 0) throw new Error("no readable chapters in this EPUB");

  // Cover art: EPUB 3 marks it on the manifest item, EPUB 2 names it in metadata.
  //
  // `getElementsByTagNameNS` hands back an HTMLCollection, which has no `find`,
  // so these are spread into arrays first — reaching for `.find` on the
  // collection itself fails silently and the cover just never appears.
  const items = [...opf.getElementsByTagNameNS("*", "item")];
  const metaTags = [...opf.getElementsByTagNameNS("*", "meta")];

  const marked = items.find((item) =>
    (item.getAttribute("properties") ?? "").split(/\s+/).includes("cover-image"),
  );
  const coverId = metaTags
    .find((meta) => meta.getAttribute("name") === "cover")
    ?.getAttribute("content");

  const coverItem = marked
    ? { path: resolve(opfDir, marked.getAttribute("href")) }
    : coverId
      ? manifest.get(coverId)
      : null;

  let cover = null;
  if (coverItem && zip.entries.has(coverItem.path)) {
    const bytes = await zip.read(coverItem.path);
    cover = { bytes, type: mediaTypeFor(coverItem.path) };
  }

  return {
    title: textOf(opf, "title") || "Untitled",
    author: textOf(opf, "creator") || "Unknown author",
    language: textOf(opf, "language"),
    description: textOf(opf, "description"),
    chapters,
    cover,
  };
}

const IMAGE_TYPES = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

function mediaTypeFor(path) {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_TYPES[extension] ?? "application/octet-stream";
}
