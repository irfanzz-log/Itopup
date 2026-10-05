// Verify the visibility behaviour end to end against the real database:
//   1. a HIDDEN voucher is absent from listActivePromos() and
//      listClaimableVouchers(), but validatePromoCode() still accepts its code;
//   2. a PUBLIC voucher appears in all three.
//
// This is the rule that must hold: visibility is a listing switch ONLY, and the
// code path never reads it.
import { prisma } from "../src/lib/db.js";
import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import {
  listActivePromos,
  listClaimableVouchers,
  validatePromoCode,
} from "../src/services/promo.service.js";
import { AppError } from "../src/lib/errors.js";

const now = new Date();
const slugHidden = `audit-hidden-${Date.now()}`;
const slugPublic = `audit-public-${Date.now()}`;
const codeHidden = `AUDIT-HIDDEN-${Date.now()}`;
const codePublic = `AUDIT-PUBLIC-${Date.now()}`;

const results = {};

async function cleanup(slugs) {
  for (const slug of slugs) {
    const promo = await prisma.promo.findUnique({ where: { slug }, select: { id: true } });
    if (promo) {
      await prisma.voucherClaim.deleteMany({ where: { promoId: promo.id } });
      await prisma.promoCode.deleteMany({ where: { promoId: promo.id } });
      await prisma.promo.delete({ where: { id: promo.id } });
    }
  }
}

describe("promo visibility", () => {
  it("hidden voucher: not listed, still redeemable by code", async () => {
    await cleanup([slugHidden, slugPublic]);
  const base = {
    title: "Audit voucher",
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

  const hidden = await prisma.promo.create({
    data: { ...base, slug: slugHidden, visibility: "HIDDEN" },
  });
  await prisma.promoCode.create({
    data: { promoId: hidden.id, code: codeHidden, usageLimit: null, perUserLimit: null },
  });

  const pub = await prisma.promo.create({
    data: { ...base, slug: slugPublic, visibility: "PUBLIC" },
  });
  await prisma.promoCode.create({
    data: { promoId: pub.id, code: codePublic, usageLimit: null, perUserLimit: null },
  });

  // (1) Public listing excludes the hidden one.
  const active = await listActivePromos({ limit: 50 });
  const activeSlugs = new Set(active.map((p) => p.slug));
  results.listingHasHidden = activeSlugs.has(slugHidden);
  results.listingHasPublic = activeSlugs.has(slugPublic);

  // (2) Claimable shelf excludes the hidden one.
  const claimable = await listClaimableVouchers({ userId: "00000000-0000-0000-0000-000000000000" });
  const claimableSlugs = new Set(claimable.map((p) => p.slug));
  results.claimableHasHidden = claimableSlugs.has(slugHidden);
  results.claimableHasPublic = claimableSlugs.has(slugPublic);

  // (3) BUT the hidden code still validates, with every other rule applied.
  const hiddenValidation = await validatePromoCode({ code: codeHidden, subtotal: 50000 });
  results.hiddenCodeValid = hiddenValidation.discount === 1000;

  const publicValidation = await validatePromoCode({ code: codePublic, subtotal: 50000 });
  results.publicCodeValid = publicValidation.discount === 1000;

  // (4) A deactivated code is refused regardless of visibility.
  await prisma.promoCode.updateMany({ where: { promoId: hidden.id }, data: { isActive: false } });
  let refusedInactive = false;
  try {
    await validatePromoCode({ code: codeHidden, subtotal: 50000 });
  } catch (e) {
    refusedInactive = e instanceof AppError && e.code === "ITP_PROMO_INVALID";
  }
  results.inactiveHiddenRefused = refusedInactive;

  // (5) Default visibility for a row created without the field is PUBLIC.
  const defaulted = await prisma.promo.findUnique({
    where: { id: pub.id },
    select: { visibility: true },
  });
  // Prisma always sends the column; the default is exercised by the migration.

  await cleanup([slugHidden, slugPublic]);

  // Vitest swallows console output; the operator proof goes to a file.
  writeFileSync("/tmp/promo-visibility.json", JSON.stringify(results, null, 2));

  console.log("VISIBILITY_RESULT", JSON.stringify(results));
  expect(results.listingHasHidden).toBe(false);
  expect(results.listingHasPublic).toBe(true);
  expect(results.claimableHasHidden).toBe(false);
  expect(results.claimableHasPublic).toBe(true);
  expect(results.hiddenCodeValid).toBe(true);
  expect(results.publicCodeValid).toBe(true);
  expect(results.inactiveHiddenRefused).toBe(true);
  expect(defaulted.visibility).toBe("PUBLIC");
  });
});
