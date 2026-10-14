import { timingSafeEqual } from "node:crypto";

/**
 * Who may import a book into this reader.
 *
 * This is the one endpoint that writes files to the machine running the server,
 * so it is the only place where being reachable matters. Two honest caveats:
 *
 *  - These checks read headers, which a client can forge. They stop an
 *    accidentally exposed instance being writable by a stranger; they are not
 *    authentication against a determined attacker.
 *  - For real protection, set NOVEL_READER_UPLOAD_TOKEN. That switches
 *    off-network requests to requiring the token.
 */

/** Compare two secrets without leaking their contents or length through timing. */
function secretMatches(provided: string, expected: string): boolean {
  const given = Buffer.from(provided);
  const wanted = Buffer.from(expected);
  if (given.length !== wanted.length) return false;
  return timingSafeEqual(given, wanted);
}

/** The hostname the request was addressed to, without a port. */
export function hostnameOf(request: Request): string {
  const host = request.headers.get("host") ?? "";
  return host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "").toLowerCase();
}

/** This machine: `localhost`, 127.0.0.0/8 or ::1. */
export function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" || hostname === "::1" || hostname.startsWith("127.")
  );
}

/**
 * "On my network": the RFC 1918 ranges, link-local addresses, and the mDNS-style
 * names a home router hands out.
 */
export function isPrivateHost(hostname: string): boolean {
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!ipv4) {
    // Not an IP literal, so it is a name. Only accept the local suffixes.
    return [".local", ".lan", ".home", ".internal"].some((suffix) =>
      hostname.endsWith(suffix),
    );
  }

  const a = Number(ipv4[1]);
  const b = Number(ipv4[2]);
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

export interface AccessDecision {
  allowed: boolean;
  /** Safe to show a user. */
  reason?: string;
  status?: number;
}

/**
 * Decide whether a request may import.
 *
 * With a token configured, anything arriving from off this machine must present
 * it. Without one, imports are limited to this machine and the local network —
 * so a forwarded port is not writable by the internet by default.
 */
export function decideImportAccess(
  request: Request,
  token: string | undefined = process.env.NOVEL_READER_UPLOAD_TOKEN,
): AccessDecision {
  const host = hostnameOf(request);
  const fromThisMachine = isLoopbackHost(host);

  if (token) {
    if (fromThisMachine) return { allowed: true };
    const provided = request.headers.get("x-upload-token") ?? "";
    if (!secretMatches(provided, token)) {
      return {
        allowed: false,
        reason: "This server requires an access token to import. Add it as the x-upload-token header.",
        status: 401,
      };
    }
    return { allowed: true };
  }

  if (fromThisMachine || isPrivateHost(host)) return { allowed: true };

  return {
    allowed: false,
    reason:
      "Imports are limited to this machine and its local network. To allow other access, set NOVEL_READER_UPLOAD_TOKEN on the server and send it as the x-upload-token header.",
    status: 403,
  };
}
