// ============================================================================
// Canonical site URL, resolved exactly once.
//
// ONE source of truth for the absolute origin. `metadataBase`, the sitemap,
// robots, and every JSON-LD node read from here so they can never disagree
// about the domain, scheme, or a trailing slash.
//
// WHY THIS IS NOT A PLAIN `process.env` READ ANY MORE
//
// NEXT_PUBLIC_APP_URL is inlined at BUILD time, and `.env.prod` is deliberately
// not committed. On a host that injects variables at RUNTIME (Vercel), a value
// set only at runtime is too late for an inlined constant: the build bakes in
// whatever was visible then. When nothing was visible, the old fallback
// silently produced `http://localhost:3200`, and the deployed sitemap.xml
// advertised localhost URLs to Google — which is exactly what was reported.
//
// Resolution order:
//   1. NEXT_PUBLIC_APP_URL, when set.
//   2. The platform's production host, when this is a production build and the
//      platform exposes one (Vercel sets VERCEL_PROJECT_PRODUCTION_URL).
//   3. In production, the canonical origin below. A production build has no
//      business guessing, and emitting localhost is strictly worse than naming
//      the domain the site actually serves.
//   4. Localhost, but ONLY outside production.
//
// `isProductionOrigin` lets callers refuse to emit a non-public URL into
// anything indexable, so a misconfiguration surfaces instead of shipping.
// ============================================================================

/** The site's real, canonical origin. */
const CANONICAL_ORIGIN = "https://itopup.my.id";

function resolveSiteUrl() {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  const isProduction = process.env.NODE_ENV === "production";

  if (isProduction) {
    // Vercel exposes the production domain even when a NEXT_PUBLIC_* variable
    // was never defined at build time. It carries no scheme, so add https.
    const platformHost =
      process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() ||
      process.env.VERCEL_URL?.trim();
    if (platformHost) return `https://${platformHost.replace(/\/+$/, "")}`;

    // Last resort in production: the domain this project owns. Never localhost.
    return CANONICAL_ORIGIN;
  }

  return "http://localhost:3200";
}

/** Absolute origin, no trailing slash. */
export const SITE_URL = resolveSiteUrl();

/** True when SITE_URL points at a real deploy, not a dev box. */
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
