// Verify deletePromo's guards against the real database.
//
// The rule: a promo that has never touched a customer is deletable; one that
// has is refused with a reason, and the caller should deactivate it instead.
// The check happens server-side at delete time — no client-supplied flag can
// skip it.
import { writeFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { prisma } from "../src/lib/db.js";
import { AppError } from "../src/lib/errors.js";
import { deletePromo, deactivatePromo } from "../src/services/promo.service.js";

const now = new Date();
const slugBase = `audit-del-${Date.now()}`;
// A real row: audit_logs has an FK on actorId, so a made-up uuid is rejected.
let ACTOR = { id: null, role: "DEV" };

const results = {};

const base = {
  title: "Audit delete",
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
  visibility: "PUBLIC",
};

async function makePromo(slug, extra = {}) {
  const promo = await prisma.promo.create({ data: { ...base, slug, ...extra } });
  await prisma.promoCode.create({
    data: { promoId: promo.id, code: slug, usageLimit: null, perUserLimit: null },
  });
  return promo;
}

async function tryDelete(promoId) {
  try {
    await deletePromo({ actor: ACTOR, promoId });
    return { deleted: true, error: null };
  } catch (e) {
    return { deleted: false, error: e instanceof AppError ? e.code : e.message };
  }
}

async function cleanup(slug) {
  const promo = await prisma.promo.findUnique({ where: { slug }, select: { id: true } });
  if (promo) {
    await prisma.voucherClaim.deleteMany({ where: { promoId: promo.id } });
    await prisma.promoCode.deleteMany({ where: { promoId: promo.id } });
    await prisma.promo.deleteMany({ where: { id: promo.id } });
  }
}

describe("promo delete guards", () => {
  it("deletes an unused promo, refuses a used one", async () => {
    const realUser = await prisma.user.findFirst({
      where: { role: { in: ["DEV", "SUPERADMIN"] } },
      select: { id: true, role: true },
    });
    ACTOR = realUser ?? { id: null, role: "DEV" };
    if (!ACTOR.id) {
      // No staff row in this database — nothing meaningful to assert about
      // permissioned actions, so the whole case is skipped instead of faked.
      writeFileSync("/tmp/promo-delete.json", JSON.stringify({ skipped: "no staff user" }, null, 2));
      return;
    }
    // (1) Never used: deletes.
    const fresh = await makePromo(`${slugBase}-fresh`);
    const freshResult = await tryDelete(fresh.id);
    results.freshDeleted = freshResult.deleted;
    const freshStillThere = await prisma.promo.findUnique({ where: { id: fresh.id } });
    results.freshRowGone = freshStillThere === null;
    // The codes should cascade away with the promo.
    const freshCodes = await prisma.promoCode.count({ where: { promoId: fresh.id } });
    results.freshCodesGone = freshCodes === 0;

    // (2) Has an ACTIVE claim: refused.
    const claimed = await makePromo(`${slugBase}-claimed`);
    const user = await prisma.user.findFirst({ select: { id: true } });
    if (user) {
      await prisma.voucherClaim.create({
        data: { userId: user.id, promoId: claimed.id, status: "ACTIVE" },
      });
    }
    const claimedResult = await tryDelete(claimed.id);
    results.claimedDeleted = claimedResult.deleted;
    results.claimedError = claimedResult.error;
    const claimedRow = await prisma.promo.findUnique({ where: { id: claimed.id } });
    results.claimedRowSurvives = claimedRow !== null;

    // (3) Code has been used: refused.
    const usedCode = await makePromo(`${slugBase}-usedcode`);
    await prisma.promoCode.updateMany({
      where: { promoId: usedCode.id },
      data: { usageCount: 1 },
    });
    const usedResult = await tryDelete(usedCode.id);
    results.usedCodeDeleted = usedResult.deleted;
    results.usedCodeError = usedResult.error;

    // (4) Referenced by an order's ORDER_CREATED log: refused.
    const logged = await makePromo(`${slugBase}-logged`);
    const order = await prisma.order.findFirst({ select: { id: true } });
    if (order) {
      await prisma.transactionLog.create({
        data: {
          orderId: order.id,
          event: "ORDER_CREATED",
          message: "test",
          metadata: { voucherPromoSlug: logged.slug },
        },
      });
    }
    const loggedResult = await tryDelete(logged.id);
    results.loggedDeleted = loggedResult.deleted;
    results.loggedError = loggedResult.error;

    // (5) Deactivate is still available for a used promo.
    const deactivated = await deactivatePromo({
      actor: ACTOR,
      promoId: claimed.id,
      request: {},
    });
    results.deactivatedOk = deactivated.isActive === false;

    // (6) Audit trail records the hard delete.
    const auditRows = await prisma.auditLog.count({
      where: { targetType: "Promo", targetId: fresh.id, action: "PROMO_HARD_DELETED" },
    });
    results.auditWrittenBeforeDelete = auditRows === 1;

    await cleanup(`${slugBase}-fresh`);
    await cleanup(`${slugBase}-claimed`);
    await cleanup(`${slugBase}-usedcode`);
    await cleanup(`${slugBase}-logged`);

    writeFileSync("/tmp/promo-delete.json", JSON.stringify(results, null, 2));

    expect(results.freshDeleted).toBe(true);
    expect(results.freshRowGone).toBe(true);
    expect(results.freshCodesGone).toBe(true);
    expect(results.claimedDeleted).toBe(false);
    expect(results.claimedError).toBe("ITP_CONFLICT");
    expect(results.claimedRowSurvives).toBe(true);
    expect(results.usedCodeDeleted).toBe(false);
    expect(results.usedCodeError).toBe("ITP_CONFLICT");
    expect(results.loggedDeleted).toBe(false);
    expect(results.loggedError).toBe("ITP_CONFLICT");
    expect(results.deactivatedOk).toBe(true);
    expect(results.auditWrittenBeforeDelete).toBe(true);
  });
});
