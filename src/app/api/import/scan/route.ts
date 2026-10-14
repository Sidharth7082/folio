import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

import { discoverFiles, ingestOne, isSupportedFile } from "../../../../../scripts/ingest.mjs";
import { decideImportAccess } from "@/lib/import/access";
import { inboxStatus } from "@/lib/import/inbox";

/**
 * Import everything sitting in the configured inbox folder.
 *
 * For someone with a folder of EPUBs this is the fastest route in: copy files
 * across, press one button. The folder is server-configured and never taken
 * from the request — see `lib/import/inbox`.
 */
export const instant = false;

/** One click imports at most this many books, so a stray huge folder cannot run away. */
const MAX_FILES_PER_SCAN = 200;

export async function GET(request: Request) {
  const access = decideImportAccess(request);
  const inbox = inboxStatus();

  return NextResponse.json({
    ok: true,
    inbox,
    canImport: access.allowed,
    requiresToken: Boolean(process.env.NOVEL_READER_UPLOAD_TOKEN),
    maxFiles: MAX_FILES_PER_SCAN,
  });
}

export async function POST(request: Request) {
  const access = decideImportAccess(request);
  if (!access.allowed) {
    return NextResponse.json(
      { ok: false, message: access.reason ?? "Not allowed." },
      { status: access.status ?? 403 },
    );
  }

  const inbox = inboxStatus();
  if (!inbox.exists) {
    return NextResponse.json({ ok: false, message: inbox.hint }, { status: 400 });
  }

  let overwrite = false;
  try {
    const body = (await request.json()) as { overwrite?: unknown };
    overwrite = body?.overwrite === true;
  } catch {
    // No body, or not JSON: use the defaults.
  }

  try {
    const found = (await discoverFiles(inbox.dir, { recursive: true })).filter((file) =>
      isSupportedFile(file),
    );
    const batch = found.slice(0, MAX_FILES_PER_SCAN);

    const imported: { slug: string; title: string; chapterCount: number; url: string }[] = [];
    const skipped: string[] = [];
    const failed: { file: string; message: string }[] = [];

    for (const file of batch) {
      try {
        const result = await ingestOne(file, { overwrite });
        if (result.skipped) {
          skipped.push(result.title);
          continue;
        }
        imported.push({
          slug: result.slug,
          title: result.title,
          chapterCount: result.chapterCount,
          url: `/novel/${result.slug}`,
        });
      } catch (error) {
        failed.push({
          file: file.split("/").pop() ?? file,
          message: error instanceof Error ? error.message : "Import failed.",
        });
      }
    }

    if (imported.length > 0) revalidateTag("content", "max");

    return NextResponse.json({
      ok: true,
      folder: inbox.dir,
      scanned: batch.length,
      imported,
      skipped,
      failed,
      truncated: found.length > batch.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read that folder.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
