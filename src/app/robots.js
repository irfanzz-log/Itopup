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
        // Googlebot honours `crawl-delay` only in very limited cases, so it is
        // omitted rather than written and ignored.
        userAgent: "*",
        allow: "/",
        disallow: [
          "/member/",
          "/dev/",
          "/api/",
          "/checkout/",
          // The ambiguous legacy path the operator route replaced. It 307s;
          // listing it keeps a crawler from wasting a request per old link.
          "/topup/pulsa/pulsa",
        ],
      },
    ],
    sitemap: [absoluteUrl("/sitemap.xml")],
    host: absoluteUrl("").replace(/^https?:\/\//, ""),
  };
}

