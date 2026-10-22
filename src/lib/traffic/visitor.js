// ============================================================================
// Visitor identity for the self-built view engine.
//
// WHY WE ISSUE OUR OWN ID
//
// "Unique visitors" cannot be counted from IP alone: one office behind NAT is
// one IP for fifty people, and one phone on mobile data changes IP mid-session.
// So the app issues a random first-party id in a cookie and counts DISTINCT ids.
//
// WHAT IS STORED, AND WHY IT IS SAFE
//
// Only the SHA-256 of the id reaches the database. Two properties matter:
//   * the raw cookie value never lands in a table, a log, or an export, so a
//     database leak does not hand anyone a live identifier;
//   * the hash is scoped to this origin — it is not a third-party tracking id and
//     cannot be correlated with another site.
//
// The id is random, not derived from the IP or the user agent, so it cannot be
// recomputed by anyone who knows those. That is deliberate: a derived id would
// be a fingerprint wearing a cookie's clothes.
//
// CONSENT AND FAILURE POLICY
//
// This is an analytics identifier, not a login. If cookies are blocked, the id
// is simply absent and the reader falls back to `ip` — the count degrades, it
// never breaks. Nothing here throws into a request path.
// ============================================================================
import { createHash, randomBytes } from "node:crypto";

/** Cookie name. Deliberately short and non-descriptive of its purpose. */
export const VISITOR_COOKIE = "itp_vid";

/** One year. Long enough that a returning visitor is recognised, short enough
 *  that an abandoned device forgets them. */
export const VISITOR_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

/**
 * Read the visitor id from a request, if present and well formed.
 *
 * @param {{ cookies?: { get: (name: string) => { value?: string } | undefined } }} req
 * @returns {string|null}
 */
export function readVisitorId(req) {
  try {
    const raw = req?.cookies?.get?.(VISITOR_COOKIE)?.value;
    if (typeof raw !== "string") return null;
    // Shape check: 32 hex chars. Anything else is not one of ours, and hashing
    // an arbitrary attacker-supplied string would let them choose their own id.
    return /^[a-f0-9]{32}$/i.test(raw) ? raw.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Generate a fresh id. 16 bytes of CSPRNG, hex encoded. */
export function newVisitorId() {
  return randomBytes(16).toString("hex");
}

/** SHA-256 of the id. The only form that is ever persisted. */
export function hashVisitorId(id) {
  if (!id) return null;
  return createHash("sha256").update(String(id), "utf8").digest("hex");
}

/** Convenience: request → stored hash, or null. */
export function visitorHashFromRequest(req) {
  return hashVisitorId(readVisitorId(req));
}

/** Cookie options for the response that issues the id. */
export function visitorCookieOptions() {
  return {
    path: "/",
    httpOnly: true,
    // SameSite=Lax: the id must survive a normal navigation and a return from
    // a payment redirect, but must not ride along on a cross-site POST.
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: VISITOR_COOKIE_MAX_AGE,
  };
}
