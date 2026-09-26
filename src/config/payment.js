// ============================================================================
// Payment method catalogue.
//
// IMPORTANT — read before touching this file:
//
// No payment gateway has been selected yet. Nothing here invents an API, a
// callback format, or a signature scheme. What this file defines is the
// INTERNAL, provider-agnostic list of payment methods the UI may offer, plus
// the internal fee model. The mapping from an internal method key to a gateway's
// own payment code lives in the payment adapter (src/providers/payment/*), never
// here.
//
// TWO KINDS OF METHOD IN THIS FILE:
//
//   1. OFFLINE methods (`enabled: true`) — served by the manual adapter. The
//      customer sends money to a destination the operator configured, and an
//      operator confirms it arrived. These work TODAY and are listed per bank and
//      per e-wallet so the customer picks the channel they actually have.
//
//   2. GATEWAY methods (`enabled: false`) — served by an adapter that does not
//      exist yet, because no gateway has been chosen. They stay off; turning one
//      on without its adapter mapping implemented would offer the customer a
//      method that cannot produce payment instructions.
//
// `enabled: true` means "this method is implemented". It is NOT sufficient on its
// own: `availablePaymentMethods()` additionally requires the adapter to be
// configured, so a bank method is hidden until its account number exists.
// ============================================================================

// Rendered inside client components (method descriptions, eligibility reasons),
// so amounts go through the shared deterministic formatter. `toLocaleString`
// here would differ between the server and the browser and break hydration.
import { formatNumber } from "../lib/format.js";

/** @typedef {{key:string,label:string,group:string,enabled:boolean,
 *             legacy?:boolean,feeFlat:number,feePercent:number,
 *             minAmount:number,maxAmount:number,
 *             description?:string,note?:string}} PaymentMethod */

/** Offline methods share the fee model: ITOPUP charges nothing, the sending bank or wallet may. */
const OFFLINE_FEE = { feeFlat: 0, feePercent: 0, minAmount: 1000, maxAmount: 50_000_000 };

/**
 * Bank transfers are refused below this amount.
 *
 * WHY: a bank transfer of a few thousand rupiah is not viable — the sending
 * bank's own fee can exceed the transaction, the customer's admin fee is larger
 * than the top-up, and every one of them is reconciled by hand. Below this
 * threshold the customer pays with an e-wallet instead, whose minimum is an
 * order of magnitude lower.
 *
 * This is a PRODUCT rule, so it lives here next to the amounts rather than being
 * re-derived in the UI. The UI reads it through `filterMethodsForPurchase()` and
 * the server enforces it through `checkMethodEligibility()`; one constant, both
 * sides.
 */
export const BANK_MIN_AMOUNT = 100_000;

/** Offline bank methods: same fee model, but the higher floor. */
const BANK_FEE = { ...OFFLINE_FEE, minAmount: BANK_MIN_AMOUNT };

/** @type {PaymentMethod[]} */
export const PAYMENT_METHODS = [
  // ── Legacy alias ─────────────────────────────────────────────────────────
  // `manual_transfer` was the single offline method before the catalogue was
  // split per bank and per e-wallet. Orders already in the database reference it,
  // and re-issuing instructions for such an order must keep working — deleting
  // the key would make `getPaymentMethod` return null and strand those orders.
  //
  // `legacy: true` keeps it resolvable while excluding it from the checkout list,
  // so it is not offered as a sixth, vaguer bank option.
  {
    key: "manual_transfer",
    label: "Transfer Manual",
    group: "Transfer Bank",
    enabled: true,
    legacy: true,
    ...OFFLINE_FEE,
    description: "Transfer bank, diverifikasi operator.",
  },

  // ── Offline: bank transfer, per bank ─────────────────────────────────────
  // Listed per bank rather than as one generic "bank transfer" so the customer
  // picks the bank they actually use and is shown only that bank's account —
  // the alternative is a list of five accounts and a guess.
  //
  // These use BANK_FEE, not OFFLINE_FEE: the 100k floor applies to a NEW bank
  // transfer, while the legacy key above keeps the lower floor so a historical
  // order can still be re-issued instructions.
  {
    key: "manual_bank_bca",
    label: "Transfer Bank BCA",
    group: "Transfer Bank",
    enabled: true,
    ...BANK_FEE,
    description: `Transfer ke rekening BCA, minimal Rp ${formatNumber(BANK_MIN_AMOUNT)}.`,
  },
  {
    key: "manual_bank_mandiri",
    label: "Transfer Bank Mandiri",
    group: "Transfer Bank",
    enabled: true,
    ...BANK_FEE,
    description: `Transfer ke rekening Mandiri, minimal Rp ${formatNumber(BANK_MIN_AMOUNT)}.`,
  },
  {
    key: "manual_bank_bni",
    label: "Transfer Bank BNI",
    group: "Transfer Bank",
    enabled: true,
    ...BANK_FEE,
    description: `Transfer ke rekening BNI, minimal Rp ${formatNumber(BANK_MIN_AMOUNT)}.`,
  },
  {
    key: "manual_bank_bri",
    label: "Transfer Bank BRI",
    group: "Transfer Bank",
    enabled: true,
    ...BANK_FEE,
    description: `Transfer ke rekening BRI, minimal Rp ${formatNumber(BANK_MIN_AMOUNT)}.`,
  },
  {
    key: "manual_bank_lainnya",
    label: "Transfer Bank Lainnya",
    group: "Transfer Bank",
    enabled: true,
    ...BANK_FEE,
    description: `Bank lain yang terdaftar, minimal Rp ${formatNumber(BANK_MIN_AMOUNT)}.`,
  },

  // ── Offline: e-wallet transfer ───────────────────────────────────────────
  // An e-wallet transfer has no "berita" field, so the amount itself is the
  // matching key. The adapter words its steps accordingly.
  //
  // HOW A CUSTOMER PAYS IS NOT WHAT THEY BUY.
  //
  // An e-wallet method is a PAYMENT INSTRUMENT, not a product. A customer
  // buying Mobile Legends diamonds may well want to pay from their DANA
  // balance — that is the normal use of an e-wallet. The previous version
  // carried `walletSlug` and refused anything but the matching wallet
  // ("Metode DANA hanya untuk top up dana"), which made every cross-wallet
  // payment impossible and equated the payment channel with the purchase.
  //
  // The destination the customer is shown comes from MANUAL_EWALLET_NUMBERS,
  // keyed by the method's own name; nothing here depends on the purchase.
  {
    key: "manual_ewallet_dana",
    label: "DANA",
    group: "E-Wallet",
    enabled: true,
    ...OFFLINE_FEE,
    maxAmount: 10_000_000,
    description: "Kirim ke nomor DANA, diverifikasi operator.",
  },
  {
    key: "manual_ewallet_ovo",
    label: "OVO",
    group: "E-Wallet",
    enabled: true,
    ...OFFLINE_FEE,
    maxAmount: 10_000_000,
    description: "Kirim ke nomor OVO, diverifikasi operator.",
  },
  {
    key: "manual_ewallet_gopay",
    label: "GoPay",
    group: "E-Wallet",
    enabled: true,
    ...OFFLINE_FEE,
    maxAmount: 10_000_000,
    description: "Kirim ke nomor GoPay, diverifikasi operator.",
  },
  {
    key: "manual_ewallet_shopeepay",
    label: "ShopeePay",
    group: "E-Wallet",
    enabled: true,
    ...OFFLINE_FEE,
    maxAmount: 10_000_000,
    description: "Kirim ke nomor ShopeePay, diverifikasi operator.",
  },

  // ── Gateway: virtual account ─────────────────────────────────────────────
  // Enabled only once a gateway adapter implements these keys. The label says
  // "otomatis" because a VA settles itself, unlike the offline methods above.
  {
    key: "va_bca",
    label: "BCA Virtual Account",
    group: "Virtual Account",
    enabled: false,
    feeFlat: 4000,
    feePercent: 0,
    minAmount: 1000,
    maxAmount: 50_000_000,
    description: "Otomatis terverifikasi. Butuh payment gateway.",
  },
  {
    key: "va_bni",
    label: "BNI Virtual Account",
    group: "Virtual Account",
    enabled: false,
    feeFlat: 4000,
    feePercent: 0,
    minAmount: 1000,
    maxAmount: 50_000_000,
    description: "Otomatis terverifikasi. Butuh payment gateway.",
  },
  {
    key: "va_bri",
    label: "BRIVA",
    group: "Virtual Account",
    enabled: false,
    feeFlat: 4000,
    feePercent: 0,
    minAmount: 1000,
    maxAmount: 50_000_000,
    description: "Otomatis terverifikasi. Butuh payment gateway.",
  },
  {
    key: "va_mandiri",
    label: "Mandiri Virtual Account",
    group: "Virtual Account",
    enabled: false,
    feeFlat: 4000,
    feePercent: 0,
    minAmount: 1000,
    maxAmount: 50_000_000,
    description: "Otomatis terverifikasi. Butuh payment gateway.",
  },
  {
    key: "va_permata",
    label: "Permata Virtual Account",
    group: "Virtual Account",
    enabled: false,
    feeFlat: 4000,
    feePercent: 0,
    minAmount: 1000,
    maxAmount: 50_000_000,
    description: "Otomatis terverifikasi. Butuh payment gateway.",
  },

  // ── Gateway: QRIS ────────────────────────────────────────────────────────
  {
    key: "qris",
    label: "QRIS (semua e-wallet & m-banking)",
    group: "QRIS",
    enabled: false,
    feePercent: 0.7,
    feeFlat: 0,
    minAmount: 1000,
    maxAmount: 10_000_000,
    description: "Scan sekali dari aplikasi apa pun. Butuh payment gateway.",
  },

  // ── Gateway: retail outlets ──────────────────────────────────────────────
  {
    key: "retail_alfamart",
    label: "Alfamart",
    group: "Gerai Retail",
    enabled: false,
    feeFlat: 5000,
    feePercent: 0,
    minAmount: 10_000,
    maxAmount: 5_000_000,
    description: "Bayar di kasir. Butuh payment gateway.",
  },
  {
    key: "retail_indomaret",
    label: "Indomaret",
    group: "Gerai Retail",
    enabled: false,
    feeFlat: 5000,
    feePercent: 0,
    minAmount: 10_000,
    maxAmount: 5_000_000,
    description: "Bayar di kasir. Butuh payment gateway.",
  },
];

const BY_KEY = new Map(PAYMENT_METHODS.map((m) => [m.key, m]));

export function getPaymentMethod(key) {
  return BY_KEY.get(key) ?? null;
}

/**
 * Human label for a stored method key.
 *
 * The database stores the KEY (`manual_bank_bca`). Rendering that key to a
 * customer is how "manual_bank_bca" ends up on a receipt. Falls back to a
 * de-underscored, title-cased version rather than an empty string, so an
 * unrecognised key is still readable instead of blank.
 */
export function paymentMethodLabel(key) {
  const method = BY_KEY.get(String(key || ""));
  if (method) return method.label;
  const raw = String(key || "").trim();
  if (!raw) return "Pembayaran";
  return raw
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Methods marked as implemented AND offered to customers.
 *
 * `legacy` keys are excluded: they stay resolvable so historical orders can be
 * re-issued, but they are not choices in a new checkout. Necessary, but not
 * sufficient — see `availablePaymentMethods()` below.
 */
export function enabledPaymentMethods() {
  return PAYMENT_METHODS.filter((m) => m.enabled && !m.legacy);
}

/**
 * Methods that can actually complete a payment: implemented AND served by a
 * configured adapter.
 *
 * `enabledPaymentMethods()` alone is not enough to render a checkout. A method
 * whose adapter is missing configuration would be offered to the customer, they
 * would fill the whole form, and the order would be refused at the last step.
 * This is the list the UI and the order service must both agree on.
 *
 * LIVES IN payment.server.js, NOT HERE. This file is imported by client
 * components (TopupForm) — importing the adapter here would pull the manual
 * adapter → env.server.js → env.js into the client bundle. Get it from
 * `@/config/payment.server`.
 */

/**
 * Narrow the servable list to what makes sense for ONE purchase.
 *
 * A METHOD IS HIDDEN WHEN THE PURCHASE IS BELOW ITS MINIMUM. This is what
 * removes bank transfers under Rp 100.000. It is the SAME predicate the
 * server enforces in `checkMethodEligibility()`, so a method can never be
 * offered here and then refused at order creation.
 *
 * A bank method is always kept as a fallback, even at a low amount — the
 * customer needs SOME way to pay. What changes below the threshold is which
 * methods are shown, and the UI explains the floor rather than leaving a gap
 * the customer cannot interpret.
 *
 * NOT DONE HERE: restricting an e-wallet method to a matching wallet. A
 * payment method is an instrument, not a product — paying for diamonds from
 * a DANA balance is a normal transaction, and the previous `walletSlug`
 * coupling refused it. The destination shown to the customer comes from the
 * adapter's own configuration and never depended on the purchase.
 *
 * @param {PaymentMethod[]} methods
 * @param {{ amount?: number|null }} purchase
 */
export function filterMethodsForPurchase(methods, { amount = null } = {}) {
  const hasAmount = Number.isFinite(Number(amount)) && Number(amount) > 0;

  return (methods ?? []).filter((method) => {
    // Below the method's floor it cannot be used for this purchase.
    if (hasAmount && Number(amount) < Number(method.minAmount ?? 0)) return false;

    return true;
  });
}

/**
 * The minimum amount any offered method accepts, so the UI can tell the customer
 * why a method disappeared instead of showing an unexplained shorter list.
 * Returns null when nothing is offered.
 */
export function lowestOfferedMinimum(methods) {
  const values = (methods ?? [])
    .map((m) => Number(m.minAmount ?? 0))
    .filter((n) => Number.isFinite(n) && n > 0);
  return values.length ? Math.min(...values) : null;
}

/**
 * Compute the gateway fee for a method and amount.
 *
 * Percentages are applied with integer arithmetic: `Math.round` on a float
 * percentage is how a one-rupiah discrepancy appears between the fee we quote
 * and the fee the gateway charges.
 */
export function computePaymentFee(method, amount) {
  if (!method) return 0;
  const flat = Number(method.feeFlat || 0);
  const percent = Number(method.feePercent || 0);
  const percentFee = Math.round((Number(amount) * percent) / 100);
  return flat + percentFee;
}

/** Total the customer pays: order total + gateway fee. */
export function computePayableAmount(method, amount) {
  return Number(amount) + computePaymentFee(method, amount);
}

/**
 * Whether a method can be used for this amount. Kept as a function returning a
 * reason so the UI can say WHY instead of silently hiding an option.
 */
export function checkMethodEligibility(method, amount) {
  if (!method) return { ok: false, reason: "Metode pembayaran tidak dikenal." };
  if (!method.enabled) return { ok: false, reason: "Metode pembayaran belum aktif." };
  if (amount < method.minAmount) {
    return { ok: false, reason: `Minimum transaksi Rp ${formatNumber(method.minAmount)}.` };
  }
  if (amount > method.maxAmount) {
    return { ok: false, reason: `Maksimum transaksi Rp ${formatNumber(method.maxAmount)}.` };
  }
  return { ok: true };
}

/** Grouped for rendering, preserving declaration order. Defaults to the methods a customer may choose. */
export function groupPaymentMethods(methods = enabledPaymentMethods()) {
  const groups = new Map();
  for (const method of methods) {
    if (!groups.has(method.group)) groups.set(method.group, []);
    groups.get(method.group).push(method);
  }
  return [...groups.entries()].map(([group, items]) => ({ group, items }));
}
