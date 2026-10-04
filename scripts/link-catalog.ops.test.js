// Restore the catalogue and link everything the mapping now covers.
//
// WHAT IT DOES
//
//   1. Recreates variants that a mapping rule covers but the DB lacks. This is
//      what rebuilt Free Fire: the product was active but every variant under
//      it had been deleted, so 37 correct rules pointed at nothing and the game
//      rendered an empty grid. The ladder is rebuilt FROM the rules, priced off
//      the live pricelist — never by hand.
//   2. Creates ProviderProduct links for every rule whose SKU the provider
//      lists, across ALL games. A targeted re-run of the link pass in
//      sync.service.js, not a full sync.
//   3. Refreshes costPrice/sellingPrice/stock from the live pricelist for links
//      that already exist. sellingPrice is always DERIVED
//      (sellingPriceFromCost), never typed by hand.
//
// It never re-points a variant that is already linked under another code —
// that changes what we buy and is an operator decision (same rule as
// sync.service.js).
//
// Run after fixing src/config/provider-mapping.js:
//   npx vitest run --config vitest.sync.config.js scripts/link-catalog.ops.test.js
//
import { describe, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const REPORT = "/tmp/ff-restore-write.log";

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

// (The variant-creation loop derives its targets from PROVIDER_MAPPING at run
// time, so there is no denomination list to maintain here.)

describe("catalogue restore + relink", () => {
  it("creates missing variants and links every resolvable rule", async () => {
    fs.rmSync(REPORT, { force: true });
    forceEnv();

    const { getTopupProvider } = await import("../src/providers/index.js");
    const { prisma } = await import("../src/lib/db.js");
    const { PROVIDER_MAPPING } = await import("../src/config/provider-mapping.js");
    const { sellingPriceFromCost } = await import("../src/config/pricing.js");
    const say = (line = "") => fs.appendFileSync(REPORT, line + "\n");

    const provider = getTopupProvider();
    const result = await provider.getProducts({ log: { info() {}, warn() {}, error() {} } });
    if (!result.ok) throw new Error(`provider fetch failed: ${JSON.stringify(result.error)}`);
    const listed = new Map(result.data.products.map((p) => [p.providerCode, p]));
    const providerRow = await prisma.provider.upsert({
      where: { code: provider.code },
      create: { code: provider.code, kind: "TOPUP", name: provider.name },
      update: {},
      select: { id: true },
    });

    say(`provider: ${provider.code} (${providerRow.id}), pricelist: ${listed.size} SKUs`);
    say(`mapping rules: ${Object.keys(PROVIDER_MAPPING.byProviderCode).length}`);

    // ── 1. Variants that a rule covers but the DB lacks ────────────────────
    // Free Fire is the case that made this necessary: the product was active
    // but every variant under it had been deleted, so 37 correct rules pointed
    // at nothing and the game rendered an empty grid. Rebuilding from the rules
    // works for any game in that state, so this loop is not FF-specific — it
    // recreates a variant for every rule whose variant is absent, priced off
    // the SKU the rule names.
    //
    // A rule needs a productSlug (or a game with a single product) for the
    // target to be unambiguous; rules without one are skipped here and left to
    // the seed, which knows the product ladder.
    const created = [];
    const productsByGame = new Map();
    for (const [code, rule] of Object.entries(PROVIDER_MAPPING.byProviderCode)) {
      const m = /^d(\d+)$/.exec(rule.variantSlug);
      if (!m) continue;

      let product = null;
      if (rule.productSlug) {
        if (!productsByGame.has(`${rule.gameSlug}/${rule.productSlug}`)) {
          productsByGame.set(
            `${rule.gameSlug}/${rule.productSlug}`,
            await prisma.product.findFirst({
              where: { game: { slug: rule.gameSlug }, slug: rule.productSlug },
              select: { id: true, name: true, isActive: true },
            })
          );
        }
        product = productsByGame.get(`${rule.gameSlug}/${rule.productSlug}`);
      } else {
        // A game with exactly one product: the rule's variant slug is enough.
        if (!productsByGame.has(`${rule.gameSlug}/*`)) {
          const all = await prisma.product.findMany({
            where: { game: { slug: rule.gameSlug } },
            select: { id: true, name: true, isActive: true },
          });
          productsByGame.set(`${rule.gameSlug}/*`, all.length === 1 ? all[0] : null);
        }
        product = productsByGame.get(`${rule.gameSlug}/*`);
      }
      if (!product) continue;

      const denomination = Number(m[1]);
      const existing = await prisma.productVariant.findFirst({
        where: { productId: product.id, slug: rule.variantSlug },
        select: { id: true },
      });
      if (existing) continue;

      const live = listed.get(code);
      const cost = live ? Number(live.price) : null;
      if (cost === null) {
        say(`  ${rule.gameSlug}/${rule.variantSlug}: SKU ${code} not on the pricelist — left uncreated`);
        continue;
      }

      const variant = await prisma.productVariant.create({
        data: {
          productId: product.id,
          name: `${denomination.toLocaleString("id-ID")} ${product.name}`,
          slug: rule.variantSlug,
          denomination,
          unit: product.name,
          costPrice: cost,
          sellingPrice: sellingPriceFromCost(cost, { kind: "GAME" }),
          isActive: true,
          // A variant linked to an out-of-stock SKU is still listed; the sync
          // records unavailable and checkout refuses, which is honest.
          sortOrder: denomination,
        },
      });
      created.push(variant.id);
      say(`  ${rule.gameSlug}/${rule.variantSlug}: CREATED cost=${cost} sell=${sellingPriceFromCost(cost, { kind: "GAME" })} from ${code}${live.available ? "" : " (SKU off)"}`);
    }
    say(`created ${created.length} variants`);

    // ── 2. Link every variant a rule now resolves ──────────────────────────
    // Rebuild the variant lookup once; the loop below only links, it never
    // re-points an existing link (that is an operator decision, see
    // sync.service.js).
    const variantsByKey = new Map();
    const allVariants = await prisma.productVariant.findMany({
      select: {
        id: true, slug: true, costPrice: true, sellingPrice: true, isActive: true,
        product: { select: { id: true, slug: true, isActive: true, game: { select: { id: true, slug: true, isActive: true, category: { select: { kind: true } } } } } },
      },
    });
    for (const v of allVariants) {
      variantsByKey.set(`${v.product.game.slug}/${v.product.slug}/${v.slug}`, v);
    }
    const existingLinks = await prisma.providerProduct.findMany({
      where: { providerId: providerRow.id },
      select: { id: true, providerCode: true, productVariantId: true },
    });
    const linkedVariantIds = new Set(existingLinks.map((l) => l.productVariantId));
    const linkedByCode = new Set(existingLinks.map((l) => l.providerCode));

    let linked = 0, refreshed = 0, noSku = 0, noVariant = 0, skippedDupe = 0;
    const writes = [];
    for (const [code, rule] of Object.entries(PROVIDER_MAPPING.byProviderCode)) {
      const key = `${rule.gameSlug}/${rule.productSlug ?? "-"}/${rule.variantSlug}`;
      const variant = rule.productSlug
        ? variantsByKey.get(`${rule.gameSlug}/${rule.productSlug}/${rule.variantSlug}`)
        : (() => {
            // Rules without productSlug may belong to any product on the game;
            // fall back to the first variant with that slug on that game.
            const exact = variantsByKey.get(key);
            if (exact) return exact;
            return allVariants.find(
              (v) => v.product.game.slug === rule.gameSlug && v.slug === rule.variantSlug
            );
          })();
      if (!variant) { noVariant++; continue; }

      const live = listed.get(code);
      if (!live) { noSku++; continue; }

      // Already linked under THIS code → refresh price/availability in place.
      if (linkedByCode.has(code) && existingLinks.some((l) => l.providerCode === code && l.productVariantId === variant.id)) {
        const row = existingLinks.find((l) => l.providerCode === code && l.productVariantId === variant.id);
        writes.push({
          model: "providerProduct",
          id: row.id,
          providerId: providerRow.id,
          productVariantId: variant.id,
          providerCode: code,
          providerName: live.name,
          providerPrice: live.price,
          providerStock: live.stock,
          isAvailable: live.available,
          lastSyncAt: new Date(),
        });
        refreshed++;
        continue;
      }

      // Linked under a DIFFERENT code → leave it (operator decision).
      if (linkedVariantIds.has(variant.id)) { skippedDupe++; continue; }

      writes.push({
        model: "providerProduct",
        providerId: providerRow.id,
        productVariantId: variant.id,
        providerCode: code,
        providerName: live.name,
        providerPrice: live.price,
        providerStock: live.stock,
        isAvailable: live.available,
        lastSyncAt: new Date(),
      });
      linked++;
    }

    say("");
    say(`=== LINKS: new=${linked} refreshed=${refreshed} noSku=${noSku} noVariant=${noVariant} dupeSkipped=${skippedDupe} ===`);

    // ── 3. Persist in chunks (same discipline as sync.service.js) ─────────
    // Chunked, not one transaction: a single big transaction against the
    // hosted pooler dies with P2028 mid-way and rolls back everything.
    // The `model`/`id` bookkeeping keys are stripped here so they never reach
    // the column list.
    const CHUNK = 40;
    for (let i = 0; i < writes.length; i += CHUNK) {
      const chunk = writes.slice(i, i + CHUNK);
      await prisma.$transaction(
        chunk.map(({ model, id, ...data }) =>
          id
            ? prisma.providerProduct.update({ where: { id }, data })
            : prisma.providerProduct.create({ data })
        ),
        { timeout: 90_000, maxWait: 15_000 }
      );
    }
    say(`wrote ${writes.length} provider_product rows in ${Math.ceil(writes.length / CHUNK)} chunks`);

    const counts = {
      games: await prisma.game.count(),
      products: await prisma.product.count(),
      variants: await prisma.productVariant.count(),
      links: await prisma.providerProduct.count(),
    };
    say("");
    say("=== AFTER ===");
    say(JSON.stringify(counts));

    const perGame = await prisma.$queryRawUnsafe(`
      select g.slug, count(distinct p.id) as products, count(v.id) as variants,
             count(pp.id) as linked, count(pp.id) filter (where pp."isAvailable") as linkedAvail
      from games g
      left join products p on p."gameId" = g.id
      left join product_variants v on v."productId" = p.id
      left join provider_products pp on pp."productVariantId" = v.id
      group by g.slug, g."sortOrder"
      order by g."sortOrder", g.slug
    `);
    for (const r of perGame) {
      say(`  ${String(r.slug).padEnd(16)} prod=${String(r.products).padStart(3)} var=${String(r.variants).padStart(4)} linked=${String(r.linked).padStart(4)} avail=${String(r.linkedavail ?? r.linkedAvail).padStart(4)}`);
    }

    await prisma.provider.update({
      where: { id: providerRow.id },
      data: { lastSyncAt: new Date(), lastSyncStatus: `ok:manual-restore:${writes.length}` },
    });
    await prisma.$disconnect();
  });
});
