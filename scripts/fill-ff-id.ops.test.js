// Tambah denominasi Free Fire (ID) yang belum ada di DB ke product "diamonds".
// Product "diamond" (Global) sudah dihapus; sekarang "diamonds" adalah satu-
// satunya produk diamond FF dan di-rename ke "Diamond" untuk konsistensi.
import { describe, it } from "vitest";
import { writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { prisma } from "../src/lib/db.js";

describe("fill free-fire ID denominations", () => {
  it("adds the missing Indonesia variants", async () => {
    const report = { added: [], skipped: [], renamed: null };

    const game = await prisma.game.findFirst({ where: { slug: "free-fire" } });
    const provider = await prisma.provider.findFirst({ where: { code: "melostore" } });
    const product = await prisma.product.findFirst({ where: { gameId: game.id, slug: "diamonds" } });
    if (!product) throw new Error('product "diamonds" tidak ditemukan');

    // rename jadi "Diamond" (tunggal) — satu produk sekarang
    await prisma.product.update({
      where: { id: product.id },
      data: { name: "Diamond" },
    });
    report.renamed = "diamonds -> Diamond";

    const existing = await prisma.providerProduct.findMany({
      where: { providerCode: { startsWith: "ffid" } },
      select: { providerCode: true },
    });
    const have = new Set(existing.map((r) => r.providerCode));

    const best = JSON.parse(readFileSync("/tmp/ff-id-best.json", "utf8"));
    for (const [variantSlug, entry] of Object.entries(best)) {
      if (have.has(entry.sku)) { report.skipped.push(entry.sku); continue; }
      const denom = Number(variantSlug.replace(/^d/, ""));
      const v = await prisma.productVariant.create({
        data: {
          productId: product.id,
          name: `${denom.toLocaleString("id-ID")} Diamonds`,
          slug: variantSlug,
          denomination: denom,
          unit: "Diamonds",
          costPrice: entry.price,
          sellingPrice: entry.price + Math.round(entry.price * 0.12),
          isActive: true,
          sortOrder: denom,
        },
      });
      await prisma.providerProduct.create({
        data: {
          providerId: provider.id,
          productVariantId: v.id,
          providerCode: entry.sku,
          providerName: `${denom} Diamonds`,
          providerPrice: entry.price,
          isAvailable: true,
        },
      });
      report.added.push(entry.sku);
    }
    writeFileSync("/tmp/fill-ff.json", JSON.stringify(report, null, 1));
  });
});
