import { promises as fs } from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

import { coversDir } from "@/lib/config/paths";

/**
 * Serve a book's own cover from disk.
 *
 * Covers deliberately do not go through `public/` any more. A production server
 * builds its static file list at boot, so a cover written *after* startup — which
 * is every cover an import produces — 404s until the server restarts. Reading
 * from the filesystem per request removes that whole class of bug.
 *
 * The filename is validated against a strict allowlist before any path is built,
 * so a crafted name cannot escape the covers directory.
 */
export const instant = false;

const COVER_FILE = /^[A-Za-z0-9_-]{1,120}\.(?:jpg|jpeg|png|webp|avif|gif|svg)$/i;

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;

  if (!COVER_FILE.test(file)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const extension = path.extname(file).toLowerCase();
  const target = path.join(coversDir(), file);

  try {
    const data = await fs.readFile(target);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "content-type": CONTENT_TYPES[extension] ?? "application/octet-stream",
        "content-length": String(data.byteLength),
        // Re-importing a book replaces its cover under the same name, so this
        // must not be cached for long.
        "cache-control": "public, max-age=0, must-revalidate",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
