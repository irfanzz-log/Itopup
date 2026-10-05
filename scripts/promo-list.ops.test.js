// Verify the admin listing filters + pagination against the real database.
//
// listPromosForAdmin now accepts visibility and a derived status. Both must be
// ignored when invalid (an unknown value must never build a broken WHERE) and
// both must narrow the result set when valid.
import { writeFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { prisma } from "../src/lib/db.js";
import { listPromosForAdmin } from "../src/services/promo.service.js";

const now = new Date();
const slugBase = `audit-list-${Date.now()}`;
const results = {};

async function cleanup(slug) {
  const promo = await prisma.promo.findUnique({ where: { slug }, select: { id: true } });
  if (promo) {
    await prisma.voucherClaim.deleteMany({ where: { promoId: promo.id } });
    await prisma.promoCode.deleteMany({ where: { promoId: promo.id } });
    await prisma.promo.deleteMany({ where: { id: promo.id } });
  }
}

const base = {
  title: "Audit list",
  description: null,
  image: null,
  banner: null,
  discountType: "FIXED",
  discountValue: 1000,
  maxDiscount: null,
  minSpend: 0,
  startsAt: now,
  endsAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
  isActive: true,
  scope: "ALL",
  categoryId: null,
  gameId: null,
  productId: null,
  variantId: null,
  distribution: "VOUCHER",
  audience: "ALL_USERS",
  minCompletedOrders: 0,
  claimLimit: null,
  claimCount: 0,
};

describe("admin promo listing", () => {
  it("filters by visibility and status, ignores junk values, paginates", async () => {
    await cleanup(`${slugBase}-h1`);
    await cleanup(`${slugBase}-h2`);
    await cleanup(`${slugBase}-p1`);
    await cleanup(`${slugBase}-p2`);

    const mk = (slug, extra) =>
      prisma.promo.create({ data: { ...base, slug, ...extra } });

    const h1 = await mk(`${slugBase}-h1`, { visibility: "HIDDEN" });
    const h2 = await mk(`${slugBase}-h2`, {
      visibility: "HIDDEN",
      isActive: false,
      // ended already
      startsAt: new Date(now.getTime() - 48 * 3600 * 1000),
      endsAt: new Date(now.getTime() - 24 * 3600 * 1000),
    });
    const p1 = await mk(`${slugBase}-p1`, { visibility: "PUBLIC" });
    const p2 = await mk(`${slugBase}-p2`, {
      visibility: "PUBLIC",
      startsAt: new Date(now.getTime() + 24 * 3600 * 1000),
    });

    // (1) visibility=HIDDEN returns only hidden promos.
    const hidden = await listPromosForAdmin({ visibility: "HIDDEN", limit: 50 });
    results.hiddenOnly = hidden.items.every((p) => p.visibility === "HIDDEN");
    results.hiddenIncludesBothStates = hidden.items.some((p) => p.id === h1.id) &&
      hidden.items.some((p) => p.id === h2.id);

    // (2) status=expired finds the ended one.
    const expired = await listPromosForAdmin({ status: "expired", limit: 50 });
    results.expiredOnly = expired.items.every((p) => p.isActive && p.endsAt < now);

    // (3) status=scheduled finds the future one.
    const scheduled = await listPromosForAdmin({ status: "scheduled", limit: 50 });
    results.scheduledOnly = scheduled.items.every((p) => p.isActive && p.startsAt > now);
    results.scheduledIncludesP2 = scheduled.items.some((p) => p.id === p2.id);

    // (4) status=inactive finds the deactivated one.
    const inactive = await listPromosForAdmin({ status: "inactive", limit: 50 });
    results.inactiveOnly = inactive.items.every((p) => !p.isActive);
    results.inactiveIncludesH2 = inactive.items.some((p) => p.id === h2.id);

    // (5) Junk values are ignored, not treated as a filter.
    const junk = await listPromosForAdmin({ visibility: "SECRET", status: "bogus", limit: 50 });
    results.junkReturnsAll = junk.items.length >= 4;
    results.junkTotalMatches = junk.pagination.total >= 4;

    // (6) Combined search narrows by title.
    const searched = await listPromosForAdmin({ search: slugBase, limit: 50 });
    results.searchNarrows = searched.items.length === 4 && searched.pagination.total === 4;

    // (7) Pagination: page 1 of limit 2 returns 2 rows and the right total.
    const paged = await listPromosForAdmin({ search: slugBase, limit: 2, page: 1 });
    results.pagedLimit = paged.items.length;
    results.pagedTotal = paged.pagination.total;
    results.pagedPages = paged.pagination.pages;
    results.pagedRowsDoNotOverlap = new Set(paged.items.map((p) => p.id)).size === 2;
    const paged2 = await listPromosForAdmin({ search: slugBase, limit: 2, page: 2 });
    results.page2Different = !paged.items.some((p) => paged2.items.some((q) => q.id === p.id));

    // (8) The claim count is available for the delete UI.
    results.claimCountPresent = paged.items.every((p) => p._count && typeof p._count.claims === "number");

    await cleanup(`${slugBase}-h1`);
    await cleanup(`${slugBase}-h2`);
    await cleanup(`${slugBase}-p1`);
    await cleanup(`${slugBase}-p2`);

    writeFileSync("/tmp/promo-list.json", JSON.stringify(results, null, 2));

    expect(results.hiddenOnly).toBe(true);
    expect(results.hiddenIncludesBothStates).toBe(true);
    expect(results.expiredOnly).toBe(true);
    expect(results.scheduledOnly).toBe(true);
    expect(results.scheduledIncludesP2).toBe(true);
    expect(results.inactiveOnly).toBe(true);
    expect(results.inactiveIncludesH2).toBe(true);
    expect(results.junkReturnsAll).toBe(true);
    expect(results.junkTotalMatches).toBe(true);
    expect(results.searchNarrows).toBe(true);
    expect(results.pagedLimit).toBe(2);
    expect(results.pagedTotal).toBe(4);
    expect(results.pagedPages).toBe(2);
    expect(results.pagedRowsDoNotOverlap).toBe(true);
    expect(results.page2Different).toBe(true);
    expect(results.claimCountPresent).toBe(true);
  });
});
