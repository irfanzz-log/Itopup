// ============================================================================
// Catalog service.
//
// The database is the source of truth for everything the storefront shows. The
// provider is NEVER read on a request path — the sync job writes provider data
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
  return prisma.category.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true, kind: true, name: true, slug: true, description: true,
      icon: true, sortOrder: true, isActive: true,
      _count: { select: { games: { where: { isActive: true } } } },
    },
  });
}

// ── Games ───────────────────────────────────────────────────────────────────

/**
 * Games in one category, for the category landing page.
 * @param {string} kindOrSlug GAME | PULSA, or the URL slug
 */
export async function listGamesByCategory(kindOrSlug, { includeInactive = false } = {}) {
  const kind = resolveCategoryKind(kindOrSlug);

  const category = await prisma.category.findUnique({
    where: { kind },
    select: { id: true, kind: true, name: true, slug: true, description: true },
  });
  if (!category) return { category: null, games: [] };

  const games = await prisma.game.findMany({
    where: { categoryId: category.id, ...(includeInactive ? {} : { isActive: true }) },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true, name: true, slug: true, publisher: true, description: true,
      logo: true, banner: true, isPopular: true, sortOrder: true, isActive: true,
      _count: { select: { products: { where: { isActive: true } } } },
    },
  });

  return { category, games };
}

/** Every active game, grouped by category — for the /topup hub and the navbar. */
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

  return categories.map((category) => ({
    ...category,
    path: `/topup/${CATEGORY_KIND_PATH[category.kind] ?? "game"}`,
  }));
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
 * each — everything the /topup/game/[slug] page needs in ONE round trip.
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
 * Throws when the variant does not exist or is not sellable — a checkout must
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
 * Returns null when nothing is mapped — checkout then reports
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

/** Variants with cost, margin, and provider mapping — admin only. */
export async function listVariantsForAdmin({ gameSlug = null, productSlug = null, search = "", page = 1, limit = 30 } = {}) {
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
  if (gameSlug || productSlug) {
    where.product = {
      ...(productSlug ? { slug: productSlug } : {}),
      ...(gameSlug ? { game: { slug: gameSlug } } : {}),
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
      /** Selling price the pricing rules WOULD derive — shown as a hint. */
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
 * Grouped in the database — never fetched into Node and counted there.
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
 * The two kinds are the only ones that exist — the E_WALLET catalogue was
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
