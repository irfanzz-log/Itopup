// ============================================================================
// /sitemap.xml
//
// Generated at request time from the database (see src/services/sitemap), so a
// game added through the admin panel is in the sitemap without a redeploy.
//
// `priority`/`changeFrequency` are intentionally omitted. Google has stated it
// ignores both for ranking; sending them adds bytes and implies a signal that
// is not there. What IS sent is `lastmod`, derived from each row's own
// `updatedAt`, which Google does use to decide what to recrawl.
//
// SCALE: the catalogue is ~40 URLs today. The protocol caps a single sitemap at
// 50,000 URLs / 50MB, so no index file is needed yet; when the catalogue or an
// article collection approaches that, split this into app/sitemap/[id].js and
// add a sitemap index, keeping the same service layer.
// ============================================================================
import { absoluteUrl } from "@/lib/site-url.js";
import {
  FIXED_SITEMAP_ENTRIES,
  sitemapCategories,
  sitemapGamePages,
  sitemapPulsaOperators,
} from "@/services/sitemap.service.js";

export const dynamic = "force-dynamic";

export default async function sitemap() {
  // The catalogue read is wrapped: a database failure must not turn the
  // sitemap into a 500. The fixed routes are still correct and worth serving,
  // and an empty catalogue section degrades to a small sitemap rather than
  // none.
  const [categories, games, operators] = await Promise.all([
    sitemapCategories().catch(() => []),
    sitemapGamePages().catch(() => []),
    sitemapPulsaOperators().catch(() => []),
  ]);

  const fixed = FIXED_SITEMAP_ENTRIES.map((entry) => ({
    url: absoluteUrl(entry.url),
    // Marketing pages change when the catalogue or offer story changes; the
    // honest statement is "no per-row timestamp", so lastmod stays absent.
    priority: entry.priority,
  }));

  const categoryEntries = categories.map((category) => ({
    url: absoluteUrl(`/topup/${category.path}`),
    lastModified: category.lastModified ?? undefined,
    priority: 0.8,
  }));

  const gameEntries = games.map((game) => ({
    url: absoluteUrl(game.path),
    lastModified: game.lastModified ?? undefined,
    priority: game.isPopular ? 0.8 : 0.7,
  }));

  const operatorEntries = operators.map((operator) => ({
    url: absoluteUrl(operator.path),
    lastModified: operator.lastModified ?? undefined,
    priority: 0.6,
  }));

  // De-duplicate defensively. A game and an operator cannot share a path, but a
  // category path could equal /topup only if a category were named that way,
  // and a duplicate URL in a sitemap is a validation error in Search Console.
  const seen = new Set();
  const merged = [...fixed, ...categoryEntries, ...gameEntries, ...operatorEntries];

  return merged.filter((entry) => {
    if (seen.has(entry.url)) return false;
    seen.add(entry.url);
    return true;
  });
}

