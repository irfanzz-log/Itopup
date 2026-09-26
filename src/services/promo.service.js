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
import { AUDIT } from "../lib/constants.js";
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
};

// ── Public reads ────────────────────────────────────────────────────────────

/** Promos that are live right now: active, started, not yet ended. */
export async function listActivePromos({ limit = 12 } = {}) {
  const now = new Date();
  return prisma.promo.findMany({
    where: { isActive: true, startsAt: { lte: now }, endsAt: { gte: now } },
    orderBy: [{ endsAt: "asc" }, { createdAt: "desc" }],
    take: Math.min(50, Math.max(1, limit)),
    select: PUBLIC_PROMO_SELECT,
  });
}

export async function getPromoBySlug(slug) {
  const now = new Date();
  return prisma.promo.findFirst({
    where: { slug, isActive: true, startsAt: { lte: now }, endsAt: { gte: now } },
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

  // A discount can never exceed the subtotal — otherwise the order total goes
  // negative and the payment gateway rejects it (or, worse, pays the customer).
  discount = Math.max(0, Math.min(discount, base));

  return { discount, applies: discount > 0, reason: null };
}

/**
 * Validate a promo code for a specific purchase.
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

// ── Admin CRUD ──────────────────────────────────────────────────────────────

export async function listPromosForAdmin({ page = 1, limit = 20, search = "", activeOnly = false } = {}) {
  const take = Math.min(100, Math.max(1, Number(limit) || 20));
  const skip = (Math.max(1, Number(page) || 1) - 1) * take;

  const where = {};
  if (activeOnly) {
    const now = new Date();
    where.isActive = true;
    where.startsAt = { lte: now };
    where.endsAt = { gte: now };
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
        _count: { select: { variants: true } },
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
 * Deactivate rather than delete.
 *
 * A hard delete would break the historical link from any order that used the
 * promo. Deactivating keeps the audit trail intact and takes the promo off the
 * storefront immediately.
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
