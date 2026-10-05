// ============================================================================
// Konsolidasi CODM: tiga baris game (codm, call-of-duty-mobile,
// call-of-duty-mobile-indonesia) menjadi satu game "codm" dengan dua Product,
// "cp-global" (brand "Call Of Duty Mobile") dan "cp-id" (brand Indonesia).
//
// Kedua DB target tidak punya order_items pada variant CODM (diverifikasi),
// jaka variant lama aman dihapus. Menghapus dipilih daripada menonaktifkan:
// dua baris "CP" aktif adalah duplicate-content nyata di pencarian dan sitemap.
//
// HARGA: sellingPrice dihitung ulang dari costPrice lewat sellingPriceFromCost
// dengan kind PULSA hanya untuk game pulsa; game memakai multiplier 4%.
//
// Jalankan: npx vitest run --config vitest.sync.config.js scripts/consolidate-codm.ops.test.js
// ============================================================================
import { describe, it } from "vitest";
import { writeFileSync } from "node:fs";
import { prisma } from "../src/lib/db.js";
import { sellingPriceFromCost } from "../src/config/pricing.js";

const REGIONS = {
  "cp-global": [
    [31, 4302, "codm31c-s12"],
    [63, 8455, "codm63c-s12a"],
    [128, 17123, "codm128c-s12"],
    [321, 43772, "codm321c-s12"],
    [384, 56097, "codm384c-s121"],
    [645, 85087, "codm645c-s12"],
    [800, 102099, "codm800c-s12a"],
    [965, 140285, "codm965c-s121"],
    [1373, 169157, "codm1373c-s12"],
    [1584, 200794, "codm1584c-s12"],
    [2059, 260957, "codm2059c-s12"],
    [2750, 320905, "codm2750c-s12a"],
    [3564, 422235, "codm3564c-s12b"],
    [5618, 616449, "codm5618c-s12"],
    [7656, 844442, "codm7656c-s12"],
    [11190, 1392768, "codm11190c-s121"],
    [15312, 1688939, "codm15312c-s12b"],
    [38280, 4309164, "codm38280c-s12"],
    [76560, 8618327, "codm76560c-s12"],
  ],
  "cp-id": [
    [31, 4434, "cgiid31ca-s71"],
    [63, 9606, "cgiid63c-s7"],
    [128, 19361, "cgiid128c-s7"],
    [321, 48495, "cgiid321c-s7"],
    [645, 96427, "cgiid645c-s7"],
    [800, 107639, "cgiid800c-s7"],
    [1373, 191545, "cgiid1373c-s7"],
    [2060, 287411, "cgiid2060c-s7"],
    [2750, 338564, "cgiid2750c-s7"],
    [3564, 478256, "cgiid3564c-s7"],
    [5618, 648001, "cgiid5618ca-s71"],
    [7656, 956325, "cgiid7656c-s7"],
    [15312, 1775368, "cgiid15312c-s7"],
    [38280, 4438602, "cgiid38280c-s7"],
    [76560, 8877203, "cgiid76560ca-s71"],
  ],
};

describe("consolidate codm", () => {
  it("merges the three CODM games into one game with two region products", async () => {
    const report = {
      deactivatedGames: [],
      deletedProviderLinks: 0,
      deletedVariants: 0,
      deletedProducts: 0,
      createdProducts: [],
      createdVariants: 0,
      repricedVariants: 0,
      errors: [],
    };

    const keep = await prisma.game.findUnique({ where: { slug: "codm" } });
    if (!keep) throw new Error('game "codm" tidak ditemukan');

    // ── 1. Hapus game duplikat beserta product/variant/link-nya ──────────────
    // call-of-duty-mobile dan call-of-duty-mobile-indonesia. Kedua DB telah
    // diverifikasi memiliki 0 order_items pada variant CODM, jadi hard delete
    // tidak akan meninggalkan transaksi yatim.
    for (const slug of ["call-of-duty-mobile", "call-of-duty-mobile-indonesia"]) {
      const game = await prisma.game.findUnique({
        where: { slug },
        include: {
          products: {
            select: { id: true, _count: { select: { variants: true } } },
          },
        },
      });
      if (!game) continue;

      const variantIds = (
        await prisma.productVariant.findMany({
          where: { productId: { in: game.products.map((p) => p.id) } },
          select: { id: true },
        })
      ).map((v) => v.id);

      if (variantIds.length > 0) {
        // Pastikan tidak ada transaksi yang menunjuk variant ini sebelum hapus.
        const used = await prisma.orderItem.count({
          where: { productVariantId: { in: variantIds } },
        });
        if (used > 0) {
          report.errors.push(
            `${slug}: ${used} order items menunjuk variantnya, dilewati (tidak dihapus)`
          );
          await prisma.game.update({ where: { id: game.id }, data: { isActive: false } });
          report.deactivatedGames.push(slug);
          continue;
        }
        report.deletedProviderLinks += (
          await prisma.providerProduct.deleteMany({
            where: { productVariantId: { in: variantIds } },
          })
        ).count;
        report.deletedVariants += (
          await prisma.productVariant.deleteMany({
            where: { id: { in: variantIds } },
          })
        ).count;
      }
      report.deletedProducts += (
        await prisma.product.deleteMany({
          where: { id: { in: game.products.map((p) => p.id) } },
        })
      ).count;
      await prisma.game.delete({ where: { id: game.id } });
      report.deactivatedGames.push(`${slug} (deleted)`);
    }

    // ── 2. Hapus product "cp" lama beserta link-nya di game codm ─────────────
    const oldProduct = await prisma.product.findFirst({
      where: { gameId: keep.id, slug: "cp" },
      include: { variants: { select: { id: true } } },
    });
    if (oldProduct) {
      const oldVariantIds = oldProduct.variants.map((v) => v.id);
      const used = await prisma.orderItem.count({
        where: { productVariantId: { in: oldVariantIds } },
      });
      if (used > 0) {
        report.errors.push(
          `codm/cp: ${used} order items menunjuk variantnya, product lama hanya dinonaktifkan`
        );
        await prisma.product.update({ where: { id: oldProduct.id }, data: { isActive: false } });
      } else {
        report.deletedProviderLinks += (
          await prisma.providerProduct.deleteMany({
            where: { productVariantId: { in: oldVariantIds } },
          })
        ).count;
        report.deletedVariants += (
          await prisma.productVariant.deleteMany({ where: { productId: oldProduct.id } })
        ).count;
        await prisma.product.delete({ where: { id: oldProduct.id } });
        report.deletedProducts += 1;
      }
    }

    // ── 3. Buat dua product region + variant-nya ─────────────────────────────
    for (const [productSlug, rows] of Object.entries(REGIONS)) {
      const product = await prisma.product.upsert({
        where: { gameId_slug: { gameId: keep.id, slug: productSlug } },
        update: { name: productSlug === "cp-id" ? "CP (Indonesia)" : "CP (Global)", isActive: true },
        create: {
          gameId: keep.id,
          slug: productSlug,
          name: productSlug === "cp-id" ? "CP (Indonesia)" : "CP (Global)",
          sortMode: "NOMINAL",
          sortOrder: productSlug === "cp-global" ? 1 : 2,
        },
        select: { id: true },
      });
      report.createdProducts.push(productSlug);

      for (const [index, [denomination, costPrice, providerCode]] of rows.entries()) {
        const slug = `d${denomination}`;
        const sellingPrice = sellingPriceFromCost(costPrice);
        const variant = await prisma.productVariant.upsert({
          where: { productId_slug: { productId: product.id, slug } },
          update: {
            name: `${denomination.toLocaleString("id-ID")} CP`,
            denomination,
            unit: "CP",
            costPrice,
            sellingPrice,
            isActive: true,
            sortOrder: index,
          },
          create: {
            productId: product.id,
            slug,
            name: `${denomination.toLocaleString("id-ID")} CP`,
            denomination,
            unit: "CP",
            costPrice,
            sellingPrice,
            sortOrder: index,
          },
          select: { id: true },
        });
        report.createdVariants += 1;

        // Link provider. ProviderProduct unik per (provider, variant), jadi
        // create-or-update; mapping eksisting (mis. codm31c-s12 yang dulu
        // menunjuk game lain) tidak ada karena game lama sudah dihapus di atas.
        const providerRow = await prisma.provider.findFirst({
          where: { code: "melostore" },
          select: { id: true },
        });
        if (!providerRow) continue;

        const payload = {
          providerId: providerRow.id,
          productVariantId: variant.id,
          providerCode,
          providerName: `${denomination.toLocaleString("id-ID")} CP`,
          providerPrice: costPrice,
          isAvailable: true,
        };
        const existingLink = await prisma.providerProduct.findFirst({
          where: { providerId: providerRow.id, providerCode },
          select: { id: true },
        });
        if (existingLink) {
          await prisma.providerProduct.update({ where: { id: existingLink.id }, data: payload });
        } else {
          await prisma.providerProduct.create({ data: payload });
        }
      }
    }

    // ── 4. Reharga seluruh variant non-pulsa ke markup 4% ────────────────────
    //
    // PULSA dapat spread tetap Rp 1.000, jadi dua product region CODM di atas
    // sudah benar (kategori GAME, markup 4%). Game lain di DB ini masih memakai
    // harga turunan dari markup 8% lama; harga itu SAMA PERSIS dengan apa yang
    // formula lama hasilkan, jadi bukan harga yang dipinned admin, dan harus
    // ikut naik ke 4%.
    //
    // Deteksi pin-nya membandingkan harga yang ada terhadap apa yang dihasilkan
    // OLEH MARKUP LAMA, bukan yang baru; membandingkan terhadap yang baru akan
    // salah menganggap semua harga lama sebagai dipinned dan menolak menulis
    // ulang satu pun.
    const games = await prisma.game.findMany({
      where: { category: { kind: "GAME" } },
      select: {
        id: true,
        products: {
          select: {
            id: true,
            variants: { select: { id: true, costPrice: true, sellingPrice: true } },
          },
        },
      },
    });
    for (const game of games) {
      for (const product of game.products) {
        for (const variant of product.variants) {
          const oldDerived = sellingPriceFromCost(variant.costPrice, {
            multiplier: 1.08,
            flat: 0,
            roundTo: 100,
          });
          const isPinned = Number(variant.sellingPrice) !== oldDerived;
          if (isPinned) continue;

          const derived = sellingPriceFromCost(variant.costPrice);
          if (Number(variant.sellingPrice) === derived) continue;
          await prisma.productVariant.update({
            where: { id: variant.id },
            data: { sellingPrice: derived },
          });
          report.repricedVariants += 1;
        }
      }
    }

    // ── 5. Reharga pulsa ke spread tetap Rp 1.000 ─────────────────────────────
    // Margin lama bervariasi (Rp 500 sampai Rp 8.100) karena turunan dari markup
    // persentase. Harga yang persis sama dengan output 8%-markup dianggap tidak
    // dipinned dan ditimpa ke cost + 1.000.
    const pulsa = await prisma.game.findMany({
      where: { category: { kind: "PULSA" } },
      select: {
        id: true,
        products: {
          select: {
            id: true,
            variants: { select: { id: true, costPrice: true, sellingPrice: true } },
          },
        },
      },
    });
    for (const game of pulsa) {
      for (const product of game.products) {
        for (const variant of product.variants) {
          const oldDerived = sellingPriceFromCost(variant.costPrice, {
            multiplier: 1.08,
            flat: 0,
            roundTo: 100,
          });
          const isPinned = Number(variant.sellingPrice) !== oldDerived;
          if (isPinned) continue;

          const derived = sellingPriceFromCost(variant.costPrice, { kind: "PULSA" });
          if (Number(variant.sellingPrice) === derived) continue;
          await prisma.productVariant.update({
            where: { id: variant.id },
            data: { sellingPrice: derived },
          });
          report.repricedVariants += 1;
        }
      }
    }

    writeFileSync("/tmp/consolidate-codm.json", JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  });
});
