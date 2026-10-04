// Verifies that every SKU referenced by PROVIDER_MAPPING.byProviderCode is
// actually listed by the provider. A rule pointing at a nonexistent SKU can
// never create a link, and the sync reports it only as "unmatched" buried among
// ~20k rows — it looks like the provider stopped stocking the product, when in
// fact the rule itself is stale.
//
//   npx vitest run --config vitest.sync.config.js scripts/audit-mapping.ops.test.js
//
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const REPORT = "/tmp/audit-mapping.log";

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

describe("mapping audit", () => {
  it("reports rules whose SKU the provider no longer lists", async () => {
    fs.rmSync(REPORT, { force: true });
    forceEnv();

    const { getTopupProvider } = await import("../src/providers/index.js");
    const { PROVIDER_MAPPING } = await import("../src/config/provider-mapping.js");
    const { prisma } = await import("../src/lib/db.js");
    const provider = getTopupProvider();
    const say = (line = "") => fs.appendFileSync(REPORT, line + "\n");

    const result = await provider.getProducts({ log: { info() {}, warn() {}, error() {} } });
    if (!result.ok) throw new Error(`fetch failed: ${JSON.stringify(result.error)}`);
    const { products } = result.data;

    const listed = new Map(products.map((p) => [p.providerCode, p]));
    const rules = Object.entries(PROVIDER_MAPPING.byProviderCode);

    const stale = [];
    const ok = [];
    for (const [code, rule] of rules) {
      const p = listed.get(code);
      if (!p) {
        // Is the variant linked anyway, under another code?
        const linked = await prisma.providerProduct.findFirst({
          where: {
            providerCode: code,
            productVariant: {
              slug: rule.variantSlug,
              product: {
                ...(rule.productSlug ? { slug: rule.productSlug } : {}),
                game: { slug: rule.gameSlug },
              },
            },
          },
          select: { id: true, isAvailable: true },
        });
        stale.push({ code, rule, linked: !!linked });
      } else {
        ok.push({ code, rule, available: p.available, price: p.price });
      }
    }

    say(`=== MAPPING AUDIT: ${rules.length} rules ===`);
    say(`listed by provider : ${ok.length}`);
    say(`STALE (SKU absent) : ${stale.length}`);
    say("");
    say("=== STALE RULES (rule points at a SKU the provider does not list) ===");
    for (const s of stale) {
      say(`   ${String(s.code).padEnd(18)} ${s.rule.gameSlug}/${s.rule.productSlug ?? "-"}/${s.rule.variantSlug}  linkedRow=${s.linked}`);
    }

    // Rules that ARE listed but whose variant has no link: the rule resolved,
    // the SKU exists, yet no ProviderProduct row exists. That means the variant
    // itself is missing from product_variants (rule points at a ghost).
    say("");
    say("=== LISTED RULES WITH NO LINK (variant may not exist) ===");
    let n = 0;
    for (const { code, rule } of ok) {
      const row = await prisma.providerProduct.findFirst({
        where: { providerCode: code },
        select: { id: true },
      });
      if (!row) {
        const variant = await prisma.productVariant.findFirst({
          where: {
            slug: rule.variantSlug,
            product: {
              ...(rule.productSlug ? { slug: rule.productSlug } : {}),
              game: { slug: rule.gameSlug },
            },
          },
          select: { id: true },
        });
        say(`   ${String(code).padEnd(18)} ${rule.gameSlug}/${rule.productSlug ?? "-"}/${rule.variantSlug} variantExists=${!!variant}`);
        n++;
      }
    }
    say(`(${n} such rules)`);

    await prisma.$disconnect();
  });
});
