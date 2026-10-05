// ============================================================================
// Promo service.
//
// Discount maths and promo validation live here and NOWHERE else. The checkout
// recomputes the discount inside the order transaction; a discount the client
// calculated is never trusted.
//
// Integer arithmetic throughout: a percentage applied to rupiah with floats
// produces a one-rupiah drift between what the customer was shown and what the
// order records.
// ============================================================================
import { prisma } from "../lib/db.js";
import { AppError } from "../lib/errors.js";
import { AUDIT, ORDER_STATUS } from "../lib/constants.js";
import { parse, promoCreateSchema, promoUpdateSchema } from "../lib/validation.js";
import { writeAudit } from "./audit.service.js";

const PUBLIC_PROMO_SELECT = {
  id: true,
  title: true,
  slug: true,
  description: true,
  image: true,
  banner: true,
  discountType: true,
  discountValue: true,
  maxDiscount: true,
  minSpend: true,
  startsAt: true,
  endsAt: true,
  isActive: true,
  scope: true,
  categoryId: true,
  gameId: true,
  productId: true,
  variantId: true,
  distribution: true,
  audience: true,
  minCompletedOrders: true,
  claimLimit: true,
  claimCount: true,
  visibility: true,
};

// ── Public reads ────────────────────────────────────────────────────────────

/** Promos that are live right now: active, started, not yet ended, and PUBLIC.
 *
 * Visibility is filtered HERE, not by the caller and not by the client: a
 * HIDDEN voucher must never reach /promo or any endpoint that lists promos for
 * customers. It remains redeemable by its code (see `validatePromoCode`), which
 * deliberately does NOT read this column.
 */
export async function listActivePromos({ limit = 12 } = {}) {
  const now = new Date();
  return prisma.promo.findMany({
    where: {
      isActive: true,
      startsAt: { lte: now },
      endsAt: { gte: now },
      visibility: "PUBLIC",
    },
    orderBy: [{ endsAt: "asc" }, { createdAt: "desc" }],
    take: Math.min(50, Math.max(1, limit)),
    select: PUBLIC_PROMO_SELECT,
  });
}

export async function getPromoBySlug(slug) {
  const now = new Date();
  return prisma.promo.findFirst({
    where: {
      slug,
      isActive: true,
      startsAt: { lte: now },
      endsAt: { gte: now },
      // A hidden voucher has no public detail page: linking to it would be a
      // listing by another name. Its code path is checkout, not /promo/[slug].
      visibility: "PUBLIC",
    },
    select: { ...PUBLIC_PROMO_SELECT, codes: { where: { isActive: true }, select: { code: true } } },
  });
}

// ── Discount computation ────────────────────────────────────────────────────

/**
 * Compute the discount for a promo against a subtotal.
 *
 * Returns 0 when the promo does not apply (below minSpend, outside its window,
 * inactive) rather than throwing: "this promo gives you nothing" is a valid
 * answer for a UI that shows all promos.
 *
 * @returns {{ discount: number, applies: boolean, reason: string|null }}
 */
export function computePromoDiscount(promo, subtotal, now = new Date()) {
  if (!promo) return { discount: 0, applies: false, reason: "Promo tidak ditemukan." };
  if (!promo.isActive) return { discount: 0, applies: false, reason: "Promo tidak aktif." };
  if (new Date(promo.startsAt) > now) return { discount: 0, applies: false, reason: "Promo belum dimulai." };
  if (new Date(promo.endsAt) < now) return { discount: 0, applies: false, reason: "Promo sudah berakhir." };

  const base = Number(subtotal) || 0;
  if (base < (promo.minSpend ?? 0)) {
    return {
      discount: 0,
      applies: false,
      reason: `Minimum transaksi Rp ${Number(promo.minSpend).toLocaleString("id-ID")}.`,
    };
  }

  let discount;
  if (promo.discountType === "PERCENT") {
    // Integer maths: round DOWN so a rounding error can never make the customer
    // pay less than the recorded discount accounts for.
    discount = Math.floor((base * Number(promo.discountValue)) / 100);
    if (promo.maxDiscount != null) discount = Math.min(discount, Number(promo.maxDiscount));
  } else {
    discount = Number(promo.discountValue);
  }

  // A discount can never exceed the subtotal. Otherwise the order total goes
  // negative and the payment gateway rejects it (or, worse, pays the customer).
  discount = Math.max(0, Math.min(discount, base));

  return { discount, applies: discount > 0, reason: null };
}

/**
 * Validate a promo code for a specific purchase.
 *
 * Visibility is NOT read here, on purpose. `visibility` is a publishing switch
 * here. It decides whether a voucher is listed, and a HIDDEN voucher is defined as
 * fully redeemable by anyone who knows the code. Gating the code path on it
 * would make "hidden" into a real restriction and, worse, would give whoever
 * could flip the column the power to void vouchers already handed to customers.
 * Every rule that actually protects the voucher (active, window, scope,
 * minSpend, quota) is enforced here and again atomically at order time.
 *
 * @param {{ code: string, subtotal: number, variantId?: string }} input
 * @returns {Promise<{ promo: object, discount: number }>}
 * @throws {AppError} ITP_PROMO_INVALID / ITP_PROMO_EXHAUSTED
 */
export async function validatePromoCode({ code, subtotal, variantId = null }) {
  const normalised = String(code || "").trim().toUpperCase();
  if (!normalised) throw new AppError("ITP_PROMO_INVALID");

  const promoCode = await prisma.promoCode.findUnique({
    where: { code: normalised },
    include: { promo: { select: { ...PUBLIC_PROMO_SELECT, variants: { select: { id: true } } } } },
  });

  if (!promoCode || !promoCode.isActive) {
    throw new AppError("ITP_PROMO_INVALID");
  }

  // Usage limits are checked here for a fast, friendly error. The ATOMIC check
  // happens at order creation (a conditional updateMany inside the transaction),
  // because a read-then-write here would let two concurrent checkouts both pass.
  if (promoCode.usageLimit != null && promoCode.usageCount >= promoCode.usageLimit) {
    throw new AppError("ITP_PROMO_EXHAUSTED");
  }

  const { promo } = promoCode;

  // A promo scoped to specific variants only applies to those variants.
  if (promo.variants.length > 0) {
    if (!variantId || !promo.variants.some((v) => v.id === variantId)) {
      throw new AppError("ITP_PROMO_INVALID", "Promo tidak berlaku untuk produk ini.");
    }
  }

  const { discount, applies, reason } = computePromoDiscount(promo, subtotal);
  if (!applies) {
    throw new AppError("ITP_PROMO_INVALID", reason || undefined);
  }

  return { promo, promoCodeId: promoCode.id, discount };
}

// ── Scope resolution ─────────────────────────────────────────────────────────

/**
 * Does a promo apply to a given catalog context?
 *
 * `ctx` is the FLAT context from `scopeContextFromVariant`: { variantId,
 * productId, gameId, categoryId }. Scope is matched against the variant's own
 * id and the ids of its parents (product, game, category), so a promo scoped to
 * a game covers every nominal under it without needing a row per nominal.
 *
 * @param {object} promo  A promo with its scope/target fields loaded.
 * @param {object} ctx    Flat catalog context.
 */
export function promoAppliesToVariant(promo, ctx) {
  if (!promo || !ctx) return false;
  switch (promo.scope) {
    case "ALL": return true;
    case "VARIANT": return promo.variantId ? promo.variantId === ctx.variantId : false;
    case "PRODUCT": return promo.productId ? promo.productId === ctx.productId : false;
    case "GAME": return promo.gameId ? promo.gameId === ctx.gameId : false;
    case "CATEGORY": return promo.categoryId ? promo.categoryId === ctx.categoryId : false;
    default: return false;
  }
}

/**
 * The catalog context a promo's scope is checked against. Resolved once from
 * the variant and reused by every comparison.
 */
export function scopeContextFromVariant(variant) {
  const game = variant?.product?.game ?? null;
  return {
    variantId: variant?.id ?? null,
    productId: variant?.product?.id ?? null,
    gameId: game?.id ?? null,
    categoryId: game?.categoryId ?? null,
  };
}

// ── Auto discounts ("diskon manual") ────────────────────────────────────────

/**
 * Compute the AUTO discount for a variant.
 *
 * The admin sets a promo with distribution=AUTO and a scope (ALL, a category, a
 * game, a product, or a single nominal). At checkout this function finds every
 * live AUTO promo whose scope covers the variant and takes the LARGEST one.
 * stacking multiple automatic discounts would let two 10% rules compound into
 * 19%, which is not what the operator configured.
 *
 * @param {{ variantId: string, subtotal?: number }} args
 * @returns {Promise<{ promo: object|null, discount: number }>}
 */
export async function resolveAutoDiscount({ variantId, subtotal = null }) {
  if (!variantId) return { promo: null, discount: 0 };

  const now = new Date();

  const variants = await prisma.productVariant.findMany({
    where: { id: variantId },
    select: {
      id: true,
      productId: true,
      sellingPrice: true,
      product: { select: { id: true, gameId: true, game: { select: { id: true, categoryId: true } } } },
    },
  });
  const variant = variants[0];
  if (!variant) return { promo: null, discount: 0 };

  const ctx = scopeContextFromVariant(variant);

  // Every live AUTO promo. Scope is filtered here (not in SQL) because each
  // scope has its own column; four ORs with three-way joins are harder to read
  // than this loop, and the candidate set is small (a storefront has a handful
  // of concurrent auto discounts).
  const candidates = await prisma.promo.findMany({
    where: {
      isActive: true,
      distribution: "AUTO",
      startsAt: { lte: now },
      endsAt: { gte: now },
    },
    select: { ...PUBLIC_PROMO_SELECT },
  });

  let best = null;
  let bestDiscount = 0;

  for (const promo of candidates) {
    if (!promoAppliesToVariant(promo, ctx)) continue;
    // Without a subtotal (used on the catalog card, before a basket exists),
    // assume the discount applies and compute it against the price we have.
    const { discount, applies } = computePromoDiscount(
      promo,
      subtotal ?? variant.sellingPrice ?? 0,
    );
    if (!applies) continue;
    if (discount > bestDiscount) {
      best = promo;
      bestDiscount = discount;
    }
  }

  return { promo: best, discount: bestDiscount };
}

/**
 * Resolve AUTO discounts for MANY variants in ONE pass.
 *
 * The top-up page shows every nominal at once, and each tile needs to know
 * whether a promo covers it. Fetching them one-by-one (one DB round-trip per
 * nominal) is what produced the "flash": the grid rendered list prices, then
 * each tile silently swapped to a crossed-out pair as its own request landed.
 * That read as prices changing underneath the customer.
 *
 * This resolves the whole grid before any of it is painted: one promo query,
 * one variant query, and the page receives a complete price map.
 *
 * @param {string[]} variantIds
 * @returns {Promise<Map<string, {promo: object|null, discount: number}>>}
 */
export async function resolveAutoDiscountBatch(variantIds) {
  if (!variantIds?.length) return new Map();

  const now = new Date();

  const variants = await prisma.productVariant.findMany({
    where: { id: { in: variantIds } },
    select: {
      id: true,
      sellingPrice: true,
      product: { select: { id: true, gameId: true, game: { select: { id: true, categoryId: true } } } },
    },
  });
  if (!variants.length) return new Map();

  // The same candidate set is tested against every variant; one fetch, not one
  // per nominal.
  const candidates = await prisma.promo.findMany({
    where: {
      isActive: true,
      distribution: "AUTO",
      startsAt: { lte: now },
      endsAt: { gte: now },
    },
    select: { ...PUBLIC_PROMO_SELECT },
  });

  const out = new Map();
  for (const variant of variants) {
    const ctx = scopeContextFromVariant(variant);
    let best = null;
    let bestDiscount = 0;
    for (const promo of candidates) {
      if (!promoAppliesToVariant(promo, ctx)) continue;
      const { discount, applies } = computePromoDiscount(promo, variant.sellingPrice ?? 0);
      if (!applies) continue;
      if (discount > bestDiscount) {
        best = promo;
        bestDiscount = discount;
      }
    }
    out.set(variant.id, { promo: best, discount: bestDiscount });
  }
  return out;
}

/**
 * Simulate an entire checkout: list price → auto discount → voucher → fee.
 *
 * The summary rail shows the customer a total BEFORE they commit, so they are
 * not surprised by the fee or by a voucher that turns out not to apply. This
 * function reproduces `createOrder`'s pricing path EXACTLY: same stacking
 * order (auto first, voucher on what remains), same integer rounding, same
 * clamps, because a preview that disagrees with the order is worse than no
 * preview at all.
 *
 * Nothing is spent here. The claim is validated read-only; redemption happens
 * in the order transaction.
 *
 * @param {object} variant  A sellable variant (needs sellingPrice + scope ids).
 * @param {string|null} voucherClaimId  A claim from "Voucher Saya", if picked.
 * @param {object|null} paymentMethod  Resolved payment method, or null.
 * @param {string|null} userId  Session user; required to read a claim.
 */
export async function previewCheckout({ variant, voucherClaimId = null, paymentMethod = null, userId = null }) {
  const normal = Math.max(0, Math.round(Number(variant?.sellingPrice ?? 0)));

  // (1) Auto discount ("diskon manual"): applied to the raw price.
  const { promo: autoPromo, discount: autoDiscount } = await resolveAutoDiscount({
    variantId: variant?.id ?? null,
    subtotal: normal,
  });
  const afterAuto = Math.max(0, normal - autoDiscount);

  // (2) Voucher: validated against what remains AFTER the auto discount, which
  //     is the same subtotal createOrder passes to the voucher validator.
  //     A voucher that does not apply (wrong scope, below minSpend, not the
  //     owner's, expired) yields a zero discount plus a reason the UI can show
  //     It is not an error, just an unusable voucher for this purchase.
  let voucherPromo = null;
  let voucherDiscount = 0;
  let voucherEligible = true;
  let voucherReason = null;

  if (voucherClaimId) {
    if (!userId) {
      voucherEligible = false;
      voucherReason = "Masuk untuk menggunakan voucher ini.";
    } else {
      try {
        const result = await validateVoucherClaim({
          claimId: voucherClaimId,
          userId,
          subtotal: afterAuto,
          variantId: variant?.id ?? null,
        });
        voucherPromo = result.promo;
        voucherDiscount = Math.max(0, Math.min(result.discount, afterAuto));
      } catch (err) {
        voucherEligible = false;
        voucherReason = err?.message ?? "Voucher tidak dapat digunakan.";
      }
    }
  }
  const afterVoucher = Math.max(0, afterAuto - voucherDiscount);

  /**
   * Simulasi total: harga normal → potongan diskon → total.
   *
   * Biaya admin TIDAK ikut dihitung di fase pemilihan nominal. Alasannya: biaya
   * admin tergantung metode pembayaran yang customer belum dipilih di tahap ini.
   * Menampilkan "Rp 1.535" di sini lalu totalnya berubah lagi di pembayaran adalah
   * perubahan harga yang tidak dijelaskan, customer bingung. Total final, biaya
   * admin, dan harga asli dihitung server-side saat pembayaran.
   */
  const fee = 0;
  const total = Math.max(0, afterVoucher + fee);

  return {
    normal,
    autoDiscount,
    autoPromo,
    afterAuto,
    voucherDiscount,
    voucherPromo,
    voucherEligible,
    voucherReason,
    afterVoucher,
    fee,
    total,
  };
}

// ── Claimable vouchers ──────────────────────────────────────────────────────

/**
 * Vouchers this user can claim right now: eligible AND not already claimed.
 *
 * Eligibility is audience × completion history:
 *   ALL_USERS    : everyone
 *   NEW_CUSTOMER : zero COMPLETED orders
 *   LOYAL_CUSTOMER : at least `minCompletedOrders` COMPLETED orders
 */
export async function listClaimableVouchers({ userId }) {
  if (!userId) return [];

  const now = new Date();

  const [completedCount, claimed] = await Promise.all([
    prisma.order.count({ where: { userId, status: ORDER_STATUS.SUCCESS } }),
    prisma.voucherClaim.findMany({
      where: { userId },
      select: { promoId: true, status: true },
    }),
  ]);

  // A claim row of ANY status means this promo was already offered to this
  // customer: ACTIVE (sitting in their wallet), REDEEMED (already spent), or
  // VOIDED (revoked by an admin). None of the three belongs on the "claim your
  // voucher" shelf again. This is the display half of the fix; without it a
  // customer who already spent a voucher sees it re-offered, claims it, and the
  // checkout then has to reject them (or, before the constraint fix, crash with
  // P2002). The backend still re-validates ownership and status at checkout.
  const claimedAny = new Set(claimed.map((c) => c.promoId));
  const claimedActive = new Set(claimed.filter((c) => c.status === "ACTIVE").map((c) => c.promoId));

  const candidates = await prisma.promo.findMany({
    where: {
      isActive: true,
      distribution: "VOUCHER",
      startsAt: { lte: now },
      endsAt: { gte: now },
      // A HIDDEN voucher is deliberately absent from the claimable shelf:
      // claiming it would publicise a code the operator meant to hand out
      // individually. It is still usable by typing the code at checkout.
      visibility: "PUBLIC",
    },
    orderBy: [{ endsAt: "asc" }, { createdAt: "desc" }],
    select: { ...PUBLIC_PROMO_SELECT },
  });

  return candidates.filter((promo) => {
    // Audience gate.
    if (promo.audience === "NEW_CUSTOMER" && completedCount > 0) return false;
    if (promo.audience === "LOYAL_CUSTOMER" && completedCount < (promo.minCompletedOrders || 0)) {
      return false;
    }
    // Already holding an active claim.
    if (claimedActive.has(promo.id)) return false;
    // Already used it, or it was claimed then voided: do NOT re-offer. The
    // voucher shelf shows only what is genuinely available to this customer.
    if (claimedAny.has(promo.id)) return false;
    // Quota exhausted. claimCount is denormalised; the atomic guard is in
    // claimVoucher() and tolerates drift by re-checking the live count there.
    if (promo.claimLimit != null && promo.claimCount >= promo.claimLimit) return false;
    return true;
  });
}

/**
 * Vouchers the user is holding: ACTIVE claims, ready to spend at checkout.
 */
export async function listMyVouchers({ userId }) {
  if (!userId) return [];

  return prisma.voucherClaim.findMany({
    where: { userId, status: "ACTIVE" },
    orderBy: [{ claimedAt: "desc" }],
    select: {
      id: true,
      status: true,
      claimedAt: true,
      promo: { select: PUBLIC_PROMO_SELECT },
    },
  });
}

/**
 * Claim a voucher. Quota is enforced atomically: a conditional increment is
 * what stops the 11th customer from claiming a 10-user voucher; a
 * read-then-write would let two concurrent claims both pass the count check.
 *
 * @returns {Promise<{ claim: object }>}
 */
export async function claimVoucher({ userId, promoId }) {
  if (!userId || !promoId) throw new AppError("ITP_INVALID_INPUT", "Voucher tidak valid.");

  const now = new Date();

  const promo = await prisma.promo.findUnique({
    where: { id: promoId },
    select: { ...PUBLIC_PROMO_SELECT, distribution: true, audience: true, minCompletedOrders: true },
  });
  if (!promo || !promo.isActive || promo.distribution !== "VOUCHER") {
    throw new AppError("ITP_NOT_FOUND", "Voucher tidak ditemukan.");
  }
  if (promo.startsAt > now || promo.endsAt < now) {
    throw new AppError("ITP_PROMO_INVALID", "Voucher sudah tidak berlaku.");
  }

  // ── Audience gate (non-transactional read is fine here: the quota guard
  // below is the one that has to be atomic) ──────────────────────────────
  const completedCount = await prisma.order.count({
    where: { userId, status: ORDER_STATUS.SUCCESS },
  });
  if (promo.audience === "NEW_CUSTOMER" && completedCount > 0) {
    throw new AppError("ITP_PROMO_INVALID", "Voucher ini hanya untuk pelanggan baru.");
  }
  if (promo.audience === "LOYAL_CUSTOMER" && completedCount < (promo.minCompletedOrders || 0)) {
    throw new AppError(
      "ITP_PROMO_INVALID",
      `Voucher ini untuk pelanggan dengan minimal ${promo.minCompletedOrders} transaksi.`,
    );
  }

  // Already holding an ACTIVE claim? Refuse here, before the quota is touched.
  // Without this the upsert below would silently return the existing row and
  // the customer's button would look like it claimed a second voucher.
  const existingClaim = await prisma.voucherClaim.findUnique({
    where: { userId_promoId: { userId, promoId } },
    select: { id: true, status: true },
  });
  if (existingClaim?.status === "ACTIVE") {
    throw new AppError("ITP_CONFLICT", "Anda sudah memiliki voucher ini.");
  }

  try {
    return await prisma.$transaction(async (tx) => {
      // THE QUOTA GUARD. `updateMany` with a conditional where is an atomic
      // compare-and-increment; two concurrent claims cannot both take the last
      // slot because the where-clause re-evaluates claimCount per row.
      if (promo.claimLimit != null) {
        const taken = await tx.promo.updateMany({
          where: {
            id: promoId,
            isActive: true,
            OR: [{ claimLimit: null }, { claimCount: { lt: prisma.promo.fields.claimLimit } }],
          },
          data: { claimCount: { increment: 1 } },
        });
        if (taken.count !== 1) {
          throw new AppError("ITP_PROMO_EXHAUSTED", "Kuota klaim voucher sudah habis.");
        }
      }

      // Upsert on the (userId, promoId) primary key, NOT on status: with a
      // composite PK there is exactly one row per user+promo, so a re-claim of
      // a promo the customer already used once must revive THAT row (resetting
      // it to ACTIVE) instead of trying to insert a second one.
      //
      // Reviving is the correct behaviour for a voucher the customer is allowed
      // to hold again: the previous redemption is preserved in the audit log and
      // in `redeemedInvoice` on the order, and the claim becomes spendable once
      // more. `claimedAt` is reset so the wallet shows the fresh claim time.
      // A re-claim of a claim the customer ALREADY holds actively is a no-op for
      // the wallet (they still have one voucher), but must NOT silently succeed
      // as if a new quota slot were taken: claimCount is only incremented on the
      // create branch. The caller surfaces the duplicate as a conflict.
      const claim = await tx.voucherClaim.upsert({
        where: { userId_promoId: { userId, promoId } },
        update: { status: "ACTIVE", claimedAt: new Date(), redeemedAt: null, redeemedInvoice: null },
        create: { userId, promoId, status: "ACTIVE" },
        select: {
          id: true,
          status: true,
          claimedAt: true,
          promo: { select: PUBLIC_PROMO_SELECT },
        },
      });

      await writeAudit({
        action: AUDIT.PROMO_CLAIMED,
        actor: { id: userId },
        targetType: "Promo",
        targetId: promoId,
        metadata: { title: promo.title, slug: promo.slug },
        tx,
        strict: false,
        request: {},
      });

      return { claim };
    });
  } catch (err) {
    // A unique violation here means the user already holds an ACTIVE claim,
    // not an error worth surfacing as a 500.
    if (err?.code === "P2002") {
      throw new AppError("ITP_CONFLICT", "Anda sudah memiliki voucher ini.");
    }
    throw err;
  }
}

/**
 * Validate a voucher CLAIM (from "Voucher Saya") for use at checkout.
 *
 * Mirrors `validatePromoCode`, but the entry key is a claim the customer owns
 * instead of a code string. Ownership is enforced: a claim id belonging to
 * another user is rejected, not merely "not found".
 *
 * The claim is NOT spent here. Spending happens in `redeemVoucherClaim` inside
 * the order transaction, so a validation that passes but an order that fails
 * leaves the voucher untouched.
 *
 * @returns {Promise<{ promo: object, claimId: string, discount: number }>}
 */
export async function validateVoucherClaim({ claimId, userId, subtotal, variantId = null }) {
  if (!claimId || !userId) throw new AppError("ITP_PROMO_INVALID", "Voucher tidak valid.");

  const claim = await prisma.voucherClaim.findUnique({
    where: { id: claimId },
    include: {
      promo: {
        select: {
          ...PUBLIC_PROMO_SELECT,
          codes: { where: { isActive: true }, select: { code: true } },
        },
      },
    },
  });

  if (!claim) throw new AppError("ITP_PROMO_INVALID", "Voucher tidak ditemukan.");
  if (claim.userId !== userId) {
    // Do not leak that another user owns this id.
    throw new AppError("ITP_PROMO_INVALID", "Voucher tidak ditemukan.");
  }
  if (claim.status !== "ACTIVE") {
    throw new AppError("ITP_PROMO_INVALID", "Voucher sudah dipakai atau tidak berlaku.");
  }

  const { promo } = claim;
  const now = new Date();
  if (!promo.isActive || promo.startsAt > now || promo.endsAt < now) {
    throw new AppError("ITP_PROMO_INVALID", "Voucher sudah tidak berlaku.");
  }

  // Scope: a voucher scoped to a variant only applies to that variant.
  if (!promoAppliesToVariant(promo, await scopeContextForVariantId(variantId))) {
    throw new AppError("ITP_PROMO_INVALID", "Voucher tidak berlaku untuk produk ini.");
  }

  const { discount, applies, reason } = computePromoDiscount(promo, subtotal);
  if (!applies) {
    throw new AppError("ITP_PROMO_INVALID", reason || "Voucher tidak memenuhi syarat.");
  }

  return { promo, claimId: claim.id, discount };
}

/**
 * Fetch the scope context (variant/product/game/category ids) for a variant id.
 * Extracted so the scope check in `validateVoucherClaim` reads the same rows
 * `resolveAutoDiscount` does: one shape, two call sites.
 */
async function scopeContextForVariantId(variantId) {
  if (!variantId) return null;
  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
    select: {
      id: true,
      productId: true,
      product: { select: { id: true, gameId: true, game: { select: { id: true, categoryId: true } } } },
    },
  });
  return scopeContextFromVariant(variant);
}

/**
 * Redeem a voucher claim at checkout.
 *
 * The claim is marked REDEEMED atomically with the quota increment, so a
 * concurrent checkout of the same claim cannot spend it twice. Called from
 * the order transaction.
 *
 * @param {object} tx  The order's transaction client.
 * @param {{ claimId: string, invoice: string }} args
 */
export async function redeemVoucherClaim(tx, { claimId, invoice }) {
  if (!claimId || !invoice) {
    throw new AppError("ITP_INVALID_INPUT", "Klaim voucher tidak valid.");
  }

  // Conditional update = the atomic guard. It only matches an ACTIVE claim,
  // so a claim that was already spent (or voided) affects zero rows and the
  // checkout refuses to proceed.
  const spent = await tx.voucherClaim.updateMany({
    where: { id: claimId, status: "ACTIVE" },
    data: { status: "REDEEMED", redeemedAt: new Date(), redeemedInvoice: invoice },
  });
  if (spent.count !== 1) {
    throw new AppError("ITP_PROMO_INVALID", "Voucher tidak tersedia atau sudah dipakai.");
  }
}

// ── Admin CRUD ──────────────────────────────────────────────────────────────

const VISIBILITY_VALUES = ["PUBLIC", "HIDDEN"];
const STATUS_VALUES = ["active", "inactive", "scheduled", "expired"];

/**
 * Admin listing with the filters the operator page exposes.
 *
 * `status` is derived (active/inactive/scheduled/expired) rather than stored:
 * it is `isActive` crossed with the time window, so filtering by it must
 * reproduce that derivation in the WHERE. Keeping it out of the schema means
 * there is no column that can contradict the dates.
 */
export async function listPromosForAdmin({
  page = 1,
  limit = 20,
  search = "",
  visibility = null,
  status = null,
} = {}) {
  const take = Math.min(100, Math.max(1, Number(limit) || 20));
  const skip = (Math.max(1, Number(page) || 1) - 1) * take;

  const where = {};

  if (VISIBILITY_VALUES.includes(visibility)) {
    where.visibility = visibility;
  }

  const now = new Date();
  if (status === "active") {
    where.isActive = true;
    where.startsAt = { lte: now };
    where.endsAt = { gte: now };
  } else if (status === "inactive") {
    where.isActive = false;
  } else if (status === "scheduled") {
    where.isActive = true;
    where.startsAt = { gt: now };
  } else if (status === "expired") {
    where.isActive = true;
    where.endsAt = { lt: now };
  }

  if (search) {
    const term = String(search).trim().slice(0, 100);
    where.OR = [
      { title: { contains: term, mode: "insensitive" } },
      { slug: { contains: term, mode: "insensitive" } },
      { codes: { some: { code: { contains: term.toUpperCase() } } } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.promo.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      select: {
        ...PUBLIC_PROMO_SELECT,
        createdAt: true,
        codes: {
          select: { id: true, code: true, usageLimit: true, usageCount: true, isActive: true },
        },
        // `variants` is the legacy M2M; `claims` is how many customers hold or
        // held this voucher. Both counts drive the delete confirmation text.
        _count: { select: { variants: true, claims: true } },
      },
    }),
    prisma.promo.count({ where }),
  ]);

  return {
    items,
    pagination: { page: Math.max(1, Number(page) || 1), limit: take, total, pages: Math.max(1, Math.ceil(total / take)) },
  };
}

export async function createPromo({ actor, input, request = {} }) {
  const data = parse(promoCreateSchema, input);

  const clash = await prisma.promo.findUnique({ where: { slug: data.slug }, select: { id: true } });
  if (clash) throw new AppError("ITP_CONFLICT", "Slug promo sudah digunakan.");

  const { code, usageLimit, perUserLimit, ...promoData } = data;

  // A target id without its scope is a config error the refinement should have
  // caught, but a stale target left over from a scope change is cleaned here so
  // the row can never match more than one scope at once.
  clearOrphanTargets(promoData);

  if (code) {
    const codeClash = await prisma.promoCode.findUnique({ where: { code }, select: { id: true } });
    if (codeClash) throw new AppError("ITP_CONFLICT", "Kode promo sudah digunakan.");
  }

  const promo = await prisma.$transaction(async (tx) => {
    const created = await tx.promo.create({
      data: { ...promoData, createdById: actor.id },
      select: PUBLIC_PROMO_SELECT,
    });

    if (code) {
      await tx.promoCode.create({
        data: {
          promoId: created.id,
          code,
          usageLimit: usageLimit ?? null,
          perUserLimit: perUserLimit ?? null,
        },
      });
    }

    await writeAudit({
      action: AUDIT.PROMO_CREATED,
      actor,
      targetType: "Promo",
      targetId: created.id,
      metadata: { title: created.title, slug: created.slug, code: code ?? null },
      tx,
      strict: true,
      request,
    });

    return created;
  });

  return promo;
}

/**
 * Null out target ids that do not belong to the promo's scope.
 *
 * If the operator switches scope from GAME to CATEGORY and the gameId is still
 * set, the row would carry a leftover target that `promoAppliesToVariant`
 * never reads, harmless for resolution, but misleading in the admin UI and
 * in the audit trail. Kept consistent here instead.
 */
function clearOrphanTargets(promoData) {
  if (promoData.scope == null) return;
  const keep = SCOPE_TO_FIELD[promoData.scope];
  for (const field of ["categoryId", "gameId", "productId", "variantId"]) {
    if (field !== keep && promoData[field] != null) promoData[field] = null;
  }
}

const SCOPE_TO_FIELD = {
  ALL: null,
  CATEGORY: "categoryId",
  GAME: "gameId",
  PRODUCT: "productId",
  VARIANT: "variantId",
};

export async function updatePromo({ actor, promoId, input, request = {} }) {
  const data = parse(promoUpdateSchema, input);

  const existing = await prisma.promo.findUnique({
    where: { id: promoId },
    select: { id: true, slug: true, title: true, isActive: true },
  });
  if (!existing) throw new AppError("ITP_NOT_FOUND", "Promo tidak ditemukan.");

  if (data.slug && data.slug !== existing.slug) {
    const clash = await prisma.promo.findUnique({ where: { slug: data.slug }, select: { id: true } });
    if (clash) throw new AppError("ITP_CONFLICT", "Slug promo sudah digunakan.");
  }

  const { code, usageLimit, perUserLimit, ...promoData } = data;
  clearOrphanTargets(promoData);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.promo.update({
      where: { id: promoId },
      data: promoData,
      select: PUBLIC_PROMO_SELECT,
    });

    if (code) {
      const existingCode = await tx.promoCode.findFirst({ where: { promoId } });
      if (existingCode) {
        await tx.promoCode.update({
          where: { id: existingCode.id },
          data: { code, ...(usageLimit !== undefined ? { usageLimit } : {}), ...(perUserLimit !== undefined ? { perUserLimit } : {}) },
        });
      } else {
        await tx.promoCode.create({
          data: { promoId, code, usageLimit: usageLimit ?? null, perUserLimit: perUserLimit ?? null },
        });
      }
    }

    await writeAudit({
      action: AUDIT.PROMO_UPDATED,
      actor,
      targetType: "Promo",
      targetId: promoId,
      // `changed` names the fields only; values are already on the row.
      metadata: { changed: Object.keys(data) },
      tx,
      strict: true,
      request,
    });

    return updated;
  });
}

/**
 * Hard-delete a promo that has never been used.
 *
 * The project has no soft-delete column on Promo, and adding one would be wrong
 * here: `deactivatePromo` already IS the soft delete, and it is what an operator
 * should reach for when history matters. This function is for the other case:
 * a voucher created by mistake, or a test voucher, where there is no history to
 * protect. Its guard is the reason it is safe:
 *
 *   - any VoucherClaim, in ANY status (ACTIVE / REDEEMED / VOIDED), blocks it,
 *   - any PromoCode usage (usageCount > 0) blocks it,
 *   - any order carrying this promo's slug blocks it.
 *
 * Those are checked server-side inside the transaction, not trusted from the
 * client. A promo that passes all three has had no effect on any customer, so
 * removing the row cannot orphan a receipt, a claim, or an audit record. The
 * audit entry itself is written BEFORE the delete, so the trail names the promo
 * even after the row is gone.
 *
 * `promoId` and `blocker` are returned for the UI, so an operator who clicks
 * Delete on a used voucher learns WHY (and is pointed at deactivate) instead of
 * a bare 409.
 */
export async function deletePromo({ actor, promoId, request = {} }) {
  const existing = await prisma.promo.findUnique({
    where: { id: promoId },
    select: {
      id: true,
      title: true,
      slug: true,
      isActive: true,
      codes: { select: { id: true, usageCount: true } },
      _count: { select: { claims: true } },
    },
  });
  if (!existing) throw new AppError("ITP_NOT_FOUND", "Promo tidak ditemukan.");

  // ── Guards: has this promo ever touched a customer? ────────────────────
  const usedByClaimCount = existing._count.claims;
  const totalCodeUsage = existing.codes.reduce((sum, c) => sum + (c.usageCount ?? 0), 0);

  if (usedByClaimCount > 0) {
    throw new AppError(
      "ITP_CONFLICT",
      `Voucher sudah diklaim oleh ${usedByClaimCount} member. Nonaktifkan saja, jangan dihapus. Data pemakaian tetap perlu untuk histori.`,
    );
  }
  if (totalCodeUsage > 0) {
    throw new AppError(
      "ITP_CONFLICT",
      `Kode promo sudah dipakai ${totalCodeUsage} kali. Nonaktifkan saja, jangan dihapus. Data pemakaian tetap perlu untuk histori.`,
    );
  }

  // An order that carried this promo. The slug is NOT a column on orders;
  // createOrder writes it into the ORDER_CREATED TransactionLog's metadata
  // (`autoPromoSlug` / `voucherPromoSlug`), so this is a JSON lookup against
  // the same metadata the order path writes. A row can be added later, which
  // is why this check lives here (server-side, at delete time) rather than
  // being derived once up front.
  const orderRefs = await prisma.transactionLog.count({
    where: {
      event: "ORDER_CREATED",
      OR: [
        { metadata: { path: ["autoPromoSlug"], equals: existing.slug } },
        { metadata: { path: ["voucherPromoSlug"], equals: existing.slug } },
      ],
    },
  });
  if (orderRefs > 0) {
    throw new AppError(
      "ITP_CONFLICT",
      `Promo tercatat di ${orderRefs} transaksi. Nonaktifkan saja, jangan dihapus. Data transaksi tetap perlu untuk histori.`,
    );
  }

  return prisma.$transaction(async (tx) => {
    // The audit row is written BEFORE the delete. Once the promo row is gone
    // there is nothing left to describe, so the trail has to be complete first.
    await writeAudit({
      action: AUDIT.PROMO_HARD_DELETED,
      actor,
      targetType: "Promo",
      targetId: promoId,
      metadata: { title: existing.title, slug: existing.slug, hardDelete: true },
      tx,
      strict: true,
      request,
    });

    // PromoCode + legacy M2M both cascade on delete, so only the promo row is
    // removed explicitly.
    await tx.promo.delete({ where: { id: promoId } });

    return { id: promoId };
  });
}

/**
 * Deactivate rather than delete.
 *
 * A hard delete would break the historical link from any order that used the
 * promo. Deactivating keeps the audit trail intact and takes the promo off the
 * storefront immediately. When the promo HAS been used, this is the right call;
 * see deletePromo for the never-used case.
 */
export async function deactivatePromo({ actor, promoId, request = {} }) {
  const existing = await prisma.promo.findUnique({
    where: { id: promoId },
    select: { id: true, title: true, isActive: true },
  });
  if (!existing) throw new AppError("ITP_NOT_FOUND", "Promo tidak ditemukan.");
  if (!existing.isActive) throw new AppError("ITP_CONFLICT", "Promo sudah nonaktif.");

  return prisma.$transaction(async (tx) => {
    const updated = await tx.promo.update({
      where: { id: promoId },
      data: { isActive: false },
      select: PUBLIC_PROMO_SELECT,
    });
    await tx.promoCode.updateMany({ where: { promoId }, data: { isActive: false } });

    await writeAudit({
      action: AUDIT.PROMO_DELETED,
      actor,
      targetType: "Promo",
      targetId: promoId,
      metadata: { title: existing.title, softDelete: true },
      tx,
      strict: true,
      request,
    });

    return updated;
  });
}
