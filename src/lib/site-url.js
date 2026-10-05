// ============================================================================
// Canonical site URL, resolved exactly once.
//
// ONE source of truth for the absolute origin. `metadataBase`, the sitemap,
// robots, and every JSON-LD node read from here so they can never disagree
// about the domain, scheme, or a trailing slash.
//
// NEXT_PUBLIC_APP_URL is the same variable layout.jsx already used for
// metadataBase, so nothing new is invented: setting it in production flips
// every absolute URL at once.
//
// The fallback is deliberately a localhost URL, never a guessed domain. A
// sitemap full of http://localhost URLs is obviously wrong; one silently full
// of a domain we do not own is worse.
// ============================================================================

/** Absolute origin, no trailing slash. */
export const SITE_URL = (() => {
  const raw = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3200";
  return raw.replace(/\/+$/, "");
})();

/** True when NEXT_PUBLIC_APP_URL points at a real deploy, not a dev box. */
export const isProductionOrigin = /^https:\/\//i.test(SITE_URL);

/**
 * Join an absolute origin and a path into one canonical URL.
 *
 * `path` is always root-relative ("/topup/game"). Leading slashes on the input
 * are normalised and any query string is dropped: tracking parameters
 * (utm_*, ref) and filter/sort state must never reach the sitemap or a
 * canonical tag.
 */
export function absoluteUrl(path = "/") {
  const clean = String(path ?? "/")
    .split("?")[0]
    .split("#")[0]
    .replace(/^\/+/, "");
  return clean ? `${SITE_URL}/${clean}` : SITE_URL;
}
