// ============================================================================
// Route-handler utilities: cookies, CSRF, rate-limit keys.
//
// Every API route in this app follows the same shape:
//   export const POST = route(async (req, ctx, { log }) => { … });
// which guarantees a consistent envelope and that no unhandled error ever
// reaches the client as a stack trace.
// ============================================================================
import { NextResponse } from "next/server";
import { assertSameOrigin, CSRF_COOKIE, generateCsrfToken, csrfCookieOptions } from "./csrf.js";
import { clientIp, enforce, presets } from "./rate-limit.js";
import { sessionCookieOptions, clearSessionCookieOptions, SESSION_COOKIE } from "./auth/session.js";
import { AppError } from "./errors.js";
import { createLogger } from "./logger.js";

/** Standard request context extracted from a NextRequest. */
export function requestContext(req) {
  const ip = clientIp(req);
  const userAgent = req.headers.get("user-agent");
  return {
    ip,
    userAgent: userAgent ? userAgent.slice(0, 255) : null,
    path: req?.nextUrl?.pathname ?? null,
    method: req?.method ?? null,
  };
}

/**
 * Guard a mutating request: same-origin (CSRF) then rate limit.
 * Call this at the top of every POST/PATCH/DELETE handler.
 *
 * @param {Request} req
 * @param {{ rateLimit?: Array<[string, object]>|null, log?: object }} [options]
 */
export async function guardMutation(req, { rateLimit = null, log } = {}) {
  assertSameOrigin(req);
  if (rateLimit?.length) {
    try {
      await enforce(rateLimit);
    } catch (err) {
      log?.warn?.("request.rate_limited", { keys: rateLimit.map(([k]) => k) });
      throw err;
    }
  }
}

/**
 * Rate-limit keys for an auth endpoint.
 *
 * Two buckets on purpose: a tight one keyed on the account identifier (stops
 * brute-forcing one account) and a loose one keyed on the IP (stops spraying
 * across many accounts without locking out a shared NAT).
 */
export function authRateLimitKeys({ scope, identifier, ip }) {
  const keys = [];
  if (identifier) keys.push([`${scope}:id:${identifier}`, presets.login]);
  if (ip) keys.push([`${scope}:ip:${ip}`, presets.loginIp]);
  // No IP and no identifier (proxy headers absent): fall back to a global bucket
  // so the limiter still does something rather than nothing.
  if (keys.length === 0) keys.push([`${scope}:anon`, presets.loginIp]);
  return keys;
}

/** Generic bucket for a route, keyed by user when known else IP. */
export function bucket(scope, preset, { userId, ip }) {
  const subject = userId ? `u:${userId}` : ip ? `ip:${ip}` : "anon";
  return [`${scope}:${subject}`, preset];
}

/** Attach the session cookie to a response. */
export function withSessionCookie(response, token) {
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return response;
}

/** Attach a cleared session cookie to a response (logout). */
export function withClearedSessionCookie(response) {
  response.cookies.set(SESSION_COOKIE, "", clearSessionCookieOptions());
  return response;
}

/**
 * Ensure a CSRF double-submit token cookie exists, and return the value.
 * Called by the root layout's server side via a route, or lazily by any page
 * that renders a form.
 */
export function withCsrfCookie(response, existingToken) {
  const token = existingToken || generateCsrfToken();
  response.cookies.set(CSRF_COOKIE, token, csrfCookieOptions(process.env.NODE_ENV === "production"));
  return { response, token };
}

// ---------------------------------------------------------------------------
// The response envelope lives in ./http.js; re-exported here so a route handler
// has exactly ONE import path (`@/lib/api.js`) instead of having to know which
// of the two modules owns which helper. `http.js` never imports this file, so
// there is no cycle.
// ---------------------------------------------------------------------------
export { requestId, ok, fail, toFail, route, readJson } from "./http.js";

// Validation lives in validation.js, but route handlers import it from here so
// there is ONE import path per route file. `parse()` is preferred over a raw
// `schema.parse()` in a route: it throws an AppError with field-level details,
// which the envelope renders as 422 instead of an opaque 500.
export { parse, tryParse } from "./validation.js";

export { NextResponse, AppError, createLogger };
