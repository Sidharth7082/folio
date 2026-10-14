import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

import { ingestOne } from "../../../../scripts/ingest.mjs";
import { decideImportAccess } from "@/lib/import/access";

/**
 * Accept an uploaded book and put it in the reader.
 *
 * This is the one endpoint that writes to the machine running the server, so it
 * validates everything it can: who is asking, the file type, and the size. The
 * uploaded name is never used as a path — the file is written to a fresh temp
 * directory under a sanitised name, and the importer derives the real slug from
 * the book's own title.
 */
export const instant = false;

/** Generous for a novel, small enough that the upload is buffered happily. */
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

const ALLOWED_EXTENSIONS = new Set([".epub", ".txt", ".md"]);

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, message }, { status });
}

export async function POST(request: Request) {
  const access = decideImportAccess(request);
  if (!access.allowed) return jsonError(access.reason ?? "Not allowed.", access.status ?? 403);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError("Could not read the upload. Send it as multipart/form-data.", 400);
  }

  const upload = form.get("file");
  if (!(upload instanceof File) || upload.size === 0) {
    return jsonError("No file was attached.", 400);
  }
  if (upload.size > MAX_UPLOAD_BYTES) {
    return jsonError(
      `That file is ${(upload.size / 1048576).toFixed(1)} MB. The limit is ${
        MAX_UPLOAD_BYTES / 1048576
      } MB.`,
      413,
    );
  }

  // Only the extension is taken from the client-supplied name, and it has to be
  // one the importer understands.
  const originalName = path.basename(upload.name || "book.epub");
  const extension = path.extname(originalName).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return jsonError(
      `"${extension || "that file"}" is not supported. Upload an .epub, .txt or .md file.`,
      415,
    );
  }

  // Strip anything that could matter in a path, then keep the readable name so
  // the importer can fall back to it as a title for .txt and .md uploads.
  const safeName =
    originalName.replace(/[^\p{L}\p{N}\s._()-]+/gu, "").slice(0, 120) || `book${extension}`;

  // A fresh directory per upload, so the filename itself stays meaningful.
  const workDir = path.join(os.tmpdir(), `folio-upload-${randomUUID()}`);
  const target = path.join(workDir, safeName);

  try {
    await fs.mkdir(workDir, { recursive: true });
    await fs.writeFile(target, Buffer.from(await upload.arrayBuffer()));

    const overwrite = form.get("overwrite") === "true";
    const result = await ingestOne(target, { overwrite });

    if (result.skipped) {
      return jsonError(
        `"${result.title}" is already in your library. Tick "replace" to import it again.`,
        409,
      );
    }

    // Content reads are cached for 30 days; without this the new book would not
    // appear in /browse or on the home page.
    revalidateTag("content", "max");

    return NextResponse.json({
      ok: true,
      slug: result.slug,
      title: result.title,
      chapterCount: result.chapterCount,
      cover: result.cover,
      url: `/novel/${result.slug}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Import failed.";
    return jsonError(message, 500);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
