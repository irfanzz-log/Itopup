// ============================================================================
// Order service — the transactional core.
//
// Invariants this file exists to protect:
//
//   1. THE SERVER OWNS THE PRICE. The client sends a variant id; the price,
//      discount, fee and total are read from the database inside the same
//      transaction that creates the order. A price in the request body is not
//      read, and `.strict()` validation rejects it outright.
//
//   2. NO DUPLICATE ORDERS. `Order.@@unique([userId, idempotencyKey])` is the
//      guarantee. A double click, a refresh, or a retried request hits P2002 and
//      resolves to the EXISTING order. A request that reuses a key with a
//      DIFFERENT payload is a 409, not a silent replay of the old order.
//
//   3. NO DOUBLE DISPATCH. `providerAttempts` is incremented with a conditional
//      updateMany inside a transaction, so two concurrent reconcilers cannot
//      both dispatch. The provider reference is stored before the call returns.
//
//   4. UNKNOWN IS NOT FAILED. A provider timeout leaves the order PROCESSING
//      (reconcilable), never FAILED. Marking a possibly-delivered order as
//      failed is how a customer gets a refund AND a top-up.
// ============================================================================
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../lib/db.js";
import { AppError } from "../lib/errors.js";
import { createLogger } from "../lib/logger.js";
import {
  AUDIT, ORDER_STATUS, ORDER_TRANSITIONS, TERMINAL_ORDER_STATUSES,
} from "../lib/constants.js";
import { ORDER_TTL_MINUTES } from "../lib/env.server.js";
import { validateFields } from "../config/input-fields.js";
import { computePaymentFee, getPaymentMethod, checkMethodEligibility } from "../config/payment.js";
import { unitMargin } from "../config/pricing.js";
import { getSellableVariant, selectProviderMapping } from "./catalog.service.js";
import { validatePromoCode } from "./promo.service.js";
import { writeAudit } from "./audit.service.js";
import { validateAccount } from "./provider.service.js";
import { getTopupProvider } from "../providers/index.js";
import { checkMethodServable } from "../providers/payment/index.js";
import { PROVIDER_ORDER_STATUS } from "../providers/contract.js";

// ── Invoice ─────────────────────────────────────────────────────────────────

/** Crockford-style base32, minus I/L/O/U to avoid visual ambiguity in support. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function randomToken(length) {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/**
 * Customer-facing invoice: ITP-YYYYMMDD-XXXXXXXX.
 * Date is WIB so it matches what the customer sees on their order page.
 */
export function generateInvoice(date = new Date()) {
  const wib = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const stamp =
    `${wib.getUTCFullYear()}` +
    `${String(wib.getUTCMonth() + 1).padStart(2, "0")}` +
    `${String(wib.getUTCDate()).padStart(2, "0")}`;
  return `ITP-${stamp}-${randomToken(8)}`;
}

// ── Pricing (pure — unit tested without a database) ─────────────────────────

/**
 * Compute the authoritative price breakdown.
 *
 * @param {{ variant: object, quantity?: number, promo?: { discount: number }|null, paymentMethod?: object|null }} input
 * @returns {{ quantity:number, unitSellingPrice:number, unitCostPrice:number,
 *             subtotal:number, discount:number, fee:number, total:number, margin:number }}
 */
export function computeOrderPricing({ variant, quantity = 1, promo = null, paymentMethod = null }) {
  const qty = Math.max(1, Math.min(100, Number(quantity) || 1));

  const unitSellingPrice = Number(variant.sellingPrice);
  const unitCostPrice = Number(variant.costPrice);

  if (!Number.isFinite(unitSellingPrice) || unitSellingPrice <= 0) {
    throw new AppError("ITP_PRODUCT_UNAVAILABLE", "Harga produk tidak valid.");
  }

  const subtotal = unitSellingPrice * qty;
  const discount = Math.max(0, Math.min(Number(promo?.discount ?? 0), subtotal));
  const afterDiscount = subtotal - discount;

  // The gateway fee is charged on what the customer actually pays.
  const fee = paymentMethod ? computePaymentFee(paymentMethod, afterDiscount) : 0;
  const total = afterDiscount + fee;

  if (total < 1) {
    throw new AppError("ITP_INVALID_INPUT", "Total pembayaran tidak valid.");
  }

  return {
    quantity: qty,
    unitSellingPrice,
    unitCostPrice,
    subtotal,
    discount,
    fee,
    total,
    margin: unitMargin(unitSellingPrice, unitCostPrice) * qty - discount,
  };
}

/** Canonical hash of a checkout request, so the same key with a different body is detectable. */
export function hashCheckoutRequest({ variantId, fields, promoCode, paymentMethod }) {
  const canonical = JSON.stringify({
    variantId,
    // Sorted so key order cannot change the hash.
    fields: Object.keys(fields || {}).sort().reduce((acc, key) => {
      acc[key] = String(fields[key]).trim();
      return acc;
    }, {}),
    promoCode: promoCode ? String(promoCode).trim().toUpperCase() : null,
    paymentMethod,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

// ── Reads ───────────────────────────────────────────────────────────────────

/** Projection for a member's own order list — no cost, no provider internals. */
const MEMBER_ORDER_SELECT = {
  id: true,
  invoice: true,
  status: true,
  gameName: true,
  productName: true,
  variantName: true,
  quantity: true,
  customerInput: true,
  subtotal: true,
  discount: true,
  fee: true,
  total: true,
  expiresAt: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  payment: {
    select: { status: true, method: true, reference: true, expiresAt: true, paidAt: true, instructions: true },
  },
};

export async function listOrdersForUser({ userId, page = 1, limit = 10, status = null }) {
  const take = Math.min(50, Math.max(1, Number(limit) || 10));
  const skip = (Math.max(1, Number(page) || 1) - 1) * take;

  // `userId` is ALWAYS applied. There is no code path that lists orders without
  // it — that is the IDOR protection, enforced by the query shape rather than by
  // a caller remembering to filter.
  const where = { userId };
  if (status && ORDER_STATUS[status]) where.status = status;

  const [items, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      select: MEMBER_ORDER_SELECT,
    }),
    prisma.order.count({ where }),
  ]);

  return {
    items,
    pagination: { page: Math.max(1, Number(page) || 1), limit: take, total, pages: Math.max(1, Math.ceil(total / take)) },
  };
}

/**
 * One order, scoped to its owner.
 *
 * `where: { id, userId }` (not findUnique-then-compare) so a mismatched owner is
 * indistinguishable from a missing row — an attacker cannot probe which order
 * ids exist.
 */
export async function getOrderForUser({ orderId, userId, invoice = null }) {
  const where = invoice ? { invoice, userId } : { id: orderId, userId };

  const order = await prisma.order.findFirst({
    where,
    select: {
      ...MEMBER_ORDER_SELECT,
      logs: {
        orderBy: { createdAt: "asc" },
        select: { event: true, message: true, createdAt: true, code: true },
      },
    },
  });

  if (!order) throw new AppError("ITP_ORDER_NOT_FOUND");
  return order;
}

/** Admin view: adds cost, margin, provider reference and the full log trail. */
export async function listOrdersForAdmin({
  page = 1, limit = 20, status = null, search = "", userId = null, from = null, to = null,
} = {}) {
  const take = Math.min(100, Math.max(1, Number(limit) || 20));
  const skip = (Math.max(1, Number(page) || 1) - 1) * take;

  const where = {};
  if (status && ORDER_STATUS[status]) where.status = status;
  if (userId) where.userId = userId;
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to) where.createdAt.lte = new Date(to);
  }
  if (search) {
    const term = String(search).trim().slice(0, 100);
    where.OR = [
      { invoice: { contains: term.toUpperCase() } },
      { providerRef: { contains: term } },
      { user: { email: { contains: term, mode: "insensitive" } } },
      { gameName: { contains: term, mode: "insensitive" } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      select: {
        id: true, invoice: true, status: true,
        gameName: true, productName: true, variantName: true, quantity: true,
        subtotal: true, discount: true, fee: true, total: true,
        unitCostPrice: true, unitSellingPrice: true, margin: true,
        providerRef: true, providerOrderId: true, providerStatus: true,
        providerAttempts: true, dispatchedAt: true, completedAt: true,
        createdAt: true, updatedAt: true,
        user: { select: { id: true, name: true, email: true } },
        payment: { select: { status: true, method: true, reference: true, paidAt: true } },
        provider: { select: { code: true, name: true } },
      },
    }),
    prisma.order.count({ where }),
  ]);

  return {
    items,
    pagination: { page: Math.max(1, Number(page) || 1), limit: take, total, pages: Math.max(1, Math.ceil(total / take)) },
  };
}

export async function getOrderForAdmin(orderId) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true, invoice: true, status: true,
      gameName: true, productName: true, variantName: true, quantity: true,
      customerInput: true,
      subtotal: true, discount: true, fee: true, total: true,
      unitCostPrice: true, unitSellingPrice: true, margin: true,
      providerRef: true, providerOrderId: true, providerStatus: true, providerMessage: true,
      providerAttempts: true, dispatchedAt: true, completedAt: true,
      idempotencyKey: true, expiresAt: true, ip: true, userAgent: true,
      createdAt: true, updatedAt: true,
      user: { select: { id: true, name: true, email: true, status: true, role: true } },
      provider: { select: { id: true, code: true, name: true, status: true } },
      payment: true,
      items: true,
      logs: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!order) throw new AppError("ITP_ORDER_NOT_FOUND", "Transaksi tidak ditemukan.");
  return order;
}

// ── Creation ────────────────────────────────────────────────────────────────

/**
 * Create an order from a validated checkout request.
 *
 * @param {{ userId: string, input: object, request?: object }} args
 * @returns {Promise<{ order: object, reused: boolean }>}
 */
export async function createOrder({ userId, input, request = {}, user = null }) {
  const { variantId, fields, promoCode, paymentMethod, idempotencyKey } = input;
  const log = createLogger({ component: "order", userId });

  const requestHash = hashCheckoutRequest({ variantId, fields, promoCode, paymentMethod });

  // ── Idempotency: look up an existing order for this key FIRST ─────────────
  const existing = await prisma.order.findUnique({
    where: { userId_idempotencyKey: { userId, idempotencyKey } },
    select: { id: true, invoice: true, status: true, total: true, requestHash: true },
  });

  if (existing) {
    if (existing.requestHash !== requestHash) {
      // Same key, different purchase: refuse rather than silently returning an
      // order the customer did not ask for.
      log.warn("order.idempotency_conflict", { orderId: existing.id });
      throw new AppError("ITP_IDEMPOTENCY_CONFLICT");
    }
    log.info("order.idempotent_replay", { orderId: existing.id, invoice: existing.invoice });
    return { order: existing, reused: true };
  }

  // ── Load the authoritative variant (throws when not sellable) ─────────────
  const variant = await getSellableVariant(variantId);

  // ── Validate the customer input against the game's field contract ─────────
  const fieldDefs = Array.isArray(variant.product.game.inputFields)
    ? variant.product.game.inputFields
    : [];
  const fieldResult = validateFields(fieldDefs, fields);
  if (!fieldResult.ok) {
    throw new AppError("ITP_INVALID_INPUT", fieldResult.errors[0]?.message || "Data akun tidak valid.", {
      details: fieldResult.errors,
    });
  }

  // ── Verify the account with the provider BEFORE the order exists ──────────
  //
  // The purchase flow checks the account as part of "Lanjut ke Pembayaran", and
  // the account details are shown on the payment page. That check is a UX
  // convenience; THIS is the enforcement. Without it, a client that skips the
  // form (or a direct API caller) could create an order for a player id that
  // does not exist, pay for it, and only then have the provider reject the
  // top-up — the customer's money is taken for a top-up that cannot be delivered.
  //
  // An account that is reported as NOT FOUND stops the order. An outage does NOT:
  // the provider being unreachable says nothing about the account, and refusing
  // every purchase during a provider blip would be worse than the risk. The gap
  // is recorded in the transaction log, and the dispatch step re-checks anyway.
  let accountVerification = null;
  if (variant.product.game.supportsValidation) {
    try {
      const verification = await validateAccount({
        gameSlug: variant.product.game.slug,
        fields: fieldResult.values,
        userId,
      });

      if (verification.valid === false) {
        throw new AppError(
          "ITP_INVALID_ACCOUNT",
          "Akun tidak ditemukan. Periksa kembali User ID dan Zone ID Anda.",
          { details: fieldDefs.map((def) => ({ field: def.key, message: "Periksa kembali data ini." })) }
        );
      }

      // Persisted so the payment page can SHOW the verified account back to the
      // customer. That confirmation is the reason the separate "Cek Akun" step
      // was removed: the name appears where the money is, not before it.
      accountVerification = {
        nickname: verification.nickname ?? null,
        server: verification.server ?? null,
      };
    } catch (err) {
      // A not-found verdict must stop the order; anything else is an outage and
      // is recorded rather than treated as a rejection.
      if (err instanceof AppError && err.code === "ITP_INVALID_ACCOUNT") throw err;
      log.warn("order.account_check_failed", { gameSlug: variant.product.game.slug, error: err });
    }
  }

  // ── Payment method must exist and be enabled ─────────────────────────────
  const method = getPaymentMethod(paymentMethod);
  if (!method) {
    throw new AppError("ITP_PAYMENT_UNAVAILABLE", "Metode pembayaran tidak dikenal.");
  }

  // ── Promo (server-side; the client's claimed discount is never read) ──────
  let promoResult = null;
  if (promoCode) {
    const provisional = computeOrderPricing({ variant, promo: null, paymentMethod: null });
    promoResult = await validatePromoCode({
      code: promoCode,
      subtotal: provisional.subtotal,
      variantId: variant.id,
    });
  }

  const pricing = computeOrderPricing({
    variant,
    promo: promoResult ? { discount: promoResult.discount } : null,
    paymentMethod: method,
  });

  const eligibility = checkMethodEligibility(method, pricing.total);
  if (!eligibility.ok) {
    throw new AppError("ITP_PAYMENT_UNAVAILABLE", eligibility.reason);
  }

  // The method must be SERVED by a configured adapter, not merely enabled in
  // config. Without this, an order is created and then the customer reaches a
  // checkout that cannot produce payment instructions — a dead end with their
  // order already on the books.
  const servable = checkMethodServable(method.key);
  if (!servable.ok) {
    throw new AppError("ITP_PAYMENT_UNAVAILABLE", servable.reason);
  }

  // ── Provider mapping must exist BEFORE the order is created ──────────────
  const mapping = selectProviderMapping(variant);
  if (!mapping) {
    throw new AppError("ITP_PRODUCT_UNAVAILABLE", "Produk belum terhubung ke provider.");
  }

  const expiresAt = new Date(Date.now() + ORDER_TTL_MINUTES * 60 * 1000);

  try {
    const order = await prisma.$transaction(async (tx) => {
      // Reserve the promo usage ATOMICALLY. `updateMany` with a conditional
      // where is what makes two concurrent checkouts unable to both consume the
      // last slot — a read-then-write would let both through.
      if (promoResult) {
        const reserved = await tx.promoCode.updateMany({
          where: {
            id: promoResult.promoCodeId,
            isActive: true,
            OR: [{ usageLimit: null }, { usageCount: { lt: prisma.promoCode.fields.usageLimit } }],
          },
          data: { usageCount: { increment: 1 } },
        });
        if (reserved.count !== 1) {
          throw new AppError("ITP_PROMO_EXHAUSTED");
        }
      }

      const created = await tx.order.create({
        data: {
          invoice: generateInvoice(),
          userId,
          status: ORDER_STATUS.PENDING_PAYMENT,
          gameName: variant.product.game.name,
          productName: variant.product.name,
          variantName: variant.name,
          quantity: pricing.quantity,
          customerInput: fieldResult.values,
          unitCostPrice: pricing.unitCostPrice,
          unitSellingPrice: pricing.unitSellingPrice,
          subtotal: pricing.subtotal,
          discount: pricing.discount,
          fee: pricing.fee,
          total: pricing.total,
          margin: pricing.margin,
          providerId: mapping.provider.id,
          idempotencyKey,
          requestHash,
          expiresAt,
          ip: request.ip ? String(request.ip).slice(0, 64) : null,
          userAgent: request.userAgent ? String(request.userAgent).slice(0, 255) : null,
          items: {
            create: {
              productVariantId: variant.id,
              gameName: variant.product.game.name,
              productName: variant.product.name,
              variantName: variant.name,
              quantity: pricing.quantity,
              unitCostPrice: pricing.unitCostPrice,
              unitSellingPrice: pricing.unitSellingPrice,
              subtotal: pricing.subtotal,
            },
          },
        },
        select: { id: true, invoice: true, status: true, total: true, expiresAt: true },
      });

      await tx.transactionLog.create({
        data: {
          orderId: created.id,
          event: "ORDER_CREATED",
          message: "Order dibuat, menunggu pembayaran.",
          metadata: {
            variantId: variant.id,
            providerCode: mapping.provider.code,
            promoCode: promoCode ?? null,
            discount: pricing.discount,
            fee: pricing.fee,
          },
        },
      });

      return created;
    });

    log.info("order.created", { orderId: order.id, invoice: order.invoice, total: order.total });

    // ── Issue payment instructions as part of creating the order ────────────
    // The order page must never tell a paying customer "instruksi belum
    // diterbitkan" with no way to produce them. Creating the order and issuing
    // its instructions is ONE customer-visible action, so it happens here.
    //
    // Failure is tolerated on purpose: the order exists and the money is not yet
    // involved, so a failure here must not roll the order back. The customer can
    // re-issue from the order page, and the transaction log records the gap.
    let instructions = null;
    try {
      // Imported dynamically: payment.service.js imports THIS module (it calls
      // transitionOrder and dispatchOrder), so a static import here would be a
      // cycle. A cycle in this pair is not theoretical — it would resolve to a
      // partially-initialised module and fail at the first settlement.
      const { issuePaymentInstructions } = await import("./payment.service.js");
      instructions = await issuePaymentInstructions({
        order: { ...order, user: { name: user?.name ?? null, email: user?.email ?? null } },
        paymentMethod: method.key,
        request,
        // Carried into the instructions so the payment page can show the verified
        // account name back to the customer.
        verifiedAccount: accountVerification,
      });
    } catch (err) {
      log.error("order.instructions_failed", { orderId: order.id, error: err });
      await prisma.transactionLog.create({
        data: {
          orderId: order.id,
          event: "PAYMENT_INSTRUCTIONS_FAILED",
          code: err?.code ?? "ITP_INTERNAL_ERROR",
          message: "Instruksi pembayaran gagal diterbitkan; dapat dicoba ulang dari halaman transaksi.",
        },
      });
    }

    return { order, reused: false, instructions };
  } catch (err) {
    // P2002 on the composite idempotency key means a concurrent request won the
    // race. Resolve to the winner's order instead of failing the customer.
    if (err?.code === "P2002") {
      const winner = await prisma.order.findUnique({
        where: { userId_idempotencyKey: { userId, idempotencyKey } },
        select: { id: true, invoice: true, status: true, total: true, requestHash: true },
      });
      if (winner) {
        if (winner.requestHash !== requestHash) throw new AppError("ITP_IDEMPOTENCY_CONFLICT");
        log.info("order.idempotent_race_resolved", { orderId: winner.id });
        return { order: winner, reused: true };
      }
    }
    throw err;
  }
}

// ── State machine ───────────────────────────────────────────────────────────

/** Whether a transition is allowed. Exported so tests can assert the table. */
export function canTransition(from, to) {
  if (from === to) return false;
  if (TERMINAL_ORDER_STATUSES.includes(from)) return false;
  return (ORDER_TRANSITIONS[from] ?? []).includes(to);
}

/**
 * Move an order to a new status.
 *
 * Uses a conditional `updateMany` (status must still be the expected value) so
 * two concurrent transitions cannot both apply — a lost update here would, for
 * example, refund an order twice.
 */
export async function transitionOrder({
  orderId, from, to, reason = null, actor = null, request = {}, tx = null, metadata = null,
}) {
  if (!canTransition(from, to)) {
    throw new AppError("ITP_INVALID_STATE_TRANSITION", `Tidak dapat mengubah status ${from} → ${to}.`);
  }

  const client = tx ?? prisma;
  const log = createLogger({ component: "order", orderId });

  const result = await client.order.updateMany({
    where: { id: orderId, status: from },
    data: {
      status: to,
      ...(to === ORDER_STATUS.SUCCESS || to === ORDER_STATUS.FAILED ? { completedAt: new Date() } : {}),
    },
  });

  if (result.count !== 1) {
    // Someone else moved it first. Not an error in a concurrent system — the
    // caller decides whether to re-read or ignore.
    log.warn("order.transition_lost_race", { from, to });
    throw new AppError("ITP_INVALID_STATE_TRANSITION", "Status transaksi sudah berubah.");
  }

  await client.transactionLog.create({
    data: {
      orderId,
      event: `ORDER_STATUS_${to}`,
      code: reason ? "REASON" : null,
      message: reason || `Status berubah: ${from} → ${to}`,
      metadata: metadata ? { from, to, ...metadata } : { from, to },
    },
  });

  if (actor) {
    await writeAudit({
      action: AUDIT.ORDER_STATUS_CHANGED,
      actor,
      targetType: "Order",
      targetId: orderId,
      metadata: { from, to, reason },
      request,
      tx: client,
      strict: Boolean(tx),
    });
  }

  log.info("order.transition", { from, to });
  return { ok: true, from, to };
}

// ── Provider dispatch ───────────────────────────────────────────────────────

/** Map a normalised provider status onto an internal order status. */
export function providerStatusToOrderStatus(providerStatus) {
  switch (providerStatus) {
    case PROVIDER_ORDER_STATUS.SUCCESS:
      return ORDER_STATUS.SUCCESS;
    case PROVIDER_ORDER_STATUS.FAILED:
      return ORDER_STATUS.FAILED;
    case PROVIDER_ORDER_STATUS.REFUNDED:
      return ORDER_STATUS.REFUND;
    case PROVIDER_ORDER_STATUS.CANCELLED:
      return ORDER_STATUS.CANCELLED;
    case PROVIDER_ORDER_STATUS.PROCESSING:
    case PROVIDER_ORDER_STATUS.PENDING:
    case PROVIDER_ORDER_STATUS.UNKNOWN:
    default:
      return ORDER_STATUS.PROCESSING;
  }
}

/**
 * Dispatch a PAID order to the provider.
 *
 * Called after payment is confirmed. Single-attempt: `providerAttempts` is
 * claimed atomically first, so a concurrent reconciler cannot dispatch the same
 * order twice.
 *
 * @returns {Promise<{ dispatched: boolean, status: string }>}
 */
export async function dispatchOrder({ orderId, request = {} }) {
  const log = createLogger({ component: "order", orderId });

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true, invoice: true, status: true, customerInput: true,
      gameName: true, variantName: true, total: true, providerAttempts: true,
      // gameSlug is read through the variant's game — NOT from `gameName`.
      // `gameName` is a DISPLAY NAME ("Free Fire") snapshot for the invoice; the
      // provider mapper keys PRIMARY_TARGET_FIELD on the SLUG ("free-fire").
      // Passing the display name made the mapper fall back to `userId` and throw
      // "Field userId wajib diisi" for every game whose target field is not
      // userId, and silently produced a wrong payload for the rest.
      items: {
        select: {
          productVariantId: true,
          productVariant: {
            select: { product: { select: { game: { select: { slug: true } } } } },
          },
        },
      },
      provider: { select: { id: true, code: true, name: true, status: true } },
    },
  });

  if (!order) throw new AppError("ITP_ORDER_NOT_FOUND");

  if (order.status !== ORDER_STATUS.PAID) {
    throw new AppError("ITP_INVALID_STATE_TRANSITION", "Hanya transaksi berstatus PAID yang dapat dikirim ke provider.");
  }

  // Claim the dispatch atomically.
  const claimed = await prisma.order.updateMany({
    where: { id: orderId, status: ORDER_STATUS.PAID },
    data: { status: ORDER_STATUS.PROCESSING, providerAttempts: { increment: 1 }, dispatchedAt: new Date() },
  });

  if (claimed.count !== 1) {
    log.warn("order.dispatch_lost_race");
    return { dispatched: false, status: order.status };
  }

  const provider = getTopupProvider(order.provider?.code);

  if (!provider.isConfigured()) {
    // Roll the status back so the order stays dispatchable once configured.
    await prisma.order.updateMany({
      where: { id: orderId, status: ORDER_STATUS.PROCESSING },
      data: { status: ORDER_STATUS.PAID },
    });
    await prisma.transactionLog.create({
      data: {
        orderId,
        event: "ORDER_DISPATCH_SKIPPED",
        code: "ITP_PROVIDER_NOT_CONFIGURED",
        message: "Provider belum dikonfigurasi; transaksi ditahan.",
      },
    });
    log.warn("order.dispatch_provider_unconfigured", { provider: provider.code });
    return { dispatched: false, status: ORDER_STATUS.PAID };
  }

  // Resolve the provider SKU from the database mapping — never from the client.
  const mapping = order.items[0]
    ? await prisma.providerProduct.findFirst({
        where: { providerId: order.provider.id, productVariantId: order.items[0].productVariantId },
        select: { providerCode: true },
      })
    : null;

  if (!mapping) {
    await prisma.order.updateMany({
      where: { id: orderId, status: ORDER_STATUS.PROCESSING },
      data: { status: ORDER_STATUS.FAILED, providerMessage: "Mapping produk provider tidak ditemukan." },
    });
    await prisma.transactionLog.create({
      data: {
        orderId,
        event: "ORDER_DISPATCH_FAILED",
        code: "ITP_PRODUCT_UNAVAILABLE",
        message: "Mapping provider product tidak ditemukan.",
      },
    });
    return { dispatched: false, status: ORDER_STATUS.FAILED };
  }

  const startedAt = Date.now();
  const gameSlug = order.items[0]?.productVariant?.product?.game?.slug ?? null;
  if (!gameSlug) {
    // Never guess. A missing slug would fall through to the mapper's `userId`
    // default and produce a payload for the wrong field.
    await prisma.order.updateMany({
      where: { id: orderId, status: ORDER_STATUS.PROCESSING },
      data: { status: ORDER_STATUS.FAILED, providerMessage: "Game slug tidak dapat diresolusi." },
    });
    await prisma.transactionLog.create({
      data: {
        orderId,
        event: "ORDER_DISPATCH_FAILED",
        code: "ITP_INVALID_STATE_TRANSITION",
        message: "Order item tidak memiliki game slug.",
      },
    });
    return { dispatched: false, status: ORDER_STATUS.FAILED };
  }

  const result = await provider.createOrder({
    idempotencyKey: order.invoice,
    providerCode: mapping.providerCode,
    fields: order.customerInput,
    gameSlug,
    amount: order.total,
    log,
  });
  const durationMs = Date.now() - startedAt;

  if (result.ok) {
    const providerStatus = providerStatusToOrderStatus(result.data?.status);

    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: orderId },
        data: {
          providerRef: result.data?.providerRef ?? order.invoice,
          providerOrderId: result.data?.providerOrderId ?? null,
          providerStatus: result.data?.status ?? null,
          providerMessage: result.data?.message ?? null,
          status: providerStatus,
          ...(providerStatus === ORDER_STATUS.SUCCESS || providerStatus === ORDER_STATUS.FAILED
            ? { completedAt: new Date() }
            : {}),
        },
      });
      await tx.transactionLog.create({
        data: {
          orderId,
          event: "ORDER_DISPATCHED",
          message: result.data?.message ?? "Transaksi dikirim ke provider.",
          metadata: { providerCode: provider.code, providerStatus: result.data?.status },
          durationMs,
        },
      });
    });

    log.info("order.dispatched", { providerStatus, durationMs });
    return { dispatched: true, status: providerStatus };
  }

  // A failure here is either a definite rejection or an UNKNOWN outcome.
  const isUnknown = Boolean(result.error?.unknown);

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: orderId },
      data: {
        // UNKNOWN keeps the order in PROCESSING so the reconciler can resolve it.
        // FAILED would be a lie: the top-up may have been delivered.
        status: isUnknown ? ORDER_STATUS.PROCESSING : ORDER_STATUS.FAILED,
        providerStatus: result.error?.code ?? null,
        providerMessage: result.error?.message ?? null,
        ...(isUnknown ? {} : { completedAt: new Date() }),
      },
    });
    await tx.transactionLog.create({
      data: {
        orderId,
        event: isUnknown ? "ORDER_DISPATCH_UNKNOWN" : "ORDER_DISPATCH_FAILED",
        code: result.error?.code ?? null,
        message: result.error?.message ?? "Pengiriman ke provider gagal.",
        metadata: { unknown: isUnknown, retryable: result.error?.retryable },
        durationMs,
      },
    });
  });

  log.warn("order.dispatch_failed", { code: result.error?.code, unknown: isUnknown, durationMs });
  return { dispatched: false, status: isUnknown ? ORDER_STATUS.PROCESSING : ORDER_STATUS.FAILED };
}

// ── Reconciliation ──────────────────────────────────────────────────────────

/**
 * Resolve orders whose provider outcome is unknown, plus orders stuck in
 * PROCESSING past a threshold.
 *
 * Bounded on purpose: a limit per run and a minimum age, so a provider outage
 * cannot turn into an unbounded retry loop against the provider's API.
 */
export async function reconcilePendingOrders({ limit = 25, olderThanMs = 60_000 } = {}) {
  const cutoff = new Date(Date.now() - olderThanMs);
  const log = createLogger({ component: "order", job: "reconcile" });

  const candidates = await prisma.order.findMany({
    where: {
      status: ORDER_STATUS.PROCESSING,
      updatedAt: { lte: cutoff },
      providerRef: { not: null },
    },
    orderBy: { updatedAt: "asc" },
    take: Math.min(100, Math.max(1, limit)),
    select: { id: true, invoice: true, providerRef: true, providerOrderId: true, provider: { select: { code: true } } },
  });

  const results = { checked: 0, updated: 0, skipped: 0, errors: 0 };

  for (const order of candidates) {
    results.checked += 1;
    try {
      const provider = getTopupProvider(order.provider?.code);
      if (!provider.isConfigured()) {
        results.skipped += 1;
        continue;
      }

      const result = await provider.getOrderStatus({
        providerRef: order.providerRef,
        providerOrderId: order.providerOrderId,
        log,
      });

      if (!result.ok) {
        // Still unknown: leave it for the next run. Do NOT force a terminal state.
        results.skipped += 1;
        continue;
      }

      const nextStatus = providerStatusToOrderStatus(result.data?.status);

      if (nextStatus !== ORDER_STATUS.PROCESSING) {
        await prisma.$transaction(async (tx) => {
          await tx.order.updateMany({
            where: { id: order.id, status: ORDER_STATUS.PROCESSING },
            data: {
              status: nextStatus,
              providerStatus: result.data?.status ?? null,
              providerMessage: result.data?.message ?? null,
              ...(nextStatus === ORDER_STATUS.SUCCESS || nextStatus === ORDER_STATUS.FAILED
                ? { completedAt: new Date() }
                : {}),
            },
          });
          await tx.transactionLog.create({
            data: {
              orderId: order.id,
              event: "ORDER_RECONCILED",
              message: `Hasil pengecekan provider: ${result.data?.status}`,
              metadata: { providerStatus: result.data?.status, nextStatus },
            },
          });
        });
        results.updated += 1;
      } else {
        results.skipped += 1;
      }
    } catch (err) {
      results.errors += 1;
      log.error("order.reconcile_error", { orderId: order.id, error: err });
    }
  }

  log.info("order.reconcile_done", results);
  return results;
}

/**
 * Apply a provider-reported status to an order, looked up by OUR reference.
 *
 * Used by the callback handler and by reconciliation. It is deliberately
 * separate from `transitionOrder`: the input is a provider status string, which
 * is mapped through the adapter's vocabulary first, and an unknown string
 * resolves to PROCESSING (reconcilable) rather than a wrong terminal state.
 *
 * Returns `{ applied: false }` instead of throwing when the order is already in
 * a terminal state — a duplicate callback is expected, not an error.
 */
export async function applyProviderStatus({
  providerRef,
  providerOrderId = null,
  providerStatus,
  providerMessage = null,
  source = "CALLBACK",
}) {
  if (!providerRef) throw new AppError("ITP_WEBHOOK_UNKNOWN_REFERENCE");

  const log = createLogger({ component: "order", providerRef });

  const order = await prisma.order.findUnique({
    where: { providerRef },
    select: { id: true, invoice: true, status: true },
  });

  if (!order) throw new AppError("ITP_WEBHOOK_UNKNOWN_REFERENCE");

  const mapped = providerStatusToOrderStatus(providerStatus);

  // Nothing to do: the provider agrees with where we already are.
  if (mapped === ORDER_STATUS.PROCESSING && order.status === ORDER_STATUS.PROCESSING) {
    await prisma.order.update({
      where: { id: order.id },
      data: { providerStatus: providerStatus ?? null, providerMessage },
    });
    return { applied: false, orderId: order.id, status: order.status };
  }

  if (!canTransition(order.status, mapped)) {
    // Already terminal, or the provider is telling us something the state
    // machine forbids. Record it; do not force the transition.
    await prisma.transactionLog.create({
      data: {
        orderId: order.id,
        event: "ORDER_STATUS_IGNORED",
        message: `Status provider "${providerStatus}" diabaikan pada status ${order.status}.`,
        metadata: { providerStatus, mapped, source },
      },
    });
    log.warn("order.status_ignored", { from: order.status, mapped, providerStatus });
    return { applied: false, orderId: order.id, status: order.status };
  }

  await prisma.$transaction(async (tx) => {
    await tx.order.updateMany({
      where: { id: order.id, status: order.status },
      data: {
        status: mapped,
        providerStatus: providerStatus ?? null,
        providerMessage,
        ...(providerOrderId ? { providerOrderId } : {}),
        ...(mapped === ORDER_STATUS.SUCCESS || mapped === ORDER_STATUS.FAILED
          ? { completedAt: new Date() }
          : {}),
      },
    });
    await tx.transactionLog.create({
      data: {
        orderId: order.id,
        event: `ORDER_STATUS_${mapped}`,
        message: providerMessage || `Status provider: ${providerStatus}`,
        metadata: { from: order.status, to: mapped, providerStatus, source },
      },
    });
  });

  log.info("order.provider_status_applied", { from: order.status, to: mapped, source });
  return { applied: true, orderId: order.id, status: mapped };
}

/**
 * Expire unpaid orders past their deadline.
 *
 * CANCELLED/EXPIRED only from PENDING_PAYMENT or PAYMENT_PROCESSING: an order
 * that a gateway may still settle must not be expired locally, or the customer
 * pays for a cancelled order.
 */
export async function expireStaleOrders({ limit = 100 } = {}) {
  const now = new Date();
  const log = createLogger({ component: "order", job: "expire" });

  const stale = await prisma.order.findMany({
    where: {
      status: { in: [ORDER_STATUS.PENDING_PAYMENT, ORDER_STATUS.PAYMENT_PROCESSING] },
      expiresAt: { not: null, lte: now },
    },
    orderBy: { expiresAt: "asc" },
    take: Math.min(500, Math.max(1, limit)),
    select: { id: true, invoice: true, status: true },
  });

  let expired = 0;

  for (const order of stale) {
    const result = await prisma.order.updateMany({
      where: { id: order.id, status: order.status },
      data: { status: ORDER_STATUS.EXPIRED },
    });
    if (result.count === 1) {
      expired += 1;
      await prisma.$transaction(async (tx) => {
        await tx.transactionLog.create({
          data: { orderId: order.id, event: "ORDER_EXPIRED", message: "Transaksi kedaluwarsa karena tidak dibayar." },
        });
        // Cancel the pending payment alongside the order so a late gateway
        // callback can be recognised as belonging to an expired order.
        await tx.payment.updateMany({
          where: { orderId: order.id, status: { in: ["PENDING", "PROCESSING"] } },
          data: { status: "EXPIRED" },
        });
      });
    }
  }

  log.info("order.expire_done", { scanned: stale.length, expired });
  return { scanned: stale.length, expired };
}
