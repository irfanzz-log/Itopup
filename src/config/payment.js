// ============================================================================
// Payment method catalogue.
//
// EVERY METHOD HERE IS SERVED BY MIDTRANS SNAP.
//
// This was not always true. The catalogue used to carry a set of "offline"
// methods — the customer transferred to a bank account or e-wallet number the
// operator owned, and a human confirmed the money arrived. Those are gone. The
// reasons:
//
//   * Every offline payment had to be reconciled by hand, so dispatch to
//     Melostore waited for a person instead of a webhook.
//   * Amounts matched only approximately; a wrong transfer had no automatic
//     recourse.
//   * The account numbers were secrets held in env, exposed to every customer
//     who reached checkout.
//
// Midtrans owns the payment screen entirely. We create a Snap transaction, the
// customer pays inside Midtrans, and Midtrans calls
// POST /api/webhooks/payment/midtrans. That signature-verified callback is the
// ONLY thing that settles an order; `settlePayment` then dispatches to
// Melostore. No operator touches the money path.
//
// WHAT THIS FILE STILL IS, AND IS NOT
//
// It remains the INTERNAL, provider-agnostic list the UI may offer, plus the
// fee model. The mapping from an internal method key to Midtrans's own
// payment_type lives in the adapter (`src/providers/payment/midtrans/map.js`),
// never here.
// ============================================================================

// Rendered inside client components (method descriptions, eligibility reasons),
// so amounts go through the shared deterministic formatter. `toLocaleString`
// here would differ between the server and the browser and break hydration.
import { formatNumber } from "../lib/format.js";

/** @typedef {{key:string,label:string,group:string,enabled:boolean,
 *             legacy?:boolean,feeFlat:number,feePercent:number,
 *             minAmount:number,maxAmount:number,
 *             description?:string,note?:string}} PaymentMethod */

/**
 * Virtual account methods are offered only at or above this amount.
 *
 * WHY: a VA is a bank transfer, and a bank transfer of a few thousand rupiah is
 * not viable — the sending bank's own fee can exceed the transaction, and the
 * admin fee is larger than the top-up itself. Below this threshold the customer
 * is directed to QRIS instead, which is viable down to ~Rp 1.000.
 *
 * This is a PRODUCT rule, so it lives here next to the amounts rather than being
 * re-derived in the UI. The UI reads it through `filterMethodsForPurchase()`
 * and the server enforces it through `checkMethodEligibility()`; one constant,
 * both sides.
 */
export const BANK_MIN_AMOUNT = 100_000;

/** @type {PaymentMethod[]} */
export const PAYMENT_METHODS = [
  // ── QRIS: the default for small amounts ──────────────────────────────────
  // Listed FIRST because this is the method the customer lands on for a typical
  // top-up. QRIS is viable from ~Rp 1.000, so it is the method that covers
  // everything below the VA floor. Midtrans renders the QR; we never draw one.
  {
    key: "qris",
    label: "QRIS (semua e-wallet & m-banking)",
    group: "QRIS",
    enabled: true,
    feePercent: 0.7,
    feeFlat: 0,
    minAmount: 1000,
    maxAmount: 10_000_000,
    description: "Scan sekali dari aplikasi apa pun. Paling cepat untuk nominal kecil.",
  },

  // ── E-wallets (direct, not via QRIS) ─────────────────────────────────────
  // A customer who wants to pay from a specific wallet balance can pick the
  // wallet directly. Midtrans handles the deeplink/confirmation; this is still
  // a gateway method — we hold no wallet number and reconcile nothing.
  {
    key: "ewallet_gopay",
    label: "GoPay",
    group: "E-Wallet",
    enabled: true,
    feePercent: 0.7,
    feeFlat: 0,
    minAmount: 1000,
    maxAmount: 10_000_000,
    description: "Bayar langsung dari saldo GoPay.",
  },
  {
    key: "ewallet_shopeepay",
    label: "ShopeePay",
    group: "E-Wallet",
    enabled: true,
    feePercent: 0.7,
    feeFlat: 0,
    minAmount: 1000,
    maxAmount: 10_000_000,
    description: "Bayar langsung dari saldo ShopeePay.",
  },

  // ── Virtual account: only for larger amounts ─────────────────────────────
  // A VA is the modern replacement for "transfer ke rekening BCA": Midtrans
  // generates a per-order account number, the customer transfers to it from
  // their own banking app, and settlement is automatic. The 100k floor from the
  // old manual bank methods carries over — see BANK_MIN_AMOUNT.
  {
    key: "va_bca",
    label: "BCA Virtual Account",
    group: "Virtual Account",
    enabled: true,
    feeFlat: 4000,
    feePercent: 0,
    minAmount: BANK_MIN_AMOUNT,
    maxAmount: 50_000_000,
    description: `Transfer ke nomor VA BCA, khusus transaksi di atas Rp ${formatNumber(BANK_MIN_AMOUNT)}.`,
  },
  {
    key: "va_mandiri",
    label: "Mandiri Virtual Account",
    group: "Virtual Account",
    enabled: true,
    feeFlat: 4000,
    feePercent: 0,
    minAmount: BANK_MIN_AMOUNT,
    maxAmount: 50_000_000,
    description: `Transfer ke nomor VA Mandiri, khusus transaksi di atas Rp ${formatNumber(BANK_MIN_AMOUNT)}.`,
  },
  {
    key: "va_bni",
    label: "BNI Virtual Account",
    group: "Virtual Account",
    enabled: true,
    feeFlat: 4000,
    feePercent: 0,
    minAmount: BANK_MIN_AMOUNT,
    maxAmount: 50_000_000,
    description: `Transfer ke nomor VA BNI, khusus transaksi di atas Rp ${formatNumber(BANK_MIN_AMOUNT)}.`,
  },
  {
    key: "va_bri",
    label: "BRI Virtual Account",
    group: "Virtual Account",
    enabled: true,
    feeFlat: 4000,
    feePercent: 0,
    minAmount: BANK_MIN_AMOUNT,
    maxAmount: 50_000_000,
    description: `Transfer ke nomor VA BRI, khusus transaksi di atas Rp ${formatNumber(BANK_MIN_AMOUNT)}.`,
  },
  {
    key: "va_permata",
    label: "Permata Virtual Account",
    group: "Virtual Account",
    enabled: true,
    feeFlat: 4000,
    feePercent: 0,
    minAmount: BANK_MIN_AMOUNT,
    maxAmount: 50_000_000,
    description: `Transfer ke nomor VA Permata, khusus transaksi di atas Rp ${formatNumber(BANK_MIN_AMOUNT)}.`,
  },

  // ── Card (Midtrans must also enable the acquirer in the merchant dashboard) ─
  {
    key: "card_credit",
    label: "Kartu Kredit",
    group: "Kartu",
    enabled: true,
    feePercent: 2.9,
    feeFlat: 0,
    minAmount: 1000,
    maxAmount: 50_000_000,
    description: "Visa / Mastercard / JCB melalui Midtrans.",
  },

  // ── Retail outlets: cash, for the unbanked ───────────────────────────────
  {
    key: "retail_alfamart",
    label: "Alfamart",
    group: "Gerai Retail",
    enabled: true,
    feeFlat: 5000,
    feePercent: 0,
    minAmount: 10_000,
    maxAmount: 5_000_000,
    description: "Bayar tunai di kasir Alfamart.",
  },
  {
    key: "retail_indomaret",
    label: "Indomaret",
    group: "Gerai Retail",
    enabled: true,
    feeFlat: 5000,
    feePercent: 0,
    minAmount: 10_000,
    maxAmount: 5_000_000,
    description: "Bayar tunai di kasir Indomaret.",
  },

  // ── Legacy aliases: resolvable, never offered ────────────────────────────
  // `manual_transfer` and the per-bank / per-wallet offline keys were the only
  // methods before Midtrans. Orders already in the database reference them, and
  // re-issuing instructions for such an order must keep working — deleting a key
  // would make `getPaymentMethod` return null and strand those orders.
  //
  // `legacy: true` keeps them resolvable while excluding them from the checkout
  // list, so they are never offered again. `enabled: false` makes the server
  // refuse them outright in `checkMethodEligibility`, so even a stale cached
  // client page cannot create a new order on a method that no longer exists.
  {
    key: "manual_transfer",
    label: "Transfer Manual",
    group: "Transfer Bank",
    enabled: false,
    legacy: true,
    feeFlat: 0,
    feePercent: 0,
    minAmount: 1000,
    maxAmount: 50_000_000,
    description: "Metode lama, tidak lagi tersedia.",
  },
  {
    key: "manual_bank_bca",
    label: "Transfer Bank BCA",
    group: "Transfer Bank",
    enabled: false,
    legacy: true,
    feeFlat: 0,
    feePercent: 0,
    minAmount: BANK_MIN_AMOUNT,
    maxAmount: 50_000_000,
    description: "Metode lama, tidak lagi tersedia.",
  },
  {
    key: "manual_bank_mandiri",
    label: "Transfer Bank Mandiri",
    group: "Transfer Bank",
    enabled: false,
    legacy: true,
    feeFlat: 0,
    feePercent: 0,
    minAmount: BANK_MIN_AMOUNT,
    maxAmount: 50_000_000,
    description: "Metode lama, tidak lagi tersedia.",
  },
  {
    key: "manual_bank_bni",
    label: "Transfer Bank BNI",
    group: "Transfer Bank",
    enabled: false,
    legacy: true,
    feeFlat: 0,
    feePercent: 0,
    minAmount: BANK_MIN_AMOUNT,
    maxAmount: 50_000_000,
    description: "Metode lama, tidak lagi tersedia.",
  },
  {
    key: "manual_bank_bri",
    label: "Transfer Bank BRI",
    group: "Transfer Bank",
    enabled: false,
    legacy: true,
    feeFlat: 0,
    feePercent: 0,
    minAmount: BANK_MIN_AMOUNT,
    maxAmount: 50_000_000,
    description: "Metode lama, tidak lagi tersedia.",
  },
  {
    key: "manual_bank_lainnya",
    label: "Transfer Bank Lainnya",
    group: "Transfer Bank",
    enabled: false,
    legacy: true,
    feeFlat: 0,
    feePercent: 0,
    minAmount: BANK_MIN_AMOUNT,
    maxAmount: 50_000_000,
    description: "Metode lama, tidak lagi tersedia.",
  },
  {
    key: "manual_ewallet_dana",
    label: "DANA",
    group: "E-Wallet",
    enabled: false,
    legacy: true,
    feeFlat: 0,
    feePercent: 0,
    minAmount: 1000,
    maxAmount: 10_000_000,
    description: "Metode lama, tidak lagi tersedia.",
  },
  {
    key: "manual_ewallet_ovo",
    label: "OVO",
    group: "E-Wallet",
    enabled: false,
    legacy: true,
    feeFlat: 0,
    feePercent: 0,
    minAmount: 1000,
    maxAmount: 10_000_000,
    description: "Metode lama, tidak lagi tersedia.",
  },
  {
    key: "manual_ewallet_gopay",
    label: "GoPay",
    group: "E-Wallet",
    enabled: false,
    legacy: true,
    feeFlat: 0,
    feePercent: 0,
    minAmount: 1000,
    maxAmount: 10_000_000,
    description: "Metode lama, tidak lagi tersedia.",
  },
  {
    key: "manual_ewallet_shopeepay",
    label: "ShopeePay",
    group: "E-Wallet",
    enabled: false,
    legacy: true,
    feeFlat: 0,
    feePercent: 0,
    minAmount: 1000,
    maxAmount: 10_000_000,
    description: "Metode lama, tidak lagi tersedia.",
  },
];

const BY_KEY = new Map(PAYMENT_METHODS.map((m) => [m.key, m]));

export function getPaymentMethod(key) {
  return BY_KEY.get(key) ?? null;
}

/**
 * Human label for a stored method key.
 *
 * The database stores the KEY (`va_bca`). Rendering that key to a customer is
 * how "va_bca" ends up on a receipt. Falls back to a de-underscored,
 * title-cased version rather than an empty string, so an unrecognised key is
 * still readable instead of blank. Historical orders still carrying a
 * `manual_bank_*` / `manual_ewallet_*` key therefore still print something
 * sensible instead of blanking out.
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
 * sufficient — see `availablePaymentMethods()` in payment.server.js.
 */
export function enabledPaymentMethods() {
  return PAYMENT_METHODS.filter((m) => m.enabled && !m.legacy);
}

/**
 * Narrow the servable list to what makes sense for ONE purchase.
 *
 * THE VA RULE LIVES HERE. A virtual account is hidden when the purchase is
 * below BANK_MIN_AMOUNT, because a small bank transfer is not viable — the fee
 * eats the transaction. QRIS is what the customer gets instead, and QRIS has no
 * such floor. This is the SAME predicate the server enforces in
 * `checkMethodEligibility()`, so a VA can never be offered here and then
 * refused at order creation.
 *
 * NOT DONE HERE: restricting an e-wallet method to a matching wallet. A payment
 * method is an instrument, not a product — paying for diamonds from a GoPay
 * balance is a normal transaction. Midtrans owns the payment screen and the
 * customer may switch channel there anyway; refusing the channel they picked
 * here would only block a willing payer.
 *
 * @param {PaymentMethod[]} methods
 * @param {{ amount?: number|null }} purchase
 */
export function filterMethodsForPurchase(methods, { amount = null } = {}) {
  const hasAmount = Number.isFinite(Number(amount)) && Number(amount) > 0;

  return (methods ?? []).filter((method) => {
    // Below the method's floor it cannot be used for this purchase. This is what
    // removes every virtual account under Rp 100.000.
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
