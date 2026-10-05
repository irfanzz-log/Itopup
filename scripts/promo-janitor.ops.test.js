import { writeFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { prisma } from "../src/lib/db.js";

// The ops tests prefix their scratch rows (audit-*, ui-check-*, checkout-hidden-*)
// so a broken run can be told apart from real promos. This sweeps them up,
// including rows left behind by a run that threw before its own cleanup.
describe("janitor", () => {
  it("removes every scratch promo row", async () => {
    const scratch = await prisma.promo.findMany({
      where: {
        OR: [
          { slug: { startsWith: "audit-del-" } },
          { slug: { startsWith: "audit-list-" } },
          { slug: { startsWith: "ui-check-" } },
          { slug: { startsWith: "checkout-hidden-" } },
          { slug: { startsWith: "audit-seed-" } },
        ],
      },
      select: { id: true, slug: true },
    });

    for (const p of scratch) {
      await prisma.voucherClaim.deleteMany({ where: { promoId: p.id } });
      await prisma.promoCode.deleteMany({ where: { promoId: p.id } });
    }
    const deleted = await prisma.promo.deleteMany({
      where: { id: { in: scratch.map((p) => p.id) } },
    });

    const leftover = await prisma.promo.count({
      where: {
        OR: [
          { slug: { startsWith: "audit-" } },
          { slug: { startsWith: "ui-check-" } },
          { slug: { startsWith: "checkout-hidden-" } },
        ],
      },
    });

    const rows = await prisma.promo.findMany({
      orderBy: { createdAt: "desc" },
      take: 15,
      select: { slug: true, title: true, isActive: true },
    });
    writeFileSync("/tmp/promo-janitor.json", JSON.stringify({ removed: deleted.count, leftover, remaining: rows }, null, 2));
    expect(leftover).toBe(0);
  });
});
