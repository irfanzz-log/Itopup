// Konsolidasi PUBG Mobile: hapus kedua product Global ("UC" + "Unknown Cash"),
// buat ulang satu product "UC" berisi denominasi region INDONESIA (pubgmid*).
//
// Region dipilih dari brand provider: hanya "PUBG Mobile (ID)" (brand 3081)
// yang dipakai. Global (brand 302, pubgmgl*) dibuang.
import { describe, it } from "vitest";
import { writeFileSync } from "node:fs";
import { prisma } from "../src/lib/db.js";

describe("consolidate pubg-mobile", () => {
  it("rebuilds the UC product with Indonesia SKUs", async () => {
    const report = { removed: [], createdVariants: 0, createdLinks: 0, links: 0 };

    const game = await prisma.game.findFirst({ where: { slug: "pubg-mobile" } });
    if (!game) throw new Error("game pubg-mobile tidak ditemukan");

    const provider = await prisma.provider.findFirst({ where: { code: "melostore" } });
    if (!provider) throw new Error("provider melostore belum terdaftar");

    // hapus kedua product Global
    for (const slug of ["uc", "unknown-cash"]) {
      const p = await prisma.product.findFirst({
        where: { gameId: game.id, slug },
        include: { variants: { select: { id: true } } },
      });
      if (!p) continue;
      await prisma.providerProduct.deleteMany({
        where: { productVariantId: { in: p.variants.map((v) => v.id) } },
      });
      await prisma.productVariant.deleteMany({ where: { productId: p.id } });
      await prisma.product.delete({ where: { id: p.id } });
      report.removed.push(slug);
    }

    // harga termurah per denom untuk SKU Indonesia (dipilih saat probe)
    const best = require_id_best();
    const product = await prisma.product.create({
      data: { gameId: game.id, name: "UC", slug: "uc", sortOrder: 1, sortMode: "NOMINAL" },
    });

    for (const [variantSlug, entry] of Object.entries(best)) {
      const denom = Number(variantSlug.replace(/^d/, ""));
      const markup = Math.round(entry.price * 0.12);
      const v = await prisma.productVariant.create({
        data: {
          productId: product.id,
          name: `${denom.toLocaleString("id-ID")} UC`,
          slug: variantSlug,
          denomination: denom,
          unit: "UC",
          costPrice: entry.price,
          sellingPrice: entry.price + markup,
          isActive: true,
          sortOrder: denom,
        },
      });
      report.createdVariants++;
      await prisma.providerProduct.create({
        data: {
          providerId: provider.id,
          productVariantId: v.id,
          providerCode: entry.sku,
          providerName: `${denom} UC`,
          providerPrice: entry.price,
          isAvailable: true,
        },
      });
      report.createdLinks++;
    }
    report.links = report.createdLinks;
    writeFileSync("/tmp/consolidate-pubg.json", JSON.stringify(report, null, 1));
  });
});

function require_id_best() {
  // Dibangun inline oleh skrip probe (denom -> {sku, price}) untuk SKU Indonesia.
  return JSON.parse(readFileSync_id());
}
function readFileSync_id() {
  const { readFileSync } = require("node:fs");
  return readFileSync("/tmp/pubg-id-best.json", "utf8");
}
