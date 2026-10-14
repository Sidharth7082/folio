import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { coverImageUrl, isSafeCoverFilename } from "@/lib/catalogue/ranobedb-api";
import { remoteCoverCacheDir } from "@/lib/config/paths";

/**
 * Cover proxy for RanobeDB images.
 *
 * The API only returns an opaque filename, so the browser would otherwise have
 * to hit `images.ranobedb.org` directly on every card. This route validates the
 * filename, fetches from the fixed RanobeDB host, and caches the bytes on disk
 * so repeat views are served locally.
 *
 * Dynamic by design: covers are fetched per requested filename.
 */
export const instant = false;

const CACHE_DIR = remoteCoverCacheDir();
const MAX_BYTES = 5 * 1024 * 1024;
const ONE_YEAR = 31_536_000;

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
};

function contentTypeFor(filename: string): string {
  return CONTENT_TYPES[path.extname(filename).toLowerCase()] ?? "application/octet-stream";
}

function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "cache-control": "public, max-age=60" },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ filename: string }> },
) {
  const { filename } = await params;

  // Hard allowlist on the filename; the upstream host is never caller-supplied.
  if (!isSafeCoverFilename(filename)) return notFound();

  const cachePath = path.join(CACHE_DIR, filename);

  let bytes = await readFile(cachePath).catch(() => null);

  if (!bytes) {
    const url = coverImageUrl(filename);
    if (!url) return notFound();

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(12_000),
        cache: "no-store",
      });
      if (!response.ok) return notFound();

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength === 0 || buffer.byteLength > MAX_BYTES) return notFound();

      await mkdir(CACHE_DIR, { recursive: true });
      await writeFile(cachePath, buffer).catch(() => undefined);
      bytes = buffer;
    } catch {
      return notFound();
    }
  }

  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": contentTypeFor(filename),
      "content-length": String(bytes.byteLength),
      "cache-control": `public, max-age=${ONE_YEAR}, immutable`,
    },
  });
}
