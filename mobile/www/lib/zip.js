/*
 * Just enough ZIP to read an EPUB.
 *
 * An EPUB is a ZIP with rules, so the only thing needed from the format is
 * "list the entries" and "give me these bytes". That is small enough to do
 * directly, which matters because this file loads before any bundler exists and
 * a dependency would mean introducing one for sixty lines of parsing.
 *
 * Inflating uses `DecompressionStream('deflate-raw')`, which is native in any
 * WebView this app can run in. No pako, no JSZip.
 *
 * Not supported, deliberately: ZIP64 (an EPUB over 4 GB), encryption, and
 * multi-disk archives. Each would need code that no real EPUB exercises.
 */

/** Central directory record: the reliable source of truth for entry metadata. */
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_SIGNATURE = 0x06054b50;

const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

/**
 * Find the End Of Central Directory record.
 *
 * It sits at the end of the file, after a comment of up to 64 KB whose length
 * is unknown, so it has to be searched for backwards rather than indexed.
 */
function findEndOfCentralDirectory(view) {
  const minimum = 22; // an EOCD with no comment
  const limit = Math.min(view.byteLength, minimum + 0xffff);

  for (let offset = minimum; offset <= limit; offset += 1) {
    const at = view.byteLength - offset;
    if (view.getUint32(at, true) === EOCD_SIGNATURE) return at;
  }
  throw new Error("not a zip: no end-of-central-directory record");
}

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * A read-only view of a ZIP's entries.
 *
 * `entries` maps a path to where its bytes live; nothing is decompressed until
 * asked, so opening a book is cheap even when it holds hundreds of chapters.
 */
export function openZip(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();

  const eocd = findEndOfCentralDirectory(view);
  const count = view.getUint16(eocd + 10, true);
  const directoryOffset = view.getUint32(eocd + 16, true);

  const entries = new Map();
  let at = directoryOffset;

  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(at, true) !== CENTRAL_SIGNATURE) {
      throw new Error(`corrupt zip: bad central directory entry ${index}`);
    }

    const method = view.getUint16(at + 10, true);
    const compressedSize = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localOffset = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));

    entries.set(name, { method, compressedSize, localOffset });
    at += 46 + nameLength + extraLength + commentLength;
  }

  /** Decompressed bytes for one entry. */
  async function read(name) {
    const entry = entries.get(name);
    if (!entry) throw new Error(`no such entry: ${name}`);

    if (view.getUint32(entry.localOffset, true) !== LOCAL_SIGNATURE) {
      throw new Error(`corrupt zip: bad local header for ${name}`);
    }

    // The local header repeats the name and extra field, and its extra field is
    // frequently a different length from the one in the central directory — some
    // writers disagree with themselves. Only the local copy can be trusted here.
    const nameLength = view.getUint16(entry.localOffset + 26, true);
    const extraLength = view.getUint16(entry.localOffset + 28, true);
    const start = entry.localOffset + 30 + nameLength + extraLength;

    const raw = bytes.subarray(start, start + entry.compressedSize);
    if (entry.method === METHOD_STORED) return raw;
    if (entry.method === METHOD_DEFLATE) return inflate(raw);
    throw new Error(`unsupported compression method ${entry.method} for ${name}`);
  }

  /** Decompressed bytes as text, assuming UTF-8. */
  async function readText(name) {
    return new TextDecoder().decode(await read(name));
  }

  /** Entry names, in the order the archive lists them. */
  function names() {
    return [...entries.keys()];
  }

  return { entries, names, read, readText };
}
