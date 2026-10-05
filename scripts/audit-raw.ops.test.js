// Cross-check mentah: brand_id asli untuk setiap SKU FF/PUBG yang ter-link di DB.
// Tidak ada normalisasi di tengah: pricelist -> brand_id -> region.
import { describe, it } from "vitest";
import { writeFileSync } from "node:fs";
import { prisma } from "../src/lib/db.js";
import { call } from "../src/providers/melostore/client.js";

const RAW = { 4: "Free Fire (Global)", 291: "Free Fire (ID)", 302: "PUBG Mobile (Global)", 3081: "PUBG Mobile (ID)" };

describe("raw brand audit", () => {
  it("reads raw brand_id per linked SKU", async () => {
    const linked = await prisma.providerProduct.findMany({
      where: { OR: [
        { providerCode: { startsWith: "ffid" } }, { providerCode: { startsWith: "ffg" } },
        { providerCode: { startsWith: "pubgmid" } }, { providerCode: { startsWith: "pubgmgl" } },
      ] },
      select: { providerCode: true },
    });
    const want = new Set(linked.map((r) => r.providerCode));
    if (!want.size) { writeFileSync("/tmp/audit-raw.json", JSON.stringify({ none: true })); return; }

    const found = {};
    let cursor = null;
    for (let page = 0; page < 40; page++) {
      const params = new URLSearchParams({ limit: "1000" });
      if (cursor) params.set("cursor", cursor);
      const r = await call({ path: `/api/v1/h2h/pricelists?${params.toString()}`, method: "GET", idempotent: true, operation: "auditraw" });
      if (!r.ok) { writeFileSync("/tmp/audit-raw.json", JSON.stringify({ error: r.error?.message })); return; }
      for (const row of r.data?.data ?? []) {
        if (want.has(row.sku_code)) found[row.sku_code] = { brand_id: row.brand_id, region: RAW[row.brand_id] ?? "BUKAN FF/PUBG" };
      }
      const pg = r.data?.meta?.pagination;
      if (!pg?.has_more || !pg.next_cursor) break;
      cursor = pg.next_cursor;
      await new Promise((s) => setTimeout(s, 3200));
    }
    const regions = {};
    for (const v of Object.values(found)) regions[v.region] = (regions[v.region] ?? 0) + 1;
    writeFileSync("/tmp/audit-raw.json", JSON.stringify({
      linkedInDb: want.size, matchedToPricelist: Object.keys(found).length, regions,
      nonId: Object.entries(found).filter(([, v]) => v.region !== "Free Fire (ID)" && v.region !== "PUBG Mobile (ID)").map(([k]) => k),
    }, null, 1));
  });
}, 600000);
