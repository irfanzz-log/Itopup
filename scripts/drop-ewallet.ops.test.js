// Operator script — REMOVE the topup e-wallet catalogue.
//
// Run with:
//   npx vitest run --config vitest.sync.config.js scripts/drop-ewallet.ops.test.js
//
// WHY A SCRIPT AND NOT A MIGRATION
//
// These rows were seeded from config that no longer exists. A Prisma migration
// would encode a data decision ("delete DANA") as schema state, and a migration
// re-run against a fresh database would then fail or delete nothing. Deleting
// from the seed source (config) is correct for SCHEMA; deleting the rows is a
// one-time data cleanup, which is what this is.
//
// WHAT GOES
//
//   * the E_WALLET Category row (config already dropped — see git history)
//   * the four Game rows: dana, ovo, gopay, shopeepay
//   * their Product / ProductVariant rows
//   * their ProviderProduct links (cascade on variant)
//
// WHAT IS PROTECTED
//
//   Orders and OrderItems. A variant with a live order is NOT deleted: an order
//   is a financial record and its line items must keep resolving. The script
//   reports such variants and exits without deleting anything, so the operator
//   decides rather than the script guessing. (A real order for an e-wallet top
//   up should be refunded/cancelled first, which is an operator action.)
//
//   ProviderProduct rows are deleted because they are a SYNC CACHE of the
//   provider's pricelist, not a transaction record — re-syncing rebuilds them.
import { describe, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const REPORT = "/tmp/drop-ewallet.log";

function say(line = "") {
  fs.appendFileSync(REPORT, line + "\n");
}

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

const WALLET_SLUGS = ["dana", "ovo", "gopay", "shopeepay"];

describe("drop e-wallet catalogue", () => {
  it("removes the wallet games, products and category", async () => {
    fs.rmSync(REPORT, { force: true });
    forceEnv();
    say(`DATABASE_URL host: ${String(process.env.DATABASE_URL).replace(/:[^:@/]+@/, ":***@").split("@")[1]?.split("/")[0]}`);

    const { prisma } = await import("../src/lib/db.js");

    // ── 0. Is any wallet variant referenced by a real order? ──────────────
    // Deleting it would orphan the order's line item, so refuse and report.
    const games = await prisma.game.findMany({
      where: { slug: { in: WALLET_SLUGS } },
      select: { id: true, slug: true, name: true },
    });
    const gameIds = games.map((g) => g.id);

    if (gameIds.length === 0) {
      say("\nNo wallet games found — nothing to do. The catalogue is already clean.");
      await prisma.$disconnect();
      return;
    }

    const blocked = await prisma.orderItem.findMany({
      where: { productVariant: { product: { gameId: { in: gameIds } } } },
      select: { id: true, orderId: true, productVariant: { select: { slug: true, product: { select: { game: { select: { slug: true } } } } } } },
      take: 50,
    });

    if (blocked.length > 0) {
      say(`\nABORTED: ${blocked.length} order item(s) reference wallet variants.`);
      say("Refund or cancel those orders first — an order is a financial record.");
      for (const b of blocked) {
        say(`  order=${b.orderId} variant=${b.productVariant.product.game.slug}/${b.productVariant.slug}`);
      }
      await prisma.$disconnect();
      throw new Error("Refusing to delete variants with live orders.");
    }

    // ── 1. Count what will go, then delete in dependency order ───────────
    const [variants, products, links] = await Promise.all([
      prisma.productVariant.count({ where: { product: { gameId: { in: gameIds } } } }),
      prisma.product.count({ where: { gameId: { in: gameIds } } }),
      prisma.providerProduct.count({ where: { productVariant: { product: { gameId: { in: gameIds } } } } }),
    ]);

    say(`\nRemoving:`);
    say(`  games:           ${gameIds.length}  (${games.map((g) => g.slug).join(", ")})`);
    say(`  products:        ${products}`);
    say(`  variants:        ${variants}`);
    say(`  provider links:  ${links}  (sync cache; rebuilt by re-syncing)`);

    // ProviderProduct → cascade on ProductVariant, but delete explicitly so the
    // report reflects reality even if the cascade rule changes.
    const deletedLinks = await prisma.providerProduct.deleteMany({
      where: { productVariant: { product: { gameId: { in: gameIds } } } },
    });
    await prisma.productVariant.deleteMany({ where: { product: { gameId: { in: gameIds } } } });
    await prisma.product.deleteMany({ where: { gameId: { in: gameIds } } });
    await prisma.game.deleteMany({ where: { id: { in: gameIds } } });

    say(`\nDeleted links (actual): ${deletedLinks.count}`);

    // ── 2. The E_WALLET category row (config already dropped it) ─────────
    const cat = await prisma.category.findFirst({ where: { kind: "E_WALLET" } });
    if (cat) {
      // A category with games still attached cannot be deleted; the games are
      // gone now, so this is safe.
      await prisma.category.delete({ where: { id: cat.id } });
      say(`Deleted category: ${cat.slug} (${cat.name})`);
    } else {
      say("Category E_WALLET: already absent");
    }

    // ── 3. Verify ────────────────────────────────────────────────────────
    const left = await prisma.game.findMany({
      orderBy: { sortOrder: "asc" },
      select: { slug: true, name: true, category: { select: { slug: true } } },
    });
    say(`\n=== GAMES REMAINING (${left.length}) ===`);
    for (const g of left) say(`  ${g.slug} | ${g.name} | cat=${g.category?.slug}`);
    say(
      `\nwallet games left: ${left.filter((g) => WALLET_SLUGS.includes(g.slug)).length} (must be 0)`
    );

    const pp = await prisma.providerProduct.count({
      where: { productVariant: { product: { game: { slug: { in: WALLET_SLUGS } } } } },
    });
    say(`wallet provider links left: ${pp} (must be 0)`);
    say("\nDONE");
    await prisma.$disconnect();
  }, 120_000);
});
