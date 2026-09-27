// ============================================================================
// Payment provider registry.
//
// ONE GATEWAY: MIDTRANS.
//
// The catalogue in src/config/payment.js used to be split between offline
// methods (served by the manual adapter — a human reconciled each transfer) and
// gateway methods. The offline methods and the manual adapter are gone: every
// method a customer can pick is now created, charged and settled by Midtrans
// Snap, and settled in our database ONLY by the signature-verified webhook at
// POST /api/webhooks/payment/midtrans.
//
// The manual adapter is still ON DISK at ./manual/* because historical orders
// reference its method keys and their stored instructions must still render.
// It is simply no longer reachable from the catalogue: no enabled method maps to
// it, so `resolveProviderCodeForMethod` never returns "manual" for a method a
// customer can choose.
// ============================================================================
import { AppError } from "@/lib/errors";
import { assertPaymentProvider } from "./contract.js";
import { midtransProvider } from "./midtrans/index.js";

/** @type {Record<string, object>} */
const REGISTRY = {
  midtrans: midtransProvider,
};

/** True when a payment gateway is selected AND registered. */
export function isPaymentConfigured() {
  const code = (process.env.PAYMENT_PROVIDER || "").trim().toLowerCase();
  if (!code) return false;
  const adapter = REGISTRY[code];
  return Boolean(adapter?.isConfigured?.());
}

/**
 * Resolve the configured payment adapter.
 * @throws {AppError} ITP_PAYMENT_NOT_CONFIGURED — deliberately not a 500: this
 *   is an operator configuration gap, and the message says so without leaking
 *   which env var is missing to the customer.
 */
export function getPaymentProvider(code) {
  const key = (code || process.env.PAYMENT_PROVIDER || "").trim().toLowerCase();

  if (!key) {
    throw new AppError("ITP_PAYMENT_NOT_CONFIGURED", "Metode pembayaran belum dikonfigurasi.");
  }

  const adapter = REGISTRY[key];
  if (!adapter) {
    throw new AppError(
      "ITP_PAYMENT_NOT_CONFIGURED",
      `Payment provider "${key}" belum terdaftar.`
    );
  }

  return assertPaymentProvider(adapter);
}

export function listPaymentProviders() {
  return Object.values(REGISTRY);
}

/** Diagnostics for /dev/settings — names, never values. */
export function paymentDiagnostics() {
  const code = (process.env.PAYMENT_PROVIDER || "").trim().toLowerCase();
  const adapter = code ? REGISTRY[code] : null;
  return {
    selected: code || null,
    registered: Boolean(adapter),
    configured: Boolean(adapter?.isConfigured?.()),
    missing: adapter?.configurationGaps?.().missing ?? [],
    registeredCodes: Object.keys(REGISTRY),
  };
}

export { REGISTRY as PAYMENT_PROVIDER_REGISTRY };

// ── Method → adapter resolution ──────────────────────────────────────────────
// An internal payment METHOD (src/config/payment.js) is not the same thing as a
// payment PROVIDER (this registry). Several methods are served by one adapter —
// every method here is served by Midtrans — but the indirection is kept so a
// second gateway can be added later without touching the catalogue or the UI.
//
// A method key absent from this map is UNSERVABLE, which is how a typo'd key
// fails loudly at checkout instead of silently charging nobody. This is also
// what RETIRES the manual methods: no `manual_bank_*` / `manual_ewallet_*` key
// appears below, so those keys resolve to null and are refused — both in the
// checkout list and by the server at order creation.
const METHOD_PROVIDER_EXACT = {
  qris: "midtrans",
  card_credit: "midtrans",
  card_debit: "midtrans",
  ewallet_gopay: "midtrans",
  ewallet_shopeepay: "midtrans",
  // Retail outlets are Midtrans cstore channels.
  retail_alfamart: "midtrans",
  retail_indomaret: "midtrans",
};

const METHOD_PROVIDER_PREFIX = [
  // Virtual accounts: `va_bca`, `va_bni`, … — all Midtrans VA channels.
  ["va_", "midtrans"],
];

/** The adapter code serving a method key, or null when nothing serves it. */
export function resolveProviderCodeForMethod(methodKey) {
  const key = String(methodKey || "");
  if (METHOD_PROVIDER_EXACT[key]) return METHOD_PROVIDER_EXACT[key];
  for (const [prefix, code] of METHOD_PROVIDER_PREFIX) {
    if (key.startsWith(prefix)) return code;
  }
  return null;
}

/**
 * Whether a payment method can actually be used right now: an adapter serves it
 * AND that adapter is configured.
 *
 * Used by the order service so an order is never created for a method that
 * cannot produce payment instructions — otherwise the customer reaches a dead
 * checkout after their order already exists.
 *
 * @returns {{ ok: boolean, reason?: string, providerCode?: string }}
 */
export function checkMethodServable(methodKey) {
  const code = resolveProviderCodeForMethod(methodKey);
  if (!code) {
    return { ok: false, reason: "Metode pembayaran belum tersedia." };
  }
  const adapter = REGISTRY[code];
  if (!adapter) {
    return { ok: false, reason: "Metode pembayaran belum terdaftar." };
  }

  // Prefer a method-level check when the adapter provides one. An adapter can be
  // configured for one channel and not another (bank accounts present, e-wallet
  // numbers absent), and the adapter-wide check cannot see that difference — it
  // would offer a method whose instructions cannot be produced.
  if (typeof adapter.isMethodServable === "function") {
    const result = adapter.isMethodServable(methodKey);
    if (!result?.ok) {
      return { ok: false, reason: result?.reason || "Metode pembayaran belum dikonfigurasi." };
    }
    return { ok: true, providerCode: code };
  }

  if (!adapter.isConfigured?.()) {
    return { ok: false, reason: "Metode pembayaran belum dikonfigurasi." };
  }
  return { ok: true, providerCode: code };
}
