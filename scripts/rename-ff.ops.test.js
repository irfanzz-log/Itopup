// Rename product slug FF "diamonds" -> "diamond" supaya sama dengan PRODUCT_SEED
// (satu produk tunggal sekarang, tidak ada lagi pemisahan jamak).
import { describe, it } from "vitest";
import { writeFileSync } from "node:fs";
import { prisma } from "../src/lib/db.js";

describe("rename ff product", () => {
  it("renames diamonds -> diamond", async () => {
    const game = await prisma.game.findFirst({ where: { slug: "free-fire" } });
    const p = await prisma.product.findFirst({ where: { gameId: game.id, slug: "diamonds" } });
    if (!p) { writeFileSync("/tmp/rename-ff.json", JSON.stringify({ skipped: "no diamonds product" })); return; }
    await prisma.product.update({ where: { id: p.id }, data: { slug: "diamond", name: "Diamond" } });
    writeFileSync("/tmp/rename-ff.json", JSON.stringify({ renamed: true }));
  });
});
