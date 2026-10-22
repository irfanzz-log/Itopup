// ============================================================================
// Proxy (formerly "middleware", renamed in Next.js 16).
//
// SCOPE, DELIBERATELY LIMITED:
// this runs on the edge-ish runtime before rendering and cannot reach the
// database. So it does the ONE thing it can do safely: check that a session
// cookie EXISTS and redirect when it does not. That is a UX optimisation, not
// an authorization decision.
//
// The real gates are:
//   * src/app/(member)/layout.jsx and src/app/dev/layout.jsx: server
//     components that verify the session against the database and the role,
//   * requireAuth / requireRole inside every route handler.
//
// Next's own documentation is explicit that a matcher change can silently
// remove proxy coverage from a path, which is why nothing security-critical is
// allowed to depend on this file.
// ============================================================================
import { NextResponse } from "next/server";
import { scanPathHit } from "./lib/traffic/classify.js";

/**
 * Mirror of sessionCookieName() in src/lib/auth/session.js. This file cannot
 * import that module: session.js pulls in Prisma through ../db.js, which must
 * never enter the proxy runtime. Keep both in sync — the name MUST match what
 * the login route and every server component read.
 */
const SESSION_COOKIE =
  process.env.NODE_ENV === "production"
    ? "itp_session"
    : process.env.NODE_ENV === "test"
      ? "itp_session_test"
      : "itp_session_dev";

/** Prefixes that require a session. */
const PROTECTED = ["/member", "/dev"];

function isProtected(pathname) {
  return PROTECTED.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function proxy(request) {
  const { pathname, search } = request.nextUrl;

  // Scanner probes never reach a route handler: /wp-admin.php has no page, so
  // Next answers 404 without running any of our code, and the traffic trail
  // would miss the single most common hostile signal there is. The proxy DOES
  // see every request, so the scan check lives here.
  //
  // WHY A FETCH AND NOT A DIRECT WRITE: this file cannot import Prisma (see the
  // scope note at the top — the proxy runtime must never load the database
  // client). So it hands the fact to an internal API route. That route is under
  // /api, which the matcher below excludes, so this call cannot recurse through
  // the proxy. Not awaited: navigation must not wait on a statistics write.
  if (scanPathHit(pathname)) {
    reportScan(request, pathname).catch(() => {});
  }

  if (!isProtected(pathname)) return NextResponse.next();

  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  if (hasSession) return NextResponse.next();

  // Preserve the intended destination so checkout state survives the login
  // round trip. Only the path+search is kept, never an absolute URL, which
  // would make this an open redirect.
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Skip API routes (they return JSON 401s from their own guards, and a redirect
  // would break fetch callers), static assets, and metadata files.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|icon.svg|robots.txt|sitemap.xml).*)",
  ],
};

/**
 * Hand one scanner probe to the internal traffic route.
 *
 * Kept at the bottom, next to `config`, because it is plumbing for the matcher
 * exclusion documented above rather than part of the auth decision.
 */
function reportScan(request, pathname) {
  const url = new URL("/api/traffic/scan", request.url);
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Shared secret, not a session: this is a server-to-server call and must
      // work for an anonymous visitor whose probe triggered it.
      "x-internal-key": process.env.INTERNAL_KEY ?? "",
    },
    body: JSON.stringify({
      path: pathname,
      userAgent: request.headers.get("user-agent"),
      referrer: request.headers.get("referer"),
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    }),
    // A hung write must not hold the navigation.
    signal: AbortSignal.timeout(1500),
  });
}
