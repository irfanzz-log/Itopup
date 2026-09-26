// ============================================================================
// Admin catalogue service — price, SKU, and stock management.
//
// WHY THIS IS A SEPARATE FILE FROM catalog.service.js
//
// catalog.service.js is the READ side: it projects the catalogue to the
// storefront and to /dev/products and owns the public shape (no cost prices
// leaking). This file is the WRITE side: an operator changing a price,
// re-pointing a variant at a different provider SKU, or removing a product.
//
// The two have opposite failure modes. A read must never expose a cost price;
// a write must never silently change what a customer is charged. Keeping them
// apart means a leak or a pricing mistake in one cannot surface in the other.
//
// ── THE INVARIANTS EVERY MUTATION HERE PRESERVES ───────────────────────────
//
// 1. sellingPrice is a positive integer. Checkout reads it as the truth; a
//    null or negative value would corrupt `total` arithmetic downstream.
//
// 2. Every mutation is audited with the BEFORE and AFTER values. A price change
//    is a financial event — "someone changed it" is not enough, we need what
//    it was and what it became.
//
// 3. A variant that has ever been ordered is never hard-deleted. It is the row
//    an order item points at; removing it orphans the customer's transaction
//    history. Those get deactivated, which is the same outcome for the
//    storefront without the data loss.
//
// ── WHY THE SKU SWAP EXISTS ─────────────────────────────────────────────────
//
// The provider lists the same delivered amount under several SKU codes —
// different server families, different supplier tiers. One can go
// `out_of_stock` while another for the same nominal is still `active`. Without
// a swap, the variant goes dead and the operator's only remedy is a full
// catalogue sync, which re-links from mapping rules and may pick the same dead
// SKU again. The swap lets the operator choose a live SKU explicitly, and the
// cost/price follow from that SKU's price.
// ============================================================================
import { prisma } from "../lib/db.js";
import { AppError } from "../lib/errors.js";
import { AUDIT } from "../lib/constants.js";
import { sellingPriceFromCost } from "../config/pricing.js";
import { getTopupProvider } from "../providers/index.js";
import { writeAudit } from "./audit.service.js";

/** Price bounds. A value outside these is a typo, not a business decision. */
const MIN_PRICE = 100;
const MAX_PRICE = 100_000_000;

/** The provider this service manages SKU links for. */
const PROVIDER_CODE = "melostore";

/**
 * A short-lived cache of the provider pricelist.
 *
 * The pricelist is ~21 paginated requests at 20 req/min — a full fetch takes
 * over a minute and spends a large chunk of the provider's rate budget. An
 * operator opening the SKU picker and clicking a candidate would otherwise
 * re-walk the whole list twice, and the third click would 429.
 *
 * The TTL is short on purpose: the reason the operator is here at all is that
 * stock changed, so a stale list defeats the feature. `processCache` is held in
 * the module, so it does not survive a server restart and never needs a disk
 * invalidation strategy.
 */
const PRICE_CACHE_TTL_MS = 60_000;
let pricelistCache = null;
let pricelistCacheAt = 0;

/**
 * Whether a selling price is at or below cost — a guaranteed loss per sale.
 * Reported as a warning, never blocked: a loss leader is a legitimate decision,
 * but it must not be silent.
 */
export function isBelowCost(sellingPrice, costPrice) {
  return Number(sellingPrice) <= Number(costPrice);
}

/**
 * Fetch the whole provider pricelist, memoised for PRICE_CACHE_TTL_MS.
 *
 * @param {{ force?: boolean, log?: object }} [input]
 * @returns {Promise<object>} the normalised provider product list
 */
async function fetchPricelist({ force = false, log = null } = {}) {
  const now = Date.now();
  if (!force && pricelistCache && now - pricelistCacheAt < PRICE_CACHE_TTL_MS) {
    return pricelistCache;
  }

  const provider = getTopupProvider(PROVIDER_CODE);
  if (!provider.isConfigured()) {
    const gaps = provider.configurationGaps();
    throw new AppError(
      "ITP_PROVIDER_NOT_CONFIGURED",
      `Provider belum dikonfigurasi. Variabel yang belum diisi: ${gaps.missing.join(", ") || "(tidak diketahui)"}.`
    );
  }

  const result = await provider.getProducts({ log });
  if (!result.ok) {
    throw new AppError(
      "ITP_PROVIDER_UNAVAILABLE",
      result.error?.message || "Gagal mengambil pricelist dari provider.",
      { meta: { code: result.error?.code } }
    );
  }

  pricelistCache = result.data;
  pricelistCacheAt = now;
  return pricelistCache;
}

/**
 * Validate a price an operator typed.
 * @returns {number} the price as an integer rupiah amount
 * @throws {AppError} ITP_VALIDATION_ERROR for anything that is not a positive
 *   integer inside the bounds above.
 */
function assertValidPrice(input) {
  const n = Number(input);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new AppError(
      "ITP_VALIDATION_ERROR",
      "Harga harus berupa angka bulat (rupiah), tanpa desimal atau teks."
    );
  }
  if (n < MIN_PRICE) {
    throw new AppError(
      "ITP_VALIDATION_ERROR",
      `Harga minimum adalah Rp ${MIN_PRICE.toLocaleString("id-ID")}.`
    );
  }
  if (n > MAX_PRICE) {
    throw new AppError(
      "ITP_VALIDATION_ERROR",
      `Harga maksimum adalah Rp ${MAX_PRICE.toLocaleString("id-ID")}.`
    );
  }
  return n;
}

/**
 * Find provider SKUs that could fulfil a variant.
 *
 * The list is drawn from the LIVE pricelist, not the database. This is the one
 * admin path that contacts the provider, because the whole point is to expose
 * stock the last sync has not recorded yet. It is a read with no side effects,
 * so calling it on page load is safe.
 *
 * Matching is on the product NAME, normalised: the provider labels a nominal
 * "5 Diamonds", "5 Diamond", and "5 Diamonds" across three SKU families, and
 * punctuation/case noise must not split them.
 *
 * @param {{ gameSlug?: string|null, variantName: string, log?: object }}
 * @returns {Promise<Array<{ providerCode: string, name: string, price: number,
 *   stock: number|null, available: boolean, serverName: string|null }>>}
 */
export async function listSkuCandidates({ gameSlug = null, variantName, regionPrefix = null, log = null }) {
  const data = await fetchPricelist({ log });

  // Resolve our game slug to the provider's brand NAMES, then to brand ids from
  // the pricelist's own brand list. Brand ids are the only per-product key, so
  // names have to be resolved through that map.
  const brandNames = gameSlug ? brandNamesForGame(gameSlug) : null;
  const brandIds = new Set();
  if (brandNames) {
    for (const brand of data.brands ?? []) {
      if (brandNames.includes(brand.name)) brandIds.add(brand.id);
    }
  }

  const target = normaliseName(variantName);
  if (!target) return [];

  const seen = new Set();
  const out = [];
  for (const product of data.products) {
    if (brandIds.size > 0 && !brandIds.has(product.brandId)) continue;
    if (normaliseName(product.name) !== target) continue;
    if (seen.has(product.providerCode)) continue;
    seen.add(product.providerCode);
    out.push({
      providerCode: product.providerCode,
      name: product.name,
      price: product.price,
      stock: product.stock,
      available: product.available,
      serverName: product.serverName ?? null,
      /** Same region as the SKU we are currently linked to. */
      sameRegion: regionPrefix ? skuPrefix(product.providerCode) === regionPrefix : true,
    });
  }

  // The order an operator wants to pick from: buyable first, then same-region
  // (a US-region SKU is useless for an Indonesian customer even when it is
  // cheaper), then cheapest within the region.
  return out.sort((a, b) => {
    if (a.available !== b.available) return a.available ? -1 : 1;
    if (a.sameRegion !== b.sameRegion) return a.sameRegion ? -1 : 1;
    return a.price - b.price;
  });
}

/**
 * The letters at the start of a provider SKU identify the region it delivers
 * to: `mlid…` = Mobile Legends Indonesia, `mlus…` = US, `mlph…` = Philippines.
 *
 * We sell to Indonesian customers, so a foreign-region SKU is not a substitute
 * for a dead local one even when it is cheaper and in stock. The prefix is used
 * to keep those out of the top of the candidate list.
 */
function skuPrefix(code) {
  return String(code ?? "").match(/^[a-z]+/i)?.[0]?.toLowerCase() ?? "";
}

/** Brand names for a game, as the provider labels them on the pricelist. */
function brandNamesForGame(gameSlug) {
  const BY_SLUG = {
    "mobile-legends": ["Mobile Legends (ID)", "Mobile Legends: Bang Bang (ID)", "Mobile Legends (Global)"],
    "pubg-mobile": ["PUBG Mobile (ID)", "PUBG Mobile (Global)"],
    "free-fire": ["Free Fire (ID)", "Free Fire (Global)"],
    codm: ["Call of Duty: Mobile (Indonesia ID)", "Call Of Duty Mobile"],
    roblox: ["Roblox"],
    "genshin-impact": ["Genshin Impact"],
  };
  return BY_SLUG[gameSlug] ?? null;
}

/**
 * Case/whitespace/punctuation-insensitive name comparison key.
 *
 * Matching names, not SKUs, is what makes the candidate list work across the
 * provider's SKU families — and the names are NOT clean. The provider labels
 * the same nominal "5 Diamonds", "5 Diamond", and "100 Diamond (91 + 9 Bonus)".
 * So comparison is on the LEADING DENOMINATION only: strip the parenthesised
 * bonus clause, drop the plural, and compare the number and the unit.
 *
 * MEASURED against the live pricelist: this collapses 8 distinct spellings of
 * "86 Diamonds" into one matchable group, including the Indonesian thousand
 * separator (`2.906 Diamonds`) which would otherwise never equal our variant
 * name written the same way.
 *
 * Exported because the unit tests lock the matching rules down — a normaliser
 * that silently drifted would link a variant to the wrong nominal's SKUs.
 */
export function normaliseName(name) {
  const text = String(name ?? "")
    // Drop the "(91 + 9 Bonus)" clause — the bonus varies per supplier, and a
    // bonus tier is still the same nominal the customer is buying.
    .replace(/\([^)]*\)/g, " ")
    // Drop a trailing bonus phrase with no parentheses ("+ 167 Bonus").
    .replace(/\+\s*\d+\s*bonus.*/i, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!text) return "";
  // Singular/plural and the ID thousand separator are the real sources of
  // mismatch, so normalise both: "diamond" and remove digit separators inside
  // numbers ("2.906" → "2906").
  return text
    .replace(/diamonds\b/g, "diamond")
    .replace(/(\d)[. ](?=\d{3}\b)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Update a variant's selling price.
 *
 * The price is stored as an ABSOLUTE value, not as a markup to recompute. A
 * stored markup would drift the moment the provider cost moved, and the
 * operator's job here is to set the number the customer actually sees.
 *
 * @param {{ variantId: string, sellingPrice: number, actor: object, request?: object }}
 * @returns {Promise<object>} the updated variant, with margin figures
 */
export async function updateVariantPrice({ variantId, sellingPrice, actor, request = null }) {
  const price = assertValidPrice(sellingPrice);

  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
    select: {
      id: true,
      name: true,
      costPrice: true,
      sellingPrice: true,
      product: { select: { name: true, game: { select: { name: true, slug: true } } } },
    },
  });
  if (!variant) throw new AppError("ITP_NOT_FOUND", "Varian tidak ditemukan.");

  if (Number(variant.sellingPrice) === price) {
    // Re-submitting the same price is not an error. An operator saving a form
    // twice should get a clean confirmation, not a "nothing changed" failure.
    return {
      ...variant,
      margin: price - variant.costPrice,
      marginPercent: ((price - variant.costPrice) / price) * 100,
      changed: false,
    };
  }

  const updated = await prisma.productVariant.update({
    where: { id: variantId },
    data: { sellingPrice: price },
    select: { id: true, name: true, costPrice: true, sellingPrice: true },
  });

  await writeAudit({
    action: AUDIT.PRICE_UPDATED,
    actor,
    targetType: "ProductVariant",
    targetId: variantId,
    metadata: {
      name: variant.name,
      game: variant.product?.game?.name ?? null,
      from: variant.sellingPrice,
      to: price,
      costPrice: variant.costPrice,
      belowCost: isBelowCost(price, variant.costPrice),
    },
    request,
  });

  return {
    ...updated,
    margin: updated.sellingPrice - updated.costPrice,
    marginPercent: ((updated.sellingPrice - updated.costPrice) / updated.sellingPrice) * 100,
    changed: true,
  };
}

/**
 * Re-point a variant at a different provider SKU.
 *
 * THE USE CASE: the SKU a variant is linked to has gone `out_of_stock`, and
 * the provider lists the same nominal under another code that is still
 * `active`. The operator swaps the link; cost and (unpinned) selling price
 * follow from the new SKU.
 *
 * The target must exist on the provider AND be buyable right now. Accepting an
 * out-of-stock code would "succeed" and leave the variant exactly as dead as
 * it was — the failure would be invisible until a customer complained.
 *
 * @param {{ variantId: string, providerCode: string, actor: object, request?: object }}
 * @returns {Promise<object>} the old/new SKU and the refreshed prices
 */
export async function reassignVariantSku({ variantId, providerCode, actor, request = null }) {
  const code = String(providerCode ?? "").trim().toLowerCase();
  if (!code) {
    throw new AppError("ITP_VALIDATION_ERROR", "Kode SKU tidak boleh kosong.");
  }

  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
    select: {
      id: true,
      name: true,
      costPrice: true,
      sellingPrice: true,
      product: { select: { name: true, game: { select: { name: true, slug: true } } } },
      providerProducts: {
        select: {
          id: true,
          providerCode: true,
          providerPrice: true,
          isAvailable: true,
          provider: { select: { id: true, code: true } },
        },
      },
    },
  });
  if (!variant) throw new AppError("ITP_NOT_FOUND", "Varian tidak ditemukan.");

  const current = variant.providerProducts[0] ?? null;

  const candidates = await listSkuCandidates({
    gameSlug: variant.product?.game?.slug ?? null,
    variantName: variant.name,
    regionPrefix: current ? skuPrefix(current.providerCode) : null,
  });
  const target = candidates.find((c) => c.providerCode === code);
  if (!target) {
    throw new AppError(
      "ITP_NOT_FOUND",
      `SKU ${code} tidak ditemukan di pricelist provider untuk nominal ini. ` +
        `Muat ulang daftar SKU dan pilih salah satu yang tertera.`
    );
  }
  if (!target.available) {
    throw new AppError(
      "ITP_PRODUCT_UNAVAILABLE",
      `SKU ${code} sedang out of stock di provider. Pilih SKU lain yang berstatus active.`
    );
  }

  const providerRow = await prisma.provider.findFirst({
    where: { code: PROVIDER_CODE },
    select: { id: true, code: true },
  });
  if (!providerRow) throw new AppError("ITP_PROVIDER_NOT_CONFIGURED");

  const result = await prisma.$transaction(
    async (tx) => {
      const isPinned =
        Number(variant.sellingPrice) !== sellingPriceFromCost(variant.costPrice);
      const derived = sellingPriceFromCost(target.price);

      // @@unique([providerId, productVariantId]) allows ONE mapping row per
      // variant per provider: update in place rather than insert a second.
      // Re-pointing is an operator decision — this is the case the sync
      // service deliberately refuses to do on its own.
      if (current) {
        await tx.providerProduct.update({
          where: { id: current.id },
          data: {
            providerCode: code,
            providerName: target.name,
            providerPrice: target.price,
            providerStock: target.stock,
            isAvailable: true,
            lastSyncAt: new Date(),
          },
        });
      } else {
        await tx.providerProduct.create({
          data: {
            providerId: providerRow.id,
            productVariantId: variantId,
            providerCode: code,
            providerName: target.name,
            providerPrice: target.price,
            providerStock: target.stock,
            isAvailable: true,
            lastSyncAt: new Date(),
          },
        });
      }

      // Cost always follows the SKU we are now buying. Selling price follows
      // only when the operator has not pinned one — the same rule as the sync.
      const variantData = { costPrice: target.price };
      if (!isPinned) variantData.sellingPrice = derived;

      const updated = await tx.productVariant.update({
        where: { id: variantId },
        data: variantData,
        select: { id: true, costPrice: true, sellingPrice: true },
      });

      return { updated, isPinned, derived };
    },
    // Supabase's pooler from a home connection is ~200-400ms per statement; the
    // default 5s is too small and the whole swap rolls back spuriously.
    { timeout: 30_000, maxWait: 10_000 }
  );

  await writeAudit({
    action: AUDIT.PRODUCT_UPDATED,
    actor,
    targetType: "ProductVariant",
    targetId: variantId,
    metadata: {
      action: "reassign_sku",
      name: variant.name,
      game: variant.product?.game?.name ?? null,
      fromSku: current?.providerCode ?? null,
      toSku: code,
      fromCost: variant.costPrice,
      toCost: target.price,
      pricePinned: result.isPinned,
      newSellingPrice: result.updated.sellingPrice,
    },
    request,
  });

  return {
    variantId,
    fromSku: current?.providerCode ?? null,
    toSku: code,
    costPrice: result.updated.costPrice,
    sellingPrice: result.updated.sellingPrice,
    pricePinned: result.isPinned,
  };
}

/**
 * Delete a variant, or a whole product with its variants.
 *
 * "Delete" means: stop it being offered. A variant that has ever been ordered
 * CANNOT be hard-deleted — it is the row an order item points at, and removing
 * it orphans the customer's transaction history. Those are deactivated instead,
 * which is the same outcome for the storefront without the data loss.
 *
 * Variants never ordered are removed outright; there is nothing to preserve and
 * the operator asked for them gone. ProviderProduct rows go with them via the
 * onDelete: Cascade on the relation.
 *
 * @param {{ variantId?: string, productId?: string, actor: object, request?: object }}
 * @returns {Promise<object>} counts of what was removed or deactivated
 */
export async function deleteCatalogEntry({ variantId, productId, actor, request = null }) {
  if (!variantId && !productId) {
    throw new AppError("ITP_VALIDATION_ERROR", "Variant atau produk harus ditentukan.");
  }

  // ── Single variant ───────────────────────────────────────────────────────
  if (variantId) {
    const variant = await prisma.productVariant.findUnique({
      where: { id: variantId },
      select: {
        id: true,
        name: true,
        product: { select: { name: true, game: { select: { name: true } } } },
        _count: { select: { orderItems: true } },
      },
    });
    if (!variant) throw new AppError("ITP_NOT_FOUND", "Varian tidak ditemukan.");

    const hasHistory = variant._count.orderItems > 0;

    if (hasHistory) {
      await prisma.productVariant.update({
        where: { id: variantId },
        data: { isActive: false },
      });
      await writeAudit({
        action: AUDIT.PRODUCT_UPDATED,
        actor,
        targetType: "ProductVariant",
        targetId: variantId,
        metadata: {
          action: "deactivated",
          name: variant.name,
          game: variant.product?.game?.name ?? null,
          reason: "Sudah pernah dipesan; dinonaktifkan, tidak dihapus.",
        },
        request,
      });
      return { variantId, deleted: false, deactivated: true, reason: "Memiliki riwayat pesanan." };
    }

    await prisma.productVariant.delete({ where: { id: variantId } });
    await writeAudit({
      action: AUDIT.PRODUCT_UPDATED,
      actor,
      targetType: "ProductVariant",
      targetId: variantId,
      metadata: {
        action: "deleted",
        name: variant.name,
        game: variant.product?.game?.name ?? null,
      },
      request,
    });
    return { variantId, deleted: true, deactivated: false };
  }

  // ── Whole product ────────────────────────────────────────────────────────
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      name: true,
      variants: { select: { id: true, name: true, _count: { select: { orderItems: true } } } },
    },
  });
  if (!product) throw new AppError("ITP_NOT_FOUND", "Produk tidak ditemukan.");

  const hasHistory = product.variants.some((v) => v._count.orderItems > 0);

  const result = await prisma.$transaction(
    async (tx) => {
      let deletedVariants = 0;
      let deactivatedVariants = 0;

      for (const variant of product.variants) {
        if (variant._count.orderItems > 0) {
          await tx.productVariant.update({
            where: { id: variant.id },
            data: { isActive: false },
          });
          deactivatedVariants++;
        } else {
          await tx.productVariant.delete({ where: { id: variant.id } });
          deletedVariants++;
        }
      }

      // Keep the product row when any variant still has order history, so the
      // surviving deactivated rows stay reachable from the admin UI.
      if (hasHistory) {
        await tx.product.update({ where: { id: productId }, data: { isActive: false } });
      } else {
        await tx.product.delete({ where: { id: productId } });
      }

      return { deletedVariants, deactivatedVariants, productRemoved: !hasHistory };
    },
    { timeout: 30_000, maxWait: 10_000 }
  );

  await writeAudit({
    action: AUDIT.PRODUCT_UPDATED,
    actor,
    targetType: "Product",
    targetId: productId,
    metadata: {
      action: result.productRemoved ? "deleted" : "deactivated",
      name: product.name,
      deletedVariants: result.deletedVariants,
      deactivatedVariants: result.deactivatedVariants,
    },
    request,
  });

  return { productId, ...result };
}

/**
 * The provider's own view of a variant: every SKU the provider lists for it,
 * with live availability. This is what the admin compares against our stored
 * link to see whether a swap is needed.
 *
 * @param {{ variantId: string, log?: object }}
 */
export async function getVariantSkuStatus({ variantId, log = null }) {
  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
    select: {
      id: true,
      name: true,
      costPrice: true,
      sellingPrice: true,
      isActive: true,
      stock: true,
      product: { select: { name: true, game: { select: { name: true, slug: true } } } },
      providerProducts: {
        select: {
          id: true,
          providerCode: true,
          providerName: true,
          providerPrice: true,
          isAvailable: true,
          lastSyncAt: true,
        },
      },
    },
  });
  if (!variant) throw new AppError("ITP_NOT_FOUND", "Varian tidak ditemukan.");

  const linkedCode = variant.providerProducts[0]?.providerCode ?? null;
  const candidates = await listSkuCandidates({
    gameSlug: variant.product?.game?.slug ?? null,
    variantName: variant.name,
    regionPrefix: linkedCode ? skuPrefix(linkedCode) : null,
  });

  const linkedAvailable = variant.providerProducts[0]?.isAvailable ?? null;

  return {
    variant,
    linkedSku: linkedCode,
    linkedAvailable,
    candidates,
    /** Alternates that are in stock right now — empty means no swap possible. */
    inStockAlternates: candidates.filter((c) => c.available && c.providerCode !== linkedCode),
  };
}
