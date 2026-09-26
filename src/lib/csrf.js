// ============================================================================
// CSRF protection.
//
// The session cookie is SameSite=Lax, which already blocks cross-site POSTs in
// every current browser. This module adds the two independent checks that turn
// "browser-dependent" into "enforced by us":
//
//   1. Origin / Sec-Fetch-Site validation on every mutating request. A request
//      whose Origin does not match the app origin is rejected outright. This is
//      the primary defence and needs no client-side wiring.
//   2. A double-submit token, for the rare case where a form must work from an
//      origin-less context. The token is readable by JS by design (it is not a
//      secret, it proves the request was built by our own page).
// ============================================================================
import { randomBytes, timingSafeEqual } from "node:crypto";
import { AppError } from "./errors.js";
import { CSRF_COOKIE, CSRF_HEADER } from "./csrf-constants.js";

// Re-exported so server callers have a single import path. Client components
// must import from `./csrf-constants.js` directly — see that file for why.
export { CSRF_COOKIE, CSRF_HEADER };

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function generateCsrfToken() {
  return randomBytes(32).toString("base64url");
}

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Allowed origins: the configured app URL plus localhost dev ports. An empty
 * list would disable the check entirely, so it is never empty.
 */
function allowedOrigins() {
  const origins = new Set();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl) {
    try {
      origins.add(new URL(appUrl).origin);
    } catch {
      /* malformed env var — ignored, the checks below still apply */
    }
  }
  if (process.env.NODE_ENV !== "production") {
    for (const port of [3000, 3100, 3200]) origins.add(`http://localhost:${port}`);
    origins.add("http://127.0.0.1:3000");
  }
  return origins;
}

/**
 * Reject a mutating request that did not come from our own pages.
 *
 * `Sec-Fetch-Site` is sent by every modern browser and cannot be set by page
 * JavaScript, so when present it is authoritative. When absent (older clients,
 * server-to-server calls with a cookie) we fall back to Origin, and only then
 * to the double-submit token.
 */
export function assertSameOrigin(req, { allowToken = true } = {}) {
  if (SAFE_METHODS.has(req.method)) return;

  const site = req.headers.get("sec-fetch-site");
  if (site) {
    if (site === "same-origin" || site === "none") return;
    throw new AppError("ITP_FORBIDDEN", "Permintaan lintas situs ditolak.");
  }

  const origin = req.headers.get("origin");
  if (origin) {
    if (allowedOrigins().has(origin)) return;
    throw new AppError("ITP_FORBIDDEN", "Permintaan lintas situs ditolak.");
  }

  // No Sec-Fetch-Site and no Origin: fall back to the double-submit token.
  if (allowToken) {
    const cookieToken = readCookie(req, CSRF_COOKIE);
    const headerToken = req.headers.get(CSRF_HEADER);
    if (cookieToken && headerToken && safeEqual(cookieToken, headerToken)) return;
  }

  throw new AppError("ITP_FORBIDDEN", "Permintaan tidak dapat diverifikasi.");
}

/** Minimal cookie reader — avoids importing NextRequest-only APIs into services. */
export function readCookie(req, name) {
  const raw = req?.headers?.get?.("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

/**
 * The token cookie is intentionally NOT HttpOnly: the client reads it and
 * echoes it in the header. It is bound to the session by name, not by value, so
 * leaking it alone grants nothing — an attacker still needs the HttpOnly
 * session cookie, which same-origin policy keeps out of reach.
 */
export function csrfCookieOptions(isProduction) {
  return {
    httpOnly: false,
    sameSite: "lax",
    secure: isProduction,
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  };
}
