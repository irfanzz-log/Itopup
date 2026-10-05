// ============================================================================
// Sitemap data service.
//
// The sitemap is generated from the same tables the storefront renders, so a
// game added through the admin panel appears in it without a deploy. It never
// reads the provider: a provider sync outage must not be able to empty the
// sitemap.
//
// WHAT GETS IN, AND WHY:
//   * the fixed marketing/help pages,
//   * /topup plus one URL per active category,
//   * one URL per ACTIVE game that has at least one sellable product, under its
//     real category segment,
//   * one URL per pulsa operator that has at least one active variant.
//
// WHAT STAYS OUT:
//   * /member, /dev, /api, /checkout — private or per-session, no indexable
//     content. robots.txt disallows them too.
//   * inactive games/products/variants — a sitemap URL that 200s today and 404s
//     tomorrow after a catalogue change is how a site teaches Google to ignore
//     its sitemap.
//   * variant-level URLs (e.g. /topup/game/mobile-legends/diamonds/d86). Those
//     are tabs on the game page, not routes: there is no such page to index.
//   * query-string URLs (filters, sorting, utm_*). absoluteUrl() drops them.
//   * promos have no dedicated detail route; /promo is the one public page.
//
// lastmod uses each row's own `updatedAt`, never a global timestamp. A
// blanket "today" lastmod tells Google nothing changed-specific is worth
// recrawling, which defeats the field's only real purpose.
// ============================================================================

import { prisma } from "../lib/db.js";
import { CATEGORY_KIND, CATEGORY_KIND_PATH } from "../lib/constants.js";

/**
 * The fixed routes that always exist. `lastModified` is null for pages whose
 * content is not versioned in the database; Google then recrawls on its own
 * schedule instead of being told a fabricated date.
 *
 * /login and /register are deliberately absent: both are noindex and neither
 * answers a search query. Listing a URL in the sitemap that carries no
 * indexable content is noise that dilutes the file.
 */
export const FIXED_SITEMAP_ENTRIES = [
  { url: "/", label: "Beranda", priority: 1.0 },
  { url: "/topup", label: "Top Up Game & Pulsa", priority: 0.9 },
  { url: "/promo", label: "Promo & Voucher", priority: 0.6 },
  { url: "/bantuan", label: "Bantuan & Cara Top Up", priority: 0.6 },
  { url: "/syarat", label: "Syarat & Ketentuan", priority: 0.3 },
];

/** A category the sitemap should link to, or null when it has nothing to sell. */
export async function sitemapCategories() {
  const categories = await prisma.category.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }],
    select: {
      kind: true, name: true, slug: true, updatedAt: true,
      games: {
        where: { isActive: true },
        select: { id: true,
          products: { where: { isActive: true }, select: { id: true,
            variants: { where: { isActive: true }, select: { id: true } } } } },
      },
      products: {
        where: { isActive: true },
        select: { id: true, variants: { where: { isActive: true }, select: { id: true } } },
      },
    },
  });

  return categories
    .map((category) => {
      // A category earns a sitemap URL only when a customer can actually buy
      // something in it. Counting rows would list an empty shell.
      const sellable =
        category.kind === CATEGORY_KIND.PULSA
          ? category.products.filter((p) => p.variants.length > 0).length
          : category.games.filter((g) =>
              g.products.some((p) => p.variants.length > 0)
            ).length;

      return {
        kind: category.kind,
        path: CATEGORY_KIND_PATH[category.kind] ?? category.slug,
        name: category.name,
        lastModified: category.updatedAt,
        sellable,
      };
    })
    .filter((entry) => entry.sellable > 0);
}

/**
 * Every game page URL, plus the pulsa operator pages.
 *
 * One row per sellable game. A game whose products all lack active variants
 * renders an empty grid and is excluded for the same reason as an empty
 * category. `updatedAt` comes from the game row, so recrawling a game is tied
 * to the last real content change for it.
 */
export async function sitemapGamePages() {
  const games = await prisma.game.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      name: true, slug: true, updatedAt: true, isPopular: true,
      category: { select: { kind: true } },
      products: {
        where: { isActive: true },
        select: { id: true, variants: { where: { isActive: true }, select: { id: true } } },
      },
    },
  });

  return games
    .filter((game) => game.products.some((p) => p.variants.length > 0))
    .map((game) => {
      const kind = game.category?.kind ?? CATEGORY_KIND.GAME;

      // Pulsa is one game whose BUYABLE units are operator products. Its own
      // page would be the ambiguous /topup/pulsa/pulsa this route replaced, so
      // the operator URLs below replace it instead.
      if (kind === CATEGORY_KIND.PULSA) return null;

      return {
        // The URL segment is derived from the category kind, never from the
        // request path, so a game can never appear under two categories.
        path: `/topup/${CATEGORY_KIND_PATH[kind] ?? "game"}/${game.slug}`,
        name: game.name,
        lastModified: game.updatedAt,
        isPopular: Boolean(game.isPopular),
      };
    })
    .filter(Boolean);
}

/**
 * One URL per pulsa operator, the pages /topup/pulsa/[operator] renders.
 * Operators with no active variants are skipped: the page renders an empty
 * state and the sitemap should not promise content it does not have.
 */
export async function sitemapPulsaOperators() {
  const operators = await prisma.product.findMany({
    where: { isActive: true, game: { slug: "pulsa", isActive: true } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      name: true, slug: true, updatedAt: true,
      variants: { where: { isActive: true }, select: { id: true } },
    },
  });

  return operators
    .filter((op) => op.variants.length > 0)
    .map((op) => ({
      path: `/topup/${CATEGORY_KIND_PATH.PULSA}/${op.slug}`,
      name: op.name,
      lastModified: op.updatedAt,
    }));
}
