// Integration: run the REAL sync against the live Melostore pricelist and assert
// that ProviderProduct rows are actually written.
//
// Run explicitly (hits the network, ~80s):
//   npx vitest run tests/integration/melostore-sync.integration.test.js
//
// NOTE ON SETUP: tests/setup.js TRUNCATEs every public table in beforeAll, so the
// catalogue is empty when a test starts. This test therefore re-seeds it (by
// spawning prisma/seed.js, which owns the catalogue definition) before syncing,
// without that, every SKU is "unmatched" simply because there is no variant to
// link it to, which looks like a mapping bug and is not one.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { syncProviderCatalog } from "../../src/services/sync.service.js";
import { prisma } from "../../src/lib/db.js";
import { PROVIDER_MAPPING } from "../../src/config/provider-mapping.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const log = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

/** Seed the catalogue using the real seed script against the test database. */
function seedCatalogue() {
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
}

describe("melostore sync (live)", () => {
  it("links provider SKUs to our variants and persists ProviderProduct rows", async () => {
    seedCatalogue();

    const variantCount = await prisma.productVariant.count();
    expect(variantCount).toBeGreaterThan(0);
    console.log(`catalogue seeded: ${variantCount} variants`);

    const report = await syncProviderCatalog({ dryRun: false, log });

    console.log("\n=== SYNC REPORT ===");
    console.log(JSON.stringify({
      fetched: report.fetched,
      linked: report.linked,
      created: report.created,
      priceChanged: report.priceChanged,
      unavailable: report.unavailable,
      unchanged: report.unchanged,
      unmatched: report.unmatched.length,
    }, null, 2));

    // The provider advertises ~20.9k SKUs; a partial fetch means pagination broke.
    expect(report.fetched).toBeGreaterThan(15000);

    const rows = await prisma.providerProduct.findMany({
      include: { productVariant: { include: { product: { include: { game: true } } } } },
      orderBy: { providerCode: "asc" },
    });
    console.log(`\nProviderProduct rows in DB: ${rows.length}`);
    expect(rows.length).toBeGreaterThan(0);

    // Every linked SKU must resolve to a real game + variant.
    for (const row of rows) {
      expect(row.productVariant?.product?.game?.slug).toBeTruthy();
    }

    console.log("\n=== LINKED SKUs (proof the chain is connected) ===");
    for (const row of rows) {
      console.log(
        `  ${row.providerCode.padEnd(22)} Rp${String(row.providerPrice).padStart(9)} ` +
        `${row.isAvailable ? "available  " : "unavailable"} → ` +
        `${row.productVariant.product.game.slug}/${row.productVariant.slug}`
      );
    }

    // The link count must equal the number of byProviderCode rules, each rule
    // names one SKU, and a rule that produced no row would mean the sync
    // silently dropped it.
    const ruleCount = Object.keys(PROVIDER_MAPPING.byProviderCode).length;
    console.log(`\nbyProviderCode rules: ${ruleCount}, rows written: ${rows.length}`);
    expect(rows.length).toBe(ruleCount);

    // costPrice must have been refreshed from the provider's price.
    const withCost = rows.filter((r) => r.productVariant.costPrice > 0).length;
    expect(withCost).toBe(rows.length);
  }, 300_000);
});
