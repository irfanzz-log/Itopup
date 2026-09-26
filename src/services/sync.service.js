// ============================================================================
// Catalog sync — provider pricelist → database.
//
// THE FLOW THIS FILE IMPLEMENTS:
//
//   Provider  →  sync service  →  database  →  frontend
//
// The frontend never calls the provider. It reads ProductVariant rows, whose
// sellingPrice is authoritative. This service is the only writer of
// ProviderProduct rows, and the only thing that refreshes costPrice.
//
// ── WHAT IT REFUSES TO DO ───────────────────────────────────────────────────
//
// It will NOT guess which internal variant a provider SKU corresponds to. A
// wrong link means a customer buys "86 Diamonds" and the provider delivers
// "355 Diamonds" — or worse, the wrong game entirely. So an unmatched SKU is
// REPORTED, never silently attached.
//
// Matching happens in two passes:
//   1. EXISTING links — a ProviderProduct row already points at a variant. Its
//      price and availability are refreshed. This is the steady-state path.
//   2. NEW SKUs — matched by an explicit rule in src/config/provider-mapping.js.
//      Anything not covered is returned in `unmatched` for an operator to link
//      on /dev/products.
//
// ── PRICING ─────────────────────────────────────────────────────────────────
//
// costPrice comes from the provider (their price for OUR tier). sellingPrice is
// DERIVED from it via src/config/pricing.js — unless an admin has pinned one,
// in which case it is left alone. The provider can never set a selling price.
// ============================================================================
import { prisma } from "../lib/db.js";
import { createLogger } from "../lib/logger.js";
import { AppError } from "../lib/errors.js";
import { getTopupProvider } from "../providers/index.js";
import { sellingPriceFromCost } from "../config/pricing.js";
import { PROVIDER_MAPPING } from "../config/provider-mapping.js";
import { AUDIT } from "../lib/constants.js";

/**
 * Import the provider pricelist into ProviderProduct rows.
 *
 * @param {{ category?: string, dryRun?: boolean, actor?: object, request?: object, log?: object }} [input]
 * @returns {Promise<{
 *   ok: boolean, dryRun: boolean, fetched: number, linked: number, created: number,
 *   priceChanged: number, unavailable: number, unmatched: Array<object>,
 *   durationMs: number, error?: string
 * }>}
 */
export async function syncProviderCatalog({
  category = null,
  dryRun = false,
  actor = null,
  request = null,
  log = createLogger({ component: "catalog-sync" }),
} = {}) {
  const startedAt = Date.now();
  const provider = getTopupProvider();

  if (!provider.isConfigured()) {
    const gaps = provider.configurationGaps();
    log.warn("catalog.sync_not_configured", { provider: provider.code, missing: gaps.missing });
    throw new AppError("ITP_PROVIDER_NOT_CONFIGURED", undefined, {
      meta: { provider: provider.code, missing: gaps.missing },
    });
  }

  const providerRow = await ensureProviderRow(provider);

  // ── 1. Fetch ──────────────────────────────────────────────────────────────
  const result = await provider.getProducts({ category, log });
  if (!result.ok) {
    log.warn("catalog.sync_fetch_failed", { code: result.error?.code });
    await prisma.provider
      .updateMany({ where: { id: providerRow.id }, data: { lastSyncStatus: `catalog:${result.error?.code}` } })
      .catch(() => {});
    throw new AppError("ITP_PROVIDER_UNAVAILABLE", undefined, {
      meta: { provider: provider.code, providerCode: result.error?.code },
    });
  }

  const { products, brands, inquiryForms } = result.data;

  // ── 2. Build the brand → game lookup ─────────────────────────────────────
  // Documented compact format: each product carries `brand_id` and the brand
  // list carries the name. Resolving it here keeps the matching pass readable.
  const brandById = new Map(brands.map((b) => [b.id, b]));

  // ── 3. Existing links ────────────────────────────────────────────────────
  const existing = await prisma.providerProduct.findMany({
    where: { providerId: providerRow.id },
    select: {
      id: true,
      providerCode: true,
      productVariantId: true,
      productVariant: {
        select: { id: true, costPrice: true, sellingPrice: true, isActive: true },
      },
    },
  });
  const existingByCode = new Map(existing.map((row) => [row.providerCode, row]));

  // ── 2b. Collapse duplicate provider codes, then duplicate VARIANTS ──────
  //
  // The database keys a link on @@unique([providerId, providerCode]) AND
  // @@unique([providerId, productVariantId]) — one ProviderProduct row per
  // internal variant, per provider. Two provider SKUs mapped to the same
  // variant therefore raise P2002 and, because the whole sync is one
  // transaction, roll back every other link with it.
  //
  // Both shapes occur on the live pricelist:
  //   * SAME code, many rows — the provider lists a SKU once per
  //     `server_code` (`mlid5d-s11` is both "Server 1" and "Server 11").
  //     The server is chosen at TRANSACTION time (customer_target_zone), not
  //     at link time, so keeping one row loses nothing.
  //   * DIFFERENT codes, SAME delivered amount — the e-wallet catalogue lists
  //     every denomination under several SKU families. MEASURED on DANA:
  //     `dnt10ko-s4` (Rp 10.640), `dzs10ko-s4` (Rp 10.574), `dgs10ko-s4`
  //     (Rp 10.615) and `dpsnoa10ko-s4` (Rp 10.559, inactive) all deliver
  //     "Rp. 10.000". The mapping rule resolves all four to `dana/saldo/d10000`
  //     and the second insert blows up the sync.
  //
  // The cheapest ACTIVE row wins in both cases; a code that is only ever out
  // of stock still gets linked, so the catalogue records it and the next
  // restock flips it back.
  const deduped = new Map();
  for (const product of products) {
    const current = deduped.get(product.providerCode);
    if (!current) { deduped.set(product.providerCode, product); continue; }
    const better =
      product.available !== current.available
        ? product.available
        : product.price < current.price;
    if (better) deduped.set(product.providerCode, product);
  }
  let uniqueProducts = [...deduped.values()];
  const duplicateCodes = products.length - uniqueProducts.length;

  const report = {
    ok: true,
    dryRun,
    fetched: products.length,
    // Rows dropped because the provider lists the same sku_code once per server.
    duplicates: duplicateCodes,
    // SKUs dropped because several provider codes deliver the same amount and
    // the database allows only one link per variant.
    duplicateVariants: 0,
    linked: 0,
    created: 0,
    priceChanged: 0,
    unavailable: 0,
    unchanged: 0,
    unmatched: [],
    durationMs: 0,
  };
  const variantUpdates = [];
  const providerProductWrites = [];

  // ── 2c. Resolve NEW SKUs to their variant, then collapse on the variant ──
  //
  // This pass MUST run before the write loop. Several provider SKUs can resolve
  // to the SAME ProductVariant, and the DB allows only one ProviderProduct per
  // variant. Two situations collide here:
  //
  //   * several NEW SKUs resolve to one variant (the e-wallet catalogue lists
  //     every denomination under several SKU families — MEASURED on DANA:
  //     `dnt10ko-s4`, `dzs10ko-s4`, `dgs10ko-s4` and `dpsnoa10ko-s4` all
  //     deliver "Rp. 10.000").
  //   * a NEW SKU resolves to a variant that ANOTHER code already links — the
  //     row exists under the other code, so inserting again raises P2002.
  //
  // Collapsing here makes the surviving SKU a deliberate choice — the cheapest
  // ACTIVE one — instead of whichever order the provider paginated in. A
  // variant that is already linked keeps its existing link: re-pointing it at a
  // different provider SKU changes what we pay for and is an operator decision,
  // not a sync side effect.
  const existingVariantIds = new Set(existing.map((row) => row.productVariantId).filter(Boolean));
  const variantCache = new Map();
  const variantOf = async (rule) => {
    const key = `${rule.gameSlug}/${rule.productSlug ?? "-"}/${rule.variantSlug}`;
    if (variantCache.has(key)) return variantCache.get(key);
    const variant = await prisma.productVariant.findFirst({
      where: {
        slug: rule.variantSlug,
        product: {
          ...(rule.productSlug ? { slug: rule.productSlug } : {}),
          game: { slug: rule.gameSlug },
        },
      },
      select: { id: true, costPrice: true, sellingPrice: true },
    });
    variantCache.set(key, variant);
    return variant;
  };

  const bestPerVariant = new Map();
  for (const product of uniqueProducts) {
    const match = existingByCode.get(product.providerCode);
    if (match) continue; // link already exists; the write loop refreshes it

    const rule = resolveNewSkuRule(product, brandById);
    if (!rule) {
      report.unmatched.push({
        providerCode: product.providerCode,
        name: product.name,
        price: product.price,
        brand: product.brandId !== null ? brandById.get(product.brandId)?.name ?? null : null,
        category: product.category,
        typeName: product.typeName,
      });
      continue;
    }

    const variant = await variantOf(rule);

    if (!variant) {
      const scope = rule.productSlug
        ? `produk "${rule.productSlug}" pada game "${rule.gameSlug}"`
        : `game "${rule.gameSlug}"`;
      report.unmatched.push({
        providerCode: product.providerCode,
        name: product.name,
        price: product.price,
        reason: `Aturan mapping menunjuk variant "${rule.variantSlug}" di ${scope}, tetapi variant itu tidak ada.`,
      });
      continue;
    }

    // A variant already linked under a different code is skipped, not
    // re-pointed — that would change what we buy and is an operator decision.
    if (existingVariantIds.has(variant.id)) {
      report.duplicateVariants++;
      continue;
    }

    // Same rule as the code-level dedup: cheapest ACTIVE SKU wins the variant.
    const current = bestPerVariant.get(variant.id);
    if (!current) {
      bestPerVariant.set(variant.id, { product, variant });
      continue;
    }
    const better =
      product.available !== current.product.available
        ? product.available
        : product.price < current.product.price;
    if (better) bestPerVariant.set(variant.id, { product, variant });
    report.duplicateVariants++;
  }

  // `report.duplicateVariants` is incremented in the loop above, where the
  // collisions are actually detected — both the "already linked under another
  // code" case and the "several new SKUs, one variant" case.

  // ── 3. Build the writes ──────────────────────────────────────────────────
  for (const { product, variant } of bestPerVariant.values()) {
    const derived = derivePrices(product, variant);
    report.created++;
    if (derived.costChanged || derived.sellChanged) report.priceChanged++;

    if (!dryRun) {
      providerProductWrites.push({
        providerId: providerRow.id,
        productVariantId: variant.id,
        providerCode: product.providerCode,
        providerName: product.name,
        providerPrice: product.price,
        providerStock: product.stock,
        isAvailable: product.available,
        lastSyncPayload: serializeProduct(product),
        lastSyncAt: new Date(),
      });
      if (derived.variantUpdate) variantUpdates.push(derived.variantUpdate);
    }
  }

  // ── 3b. Existing links: refresh price and availability ──────────────────
  for (const product of uniqueProducts) {
    const match = existingByCode.get(product.providerCode);
    if (!match) continue;
    report.linked++;
    if (!product.available) report.unavailable++;

    const derived = derivePrices(product, match.productVariant);
    if (derived.costChanged || derived.sellChanged) report.priceChanged++;
    else report.unchanged++;

    if (!dryRun) {
      providerProductWrites.push({
        id: match.id,
        providerId: providerRow.id,
        productVariantId: match.productVariantId,
        providerCode: product.providerCode,
        providerName: product.name,
        providerPrice: product.price,
        providerStock: product.stock,
        isAvailable: product.available,
        lastSyncPayload: serializeProduct(product),
        lastSyncAt: new Date(),
      });
      if (derived.variantUpdate) variantUpdates.push(derived.variantUpdate);
    }
  }

  // ── 4. Persist ───────────────────────────────────────────────────────────
  if (!dryRun) {
    // One transaction: a half-applied sync would leave some variants at the old
    // cost and some at the new one, and the margin report would be wrong until
    // the next run.
    //
    // The default 5s interactive-transaction timeout is far too small for a
    // hosted database. Each write is a separate round trip, and against
    // Supabase's pooler from a home connection that is ~200-400ms per row, so
    // even 56 links exceed 5s and the whole sync rolls back with "a query
    // cannot be executed on an expired transaction". Measured: 6.2s for 56
    // rows. maxWait is raised too, because acquiring a connection from the
    // pooler can itself take longer than the 2s default.
    await prisma.$transaction(async (tx) => {
      for (const write of providerProductWrites) {
        const { id, ...data } = write;
        if (id) {
          await tx.providerProduct.update({ where: { id }, data });
        } else {
          await tx.providerProduct.create({ data });
        }
      }

      for (const update of variantUpdates) {
        const { id, ...data } = update;
        await tx.productVariant.update({ where: { id }, data });
      }

      await tx.provider.update({
        where: { id: providerRow.id },
        data: {
          lastSyncAt: new Date(),
          lastSyncStatus: `ok:${report.fetched}`,
          // Persisted so /dev/providers can show whether the provider still
          // declares the same inquiry fields we render inputs for.
          catalogMeta: { brands, inquiryForms, syncedAt: new Date().toISOString() },
        },
      });
    }, { timeout: 60_000, maxWait: 15_000 });
  }

  report.durationMs = Date.now() - startedAt;

  log.info("catalog.synced", {
    provider: provider.code,
    dryRun,
    fetched: report.fetched,
    created: report.created,
    priceChanged: report.priceChanged,
    unmatched: report.unmatched.length,
    durationMs: report.durationMs,
  });

  if (!dryRun && actor) {
    await writeSyncAudit({ actor, report, request });
  }

  return report;
}

/**
 * Derive the prices for a variant from a provider product.
 *
 * TWO RULES, both deliberate:
 *   * costPrice is the provider's number. Always overwritten — a stale cost
 *     makes every margin figure wrong.
 *   * sellingPrice is only recomputed when the admin has NOT pinned one. An
 *     explicitly set selling price is a business decision, and a sync that
 *     silently overwrote it would be a pricing incident.
 */
function derivePrices(product, variant) {
  const costChanged = Number(variant.costPrice) !== Number(product.price);

  const sellingPrice = sellingPriceFromCost(product.price);
  // A variant whose selling price equals exactly the derived value is treated as
  // "not pinned", so it keeps tracking the cost. Once an admin edits it to a
  // different number it stops being overwritten.
  const isPinned = Number(variant.sellingPrice) !== sellingPriceFromCost(variant.costPrice);
  const sellChanged = !isPinned && Number(variant.sellingPrice) !== sellingPrice;

  const update = { id: variant.id, costPrice: product.price };
  if (sellChanged) update.sellingPrice = sellingPrice;
  if (product.stock !== null) update.stock = product.stock;

  return {
    costChanged,
    sellChanged,
    variantUpdate: costChanged || sellChanged || product.stock !== null ? update : null,
  };
}

/**
 * Decide which internal variant a brand-new provider SKU belongs to.
 *
 * Uses ONLY the explicit rules in src/config/provider-mapping.js. A heuristic
 * that guessed from the SKU name would be right most of the time and
 * catastrophically wrong the rest of the time.
 *
 * Pulsa is modelled as ONE game with ONE Product per operator, and every
 * operator reuses the same variant slugs (`d5000`, `d10000`, …). A rule
 * carrying only `{gameSlug, variantSlug}` therefore resolves to whichever
 * operator's Product the database returns first — silently wiring, e.g.,
 * an Axis SKU to a Telkomsel card. When a rule carries `productSlug`, it
 * is part of the lookup key and the correct operator's card is chosen.
 */
function resolveNewSkuRule(product, brandById) {
  const byCode = PROVIDER_MAPPING.byProviderCode?.[product.providerCode];
  if (byCode) return byCode;

  const brandName = product.brandId !== null ? brandById.get(product.brandId)?.name : null;
  if (!brandName) return null;

  const gameSlug = PROVIDER_MAPPING.gameSlugByBrandName?.[brandName];
  if (!gameSlug) return null;

  // With a known game, the variant slug is derived from the provider SKU via an
  // explicit per-game table — still no guessing.
  const variantSlug = PROVIDER_MAPPING.variantSlugByProviderCode?.[product.providerCode];
  if (!variantSlug) return null;

  return { gameSlug, variantSlug };
}

/** Keep only what is useful for debugging drift, and keep it small. */
function serializeProduct(product) {
  return {
    providerCode: product.providerCode,
    name: product.name,
    price: product.price,
    status: product.available ? "active" : "inactive",
    serverCode: product.serverCode,
    inquiryFormKey: product.inquiryFormKey,
    brandId: product.brandId,
    syncedAt: new Date().toISOString(),
  };
}

/** Create the Provider row on first sync so the FK always resolves. */
async function ensureProviderRow(provider) {
  const baseUrl = process.env.MELOSTORE_BASE_URL || null;
  return prisma.provider.upsert({
    where: { code: provider.code },
    create: {
      code: provider.code,
      kind: "TOPUP",
      name: provider.name,
      baseUrl,
    },
    update: { name: provider.name, baseUrl },
    select: { id: true, code: true },
  });
}

async function writeSyncAudit({ actor, report, request }) {
  const { writeAudit } = await import("./audit.service.js");
  await writeAudit({
    action: AUDIT.CATALOG_SYNCED,
    actor,
    targetType: "Provider",
    targetId: "melostore",
    metadata: {
      fetched: report.fetched,
      created: report.created,
      priceChanged: report.priceChanged,
      unmatched: report.unmatched.length,
      durationMs: report.durationMs,
    },
    request,
  });
}

/**
 * Refresh every variant's cost from the last stored ProviderProduct snapshot,
 * without contacting the provider. Used when the provider is down but the admin
 * needs the margin report to reflect what we last knew.
 */
export async function rebuildCostsFromSnapshot() {
  const rows = await prisma.providerProduct.findMany({
    where: { providerPrice: { not: null } },
    select: { productVariantId: true, providerPrice: true, isAvailable: true },
  });

  const result = await prisma.$transaction(
    rows.map((row) =>
      prisma.productVariant.update({
        where: { id: row.productVariantId },
        data: { costPrice: row.providerPrice },
        select: { id: true },
      })
    )
  );

  return { updated: result.length };
}
