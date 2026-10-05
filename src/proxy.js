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

const SESSION_COOKIE = "itp_session";

/** Prefixes that require a session. */
const PROTECTED = ["/member", "/dev"];

function isProtected(pathname) {
  return PROTECTED.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function proxy(request) {
  const { pathname, search } = request.nextUrl;

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
