// ============================================================================
// robots.txt, generated from the real route inventory.
//
// The rules here describe the SPLIT between public content and private
// surfaces, not a blocklist of paths we forgot:
//
//   * everything under /member, /dev, /api is private and disallowed. Those
//     areas render per-session data, must never be cached by a shared proxy,
//     and carry no indexable content. next.config.js already sends
//     X-Robots-Tag: noindex for them; this file stops the crawler from even
//     fetching them.
//
//   * /checkout and the legacy pulsa path are disallowed because they are
//     order-entry flows, not landing pages. A mid-checkout URL or a "thank
//     you" page has no search intent and no static content to index.
//
//   * CSS, JS, and images are never blocked. Blocking them is the classic way
//     to break rendering and rich-result extraction for no SEO benefit.
//
// robots.txt cannot remove an already-indexed URL. Removal is what the
// X-Robots-Tag header + the robots metadata on each private layout do; this
// file only saves crawl budget.
// ============================================================================
// @ts-check
import { absoluteUrl } from "@/lib/site-url.js";

export default function robots() {
  return {
    rules: [
      {
        // Public content is crawlable; private / per-session surfaces are not.
        // `allow: /` first, then explicit `disallow` for everything that must
        // never appear in an index. CSS/JS/images are intentionally NOT blocked
        // — blocking them breaks rendering and rich-result detection.
        userAgent: "*",
        allow: "/",
        disallow: [
          // Per-session / authenticated surfaces — no indexable content, no
          // cacheable response, and they would leak user-specific URLs to an
          // index if crawled via a shared link.
          "/member/",
          "/dev/",
          "/api/",
          // Order entry flow — no search intent. A mid-checkout URL has no
          // static content to index and would waste crawl budget.
          "/checkout/",
          // Auth flows are `noindex` via metadata, but also disallowed from
          // crawl budget: they never answer a search query.
          // Note: listing here does NOT replace the `noindex` on the pages
          // themselves — `Disallow` only stops fetching, `noindex` is what
          // removes an already-indexed URL.
          // We keep /login and /register crawlable so the `noindex` header
          // can be seen; they are therefore NOT listed here.
          // The ambiguous legacy pulsa path 307s to the operator page; listing
          // it avoids one wasted fetch per old external link.
          "/topup/pulsa/pulsa",
          // Internal Next.js internals that must not be treated as pages
          "/_next/",
        ],
      },
      // No `crawl-delay` — Googlebot ignores it outside very limited cases.
    ],
    sitemap: [absoluteUrl("/sitemap.xml")],
    // `host` is deprecated in Google's robots.txt spec and ignored. Kept only
    // for legacy crawlers; the canonical origin is `metadataBase` + sitemap
    // absolute URLs.
    host: absoluteUrl("").replace(/^https?:\/\//, ""),
  };
}

