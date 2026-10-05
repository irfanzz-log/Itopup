// ============================================================================
// Catalog service.
//
// The database is the source of truth for everything the storefront shows. The
// provider is NEVER read on a request path. The sync job writes provider data
// into these tables and the UI reads them.
//
// PRICE RULE: `costPrice` (harga modal) is admin-only. Every public projection
// below omits it deliberately. A single forgotten `select` is how a competitor
// learns your margin, so the public shape is defined once, here, and reused.
// ============================================================================
import { prisma } from "../lib/db.js";
import { AppError } from "../lib/errors.js";
import { CATEGORY_KIND, CATEGORY_KIND_PATH, ORDER_STATUS } from "../lib/constants.js";
import { sellingPriceFromCost, unitMargin, marginPercent } from "../config/pricing.js";
import { productIcon, gameIcon } from "../config/icons.js";

/** Fields safe to expose on the public storefront. No cost, no provider codes. */
const PUBLIC_VARIANT_SELECT = {
  id: true,
  name: true,
  slug: true,
  denomination: true,
  unit: true,
  sellingPrice: true,
  isActive: true,
  stock: true,
  sortOrder: true,
};

const PUBLIC_PRODUCT_SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  icon: true,
  sortMode: true,
  sortOrder: true,
  variants: {
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { denomination: "asc" }],
    select: PUBLIC_VARIANT_SELECT,
  },
};

const PUBLIC_GAME_SELECT = {
  id: true,
  name: true,
  slug: true,
  publisher: true,
  description: true,
  logo: true,
  banner: true,
  inputFields: true,
  supportsValidation: true,
  isPopular: true,
  sortOrder: true,
  category: { select: { id: true, kind: true, name: true, slug: true } },
};

/** Fields an admin may see, including margin data. */
const ADMIN_VARIANT_SELECT = {
  ...PUBLIC_VARIANT_SELECT,
  costPrice: true,
  createdAt: true,
  updatedAt: true,
  // Needed to decide delete vs deactivate: a variant that has been ordered
  // cannot be hard-deleted without orphaning transaction history.
  _count: { select: { orderItems: true } },
  providerProducts: {
    select: {
      id: true,
      providerCode: true,
      providerPrice: true,
      providerStock: true,
      isAvailable: true,
      lastSyncAt: true,
      provider: { select: { code: true, name: true, status: true } },
    },
  },
};

// ── Categories ──────────────────────────────────────────────────────────────

export async function listCategories({ includeInactive = false } = {}) {
  const categories = await prisma.category.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true, kind: true, name: true, slug: true, description: true,
      icon: true, sortOrder: true, isActive: true,
      _count: { select: { games: { where: { isActive: true } } } },
    },
  });

  // "7 layanan tersedia" must mean seven operators for PULSA, not one game.
  // The tile count is what the customer reads to decide whether the category
  // is worth opening, so it has to count what they can actually buy.
  return Promise.all(
    categories.map(async (category) => {
      if (category.kind !== CATEGORY_KIND.PULSA) {
        return { ...category, entryCount: category._count.games };
      }
      const operators = await prisma.product.count({
        where: {
          game: { categoryId: category.id },
          ...(includeInactive ? {} : { isActive: true }),
          // An operator with nothing sellable is not a "layanan tersedia".
          variants: { some: { isActive: true } },
        },
      });
      return { ...category, entryCount: operators };
    }),
  );
}

// ── Games ───────────────────────────────────────────────────────────────────

/**
 * The second-level filter on /dev/products.
 *
 * For GAME the meaningful split is the game itself (Mobile Legends, Free Fire,
 * …), see the `entries` this returns for kind = GAME.
 *
 * For PULSA it is NOT. Pulsa is one game whose brands are the OPERATORS, so a
 * game filter would offer a single useless option ("Pulsa") and "memfilter
 * pulsa" would never narrow to Telkomsel vs XL vs Indosat, which is the only
 * distinction the operator actually wants to make. This returns the operators
 * (Products) instead, so the second select filters by provider/brand, and it
 * pairs with the `product` filter the query string already supported but the
 * page never wired up.
 *
 * @param {string} kindOrSlug GAME | PULSA, or the URL slug
 * @returns {Promise<{ category: object|null, entries: { id, name, slug }[] }>}
 */
export async function listFilterEntries(kindOrSlug, { includeInactive = false } = {}) {
  const kind = resolveCategoryKind(kindOrSlug);

  const category = await prisma.category.findUnique({
    where: { kind },
    select: { id: true, kind: true, name: true, slug: true, description: true },
  });
  if (!category) return { category: null, entries: [] };

  if (kind !== CATEGORY_KIND.PULSA) {
    const games = await prisma.game.findMany({
      where: { categoryId: category.id, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, slug: true },
    });
    return { category, entries: games };
  }

  const operators = await prisma.product.findMany({
    where: { game: { categoryId: category.id }, ...(includeInactive ? {} : { isActive: true }) },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, slug: true },
  });
  return { category, entries: operators };
}

/**
 * The units a category's landing page actually displays.
 *
 * Most categories are "one card per Game". PULSA is not: the provider exposes
 * pulsa as a single game whose brands are the operators, so the customer
 * picks an OPERATOR (a Product), and the only game card would say "Pulsa",
 * which answers none of the questions the page is meant to answer
 * ("can I top up my Indosat number here?").
 *
 * So for PULSA the page lists the operator Products as cards; for everything
 * else it lists Games. The shape returned is the same `{ id, name, slug,
 * icon, href }` either way, so the page renders one grid, not two branches.
 */
export async function listEntriesForCategory(kindOrSlug, { includeInactive = false } = {}) {
  const kind = resolveCategoryKind(kindOrSlug);

  const category = await prisma.category.findUnique({
    where: { kind },
    select: { id: true, kind: true, name: true, slug: true, description: true },
  });
  if (!category) return { category: null, entries: [] };

  const games = await prisma.game.findMany({
    where: { categoryId: category.id, ...(includeInactive ? {} : { isActive: true }) },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true, name: true, slug: true, publisher: true, description: true,
      logo: true, banner: true, isPopular: true, sortOrder: true, isActive: true,
      _count: { select: { products: { where: { isActive: true } } } },
    },
  });

  // The single game in PULSA is not what the customer chooses. Replaced by its
  // operator products below; `games` is still returned for anything that needs
  // the raw list.
  if (kind === CATEGORY_KIND.PULSA) {
    const operators = await prisma.product.findMany({
      where: { game: { categoryId: category.id }, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true, name: true, slug: true, description: true,
        game: { select: { slug: true, name: true, inputFields: true } },
        // Only offer an operator that has something to sell.
        _count: { select: { variants: { where: { isActive: true } } } },
      },
    });

    const entries = operators
      .filter((op) => includeInactive || op._count.variants > 0)
      .map((op) => ({
        id: op.id,
        name: op.name,
        // The operator's own brand mark, never the game-level pulsa icon.
        icon: productIcon({ gameSlug: op.game?.slug ?? null, productSlug: op.slug }),
        // Each operator gets its own path. The old URL was
        // /topup/pulsa/pulsa?operator=<slug>, every operator on one page with
        // the chosen one pre-selected from a query string. That path named the
        // category twice and the operator never, and worse the pre-selection
        // could not actually be changed: the deep-link effect keyed on the
        // URL's ?operator and re-synced back to it whenever the customer clicked
        // a different tab. Putting the operator in the path means there is one
        // product on the page and nothing to snap back to.
        href: `/topup/${CATEGORY_KIND_PATH[kind]}/${op.slug}`,
        subtitle: op.description ?? null,
      }));

    return { category, entries, games };
  }

  const entries = games.map((game) => ({
    id: game.id,
    name: game.name,
    icon: game.logo ?? gameIcon(game.slug),
    href: `/topup/${CATEGORY_KIND_PATH[kind] ?? "game"}/${game.slug}`,
    subtitle: game.publisher ?? null,
  }));

  return { category, entries, games };
}

/**
 * Every active game, grouped by category, for the /topup hub and the navbar.
 *
 * In PULSA the entries a customer actually chooses are OPERATORS (Products),
 * not the single "Pulsa" game. So the group's `games` is replaced by entries
 * in the same `{ id, name, icon, href }` shape the landing page renders,
 * one source of truth for both the hub and the homepage sections.
 */
export async function listGamesGrouped({ includeInactive = false } = {}) {
  const categories = await prisma.category.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: [{ sortOrder: "asc" }],
    select: {
      id: true, kind: true, name: true, slug: true, description: true, icon: true,
      games: {
        where: includeInactive ? {} : { isActive: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: {
          id: true, name: true, slug: true, logo: true, isPopular: true, sortOrder: true,
        },
      },
    },
  });

  const withEntries = await Promise.all(
    categories.map(async (category) => {
      if (category.kind !== CATEGORY_KIND.PULSA) {
        return {
          ...category,
          // game.logo is the DB override path; the local /icons fallback is
          // what actually resolves for every game right now. Without it every
          // game card renders as initials.
          entries: category.games.map((game) => ({
            id: game.id,
            name: game.name,
            icon: game.logo ?? gameIcon(game.slug),
            href: `/topup/${category.slug}/${game.slug}`,
          })),
          path: `/topup/${CATEGORY_KIND_PATH[category.kind] ?? "game"}`,
        };
      }

      // Pulsa: list the operators, never the bare "Pulsa" game. A single card
      // saying "Pulsa" answers none of the questions the section exists for.
      const operators = await prisma.product.findMany({
        where: { game: { categoryId: category.id }, ...(includeInactive ? {} : { isActive: true }) },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: {
          id: true, name: true, slug: true,
          game: { select: { slug: true } },
          _count: { select: { variants: { where: { isActive: true } } } },
        },
      });

      return {
        ...category,
        // `games` stays for anything that still counts it; the renderer must
        // use `entries`.
        entries: operators
          .filter((op) => includeInactive || op._count.variants > 0)
          .map((op) => ({
            id: op.id,
            name: op.name,
            icon: productIcon({ gameSlug: op.game?.slug ?? null, productSlug: op.slug }),
            // Operator in the path, not a query string. See
            // listEntriesForCategory for why /topup/pulsa/pulsa?operator= was
            // replaced by /topup/pulsa/<operator>.
            href: `/topup/${CATEGORY_KIND_PATH[category.kind]}/${op.slug}`,
          })),
        path: `/topup/${CATEGORY_KIND_PATH[category.kind] ?? "game"}`,
      };
    }),
  );

  return withEntries;
}

/** Popular games for the homepage. */
export async function listPopularGames(limit = 6) {
  return prisma.game.findMany({
    where: { isActive: true, isPopular: true },
    orderBy: [{ sortOrder: "asc" }],
    take: Math.min(12, Math.max(1, limit)),
    select: {
      id: true, name: true, slug: true, logo: true, publisher: true,
      category: { select: { kind: true, name: true, slug: true } },
      _count: { select: { products: { where: { isActive: true } } } },
    },
  });
}

/**
 * Full game detail: the game, its product types, and the active variants of
 * each. Everything the /topup/game/[slug] page needs in ONE round trip.
 *
 * Returns null (not a throw) when the slug is unknown or inactive, so the page
 * can call notFound() and render a real 404 status.
 */
export async function getGameDetail(slug, { includeInactive = false } = {}) {
  const game = await prisma.game.findUnique({
    where: { slug },
    select: {
      ...PUBLIC_GAME_SELECT,
      isActive: true,
      products: {
        where: includeInactive ? {} : { isActive: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: { ...PUBLIC_PRODUCT_SELECT, isActive: true },
      },
    },
  });

  if (!game || (!includeInactive && !game.isActive)) return null;
  return game;
}

/**
 * The authoritative, server-side price lookup used by checkout.
 *
 * Returns the FULL row (including costPrice) because the caller is the order
 * service, which needs the margin. It is never serialised to a client.
 * Throws when the variant does not exist or is not sellable. A checkout must
 * fail loudly rather than silently falling back to a stale price.
 */
export async function getSellableVariant(variantId) {
  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
    include: {
      product: {
        select: {
          id: true, name: true, slug: true, isActive: true,
          game: {
            select: {
              id: true, name: true, slug: true, isActive: true,
              categoryId: true,
              inputFields: true,
              supportsValidation: true,
              category: { select: { kind: true } },
            },
          },
        },
      },
      providerProducts: {
        where: { isAvailable: true },
        orderBy: { providerPrice: "asc" },
        select: {
          id: true, providerCode: true, providerPrice: true, providerStock: true,
          provider: { select: { id: true, code: true, name: true, status: true, priority: true } },
        },
      },
    },
  });

  if (!variant) throw new AppError("ITP_NOT_FOUND", "Produk tidak ditemukan.");
  if (!variant.isActive) throw new AppError("ITP_PRODUCT_UNAVAILABLE");
  if (!variant.product?.isActive) throw new AppError("ITP_PRODUCT_UNAVAILABLE");
  if (!variant.product?.game?.isActive) throw new AppError("ITP_PRODUCT_UNAVAILABLE");

  // A finite stock of 0 means "provider says out of stock".
  if (variant.stock !== null && variant.stock <= 0) {
    throw new AppError("ITP_PRODUCT_UNAVAILABLE");
  }

  return variant;
}

/**
 * Pick the provider mapping to use for a variant.
 * Prefers the highest-priority ACTIVE provider; falls back to the lowest cost.
 * Returns null when nothing is mapped; checkout then reports
 * ITP_PRODUCT_UNAVAILABLE rather than dispatching to a guessed SKU.
 */
export function selectProviderMapping(variant) {
  const candidates = (variant.providerProducts ?? []).filter(
    (mapping) => mapping.provider?.status === "ACTIVE"
  );
  if (candidates.length === 0) return null;

  return [...candidates].sort((a, b) => {
    const priority = (b.provider.priority ?? 0) - (a.provider.priority ?? 0);
    if (priority !== 0) return priority;
    return (a.providerPrice ?? Number.MAX_SAFE_INTEGER) - (b.providerPrice ?? Number.MAX_SAFE_INTEGER);
  })[0];
}

// ── Admin views ─────────────────────────────────────────────────────────────

/** Variants with cost, margin, and provider mapping, admin only. */
export async function listVariantsForAdmin({ categoryKind = null, gameSlug = null, productSlug = null, search = "", page = 1, limit = 30 } = {}) {
  const take = Math.min(100, Math.max(1, Number(limit) || 30));
  const skip = (Math.max(1, Number(page) || 1) - 1) * take;

  const where = {};
  if (search) {
    const term = String(search).trim().slice(0, 100);
    where.OR = [
      { name: { contains: term, mode: "insensitive" } },
      { slug: { contains: term, mode: "insensitive" } },
    ];
  }
  if (categoryKind || gameSlug || productSlug) {
    where.product = {
      ...(productSlug ? { slug: productSlug } : {}),
      // Both filters narrow on the same relation, so they merge into one
      // `game` clause. Spreading them separately would let the last one win.
      game: {
        ...(categoryKind ? { category: { kind: categoryKind } } : {}),
        ...(gameSlug ? { slug: gameSlug } : {}),
      },
    };
  }

  const [items, total] = await Promise.all([
    prisma.productVariant.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      skip,
      take,
      select: {
        ...ADMIN_VARIANT_SELECT,
        product: {
          select: {
            id: true, name: true, slug: true,
            game: { select: { id: true, name: true, slug: true, category: { select: { kind: true } } } },
          },
        },
      },
    }),
    prisma.productVariant.count({ where }),
  ]);

  return {
    items: items.map((v) => ({
      ...v,
      margin: unitMargin(v.sellingPrice, v.costPrice),
      marginPercent: marginPercent(v.sellingPrice, v.costPrice),
      /** Selling price the pricing rules WOULD derive, shown as a hint. */
      suggestedPrice: sellingPriceFromCost(v.costPrice),
    })),
    pagination: { page: Math.max(1, Number(page) || 1), limit: take, total, pages: Math.max(1, Math.ceil(total / take)) },
  };
}

/** Catalog-wide counts and margin health for the admin dashboard. */
export async function catalogSummary() {
  const [categories, games, products, variants, activeVariants, unmapped] = await Promise.all([
    prisma.category.count(),
    prisma.game.count({ where: { isActive: true } }),
    prisma.product.count({ where: { isActive: true } }),
    prisma.productVariant.count(),
    prisma.productVariant.count({ where: { isActive: true } }),
    // Active variants with NO active provider mapping cannot be sold.
    prisma.productVariant.count({
      where: {
        isActive: true,
        providerProducts: { none: { isAvailable: true } },
      },
    }),
  ]);

  return { categories, games, products, variants, activeVariants, unsellableVariants: unmapped };
}

/**
 * Best-selling variants, computed from SUCCESS orders.
 * Grouped in the database, never fetched into Node and counted there.
 */
export async function topSellingVariants(limit = 5) {
  const rows = await prisma.orderItem.groupBy({
    by: ["productVariantId"],
    where: { order: { status: ORDER_STATUS.SUCCESS } },
    _sum: { quantity: true, subtotal: true },
    _count: { _all: true },
    orderBy: { _sum: { quantity: "desc" } },
    take: Math.min(20, Math.max(1, limit)),
  });

  if (rows.length === 0) return [];

  const variants = await prisma.productVariant.findMany({
    where: { id: { in: rows.map((r) => r.productVariantId) } },
    select: {
      id: true, name: true,
      product: {
        select: { name: true, game: { select: { name: true, slug: true, category: { select: { kind: true } } } } },
      },
    },
  });
  const byId = new Map(variants.map((v) => [v.id, v]));

  return rows.map((row) => {
    const variant = byId.get(row.productVariantId);
    return {
      variantId: row.productVariantId,
      variantName: variant?.name ?? "—",
      productName: variant?.product?.name ?? "—",
      gameName: variant?.product?.game?.name ?? "—",
      gameSlug: variant?.product?.game?.slug ?? null,
      categoryKind: variant?.product?.game?.category?.kind ?? null,
      unitsSold: row._sum.quantity ?? 0,
      revenue: row._sum.subtotal ?? 0,
      orders: row._count._all,
    };
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Accept either a CategoryKind ("GAME"/"PULSA") or a URL slug ("game"/"pulsa")
 * and return the kind. Returns null for anything unrecognised so callers can
 * 404 instead of silently defaulting to GAME.
 *
 * The two kinds are the only ones that exist. The E_WALLET catalogue was
 * removed, so a request for it 404s rather than resolving to a kind whose
 * rows are gone.
 */
export function resolveCategoryKind(input) {
  if (!input) return null;
  const value = String(input).trim();
  const upper = value.toUpperCase().replace(/-/g, "_");
  if ([CATEGORY_KIND.GAME, CATEGORY_KIND.PULSA].includes(upper)) return upper;

  const entry = Object.entries(CATEGORY_KIND_PATH).find(([, path]) => path === value.toLowerCase());
  return entry?.[0] ?? null;
}

export { PUBLIC_GAME_SELECT, PUBLIC_PRODUCT_SELECT, PUBLIC_VARIANT_SELECT };
