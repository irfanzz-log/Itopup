// ============================================================================
// Order service, the transactional core.
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
  AUDIT, ORDER_STATUS, ORDER_TRANSITIONS, PAYMENT_STATUS, PAYMENT_STATUS_LABEL, TERMINAL_ORDER_STATUSES,
} from "../lib/constants.js";
import { ORDER_TTL_MINUTES } from "../lib/env.server.js";
import { validateFields, secretFieldKeys } from "../config/input-fields.js";
import { phoneMatchesOperator, operatorOfPhone, OPERATOR_DISPLAY_NAME } from "../config/operators.js";
import { computePaymentFee, getPaymentMethod, checkMethodEligibility } from "../config/payment.js";
import { unitMargin } from "../config/pricing.js";
import { getPaymentProvider } from "../providers/payment/index.js";
import { PAYMENT_ERROR } from "../providers/payment/contract.js";
import { getSellableVariant, selectProviderMapping } from "./catalog.service.js";
import {
  validatePromoCode,
  validateVoucherClaim,
  resolveAutoDiscount,
  redeemVoucherClaim,
} from "./promo.service.js";
import { writeAudit } from "./audit.service.js";
import { validateAccount } from "./provider.service.js";
import { resolveForDispatch, saveGameCredential } from "./credential.service.js";
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

// ── Pricing (pure, unit tested without a database) ─────────────────────────

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

/** Projection for a member's own order list: no cost, no provider internals. */
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
  // it. That is the IDOR protection, enforced by the query shape rather than by
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
 * indistinguishable from a missing row, so an attacker cannot probe which order
 * ids exist.
 *
 * Expiry is checked as part of the read: a customer who opens an order past its
 * payment window sees it closed (and the gateway charge cancelled) rather than
 * a "Menunggu pembayaran" that cannot be completed.
 */

/**
 * Close this user's order if its payment window has passed.
 *
 * A read-path version of the expiry sweep: the customer opened the order page,
 * and the order may be past its deadline. Reads the deadline the gateway
 * actually honours (`payment.expiresAt`, Midtrans's own window) and falls back
 * to the order's window when no instrument was ever issued.
 *
 * The gateway charge is cancelled by `closeStaleOrder`; that is the half the
 * old code was missing, and why Midtrans kept showing pending.
 *
 * @param {{ userId: string, orderId?: string, invoice?: string }} args
 */
async function expireUserOrder({ userId, orderId, invoice }) {
  const where = invoice ? { invoice, userId } : { id: orderId, userId };
  const order = await prisma.order.findFirst({
    where,
    select: {
      id: true,
      invoice: true,
      status: true,
      expiresAt: true,
      payment: { select: { expiresAt: true } },
    },
  });

  // Not found, or already closed/settled: nothing to do. A 404 stays a 404;
  // this must not turn "order tidak ada" into "order berhasil di-expire".
  if (!order) return;
  if (
    order.status !== ORDER_STATUS.PENDING_PAYMENT &&
    order.status !== ORDER_STATUS.PAYMENT_PROCESSING
  ) {
    return;
  }

  // The deadline the gateway honours wins over our own order window: QRIS gives
  // 15 minutes against our 60-minute order TTL, and the QR is what the customer
  // actually has to pay.
  const deadline = order.payment?.expiresAt ?? order.expiresAt;
  if (!deadline) return;
  if (new Date(deadline).getTime() > Date.now()) return;

  await closeStaleOrder(order, {
    log: createLogger({ component: "order", userId, job: "expire-read" }),
  });
}

export async function getOrderForUser({ orderId, userId, invoice = null }) {
  const where = invoice ? { invoice, userId } : { id: orderId, userId };

  // ── Close the order if its payment window has passed, before it is read. ──
  //
  // THE BUG THIS FIXES: the sweep only ran at checkout. A customer who opened
  // the order page after the deadline saw "Menunggu pembayaran" on an order that
  // could no longer be paid, sometimes for hours, and the Midtrans charge
  // stayed pending on the dashboard because nothing ever cancelled it. Expiry
  // must be checked at the moment the customer looks at the order, not just
  // when they buy something new.
  //
  // Scoped to this one user (the read is theirs anyway); the global sweep is the
  // cron-shaped version. This reads the payment window from the payment row when
  // present (the deadline Midtrans actually honours) and falls back to the order
  // window.
  await expireUserOrder({ userId, invoice, orderId });

  // THE CUSTOMER SEES ONLY WHAT THEY CAN ACT ON.
  //
  // The transaction log records every internal step, including gateway chatter
  // the customer cannot use: "payment gateway reported terminal state",
  // "provider status applied", "dispatch skipped". Those answer operational
  // questions ("did the reconcile job run?") and carry provider names and
  // status codes a buyer has no context for. Showing them is how a support line
  // gets asked "apa itu PAYMENT_GATEWAY_TERMINAL?".
  //
  // This whitelist keeps the milestones the customer can actually act on:
  // created, paid, the provider's attempt, and the outcome. Everything else is
  // still written for the operator's dashboard; it is just not shown here.
  const CUSTOMER_LOG_EVENTS = new Set([
    "ORDER_CREATED",
    "ORDER_EXPIRED",
    "ORDER_CANCELLED",
    "PAYMENT_INSTRUCTIONS_ISSUED",
    "PAYMENT_PAID",
    "PAYMENT_SETTLED",
    "ORDER_DISPATCHED",
    "ORDER_DISPATCH_FAILED",
    "ORDER_RECONCILED",
  ]);

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

  // Drop the gateway chatter the customer cannot act on (see CUSTOMER_LOG_EVENTS
  // above). Done here rather than in Prisma because the whitelist is a
  // presentation concern; the operator's view of the same order keeps every row.
  if (Array.isArray(order.logs)) {
    order.logs = order.logs.filter((entry) => CUSTOMER_LOG_EVENTS.has(entry.event));
  }

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
 * A key for a re-order that must not collide with the row it replaces.
 *
 * The checkout key is derived from the payload (`src/lib/checkout-key.js`), so
 * it is identical for an identical purchase, which is correct for double-click
 * protection, and wrong once the first order has been cancelled: the cancelled
 * row still occupies its slot in `@@unique([userId, idempotencyKey])` and the
 * insert would throw P2002. Appending a counter reads how many prior orders
 * share that base key and steps over them, so each abandon/re-order cycle
 * (including a third and a fourth) gets its own slot.
 *
 * The caller validates the shape of the key against `^[A-Za-z0-9._:-]{16,80}$`
 * before reaching here, and the suffix keeps the result well inside that bound.
 */
async function reorderIdempotencyKey(baseKey, userId) {
  const prefix = String(baseKey).slice(0, 56);
  const taken = await prisma.order.count({
    where: { userId, idempotencyKey: { startsWith: prefix } },
  });
  return `${prefix}-r${taken + 1}`;
}

/**
 * Release an abandoned order: mark it CANCELLED, void the instrument at the
 * gateway so a late settlement cannot land on it, and record why.
 *
 * Only called for orders that are still PENDING_PAYMENT/PAYMENT_PROCESSING; a
 * PAID order never reaches this path (`createOrder` honours a replay against a
 * paid or processing order instead). The gateway call is best-effort: if the
 * provider is unreachable the order is still cancelled locally, because keeping
 * the customer stuck on an unpayable order is worse than a charge that already
 * has no place to settle.
 *
 * @param {{ id: string, invoice: string, status: string }} order
 * @param {{ log?: object }} [ctx]
 */
async function cancelStaleOrder(order, { log } = {}) {
  // Void the instrument FIRST, while the order is still open. The status update
  // below closes the door; reversing the order would leave a window in which a
  // late callback saw an open order.
  const payment = await prisma.payment.findUnique({
    where: { orderId: order.id },
    select: { reference: true, externalId: true, providerCode: true },
  });
  const provider = payment?.providerCode ? safeGetPaymentProvider(payment.providerCode) : null;

  if (provider && payment?.reference) {
    try {
      const cancelled = await provider.cancelPayment(
        { reference: payment.reference, externalId: payment.externalId ?? undefined, reason: "ORDER_ABANDONED" },
        { log }
      );
      if (!cancelled.ok && cancelled.error?.code !== PAYMENT_ERROR.REJECTED) {
        log?.warn?.("order.cancel_gateway_failed", {
          orderId: order.id,
          reference: payment.reference,
          code: cancelled.error?.code,
        });
      }
    } catch (err) {
      // Unreachable provider must not stop the local cancellation.
      log?.warn?.("order.cancel_gateway_threw", {
        orderId: order.id,
        message: String(err?.message ?? err).slice(0, 200),
      });
    }
  }

  await prisma.$transaction(async (tx) => {
    // Covers PENDING_PAYMENT/PAYMENT_PROCESSING (abandoned but open) AND
    // EXPIRED (already closed by the sweep above): the replacement path must
    // work either way, and re-running this on an already-expired order is the
    // no-op it should be. A PAID order never reaches here.
    const result = await tx.order.updateMany({
      where: {
        id: order.id,
        status: {
          in: [
            ORDER_STATUS.PENDING_PAYMENT,
            ORDER_STATUS.PAYMENT_PROCESSING,
            ORDER_STATUS.EXPIRED,
          ],
        },
      },
      data: { status: ORDER_STATUS.CANCELLED },
    });
    if (result.count !== 1) return;

    await tx.transactionLog.create({
      data: {
        orderId: order.id,
        event: "ORDER_CANCELLED",
        message: "Dibatalkan otomatis: pelanggan membuat ulang transaksi yang sama.",
      },
    });
    // Expire the payment row too, so a late gateway callback recognises it as
    // belonging to a cancelled order rather than an open one.
    await tx.payment.updateMany({
      where: { orderId: order.id, status: { in: [PAYMENT_STATUS.PENDING, PAYMENT_STATUS.PROCESSING] } },
      data: { status: PAYMENT_STATUS.EXPIRED },
    });
  });
}

/**
 * Resolve the payment provider for a cancellation, or null when the adapter is
 * unconfigured or unknown (an order created before the mapping existed, a
 * provider since removed). Null means "no gateway call", never "abort".
 */
function safeGetPaymentProvider(providerCode) {
  try {
    return getPaymentProvider(providerCode) ?? null;
  } catch {
    return null;
  }
}

/**
 * Expire THIS user's orders past their deadline.
 *
 * The global sweep (`expireStaleOrders`) is the cron-shaped version; this one
 * runs on the customer's own checkout path, scoped to them, because those are
 * the only rows whose state decides what this request does next. It cancels the
 * payment too so a late gateway callback sees an expired order, not an open one.
 *
 * @param {{ userId: string, log?: object }} args
 */
async function expireOwnStaleOrders({ userId, log } = {}) {
  const now = new Date();
  const stale = await prisma.order.findMany({
    where: {
      userId,
      status: { in: [ORDER_STATUS.PENDING_PAYMENT, ORDER_STATUS.PAYMENT_PROCESSING] },
      expiresAt: { not: null, lte: now },
    },
    orderBy: { expiresAt: "asc" },
    take: 50,
    select: { id: true, invoice: true, status: true },
  });

  if (!stale.length) return 0;

  for (const order of stale) {
    // The conditional update is the optimistic lock: if a webhook reconciled
    // this order between the read and the write, count !== 1 and it is left
    // alone. A status that moved means the gateway may still settle it.
    await prisma.$transaction(async (tx) => {
      const result = await tx.order.updateMany({
        where: { id: order.id, status: order.status },
        data: { status: ORDER_STATUS.EXPIRED },
      });
      if (result.count !== 1) return;

      await tx.transactionLog.create({
        data: {
          orderId: order.id,
          event: "ORDER_EXPIRED",
          message: "Kedaluwarsa: batas waktu pembayaran terlewati.",
        },
      });
      await tx.payment.updateMany({
        where: { orderId: order.id, status: { in: [PAYMENT_STATUS.PENDING, PAYMENT_STATUS.PROCESSING] } },
        data: { status: PAYMENT_STATUS.EXPIRED },
      });
    });
  }

  log?.info?.("order.expired_stale", { userId, count: stale.length });
  return stale.length;
}

/**
 * Which field key carries the login identifier, for a game that needs one.
 *
 * @param {Array<{key:string,isCredentialLogin?:boolean}>} fieldDefs
 * @returns {string|null}
 */
function loginFieldKey(fieldDefs) {
  if (!Array.isArray(fieldDefs)) return null;
  return fieldDefs.find((f) => f.isCredentialLogin)?.key ?? null;
}

/**
 * Copy only the named keys off a source object. Used for the secret half of a
 * game login: the raw request is the only place it exists, and this is the only
 * reader.
 *
 * @param {Record<string,string>} source
 * @param {string[]} keys
 * @returns {Record<string,string>}
 */
function pickKeys(source, keys) {
  const out = {};
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === "string" && value) out[key] = value;
  }
  return out;
}

/**
 * Assemble the field object the provider call will receive for a needsGameLogin
 * game: the validated public fields, plus the resolved login and secret.
 *
 * The result lives in memory for the one dispatch call that needs it. It is
 * never assigned to the order row, never logged, never serialised into an API
 * response.
 *
 * @param {{
 *   stored: Record<string,string>,
 *   secretKeys: string[],
 *   loginKey: string|null,
 *   loginValue: string,
 *   secretValues: Record<string,string>,
 *   resolvedSecret: string|null,
 * }} input
 * @returns {Record<string,string>}
 */
function withResolvedCredential({ stored, secretKeys, loginKey, loginValue, secretValues, resolvedSecret }) {
  const out = { ...stored };

  // The login the provider is given. A stored login wins over a typed one: the
  // customer selected that row, so its login is authoritative.
  if (loginKey && loginValue) out[loginKey] = loginValue;

  for (const key of secretKeys) {
    // A decrypted stored secret is used when present; otherwise the secret the
    // customer typed in this request. Exactly one of the two is set; the
    // caller guarantees a needsGameLogin request carries one of them.
    const value = resolvedSecret || secretValues[key];
    if (value) out[key] = value;
  }

  return out;
}

/**
 * Create an order from a validated checkout request.
 *
 * @param {{ userId: string, input: object, request?: object }} args
 * @returns {Promise<{ order: object, reused: boolean }>}
 */
export async function createOrder({ userId, input, request = {}, user = null }) {
  const {
    variantId,
    fields,
    promoCode,
    voucherClaimId,
    paymentMethod,
    credentialId,
    saveCredential,
  } = input;
  const log = createLogger({ component: "order", userId });

  // A claim id and a code both name a promo. Only one may drive the order.
  if (voucherClaimId && promoCode) {
    throw new AppError("ITP_INVALID_INPUT", "Gunakan kode promo ATAU voucher, tidak keduanya.");
  }

  // ── Game-login credentials ────────────────────────────────────────────────
  //
  // A `needsGameLogin` game (eFootball) requires the customer's own account
  // login. The secret arrives under `fields.gamePassword`; it is validated
  // against the game's field contract below, then handled HERE, before the
  // order row exists, so the plaintext is never written anywhere.
  //
  // The secret is resolved into an in-memory value that the dispatch step reads
  // later, and the row id (never the secret) is stored on the order. When the
  // customer reuses a stored login, the plaintext is decrypted from that row at
  // dispatch time instead; in both cases the plaintext lives only for the one
  // provider call that needs it.
  let resolvedCredential = null;

  if (credentialId) {
    // Reusing a stored login. Scoped to this user by the credential service, so
    // an id belonging to somebody else is not found.
    resolvedCredential = await resolveForDispatch({ userId, credentialId });
  }

  const requestHash = hashCheckoutRequest({ variantId, fields, promoCode, paymentMethod });

  // ── Expire abandoned orders BEFORE the idempotency lookup ──────────────────
  //
  // Nothing else runs `expireStaleOrders()` on a timer yet, and the customer
  // should never see a status that is hours stale. Running it here, on the read
  // path that matters, keeps the row that the idempotency lookup is about to
  // fetch honest: a re-order against an abandoned purchase finds an already
  // EXPIRED order (an honourable replay) instead of a "Menunggu Pembayaran"
  // row that died an hour ago.
  //
  // Scoped to THIS user: a global sweep belongs in a cron job, and on a checkout
  // request the only orders whose state affects the outcome are this customer's.
  await expireOwnStaleOrders({ userId, log });

  // ── Fresh key when this order REPLACES an abandoned one ────────────────────
  // (Set in the lookup below, when the old order is cancelled. The insert uses
  // this variable, so it picks the replacement key up automatically.)
  let idempotencyKey = input.idempotencyKey;

  // ── Idempotency: look up an existing order for this key FIRST ─────────────
  const existing = await prisma.order.findUnique({
    where: { userId_idempotencyKey: { userId, idempotencyKey } },
    select: { id: true, invoice: true, status: true, total: true, requestHash: true },
  });

  if (existing) {
    // ── Is the existing order still one the customer can actually pay? ──────
    //
    // "Payable" = open AND it holds a payment row. A row is missing when the
    // charge failed at checkout (`PAYMENT_INSTRUCTIONS_FAILED`); the order is
    // nominally open but can never be paid, so a re-order must replace it
    // rather than send the customer back to a dead checkout.
    const isOpen =
      existing.status === ORDER_STATUS.PENDING_PAYMENT ||
      existing.status === ORDER_STATUS.PAYMENT_PROCESSING;

    const payable =
      isOpen &&
      Boolean(
        await prisma.payment.findUnique({
          where: { orderId: existing.id },
          select: { id: true },
        })
      );

    if (payable) {
      // A double click or a network retry lands here: the same purchase, a live
      // order, so point the customer back at it; that is the point of the key.
      if (existing.requestHash !== requestHash) {
        // Same key, DIFFERENT purchase, against a live order: refuse rather than
        // silently returning an order the customer did not ask for.
        log.warn("order.idempotency_conflict", { orderId: existing.id });
        throw new AppError("ITP_IDEMPOTENCY_CONFLICT");
      }
      log.info("order.idempotent_replay", { orderId: existing.id, invoice: existing.invoice });
      return { order: existing, reused: true };
    }

    // ── Not payable: the old order is closed, or open-but-broken. Replace it.
    //
    // THE BUG THIS KILLS
    //
    // The idempotency key is derived from the checkout payload
    // (src/lib/checkout-key.js), so the same nominal + same account number +
    // same payment method always produce the same key. Before this branch
    // existed, that meant re-ordering a top-up you abandoned earlier sent you
    // back to the old order, still marked "Menunggu Pembayaran" hours after
    // the payment window closed, or with no payment row at all, instead of
    // starting a fresh transaction. The charge at Midtrans was dead or never
    // created, but the order blocked the purchase until its TTL expired.
    //
    // This is the checkout pattern every e-commerce platform converges on: an
    // unpaid order is a reservation, not an entitlement. The reservation is
    // released (cancelled at the gateway too, so a stray late settlement cannot
    // land on it) and a new order is created with a new window.
    //
    // The request-hash conflict check does NOT apply here: the order being
    // replaced cannot serve the purchase, so its stored hash says nothing about
    // whether this request should be allowed. Refusing on that comparison is
    // what dead-ends the customer on "Permintaan tidak cocok".
    //
    // A PAID order never reaches this path: it is payable, and replayed above,
    // so a re-order can never cancel a paid order.
    await cancelStaleOrder(existing, { log });
    idempotencyKey = await reorderIdempotencyKey(input.idempotencyKey, userId);
    log.info("order.replacing_unpaid", {
      orderId: existing.id,
      invoice: existing.invoice,
      status: existing.status,
      reason: isOpen ? "no_payment_row" : "closed",
    });
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

  // ── Phone must belong to the selected operator ────────────────────────────
  //
  // The customer picks the operator as a product (PRODUCT_SEED.pulsa), then
  // types the number. Without this check a customer who picked Indosat and
  // typed a Telkomsel number would sail through validation, get a payment, and
  // only fail at the provider, after the money was already taken.
  //
  // It runs AFTER validateFields so the number is already known-good in shape;
  // a malformed number reports the shape error, not the operator mismatch.
  if (fieldDefs.some((d) => d.key === "phoneNumber")) {
    const phone = fieldResult.values.phoneNumber;
    const operator = variant.product.slug; // the operator IS the product.
    if (phone && operator && !phoneMatchesOperator(phone, operator)) {
      const expected = OPERATOR_DISPLAY_NAME[operator] || operator;
      const actual = OPERATOR_DISPLAY_NAME[operatorOfPhone(phone)] || "operator lain";
      throw new AppError("ITP_PHONE_OPERATOR_MISMATCH", `Nomor ini bukan nomor ${expected}.`, {
        details: [
          {
            field: "phoneNumber",
            message: `Nomor ini terdeteksi sebagai nomor ${actual}, bukan ${expected}. Pilih produk ${actual} atau ganti nomornya.`,
          },
        ],
      });
    }
  }

  // ── Resolve the game-login secret (needsGameLogin games only) ─────────────
  //
  // `validateFields` ran the same length/pattern rules on the secret as on
  // every other field, but returned `values` WITHOUT it (see secretFieldKeys).
  // The plaintext therefore never reaches the order row, the request hash, or
  // any log line produced from those objects.
  //
  // Two sources, resolved to the same in-memory shape:
  //   * typed now → `fields.gamePassword`, stored before the order is created
  //     when `saveCredential` is set,
  //   * a stored login the customer picked → decrypted here, and its row id is
  //     what the order remembers.
  //
  // For a game that does not need a login there is nothing to do: `fields`
  // carries no secret key, and this whole block is skipped.
  const needsGameLogin = Boolean(variant.product.game.needsGameLogin);
  const secretDefs = secretFieldKeys(fieldDefs);
  let pendingCredentialId = resolvedCredential?.id ?? credentialId ?? null;

  // The fields dispatch will send to the provider. For every game except a
  // needsGameLogin one this is exactly what the customer typed and validated.
  // For a login game it additionally carries the resolved secret, in memory
  // only; `fieldResult.values` omits it by construction, so nothing else in
  // this function that reads `fieldResult.values` can ever see it.
  let resolvedFields = fieldResult.values;

  if (needsGameLogin) {
    if (!resolvedCredential) {
      // A needsGameLogin game must send the secret. The field is declared on the
      // game, so a client that omits it is a broken client, not a special case.
      const hasSecret = secretDefs.some((key) => fields?.[key]);
      if (!hasSecret) {
        throw new AppError("ITP_INVALID_INPUT", "Password akun game wajib diisi untuk layanan ini.", {
          details: secretDefs.map((key) => ({ field: key, message: "Password akun game wajib diisi." })),
        });
      }
    }

    // Store the login the customer just typed, when they opted in. The login
    // stays readable (it is how they recognise the row); only the secret is
    // encrypted, inside the credential service.
    if (saveCredential && !resolvedCredential) {
      const loginKey = loginFieldKey(fieldDefs);
      const loginValue = fieldResult.values[loginKey] ?? "";
      const secretValue = secretDefs.map((k) => fields?.[k]).find((v) => Boolean(v)) ?? "";
      if (!loginValue) {
        throw new AppError("ITP_INVALID_INPUT", "Login akun game wajib diisi untuk menyimpannya.");
      }
      resolvedCredential = await saveGameCredential({
        userId,
        gameId: variant.product.game.id,
        login: loginValue,
        secret: secretValue,
      });
      pendingCredentialId = resolvedCredential.id;
    }

    // Inject the resolved secret into the in-memory dispatch payload. This is
    // the ONLY place the plaintext and the validated fields meet. The order row
    // gets `fieldResult.values` (no secret) + `credentialId`; the provider call
    // gets `resolvedFields` (with it).
    resolvedFields = withResolvedCredential({
      stored: fieldResult.values,
      secretKeys: secretDefs,
      // A stored login overrides the typed one: the customer picked this row,
      // and its login is what the provider must be given.
      loginKey: loginFieldKey(fieldDefs),
      loginValue: resolvedCredential?.login ?? fieldResult.values[loginFieldKey(fieldDefs)] ?? "",
      // The typed secret, when the customer entered one. For a reused stored
      // login this is empty and the secret comes from the decrypted row.
      secretValues: pickKeys(fields, secretDefs),
      resolvedSecret: resolvedCredential?.secret ?? null,
    });
  }

  // ── Verify the account with the provider BEFORE the order exists ──────────
  //
  // The purchase flow checks the account as part of "Lanjut ke Pembayaran", and
  // the account details are shown on the payment page. That check is a UX
  // convenience; THIS is the enforcement. Without it, a client that skips the
  // form (or a direct API caller) could create an order for a player id that
  // does not exist, pay for it, and only then have the provider reject the
  // top-up. The customer's money is taken for a top-up that cannot be delivered.
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
  //
  // Two independent discount sources, by design:
  //   1. AUTO ("diskon manual"): an admin-set rule applied to every eligible
  //      purchase, no code needed. Resolved from the variant's scope.
  //   2. Voucher: either a code the customer types, or a claim they are
  //      holding ("Voucher Saya"). Claims are spent atomically below.
  //
  // They STACK, but SEQUENTIALLY: the auto discount comes off the subtotal
  // first, and the voucher applies to what REMAINS. Applying a percentage
  // voucher to the raw subtotal would discount money the customer was never
  // going to pay, and would make its maxDiscount cap measure the wrong base.
  const baseSubtotal = computeOrderPricing({ variant, promo: null, paymentMethod: null }).subtotal;

  // (1) Auto discount, resolved from the variant's scope.
  const autoDiscount = await resolveAutoDiscount({ variantId: variant.id, subtotal: baseSubtotal });

  // (2) Voucher, validated against the subtotal AFTER the auto discount.
  let promoResult = null;
  if (promoCode) {
    promoResult = await validatePromoCode({
      code: promoCode,
      subtotal: baseSubtotal - autoDiscount.discount,
      variantId: variant.id,
    });
  } else if (voucherClaimId) {
    // A claim from "Voucher Saya". The claim is verified against its promo rule
    // here, and spent atomically inside the order transaction below. Never
    // read-then-write, or two concurrent checkouts could spend one claim.
    promoResult = await validateVoucherClaim({
      claimId: voucherClaimId,
      userId,
      subtotal: baseSubtotal - autoDiscount.discount,
      variantId: variant.id,
    });
  }

  // Combined discount is what the order records. `computeOrderPricing` clamps
  // it to the subtotal, so an over-generous combination cannot go negative.
  const stackedDiscount = autoDiscount.discount + (promoResult?.discount ?? 0);

  // ── Pricing: auto discount first, voucher second ──────────────────────────
  //
  // Stacking is additive but SEQUENTIAL: the voucher's percentage applies to
  // the subtotal AFTER the automatic discount has already been taken. Applying
  // it to the raw subtotal would discount money the customer never owed, and
  // would also make the voucher's maxDiscount cap apply against the wrong base.
  const pricing = computeOrderPricing({
    variant,
    promo: stackedDiscount > 0 ? { discount: stackedDiscount } : null,
    paymentMethod: method,
  });

  const eligibility = checkMethodEligibility(method, pricing.total);
  if (!eligibility.ok) {
    throw new AppError("ITP_PAYMENT_UNAVAILABLE", eligibility.reason);
  }

  // The method must be SERVED by a configured adapter, not merely enabled in
  // config. Without this, an order is created and then the customer reaches a
  // checkout that cannot produce payment instructions, a dead end with their
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

  // Generated before the transaction so the voucher redemption below can record
  // the invoice it belongs to; the claim's `redeemedInvoice` is what support
  // reads when a customer asks which order used their voucher.
  const invoice = generateInvoice();

  try {
    const order = await prisma.$transaction(async (tx) => {
      // Reserve the promo usage ATOMICALLY. `updateMany` with a conditional
      // where is what makes two concurrent checkouts unable to both consume the
      // last slot; a read-then-write would let both through.
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

      // A voucher claim is spent here, atomically with the order insert. Doing
      // it before the order exists would leave a spent voucher with no order if
      // the insert failed; doing it after would risk a double-spend between the
      // validation above and this point.
      if (promoResult?.claimId) {
        await redeemVoucherClaim(tx, { claimId: promoResult.claimId, invoice });
      }

      const created = await tx.order.create({
        data: {
          invoice,
          userId,
          status: ORDER_STATUS.PENDING_PAYMENT,
          gameName: variant.product.game.name,
          productName: variant.product.name,
          variantName: variant.name,
          quantity: pricing.quantity,
          customerInput: fieldResult.values,
          // Only the reference, never the secret. The ciphertext stays in
          // GameCredential; dispatch decrypts it from this id at send time.
          credentialId: pendingCredentialId,
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
            // Both sources are recorded: support needs to see whether a
            // discount was automatic (admin-set) or a customer voucher, and
            // the two are not distinguishable from the total alone.
            autoDiscount: autoDiscount.discount,
            voucherDiscount: promoResult?.discount ?? 0,
            autoPromoSlug: autoDiscount.promo?.slug ?? null,
            voucherPromoSlug: promoResult?.promo?.slug ?? null,
            fee: pricing.fee,
          },
        },
      });

      return created;
      });

      log.info("order.created", { orderId: order.id, invoice: order.invoice, total: order.total });

      // ── Issue payment instructions as part of creating the order ──────────────
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
      // cycle. A cycle in this pair is not theoretical; it would resolve to a
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
 * two concurrent transitions cannot both apply; a lost update here would, for
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
    // Someone else moved it first. Not an error in a concurrent system; the
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
      // The user who owns the stored login this order may reference, needed to
      // scope the credential decryption to that user.
      userId: true,
      // Set when checkout resolved a stored game login. Its presence is what
      // tells dispatch to decrypt a secret instead of using customerInput as-is.
      credentialId: true,
      gameName: true, variantName: true, total: true, providerAttempts: true,
      // gameSlug is read through the variant's game, NOT from `gameName`.
      // `gameName` is a DISPLAY NAME ("Free Fire") snapshot for the invoice; the
      // provider mapper keys PRIMARY_TARGET_FIELD on the SLUG ("free-fire").
      // Passing the display name made the mapper fall back to `userId` and throw
      // "Field userId wajib diisi" for every game whose target field is not
      // userId, and silently produced a wrong payload for the rest.
      items: {
        select: {
          productVariantId: true,
          productVariant: {
            select: {
              product: {
                select: {
                  game: {
                    select: {
                      slug: true,
                      // The field contract: names the key a secret is carried
                      // under, so dispatch never hardcodes "gamePassword".
                      inputFields: true,
                    },
                  },
                },
              },
            },
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

  // Resolve the provider SKU from the database mapping, never from the client.
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

  // ── Resolve the stored game login, when this order used one ───────────────
  //
  // `order.customerInput` deliberately does NOT contain the secret (see
  // createOrder): the row carries `credentialId` only. For a needsGameLogin
  // game the secret is decrypted HERE, from the stored row the customer owns,
  // placed into the in-memory payload, and dropped as soon as the provider call
  // returns. It is never written back to the order, never logged, and never put
  // in a TransactionLog.
  let dispatchFields = order.customerInput;

  if (order.credentialId) {
    // The field contract of the game this order belongs to, read from the same
    // row the mapper uses. It names the secret key, so nothing here hardcodes
    // "gamePassword".
    const fieldDefs = Array.isArray(order.items[0]?.productVariant?.product?.game?.inputFields)
      ? order.items[0].productVariant.product.game.inputFields
      : [];
    const secretKeys = secretFieldKeys(fieldDefs);

    try {
      const credential = await resolveForDispatch({
        userId: order.userId,
        credentialId: order.credentialId,
      });

      // Merge the decrypted secret into a COPY of the stored fields. The order
      // row itself is untouched; only the object handed to the provider differs.
      // The login on the order row is already correct (it was written at
      // checkout from the same credential), so only the secret is injected.
      dispatchFields = {
        ...order.customerInput,
        ...pickKeys({ secret: credential.secret }, secretKeys),
      };
    } catch (err) {
      // The stored login was deleted, or AUTH_SECRET rotated and the ciphertext
      // no longer decrypts. Either way the order cannot be dispatched; fail it
      // with a message that names the real cause instead of a provider 422.
      await prisma.order.updateMany({
        where: { id: orderId, status: ORDER_STATUS.PROCESSING },
        data: {
          status: ORDER_STATUS.FAILED,
          providerMessage: "Login game tersimpan tidak dapat digunakan. Silakan pesan ulang.",
        },
      });
      await prisma.transactionLog.create({
        data: {
          orderId,
          event: "ORDER_DISPATCH_FAILED",
          code: "ITP_CREDENTIAL_UNAVAILABLE",
          message: "Kredensial game tidak dapat didekripsi atau telah dihapus.",
        },
      });
      log.warn("order.dispatch_credential_failed", { error: err });
      return { dispatched: false, status: ORDER_STATUS.FAILED };
    }
  }

  const result = await provider.createOrder({
    idempotencyKey: order.invoice,
    providerCode: mapping.providerCode,
    fields: dispatchFields,
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
 * Sync the order to a dead payment.
 *
 * THE INVARIANT: `payment.status` and `order.status` must not tell two stories.
 * If the gateway says the money will never arrive (EXPIRED/FAILED/CANCELLED/
 * REFUNDED) but the order is still waiting for it, the order must die too.
 * Otherwise /dev shows "Pembayaran: Kedaluwarsa / Status: Diproses", a
 * contradiction the customer can only resolve by opening the page themselves,
 * which is what the expiry-on-read path then does, up to 30 minutes late.
 *
 * Two calls into the same row race safely: `canTransition` + `updateMany` on
 * the CURRENT status is the optimistic lock. A PAID/PROCESSING order never
 * moves: "UNKNOWN is not failed", because a dead charge is not proof the
 * top-up was not delivered; only the top-up provider may settle that.
 *
 * Returns the row counts for telemetry; callers do not branch on them.
 *
 * @param {object} args
 * @param {string} args.orderId
 * @param {string} args.paymentStatus  PAYMENT_STATUS.* that just was written
 * @param {string|null} [args.reason]
 * @param {object} [args.log]
 * @returns {Promise<{ synced: boolean, orderStatus: string|null }>}
 */
export async function syncOrderToPayment({ orderId, paymentStatus, reason = null, log }) {
  const DEAD = new Set([
    PAYMENT_STATUS.EXPIRED,
    PAYMENT_STATUS.FAILED,
    PAYMENT_STATUS.CANCELLED,
    PAYMENT_STATUS.REFUNDED,
  ]);
  if (!orderId || !DEAD.has(paymentStatus)) {
    return { synced: false, orderStatus: null };
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, invoice: true, status: true },
  });
  if (!order) return { synced: false, orderStatus: null };

  // A PAID/PROCESSING order has already been dispatched. The payment row is
  // dead, but the top-up is on its own track; see the invariant block above.
  if (!canTransition(order.status, ORDER_STATUS.EXPIRED)) {
    log?.info?.("order.sync_payment_skipped", { orderId, orderStatus: order.status, paymentStatus });
    return { synced: false, orderStatus: order.status };
  }

  const updated = await prisma.order.updateMany({
    where: { id: order.id, status: order.status },
    data: { status: ORDER_STATUS.EXPIRED },
  });
  if (updated.count !== 1) {
    // Someone moved it between the read and the write. A movement is a
    // resolution; this must not retry.
    log?.warn?.("order.sync_payment_lost_race", { orderId, orderStatus: order.status, paymentStatus });
    return { synced: false, orderStatus: order.status };
  }

  await prisma.transactionLog.create({
    data: {
      orderId: order.id,
      event: "ORDER_EXPIRED",
      code: "SYNC_FROM_PAYMENT",
      message: reason || `Kedaluwarsa: pembayaran ${PAYMENT_STATUS_LABEL[paymentStatus] ?? paymentStatus}.`,
    },
  });

  log?.info?.("order.synced_to_payment", { orderId, invoice: order.invoice, from: order.status, paymentStatus });

  return { synced: true, orderStatus: ORDER_STATUS.EXPIRED };
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
 * a terminal state; a duplicate callback is expected, not an error.
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

  // providerRef is only unique under @@unique([providerId, providerRef]); a
  // bare `where: { providerRef }` is a PrismaClientValidationError and rejects
  // every callback. Look it up as the first match on the ref instead; the ref
  // is our own invoice, so collisions across providers are not a thing in
  // practice and the state-machine guards below keep the transition safe.
  const order = await prisma.order.findFirst({
    where: { providerRef },
    orderBy: { createdAt: "desc" },
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
 * Close ONE stale order: cancel the Midtrans charge, mark the order EXPIRED,
 * and record why.
 *
 * THE GATEWAY CANCEL IS THE POINT. The old version only ever wrote to the local
 * database, so the order page said "kedaluwarsa" while the Midtrans dashboard
 * kept showing the charge as pending forever, and a customer who paid the dead
 * charge hours later had a settlement land on an order we had already given up
 * on. Closing the charge at the gateway is what makes "expired" true.
 *
 * THE ORDER IS CLOSED, NOT THE CUSTOMER'S FUTURE. A re-order for the same
 * payload still works: `createOrder` finds this EXPIRED row and replaces it.
 *
 * @param {{ id: string, invoice: string }} order
 * @param {{ log?: object }} [ctx]
 * @returns {Promise<boolean>} true when the order was closed by this call
 */
async function closeStaleOrder(order, { log } = {}) {
  // ── Cancel at Midtrans FIRST, while the order is still locally open. ──────
  // A late settlement arriving after the local close is what the comment below
  // guards against; closing the charge before the row removes the window.
  const payment = await prisma.payment.findUnique({
    where: { orderId: order.id },
    select: { id: true, reference: true, externalId: true, providerCode: true, status: true },
  });

  const provider = payment?.providerCode ? safeGetPaymentProvider(payment.providerCode) : null;

  // A payment already at a terminal state has nothing open at the gateway.
  const gatewayStillOpen =
    payment && [PAYMENT_STATUS.PENDING, PAYMENT_STATUS.PROCESSING].includes(payment.status);

  if (provider && payment?.reference && gatewayStillOpen) {
    try {
      const cancelled = await provider.cancelPayment(
        { reference: payment.reference, externalId: payment.externalId ?? undefined, reason: "ORDER_EXPIRED" },
        { log }
      );
      if (!cancelled.ok && cancelled.error?.code !== PAYMENT_ERROR.REJECTED) {
        // NOT_CONFIGURED/TIMEOUT/UNAVAILABLE: the local close still happens.
        // an unreachable gateway is not a reason to keep the order open. The
        // charge can be reconciled by hand if the money ever does arrive.
        log?.warn?.("order.expire_gateway_cancel_failed", {
          orderId: order.id,
          reference: payment.reference,
          code: cancelled.error?.code,
        });
      }
    } catch (err) {
      log?.warn?.("order.expire_gateway_cancel_threw", {
        orderId: order.id,
        message: String(err?.message ?? err).slice(0, 200),
      });
    }
  }

  // ── Close locally. The conditional update is the optimistic lock: if a
  // webhook settled this order between the read and the write, count !== 1 and
  // it is left PAID; a gateway that says we got the money wins.
  const result = await prisma.order.updateMany({
    where: {
      id: order.id,
      status: { in: [ORDER_STATUS.PENDING_PAYMENT, ORDER_STATUS.PAYMENT_PROCESSING] },
    },
    data: { status: ORDER_STATUS.EXPIRED },
  });
  if (result.count !== 1) return false;

  await prisma.$transaction(async (tx) => {
    await tx.transactionLog.create({
      data: {
        orderId: order.id,
        event: "ORDER_EXPIRED",
        message: "Kedaluwarsa: batas waktu pembayaran terlewati.",
      },
    });
    // The payment row is marked too, so a late callback sees an expired order
    // rather than an open one it could settle into.
    await tx.payment.updateMany({
      where: { orderId: order.id, status: { in: [PAYMENT_STATUS.PENDING, PAYMENT_STATUS.PROCESSING] } },
      data: { status: PAYMENT_STATUS.EXPIRED },
    });
  });
  return true;
}

/**
 * Expire unpaid orders past their deadline.
 *
 * Called from a checkout, from reading an order page, and from the global sweep.
 * All three need the same behaviour: close the order and void the charge at the
 * gateway, so the customer sees the truth on both sides.
 *
 * PENDING_PAYMENT/PAYMENT_PROCESSING only: a PAID order may still be settled by
 * the gateway, and expiring it locally is how a customer pays and gets nothing.
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
    if (await closeStaleOrder(order, { log })) expired += 1;
  }

  log.info("order.expire_done", { scanned: stale.length, expired });
  return { scanned: stale.length, expired };
}
