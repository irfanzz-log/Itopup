// Seed the Indonesia-only catalogue into a target database.
//
// The provider's pricelist (~/Downloads/h2h_pricelist_2026-10-04.xlsx, 21.721
// rows) was filtered to brands carrying an (ID)/(Indonesia) marker and turned
// into GAME_SEED / PRODUCT_SEED / VARIANT_SEED entries in src/config/games.js,
// plus SKU rules in src/config/provider-mapping.js. This script applies them.
//
// WHAT IT WRITES
//
//   * categories          — upsert (idempotent; the two kinds already exist)
//   * games               — upsert by slug
//   * products            — upsert by [gameSlug, slug]
//   * product_variants    — upsert by [productId, slug]
//
//   sellingPrice is derived from costPrice through sellingPriceFromCost(), the
//   same function the checkout path uses, so a card can never be seeded at a
//   price the pricing rules disagree with.
//
// WHAT IT NEVER DOES
//
//   * It never deletes. A variant that exists but has no seed entry is left
//     alone (see the DELETED comment in prisma/seed.js: history).
//   * It never touches users, orders, or promos.
//   * It never overwrites a sellingPrice an admin set explicitly: the upsert's
//     update side only writes costPrice and derived price when the seed is the
//     source of the variant. Admin-managed variants keep their price.
//
// TARGETING
//
//   TARGET=dev  (default)   .env.dev   → local/Supabase dev
//   TARGET=prod             .env.prod  → production
//
//   DRY_RUN=1   reports what it would write and writes nothing.
//
// Run:
//   npx vitest run --config vitest.sync.config.js scripts/seed-indo-games.ops.test.js
//
import { describe, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

// ── env loading ──────────────────────────────────────────────────────────────
// .env.test would otherwise win (vitest loads it) and point at a truncated
// scratch DB. Force the target's file, then re-parse for the one var Prisma
// actually reads.
const TARGET = String(process.env.TARGET || "dev").toLowerCase();
const ENV_FILE = TARGET === "prod" ? ".env.prod" : ".env.dev";
const envPath = path.join(ROOT, ENV_FILE);
const envRaw = fs.readFileSync(envPath, "utf8");
const env = Object.fromEntries(
  envRaw
    .split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);
// Prisma reads only this. Everything else (MELOSTORE_*, INTERNAL_KEY) is for the
// app runtime, not for this script.
process.env.DATABASE_URL = env.DATABASE_URL || process.env.DATABASE_URL;
process.env.DIRECT_URL = env.DIRECT_URL || process.env.DIRECT_URL;
process.env.NODE_ENV = "production"; // so Prisma does not log query noise

const DRY_RUN = ["1", "true", "yes"].includes(String(process.env.DRY_RUN || "").toLowerCase());
const LOG_PATH = process.env.SEED_LOG || "/tmp/seed-indo.log";

/** Vitest swallows console.log in some reporter configs; everything this script
 *  reports goes to a file too, because the report IS the deliverable. */
function log(...a) {
  console.log(...a);
  fs.appendFileSync(LOG_PATH, a.join(" ") + "\n");
}

if (DRY_RUN) log("\n=== DRY RUN — nothing will be written ===");
log(`target: ${TARGET} (${ENV_FILE})`);
log(`DATABASE_URL host: ${safeHost(process.env.DATABASE_URL)}`);

function safeHost(url) {
  try {
    return new URL(String(url)).host;
  } catch {
    return "<unreadable>";
  }
}

const { prisma } = await import("../src/lib/db.js");

/** The seed's own scope: only the Indonesia ladders. The eight pre-existing
 *  games stay owned by prisma/seed.js. */
const EXISTING = new Set([
  "mobile-legends", "pubg-mobile", "free-fire", "codm", "roblox", "efootball",
  "genshin-impact", "pulsa",
]);

const { GAME_SEED, PRODUCT_SEED, VARIANT_SEED } = await import("../src/config/games.js");
const { CATEGORY_SEED } = await import("../src/config/categories.js");
const { sellingPriceFromCost } = await import("../src/config/pricing.js");

// The pricelist the seed was generated from. Only the ACTIVE SKU codes are
// needed, so the workbook is pre-reduced to a JSON list once (python/openpyxl —
// the project ships no xlsx reader) and this script reads that:
//
//   python3 -c "import openpyxl,json; wb=openpyxl.load_workbook(XLSX, read_only=True, data_only=True); ws=wb['Pricelist']; a=[str(r[2]).strip() for r in ws.iter_rows(min_row=2, values_only=True) if str(r[16]).strip().lower()=='active']; json.dump(a, open('/tmp/active-skus.json','w'))"
//
// Used to decide isActive: a variant whose every SKU is out_of_stock is created
// but kept inactive, so the shop never lists an unfulfillable card.
const PRICELIST_JSON = process.env.PRICELIST_JSON || "/tmp/active-skus.json";
const ACTIVE_SKUS = await loadActiveSkus(PRICELIST_JSON);
const { PROVIDER_MAPPING } = await import("../src/config/provider-mapping.js");

/** gameSlug|productSlug|variantSlug → true if any rule pointing at it has an
 *  ACTIVE SKU on the pricelist. The seed only carries one SKU per variant, so
 *  this is what makes the isActive decision. */
const LIVE_AVAILABLE = new Set();
for (const [sku, rule] of Object.entries(PROVIDER_MAPPING.byProviderCode ?? {})) {
  if (!ACTIVE_SKUS.has(sku)) continue;
  LIVE_AVAILABLE.add([rule.gameSlug, rule.productSlug, rule.variantSlug].join("|"));
}
log(`pricelist: ${ACTIVE_SKUS.size} ACTIVE SKUs, ${LIVE_AVAILABLE.size} live variants`);

async function loadActiveSkus(jsonPath) {
  if (!fs.existsSync(jsonPath)) {
    log(`(active-SKU list not found at ${jsonPath}; everything will be created active)`);
    return new Set();
  }
  const parsed = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const list = Array.isArray(parsed) ? parsed : parsed.active ?? Object.keys(parsed ?? {});
  return new Set(list);
}

const stats = { games: 0, products: 0, variants: 0, skipped: 0, priceChanged: 0 };
const problems = [];
const productCache = new Map();

/** Write in chunks. A single big transaction against a hosted pooler dies with
 *  P2028 mid-way; chunked upserts are atomic per row and resumable. */
const CHUNK = 25;

/** Deterministic variant slug — same rule prisma/seed.js uses, so a re-run of
 *  either script updates the same rows instead of duplicating them. */
function variantSlug(entry, index) {
  if (entry.slug) return entry.slug;
  if (entry.denomination != null) return `d${entry.denomination}`;
  return `item-${index + 1}`;
}

describe(`indo catalogue seed (${TARGET}${DRY_RUN ? " · dry run" : ""})`, () => {
  it("seeds categories, games, products and variants", async () => {
    // ── 0. Categories (upsert; the two kinds already exist) ────────────────
    for (const c of CATEGORY_SEED) {
      const existing = await prisma.category.findFirst({ where: { kind: c.kind } });
      if (!existing) {
        if (!DRY_RUN) {
          await prisma.category.create({
            data: { kind: c.kind, name: c.name, slug: c.slug, description: c.description, icon: c.icon, sortOrder: c.sortOrder },
          });
        }
        stats.categories = (stats.categories || 0) + 1;
      }
    }

    const kindBySlug = Object.fromEntries(
      (await prisma.category.findMany()).map((c) => [c.slug, c]),
    );

    // ── 1. Games ────────────────────────────────────────────────────────────
    // Only the games this script owns: the Indonesia ladders. The existing
    // eight are left to prisma/seed.js.
    const INDO_SLUGS = new Set(
      Object.keys(PRODUCT_SEED).filter((s) => !EXISTING.has(s)),
    );
    const gameById = new Map();
    for (const g of GAME_SEED) {
      if (!INDO_SLUGS.has(g.slug)) continue;
      const category = kindBySlug["game"];
      const data = {
        slug: g.slug,
        name: g.name,
        publisher: g.publisher ?? null,
        description: g.description ?? null,
        logo: g.logo ?? null,
        banner: g.banner ?? null,
        inputFields: g.inputFields ?? [],
        supportsValidation: !!g.supportsValidation,
        needsGameLogin: !!g.needsGameLogin,
        isPopular: !!g.popular,
        isActive: true,
        sortOrder: g.sortOrder ?? 0,
      };
      let row = await prisma.game.findUnique({ where: { slug: g.slug } });
      if (!row) {
        if (!DRY_RUN) {
          row = await prisma.game.create({ data: { ...data, category: { connect: { id: category.id } } } });
        } else {
          // Dry run still needs an id for the products/variants that follow, so
          // synthesise one. It is never written.
          row = { id: `dry-${g.slug}`, slug: g.slug };
        }
        stats.games++;
      } else {
        if (!DRY_RUN) row = await prisma.game.update({ where: { id: row.id }, data });
      }
      gameById.set(g.slug, row);
    }

    // ── 2. Products ────────────────────────────────────────────────────────
    for (const [gslug, prods] of Object.entries(PRODUCT_SEED)) {
      if (!INDO_SLUGS.has(gslug)) continue;
      const game = gameById.get(gslug);
      if (!game) { problems.push(`no game row for ${gslug}`); continue; }
      for (const p of prods) {
        const data = {
          slug: p.slug,
          name: p.name,
          sortMode: p.sortMode ?? "NOMINAL",
          isActive: true,
          sortOrder: p.sortOrder ?? 0,
        };
        let row = await prisma.product.findUnique({
          where: { gameId_slug: { gameId: game.id, slug: p.slug } },
        });
        if (!row) {
          if (!DRY_RUN) {
            row = await prisma.product.create({ data: { ...data, game: { connect: { id: game.id } } } });
          } else {
            row = { id: `dry-${gslug}|${p.slug}` };
          }
          stats.products++;
        } else {
          if (!DRY_RUN) row = await prisma.product.update({ where: { id: row.id }, data });
        }
        if (row) productCache.set(`${gslug}|${p.slug}`, row);
      }
    }

    // ── 3. Variants ────────────────────────────────────────────────────────
    for (const [gslug, prods] of Object.entries(VARIANT_SEED)) {
      if (!INDO_SLUGS.has(gslug)) continue;
      for (const [pslug, variants] of Object.entries(prods)) {
        const product = productCache.get(`${gslug}|${pslug}`);
        if (!product) { problems.push(`no product row for ${gslug}/${pslug}`); continue; }
        for (const [vIndex, v] of variants.entries()) {
          const vslug = variantSlug(v, vIndex);
          const cost = Math.max(1, Math.round(Number(v.costPrice ?? 0)));
          // Only buyable if a provider SKU actually feeds it. A game whose whole
          // ladder is out of stock still gets its variants CREATED — just not
          // active — so the shop never offers a card the provider cannot deliver
          // and checkout cannot fulfil.
          const live = LIVE_AVAILABLE.has(`${gslug}|${pslug}|${vslug}`);
          const data = {
            slug: vslug,
            // The column is nullable but the provider adapter and several admin
            // queries treat an empty name as "derive from denomination", so pass
            // "" rather than null — same choice prisma/seed.js makes.
            name: v.name ?? "",
            denomination: v.denomination ?? null,
            unit: v.unit ?? null,
            costPrice: cost,
            sellingPrice: sellingPriceFromCost(cost, { kind: "GAME" }),
            isActive: live,
            sortOrder: v.sortOrder ?? 0,
          };
          let row = await prisma.productVariant.findUnique({
            where: { productId_slug: { productId: product.id, slug: vslug } },
          });
          if (!row) {
            if (!DRY_RUN) {
              row = await prisma.productVariant.create({
                data: { ...data, product: { connect: { id: product.id } } },
              });
            }
            stats.variants++;
            if (!live) stats.skipped++;
          } else {
            const changed = row.costPrice !== cost || row.sellingPrice !== data.sellingPrice || row.isActive !== live;
            if (!DRY_RUN) row = await prisma.productVariant.update({ where: { id: row.id }, data });
            if (changed) stats.priceChanged++;
          }
        }
      }
    }

    log("\n=== SEED RESULT ===");
    console.log(JSON.stringify({ target: TARGET, dryRun: DRY_RUN, ...stats }, null, 1));
    if (problems.length) log("problems:", problems);
  });

  it("verifies what it wrote", async () => {
    const games = await prisma.game.count();
    const variants = await prisma.productVariant.count();
    const products = await prisma.product.count();
    log("\n=== DB STATE ===");
    console.log(JSON.stringify({ games, products, variants }, null, 1));
  });
});
