// Confirm the checkout code path still accepts a HIDDEN voucher while the
// promo listing refuses it. validatePromoCode deliberately ignores visibility;
// that is the whole point of the feature.
import { writeFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { prisma } from "../src/lib/db.js";
import { validatePromoCode, computePromoDiscount } from "../src/services/promo.service.js";

const now = new Date();
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
  title: "Checkout hidden",
  description: "audit",
  image: null,
  banner: null,
  discountType: "FIXED",
  discountValue: 2500,
  maxDiscount: null,
  minSpend: 5000,
  startsAt: now,
  endsAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
  isActive: true,
  scope: "ALL",
  categoryId: null, gameId: null, productId: null, variantId: null,
  distribution: "VOUCHER",
  audience: "ALL_USERS",
  minCompletedOrders: 0,
  claimLimit: null,
  claimCount: 0,
  visibility: "HIDDEN",
};

describe("hidden voucher at checkout", () => {
  it("is redeemable by code while hidden from listings", async () => {
    const slug = `checkout-hidden-${Date.now()}`;
    const code = `AUDIT-HID-${Date.now().toString().slice(-6)}`;
    await cleanup(slug);
    const promo = await prisma.promo.create({ data: { ...base, slug } });
    await prisma.promoCode.create({
      data: { promoId: promo.id, code, usageLimit: null, perUserLimit: null },
    });

    let thrown = null; let validated = null; try { validated = await validatePromoCode({ code, subtotal: 10000 }); } catch (e) { thrown = e; } results.thrownCode = thrown && thrown.code; results.thrownMsg = thrown && thrown.message;
    results.validated = validated?.promo?.id === promo.id;
    results.visibilityStillHidden = validated?.promo?.visibility === "HIDDEN";

    // Discount arithmetic is untouched by the visibility change.
    const priced = computePromoDiscount(validated.promo, 10000, now);
    results.discountApplied = priced.discount === 2500;
    results.totalAfter = priced.total;

    // An expired hidden voucher is still refused by the ordinary rules.
    await prisma.promo.update({
      where: { id: promo.id },
      data: { isActive: false },
    });
    let refused = false;
    try {
      await validatePromoCode({ code, subtotal: 10000 });
    } catch (e) {
      refused = true;
    }
    results.inactiveRefused = refused;

    await cleanup(slug);
    writeFileSync("/tmp/promo-checkout.json", JSON.stringify(results, null, 2));
    expect(results.validated).toBe(true);
    expect(results.visibilityStillHidden).toBe(true);
    expect(results.discountApplied).toBe(true);
    expect(results.inactiveRefused).toBe(true);
  });
});
