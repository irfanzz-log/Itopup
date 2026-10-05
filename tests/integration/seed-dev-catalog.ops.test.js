// ============================================================================
// One-off ops file: seed the DEV catalogue (categories, games, products,
// variants, provider row, app settings) into the dev Supabase database.
//
// WHY THIS EXISTS: `node prisma/seed.js` fails on Prisma 7, which emits a
// TypeScript-only client into ./generated/prisma. Plain node ESM cannot
// resolve `./generated/prisma/enums` (ERR_MODULE_NOT_FOUND), so the seed
// script needs a bundler. Vitest resolves the client, so this file replays the
// same upserts directly and is the reliable way to (re)seed dev.
//
// RUN (targets the dev DB via the opt-in; tests/setup.js still refuses prod):
//   ITOPUP_TEST_TARGET=dev npx vitest run tests/ops/seed-dev-catalog.test.js
//
// The writes are upserts keyed on natural keys (category kind, game slug,
// product+variant slug), so re-running is an idempotent refresh. Transaction
// rows (orders, payments, logs) are never touched. This mirrors prisma/seed.js
// exactly — same data, same derivation rules — minus the staff-admin and promo
// rows, which belong to a full environment bootstrap, not a catalogue refresh.
// ============================================================================
import { describe, it, expect } from "vitest";
import {
  GAME_SEED,
  PRODUCT_SEED,
  VARIANT_SEED,
} from "../../src/config/games.js";
import { CATEGORY_SEED } from "../../src/config/categories.js";
import { sellingPriceFromCost } from "../../src/config/pricing.js";
import { prisma } from "../../src/lib/db.js";

// The one service that lives in PULSA; everything else is a GAME. Mirrors
// prisma/seed.js so the two paths cannot disagree.
const categoryForSlug = (slug) => (slug === "pulsa" ? "PULSA" : "GAME");

/** Slug for a variant card, copied from prisma/seed.js. */
function variantSlug(entry, index) {
  if (entry.slug) return entry.slug;
  if (entry.denomination != null) return `d${entry.denomination}`;
  return `item-${index + 1}`;
}

/** Display name for a variant card, copied from prisma/seed.js. */
function variantName(entry, unit) {
  if (entry.name) return entry.name;
  if (entry.denomination != null)
    return `${entry.denomination.toLocaleString("id-ID")} ${unit ?? ""}`.trim();
  return `Item ${entry.denomination}`;
}

describe("seed dev catalogue", () => {
  it("upserts categories, games, products and variants", async () => {
    const counters = { categories: 0, games: 0, products: 0, variants: 0 };

    // ── 1. Categories ──────────────────────────────────────────────────────
    const categoryIdByKind = {};
    for (const entry of CATEGORY_SEED) {
      const row = await prisma.category.upsert({
        where: { kind: entry.kind },
        update: {
          name: entry.name,
          slug: entry.slug,
          description: entry.description ?? null,
          icon: entry.icon ?? null,
          sortOrder: entry.sortOrder ?? 0,
          isActive: true,
        },
        create: {
          kind: entry.kind,
          name: entry.name,
          slug: entry.slug,
          description: entry.description ?? null,
          icon: entry.icon ?? null,
          sortOrder: entry.sortOrder ?? 0,
        },
        select: { id: true },
      });
      categoryIdByKind[entry.kind] = row.id;
      counters.categories += 1;
    }

    // ── 2. Games ──────────────────────────────────────────────────────────
    const gameIdBySlug = {};
    for (const game of GAME_SEED) {
      const kind = categoryForSlug(game.slug);
      const categoryId = categoryIdByKind[kind];
      if (!categoryId) throw new Error(`No category for game "${game.slug}"`);

      const base = {
        slug: game.slug,
        name: game.name,
        publisher: game.publisher ?? null,
        description: game.description ?? null,
        isPopular: Boolean(game.popular),
        supportsValidation: Boolean(game.supportsValidation),
        // eFootball-style games whose provider flow demands the customer's game
        // password; the checkout form changes shape when this is true.
        needsGameLogin: Boolean(game.needsGameLogin),
        sortOrder: game.sortOrder ?? 0,
        // The checkout form renders from this array; the store, the price
        // endpoint and the order service all refuse a variant whose game has
        // none (ITP_INVALID_INPUT "Konfigurasi input belum tersedia"), so it
        // must be carried on both create and update.
        inputFields: game.inputFields ?? [],
        categoryId,
      };
      const row = await prisma.game.upsert({
        where: { slug: game.slug },
        update: { ...base, isActive: true },
        create: base,
        select: { id: true },
      });
      gameIdBySlug[game.slug] = row.id;
      counters.games += 1;
    }

    // ── 3. Products + variants ────────────────────────────────────────────
    for (const [gameSlug, products] of Object.entries(PRODUCT_SEED)) {
      const gameId = gameIdBySlug[gameSlug];
      if (!gameId)
        throw new Error(`Product seed references unknown game "${gameSlug}"`);

      for (const product of products) {
        const productRow = await prisma.product.upsert({
          where: { gameId_slug: { gameId, slug: product.slug } },
          update: {
            name: product.name,
            sortMode: product.sortMode,
            sortOrder: product.sortOrder,
            isActive: true,
          },
          create: {
            gameId,
            name: product.name,
            slug: product.slug,
            sortMode: product.sortMode,
            sortOrder: product.sortOrder,
          },
          select: { id: true },
        });

        const variants = VARIANT_SEED[gameSlug]?.[product.slug] ?? [];
        for (const [index, entry] of variants.entries()) {
          const slug = variantSlug(entry, index);
          const costPrice = Number(entry.costPrice);
          if (!Number.isFinite(costPrice) || costPrice <= 0) {
            throw new Error(
              `costPrice tidak valid untuk ${gameSlug}/${product.slug}/${slug}`
            );
          }

          // sellingPrice is DERIVED from costPrice via the single markup rule,
          // never typed twice. PULSA uses a fixed spread, so the category kind
          // is passed through.
          const kind = categoryForSlug(gameSlug);
          const sellingPrice =
            entry.sellingPrice ?? sellingPriceFromCost(costPrice, { kind });

          // A variant may be defined but not sellable (eFootball needs the
          // customer's game password); it still lists, checkout refuses it.
          const isActive = entry.isActive !== false;

          await prisma.productVariant.upsert({
            where: { productId_slug: { productId: productRow.id, slug } },
            update: {
              name: variantName(entry, product.name),
              denomination: entry.denomination ?? null,
              unit: product.name,
              costPrice,
              sellingPrice,
              sortOrder: entry.sortOrder ?? index,
              isActive,
            },
            create: {
              productId: productRow.id,
              name: variantName(entry, product.name),
              slug,
              denomination: entry.denomination ?? null,
              unit: product.name,
              costPrice,
              sellingPrice,
              sortOrder: entry.sortOrder ?? index,
            },
          });
          counters.variants += 1;
        }
        counters.products += 1;
      }
    }

    // ── 4. Provider row (non-secret routing data only) ────────────────────
    await prisma.provider.upsert({
      where: { code: "melostore" },
      update: { name: "Melostore H2H", status: "ACTIVE" },
      create: { code: "melostore", name: "Melostore H2H", status: "ACTIVE" },
    });

    console.log("seeded:", counters);
    expect(counters.categories).toBeGreaterThan(0);
    expect(counters.games).toBeGreaterThan(0);
    expect(counters.products).toBeGreaterThan(0);
    expect(counters.variants).toBeGreaterThan(0);
  }, 120_000);

  it("catalogue is queryable and priced", async () => {
    const cats = await prisma.category.count();
    const games = await prisma.game.count();
    const products = await prisma.product.count();
    const variants = await prisma.productVariant.count();
    const pulsa = await prisma.game.findUnique({
      where: { slug: "pulsa" },
      select: { id: true, name: true, category: { select: { kind: true, name: true } } },
    });
    const sampleVariant = await prisma.productVariant.findFirst({
      where: { isActive: true, sellingPrice: { gt: 0 } },
      select: {
        name: true,
        slug: true,
        costPrice: true,
        sellingPrice: true,
        product: { select: { name: true, game: { select: { slug: true } } } },
      },
    });

    console.log({ categories: cats, games, products, variants, pulsa, sampleVariant });
    expect(cats).toBeGreaterThan(0);
    expect(games).toBeGreaterThan(0);
    expect(variants).toBeGreaterThan(0);
    expect(pulsa?.category?.kind).toBe("PULSA");
    expect(sampleVariant?.sellingPrice).toBeGreaterThan(sampleVariant?.costPrice ?? 0);
  });
});
