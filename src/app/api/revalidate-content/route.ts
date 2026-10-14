import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

/**
 * Drop the cached content reads.
 *
 * Adding a book writes files under `content/` and `public/covers/`, and nothing
 * in a running server notices: page reads are cached for 30 days, so a new novel
 * stays invisible in `/browse` and on the home page until the app is rebuilt.
 * The ingest script pings this afterwards, which makes a new book appear right
 * away.
 *
 * Restricted to loopback: this app is meant to run locally, and an openly
 * reachable revalidation endpoint would let anyone force a constant cache
 * rebuild. Note that the `Host` header is client-supplied, so this is a
 * guard against accidental exposure, not a substitute for not exposing the
 * server at all.
 */
export const instant = false;

function isLoopbackHost(request: Request): boolean {
  const host = request.headers.get("host") ?? "";
  const hostname = host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export async function POST(request: Request) {
  if (!isLoopbackHost(request)) {
    return NextResponse.json(
      { ok: false, message: "This endpoint only accepts local requests." },
      { status: 403 },
    );
  }

  // The tag was attached to reads using the "max" cache profile, so that is the
  // profile that has to be invalidated (Next 16 requires the profile here).
  revalidateTag("content", "max");
  return NextResponse.json({ ok: true, revalidated: "content" });
}

/** A GET is a convenient way to check the endpoint exists without changing anything. */
export async function GET(request: Request) {
  if (!isLoopbackHost(request)) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }
  return NextResponse.json({
    ok: true,
    message: "POST here to drop the cached content reads.",
  });
}
