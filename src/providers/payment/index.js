// ============================================================================
// Payment provider registry.
//
// The registry is EMPTY on purpose: no gateway has been selected, and an
// adapter cannot be written without that gateway's documentation. The core app
// asks for a payment provider and gets a precise error instead of a stub that
// pretends to charge someone.
//
// Adding a gateway later:
//   1. create src/providers/payment/<code>/{client,map,index}.js implementing
//      the contract in ./contract.js,
//   2. register it in REGISTRY below,
//   3. set PAYMENT_PROVIDER=<code> plus its credentials in the environment,
//   4. flip the relevant entries in src/config/payment.js to `enabled: true`.
// No page, service, or route handler changes — that is the point.
// ============================================================================
import { AppError } from "@/lib/errors";
import { assertPaymentProvider } from "./contract.js";
import { manualTransferProvider } from "./manual/index.js";

/** @type {Record<string, object>} */
const REGISTRY = {
  // Manual bank transfer — the method that works before a gateway is chosen.
  // Its credentials are bank accounts, not an API key.
  manual: manualTransferProvider,
  // e.g. "midtrans": midtransProvider,
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
// payment PROVIDER (this registry). Several methods may be served by one adapter
// (every offline bank and e-wallet by the manual adapter), and one method may
// later be served by a different adapter without any UI change. The mapping
// lives here, next to the adapters, so a new gateway adds itself in one place.
//
// Keys are matched by PREFIX for the offline methods so that adding
// `manual_bank_cimb` to the catalogue does not require a second edit here — the
// mistake of forgetting the second edit is exactly how a method becomes visible
// in the UI but unservable at checkout.
const METHOD_PROVIDER_EXACT = {
  manual_transfer: "manual",
};

const METHOD_PROVIDER_PREFIX = [
  ["manual_bank_", "manual"],
  ["manual_ewallet_", "manual"],
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
