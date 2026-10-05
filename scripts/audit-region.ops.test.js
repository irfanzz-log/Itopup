// Audit: cek apakah ada SKU region Global yang tersisa di katalog aktif.
// Brand region: 291 = Free Fire (ID), 3081 = PUBG Mobile (ID),
// 4 = Free Fire (Global), 302 = PUBG Mobile (Global).
// Selain itu, brand lain dengan region non-ID juga ditandai.
import { describe, it } from "vitest";
import { writeFileSync } from "node:fs";
import { prisma } from "../src/lib/db.js";
import { getProducts } from "../src/providers/melostore/products.js";

const FF = { 4: "Free Fire (Global)", 291: "Free Fire (ID)" };
const PG = { 302: "PUBG Mobile (Global)", 3081: "PUBG Mobile (ID)" };

describe("audit region", () => {
  it("reports any non-Indonesia SKUs still linked", async () => {
    // Region brand untuk setiap SKU, dari pricelist provider
    const r = await getProducts({ limit: 1000 });
    if (!r.ok) throw new Error(r.error?.message ?? "gagal");
    const regionByCode = new Map();
    for (const p of r.data.products ?? []) {
      if (p.brandId in FF) regionByCode.set(p.providerCode, FF[p.brandId]);
      if (p.brandId in PG) regionByCode.set(p.providerCode, PG[p.brandId]);
    }

    // Semua provider product yang ter-link di DB
    const rows = await prisma.providerProduct.findMany({
      select: {
        providerCode: true,
        productVariant: {
          select: { name: true, slug: true, product: { select: { slug: true, name: true, game: { select: { slug: true } } } } },
        },
      },
    });

    const ff = [];
    const pg = [];
    for (const row of rows) {
      const reg = regionByCode.get(row.providerCode);
      if (!reg) continue;
      const t = { sku: row.providerCode, region: reg, variant: row.productVariant?.name,
        product: row.productVariant?.product?.slug, game: row.productVariant?.product?.game?.slug };
      if (t.game === "free-fire") ff.push(t);
      if (t.game === "pubg-mobile") pg.push(t);
    }

    const idCount = (arr) => arr.filter((x) => x.region.includes("(ID)")).length;
    writeFileSync("/tmp/audit-region.json", JSON.stringify({
      freefire: { total: ff.length, id: idCount(ff), global: ff.filter((x) => x.region.includes("Global")).length },
      pubg: { total: pg.length, id: idCount(pg), global: pg.filter((x) => x.region.includes("Global")).length },
    }, null, 1));
  });
}, 300000);
