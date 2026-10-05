// ============================================================================
// One-off ops file: run the REAL Melostore catalogue sync against the dev
// database, linking provider SKUs to our ProductVariant rows.
//
// This is the step that makes a variant purchasable. A variant with no
// ProviderProduct link is ITP_PRODUCT_UNAVAILABLE at checkout ("Produk belum
// terhubung ke provider"), so seeding the catalogue is not enough — the
// provider pricelist has to be pulled and the mapping rules applied.
//
// RUN (dev only; tests/ops-setup.js refuses a prod-looking DATABASE_URL):
//   ITOPUP_TEST_TARGET=dev npx vitest run --config vitest.ops.config.js \
//     tests/integration/sync-dev-provider.ops.test.js
//
// Costs ~80s and hits the partner API once. The pricelist quota is
// 20 requests/minute, so this must not be looped.
// ============================================================================
import { describe, it, expect } from "vitest";
import { syncProviderCatalog } from "../../src/services/sync.service.js";
import { prisma } from "../../src/lib/db.js";

describe("sync dev provider catalogue", () => {
  it("links provider SKUs to our variants", async () => {
    const report = await syncProviderCatalog({ dryRun: false });

    console.log("=== SYNC REPORT ===");
    console.log(
      JSON.stringify(
        {
          fetched: report.fetched,
          linked: report.linked,
          created: report.created,
          priceChanged: report.priceChanged,
          unavailable: report.unavailable,
          unchanged: report.unchanged ?? 0,
          unmatched: report.unmatched.length,
        },
        null,
        2
      )
    );

    // The provider advertises ~20.9k SKUs; a partial fetch means pagination broke.
    expect(report.fetched).toBeGreaterThan(15000);
    expect(report.ok).toBe(true);
  }, 300_000);

  it("variants are now linked and priced", async () => {
    const linked = await prisma.providerProduct.count({
      where: { productVariantId: { not: null } },
    });
    const withCost = await prisma.productVariant.count({
      where: { costPrice: { gt: 0 } },
    });

    console.log({ linkedProviderProducts: linked, variantsWithCost: withCost });

    expect(linked).toBeGreaterThan(0);
    expect(withCost).toBeGreaterThan(0);
  });
});
