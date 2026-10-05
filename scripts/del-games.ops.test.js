// Remove Free Fire Max (Global) and Magic Chess Go Go (Global).
//
// WHY they are simply deleted rather than merged: they are SEPARATE GAMES on
// the provider, with their own brand_id and their own SKU families — not
// products sitting under Free Fire / Mobile Legends. But they duplicate games
// we already sell (Free Fire Max is the same title as Free Fire; Magic Chess
// Go Go is an MLBB spin-off that shares the MLBB customer), and carrying both
// means two cards for one buyer's intent. Their provider links go with them.
//
// Deleting the Game row cascades: products → variants → provider links.
import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { prisma } from "../src/lib/db.js";

const DROP = ["free-fire-max", "magic-chess-go-go"];

describe("remove duplicate games", () => {
  it("deletes the games and their catalogue subtree", async () => {
    const before = await prisma.game.findMany({
      where: { slug: { in: DROP } },
      select: {
        id: true, slug: true, name: true,
        products: { select: { id: true, name: true, _count: { select: { variants: true } } } },
      },
    });

    const report = { dropped: [], surviving: { games: 0, variants: 0 } };
    for (const g of before) {
      // The schema does not cascade Game → Product, so delete the subtree
      // bottom-up. Provider links first: they point at the variants we are
      // about to remove, and a leftover link would leave the variant
      // referenced by an order item's provider snapshot.
      const variantIds = await prisma.productVariant.findMany({
        where: { product: { gameId: g.id } },
        select: { id: true },
      });
      const vids = variantIds.map((v) => v.id);

      if (vids.length) {
        await prisma.providerProduct.deleteMany({ where: { productVariantId: { in: vids } } });
        await prisma.productVariant.deleteMany({ where: { id: { in: vids } } });
      }
      await prisma.product.deleteMany({ where: { gameId: g.id } });
      await prisma.game.delete({ where: { id: g.id } });

      report.dropped.push({
        slug: g.slug,
        name: g.name,
        products: g.products.length,
        variants: g.products.reduce((a, p) => a + p._count.variants, 0),
      });
    }

    const after = await prisma.game.aggregate({ _count: { _all: true } });
    report.surviving.games = after._count._all;
    const variants = await prisma.productVariant.aggregate({ _count: { _all: true } });
    report.surviving.variants = variants._count._all;

    // Confirm they are gone.
    const stillThere = await prisma.game.findMany({ where: { slug: { in: DROP } }, select: { slug: true } });
    expect(stillThere.length).toBe(0);

    writeFileSync("/tmp/del-games.json", JSON.stringify(report, null, 2));
  });
});
