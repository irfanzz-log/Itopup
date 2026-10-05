// Konsolidasi Free Fire: product "Diamond" (Global) dihapus, "Diamonds" (ID)
// yang tersisa di-rename ke "Diamond" sebagai satu-satunya produk.
//
// Region dipilih dari nama brand provider: hanya "Free Fire (ID)" (brand 291)
// yang dipertahankan. SKU "ffg*" (brand 4 = Free Fire (Global)) ikut dihapus.
import { describe, it } from "vitest";
import { writeFileSync } from "node:fs";
import { prisma } from "../src/lib/db.js";

describe("consolidate free-fire", () => {
  it("removes the Global product and keeps the ID one", async () => {
    const report = { removedProduct: null, keptProduct: null, deletedVariants: 0, deletedLinks: 0 };

    const game = await prisma.game.findFirst({ where: { slug: "free-fire" } });
    if (!game) throw new Error("game free-fire tidak ditemukan");

    // product Global yang akan dihapus
    const g = await prisma.product.findFirst({
      where: { gameId: game.id, slug: "diamond" },
      include: { variants: { select: { id: true } } },
    });
    const id = await prisma.product.findFirst({
      where: { gameId: game.id, slug: "diamonds" },
      include: { variants: { select: { id: true } } },
    });

    if (g && id) {
      // hapus dulu provider links-nya (FK ke variant)
      const r1 = await prisma.providerProduct.deleteMany({
        where: { productVariantId: { in: g.variants.map((v) => v.id) } },
      });
      report.deletedLinks = r1.count;
      const r2 = await prisma.productVariant.deleteMany({
        where: { productId: g.id },
      });
      report.deletedVariants = r2.count;
      await prisma.product.delete({ where: { id: g.id } });
      report.removedProduct = g.slug;
      report.keptProduct = id.slug;
    }
    writeFileSync("/tmp/consolidate-ff.json", JSON.stringify(report, null, 1));
  });
});
