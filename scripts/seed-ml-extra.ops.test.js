import { describe, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Operator script. Adds the 29 extra Mobile Legends diamond rungs that live in
// VARIANT_SEED but not yet in the database, then links them to their provider
// SKU. Idempotent: upserts, so re-running after a sync is a no-op.
//
//   npx vitest run --config vitest.sync.config.js scripts/seed-ml-extra.ops.test.js

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const REPORT = "/tmp/seed-ml-extra.log";

function say(line = "") {
  fs.appendFileSync(REPORT, line + "\n");
}

function forceEnv() {
  const raw = fs.readFileSync(path.join(ROOT, ".env.dev"), "utf8");
  for (const line of raw.split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let [, key, value] = m;
    value = value.trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    process.env[key] = value;
  }
  process.env.NODE_ENV = "development";
}

// (variantSlug, provider SKU, cost) — cheapest ACTIVE card per denomination,
// measured on the 2026-09-25 pricelist, brand "Mobile Legends (ID)".
const RUNGS = [
  ["d10", "mlid10d-s5", 2936],
  ["d33", "mlid33d-s8", 9112],
  ["d59", "mlid59d-s5", 17011],
  ["d74", "mlid74d-s8", 20605],
  ["d85", "mlid85d-s5", 24707],
  ["d113", "mlid113d-s5", 32853],
  ["d170", "mlid170d-s5", 49368],
  ["d184", "mlid184d-s8", 51510],
  ["d222", "mlid222d-s5", 65202],
  ["d240", "mlid240dd-s12", 68792],
  ["d284", "mlid284d-s5", 82911],
  ["d296", "mlid296d-s5", 82056],
  ["d345", "mlb345d-s13", 101181],
  ["d408", "mlid408d-s5", 116327],
  ["d568", "mlid568d-s5", 158441],
  ["d716", "mlid716d-s5", 201143],
  ["d750", "mlid750dd-s12a", 212691],
  ["d758", "mlid758d-s8", 203654],
  ["d875", "mlid875d-s5", 242376],
  ["d1050", "mlid1050d-s5", 292640],
  ["d1134", "mlid1134d-s5", 316416],
  ["d1159", "mlid1159d-s5", 324180],
  ["d1220", "mlid1220dd-s12a", 340724],
  ["d1704", "mlid1704dd-s12", 483835],
  ["d2010", "mlid2010d-s8", 507281],
  ["d2199", "mlb2199d-s13", 612753],
  ["d2904", "mlid2904d-s5", 777093],
  ["d4026", "mlid4026d-s8", 1016779],
  ["d4830", "mlid4830d-s5", 1266417],
];

describe("ml extra rungs", () => {
  it("seeds the 29 extra ML denominations and links their SKU", async () => {
    fs.rmSync(REPORT, { force: true });
    forceEnv();

    const { prisma } = await import("../src/lib/db.js");
    const { sellingPriceFromCost } = await import("../src/config/pricing.js");

    const game = await prisma.game.findFirstOrThrow({
      where: { slug: "mobile-legends" },
      select: { id: true },
    });
    const product = await prisma.product.findFirstOrThrow({
      where: { gameId: game.id, slug: "diamonds" },
      select: { id: true },
    });
    const provider = await prisma.provider.findFirstOrThrow({
      where: { code: "melostore" },
      select: { id: true },
    });

    let created = 0;
    let existed = 0;
    let linked = 0;

    for (const [slug, sku, cost] of RUNGS) {
      const denom = Number(slug.slice(1));
      const sell = sellingPriceFromCost(cost);

      const variant = await prisma.productVariant.upsert({
        where: { productId_slug: { productId: product.id, slug } },
        create: {
          productId: product.id,
          name: `${denom.toLocaleString("id-ID")} Diamonds`,
          slug,
          denomination: denom,
          unit: "Diamonds",
          costPrice: cost,
          sellingPrice: sell,
        },
        update: {},
        select: { id: true, costPrice: true, sellingPrice: true },
      });

      if (variant.costPrice === cost && variant.sellingPrice === sell) existed++;
      else created++;

      await prisma.providerProduct.upsert({
        where: { providerId_providerCode: { providerId: provider.id, providerCode: sku } },
        create: {
          providerId: provider.id,
          productVariantId: variant.id,
          providerCode: sku,
          providerName: `${denom.toLocaleString("id-ID")} Diamonds`,
          providerPrice: cost,
          isAvailable: true,
          lastSyncAt: new Date(),
        },
        update: {
          productVariantId: variant.id,
          providerPrice: cost,
          lastSyncAt: new Date(),
        },
        select: { id: true },
      });
      linked++;
    }

    say(`rungs        : ${RUNGS.length}`);
    say(`variants     : ${created} created, ${existed} already present`);
    say(`links touched: ${linked}`);

    // The constraint allows one provider link per variant; a rung that was
    // already linked under another SKU would have silently re-pointed above, so
    // verify the link actually belongs to the SKU we chose.
    const checks = await prisma.$queryRawUnsafe(`
      select pv.slug, pp."providerCode", pv."costPrice", pv."sellingPrice"
      from product_variants pv
      join provider_products pp on pp."productVariantId" = pv.id
      where pv."productId" = $1
      and pv.slug in (${RUNGS.map((_, i) => `$${i + 2}`).join(", ")})
    `, product.id, ...RUNGS.map((r) => r[0]));

    say("");
    say("=== SEEDED RUNGS ===");
    for (const row of checks) {
      const margin = Number(row.sellingPrice) - Number(row.costPrice);
      say(
        `${String(row.slug).padEnd(7)} ${String(row.providerCode).padEnd(17)} ` +
        `cost ${String(row.costPrice).padStart(9)} jual ${String(row.sellingPrice).padStart(9)} ` +
        `(+${margin})`
      );
    }
    say(`total: ${checks.length} rungs linked`);

    const bad = RUNGS.filter(
      ([slug, sku]) => !checks.some((c) => c.slug === slug && c.providerCode === sku)
    );
    say(`mismatch     : ${bad.length}${bad.length ? " -> " + bad.map((b) => b[0]).join(", ") : ""}`);
  });
});
