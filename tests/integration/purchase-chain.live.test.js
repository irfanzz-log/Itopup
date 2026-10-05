// Verify the FULL purchase chain after a real sync:
//   provider SKU → ProviderProduct → ProductVariant → Product → Game
// and that selectProviderMapping(), the function checkout calls, returns a
// mapping. If it returns null, checkout throws ITP_PRODUCT_UNAVAILABLE, which is
// exactly the "tidak bisa melakukan pembelian" symptom.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { syncProviderCatalog } from "../../src/services/sync.service.js";
import { selectProviderMapping, getSellableVariant } from "../../src/services/catalog.service.js";
import { prisma } from "../../src/lib/db.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const log = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

describe("melostore purchase chain (live)", () => {
  it("checkout can select a provider mapping for a synced variant", async () => {
    // Fresh catalogue, then a real sync.
    execFileSync("node", ["prisma/seed.js"], {
      cwd: ROOT,
      env: {
        ...process.env,
        DATABASE_URL: process.env.DATABASE_URL,
        DIRECT_URL: process.env.DIRECT_URL || process.env.DATABASE_URL,
        SEED_ADMIN_PASSWORD: "IntegrationTest-2026!",
      },
      stdio: "pipe",
    });

    // The seed deliberately leaves the provider DISABLED until integration is
    // verified. selectProviderMapping only considers ACTIVE providers, so flip
    // it, this is the operator action the admin panel performs.
    await prisma.provider.update({
      where: { code: "melostore" },
      data: { status: "ACTIVE" },
    });

    const report = await syncProviderCatalog({ dryRun: false, log });
    console.log(`sync: fetched=${report.fetched} created=${report.created}`);

    // ── The chain, read straight from the database ─────────────────────────
    const mappings = await prisma.providerProduct.findMany({
      include: {
        provider: true,
        productVariant: { include: { product: { include: { game: true } } } },
      },
      take: 5,
      orderBy: { providerCode: "asc" },
    });

    expect(mappings.length).toBeGreaterThan(0);
    console.log("\n=== FULL CHAIN (provider → variant → product → game) ===");
    for (const m of mappings) {
      const v = m.productVariant;
      console.log(
        `  ${m.provider.code}/${m.providerCode.padEnd(22)} → ` +
        `${v.product.game.slug}/${v.product.slug}/${v.slug} ` +
        `cost=${v.costPrice} sell=${v.sellingPrice} active=${v.isActive}`
      );
      // Every hop must resolve.
      expect(m.provider).toBeTruthy();
      expect(v).toBeTruthy();
      expect(v.product).toBeTruthy();
      expect(v.product.game).toBeTruthy();
    }

    // ── Now the function checkout actually calls ───────────────────────────
    const variantId = mappings[0].productVariantId;
    const variant = await getSellableVariant(variantId);

    console.log("\n=== CHECKOUT-LEVEL CHECK ===");
    console.log(`getSellableVariant ok: ${variant.product.game.slug}/${variant.slug}`);

    const mapping = selectProviderMapping(variant);
    console.log(`selectProviderMapping: ${mapping ? mapping.providerCode : "NULL (checkout would refuse)"}`);
    expect(mapping).not.toBeNull();
    expect(mapping.providerCode).toBeTruthy();

    // Count how many of our variants are now purchasable end-to-end.
    //
    // The `isAvailable: true` filter is REQUIRED here, not cosmetic:
    // getSellableVariant() applies exactly this filter, so a variant whose only
    // provider SKU is `out_of_stock` (all of Genshin, right now) reaches
    // checkout with an empty providerProducts array and is correctly refused.
    // Counting without the filter reports Genshin as purchasable and overstates
    // the result, a test that lies in the optimistic direction is worse than no
    // test.
    const allVariants = await prisma.productVariant.findMany({
      include: {
        product: { include: { game: true } },
        providerProducts: { where: { isAvailable: true }, include: { provider: true } },
      },
    });
    const purchasable = allVariants.filter((v) => selectProviderMapping(v) !== null);
    const blocked = allVariants.filter(
      (v) => v.providerProducts.length > 0 && selectProviderMapping(v) === null
    );
    const unmapped = allVariants.filter((v) => v.providerProducts.length === 0);

    console.log(`\npurchasable variants: ${purchasable.length} / ${allVariants.length}`);
    for (const v of purchasable) {
      console.log(`  ${v.product.game.slug}/${v.slug}`);
    }
    console.log(`\nlinked but NOT purchasable (provider out_of_stock): ${blocked.length}`);
    for (const v of blocked) {
      console.log(`  ${v.product.game.slug}/${v.slug} → ${v.providerProducts.map((p) => p.providerCode).join(", ")}`);
    }
    console.log(`\nnot linked at all: ${unmapped.length}`);
    for (const v of unmapped) {
      console.log(`  ${v.product.game.slug}/${v.slug}`);
    }

    expect(purchasable.length).toBeGreaterThan(0);
  }, 300_000);
});
