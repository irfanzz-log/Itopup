import { describe, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Operator script — read-only. Run with:
//   npx vitest run --config vitest.sync.config.js scripts/db-state.ops.test.js
//
// Prints the current catalogue state (games, products, variants, provider links)
// to /tmp/db-state.log so the next step works from facts instead of assumptions.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const REPORT = "/tmp/db-state.log";

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

describe("db state", () => {
  it("dumps the catalogue", async () => {
    fs.rmSync(REPORT, { force: true });
    forceEnv();
    say(`DATABASE_URL host: ${String(process.env.DATABASE_URL).replace(/:[^:@/]+@/, ":***@").split("@")[1]?.split("/")[0]}`);

    const { prisma } = await import("../src/lib/db.js");

    const games = await prisma.game.findMany({
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        slug: true,
        name: true,
        isActive: true,
        products: {
          orderBy: { sortOrder: "asc" },
          select: {
            id: true,
            slug: true,
            name: true,
            isActive: true,
            _count: { select: { variants: true } },
          },
        },
      },
    });

    say(`=== GAMES (${games.length}) ===`);
    for (const g of games) {
      say(`${g.slug} | ${g.name} | active=${g.isActive}`);
      for (const p of g.products) {
        say(`    ${g.slug}/${p.slug} "${p.name}" variants=${p._count.variants} active=${p.isActive}`);
      }
    }

    const variants = await prisma.productVariant.findMany({
      select: {
        id: true,
        slug: true,
        name: true,
        denomination: true,
        costPrice: true,
        sellingPrice: true,
        isActive: true,
        product: { select: { slug: true, game: { select: { slug: true } } } },
        providerProducts: {
          select: { providerCode: true, isAvailable: true, providerPrice: true },
        },
      },
      orderBy: [{ product: { game: { sortOrder: "asc" } } }, { sortOrder: "asc" }],
    });

    say("");
    say(`=== VARIANTS (${variants.length}) ===`);
    let linked = 0;
    let available = 0;
    for (const v of variants) {
      const link = v.providerProducts[0];
      if (link) linked++;
      if (link?.isAvailable) available++;
      say(
        `${v.product.game.slug}/${v.product.slug}/${v.slug} "${v.name}" denom=${v.denomination} cost=${v.costPrice} sell=${v.sellingPrice} active=${v.isActive} ` +
          (link
            ? `-> ${link.providerCode} avail=${link.isAvailable} price=${link.providerPrice}`
            : "-> (no link)")
      );
    }
    say("");
    say(`linked=${linked}/${variants.length} available=${available}`);

    const providers = await prisma.provider.findMany({
      select: { code: true, status: true, lastSyncStatus: true, lastSyncAt: true },
    });
    say("");
    say("=== PROVIDERS ===");
    for (const p of providers) {
      say(`${p.code} status=${p.status} lastSyncStatus=${p.lastSyncStatus} at=${p.lastSyncAt?.toISOString?.()}`);
    }

    const ppCount = await prisma.providerProduct.count();
    const ppAvail = await prisma.providerProduct.count({ where: { isAvailable: true } });
    say("");
    say(`providerProduct rows=${ppCount} available=${ppAvail}`);

    say("");
    say("DONE");
    await prisma.$disconnect();
  }, 120_000);
});
