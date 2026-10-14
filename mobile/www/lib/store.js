/*
 * Where books live on the device.
 *
 * IndexedDB rather than the filesystem, because it needs no native plugin and
 * survives app restarts. The WebView's origin is stable (`http://localhost`), so
 * the data is not at risk of being orphaned by an origin change.
 *
 * A book record holds the original file bytes, not the parsed text. Parsing is
 * ~1.5 s for a 3 MB novel, so storing the parse would save that on every open —
 * but it would also multiply the space used and mean a parser fix never applies
 * to books already imported. Bytes are the honest thing to keep; the parse is
 * cached in memory for the session instead.
 */

const DB_NAME = "folio";
const DB_VERSION = 1;
const BOOKS = "books";

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(BOOKS)) {
        const store = db.createObjectStore(BOOKS, { keyPath: "id" });
        store.createIndex("addedAt", "addedAt");
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("could not open the library"));
  });

  return dbPromise;
}

/** Run one transaction and resolve with the request that matters. */
async function withStore(mode, run) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BOOKS, mode);
    const store = tx.objectStore(BOOKS);

    let result;
    try {
      result = run(store);
    } catch (error) {
      reject(error);
      return;
    }

    tx.oncomplete = () => resolve(result?.result ?? result);
    tx.onerror = () => reject(tx.error ?? new Error("library transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("library transaction aborted"));
  });
}

/** Every book, newest first, without the file bytes — a list does not need them. */
export async function listBooks() {
  const all = await withStore("readonly", (store) => store.getAll());
  return (all ?? [])
    .map(({ bytes, ...rest }) => rest)
    .sort((a, b) => (b.addedAt ?? "").localeCompare(a.addedAt ?? ""));
}

/** One book including its bytes, or null. */
export async function getBook(id) {
  const book = await withStore("readonly", (store) => store.get(id));
  return book ?? null;
}

export async function putBook(book) {
  await withStore("readwrite", (store) => store.put(book));
}

export async function removeBook(id) {
  await withStore("readwrite", (store) => store.delete(id));
}

/**
 * Remember how far through a book the reader got.
 *
 * Written on every chapter change rather than every scroll, so a phone that dies
 * mid-chapter loses the scroll position but not the chapter.
 */
export async function saveProgress(id, progress) {
  const book = await getBook(id);
  if (!book) return;
  await putBook({ ...book, progress, lastReadAt: new Date().toISOString() });
}
