/*
 * Places a book can come from, other than the files already on the phone.
 *
 * The point is the libraries you own. Calibre-Web, Kavita and Komga all publish
 * an OPDS feed, and OPDS is a small enough format for a phone to read unaided:
 * a navigation feed lists folders, an acquisition feed lists books with links to
 * download. Nothing here knows anything about a particular website's markup or
 * scrapes anyone's pages — it speaks a documented format to a server the reader
 * already has an account on.
 *
 * A source is three things: fields to fill in, a way to list what is there, and
 * a way to fetch one book.
 */

const KEY = "folio.sources";

/** The label to show a source under, which is mostly its address. */
export function labelFor(id, config) {
  const where = hostOf(config?.url ?? "");
  return where ? `${SOURCES[id].label} · ${where}` : SOURCES[id].label;
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function firstIn(node, name) {
  return node.getElementsByTagNameNS("*", name)[0] ?? null;
}

function textIn(node, name) {
  return firstIn(node, name)?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

/**
 * The file name to store a downloaded book under.
 *
 * The server's own name for it if there is one, because that is the name the
 * reader will see in their library server too, and otherwise the book's title.
 */
function nameFor(entry, disposition) {
  const named = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition ?? "")?.[1];
  if (named) {
    try {
      return decodeURIComponent(named);
    } catch {
      return named;
    }
  }

  const safe = entry.title.replace(/[\\/:*?"<>|]/g, " ").trim().slice(0, 80);
  return `${safe || "book"}.epub`;
}

const opds = {
  label: "OPDS catalogue",
  placeholder: "http://192.168.0.10:8083/opds",

  /**
   * List one feed.
   *
   * An entry is a folder if it points at another feed and a book if it offers an
   * EPUB, which is the whole of the format's structure that matters here.
   */
  async browse(config, href) {
    const url = href || config.url;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`the catalogue answered ${response.status}`);

    const doc = new DOMParser().parseFromString(await response.text(), "text/xml");
    if (doc.querySelector("parsererror")) {
      throw new Error("that address did not answer with an OPDS feed");
    }

    const entries = [];
    for (const node of doc.getElementsByTagNameNS("*", "entry")) {
      const links = [...node.getElementsByTagNameNS("*", "link")];
      const find = (test) =>
        links.find((link) => test(link.getAttribute("rel") ?? "", link.getAttribute("type") ?? ""));

      // The EPUB first, so that an entry which offers both a download and a
      // further feed is treated as the book it is.
      const epub = find((rel, type) => rel.includes("acquisition") && type.includes("epub"));
      const next =
        epub ??
        find((rel) => rel.includes("subsection")) ??
        find((rel, type) => type.includes("atom+xml"));
      if (!next) continue;

      entries.push({
        kind: next === epub ? "book" : "feed",
        title: textIn(node, "title") || "Untitled",
        author: textIn(node, "name"),
        summary: textIn(node, "content") || textIn(node, "summary"),
        href: new URL(next.getAttribute("href") ?? "", url).toString(),
      });
    }

    return {
      title: textIn(doc.documentElement, "title") || hostOf(url),
      url,
      entries,
    };
  },

  async book(config, entry) {
    const response = await fetch(entry.href);
    if (!response.ok) throw new Error(`the catalogue answered ${response.status} for that book`);

    const bytes = await response.arrayBuffer();
    if (!bytes.byteLength) throw new Error("that book came back empty");

    return { bytes, fileName: nameFor(entry, response.headers.get("content-disposition")) };
  },
};

/** Every kind of source the app knows, by id. */
export const SOURCES = { opds };

/** What is installed. A list, because a reader may have more than one server. */
export function loadSources() {
  try {
    const list = JSON.parse(globalThis.localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((source) => SOURCES[source?.id]) : [];
  } catch {
    return [];
  }
}

export function saveSources(list) {
  try {
    globalThis.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // A blocked store is not worth interrupting reading over.
  }
}
