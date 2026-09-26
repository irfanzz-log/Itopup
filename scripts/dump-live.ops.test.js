import { describe, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Operator script — read-only against the provider; writes NOTHING to the DB.
//   npx vitest run --config vitest.sync.config.js scripts/dump-live.ops.test.js
//
// WHY: the live pricelist names only ~52 of ~753 `brand_id` values in its
// `meta.brands` block, so a brand-NAME lookup resolves almost nothing. The
// spreadsheet has the brand name for every SKU. Dumping the full catalogue here
// lets the two be joined on SKU, which is exact.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const OUT = "/tmp/live-products.json";

function forceEnv() {
  const raw = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
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

describe("dump live catalogue", () => {
  it("writes every pricelist row to JSON", async () => {
    forceEnv();
    const { melostoreProvider } = await import("../src/providers/melostore/index.js");

    const res = await melostoreProvider.getProducts({});
    if (!res.ok) {
      fs.writeFileSync(OUT, JSON.stringify({ error: res.error }, null, 2));
      throw new Error(`fetch failed: ${JSON.stringify(res.error)}`);
    }

    const { products, brands, inquiryForms } = res.data;
    fs.writeFileSync(
      OUT,
      JSON.stringify(
        {
          fetchedAt: new Date().toISOString(),
          count: products.length,
          brands,
          inquiryForms,
          products,
        },
        null,
        0
      )
    );

    // Written to stdout too, because a vitest reporter may swallow console.log.
    fs.writeFileSync("/tmp/dump-live.log", `count=${products.length} brands=${brands.length}\n`);
  }, 900_000);
});
