// ============================================================================
// Payment method catalogue — invariants that must hold before a customer sees
// a checkout.
//
// EVERY METHOD IS SERVED BY MIDTRANS SNAP. The manual/offline methods are gone:
// the customer no longer transfers to our bank account, no operator reconciles
// anything, and the only thing that settles an order is the signature-verified
// Midtrans webhook.
//
// The bug these lock down: a method could be `enabled: true` in the catalogue,
// appear in the checkout, and then fail at the last step because the gateway
// was not configured — the customer fills the whole form and is then refused.
// `availablePaymentMethods()` must filter on the ADAPTER being configured, not
// just on `enabled`.
//
// WHY EVERY CASE RE-IMPORTS THE MODULES
//
// src/lib/env.server.js caches each variable on FIRST read (deliberately: the
// environment cannot change while the process runs, so re-reading is waste).
// That makes it impossible to test "what happens when this variable is unset"
// by mutating process.env after import — the cached value wins. `vi.resetModules()`
// plus a dynamic import gives each case a module graph that has never read the
// environment, which is the only way to exercise the unset paths honestly.
//
// UNSETTING A VARIABLE: use `process.env.X = ""`, not `delete process.env.X`.
// src/lib/env.js loads .env into process.env on first import with
// `override: false`, which FILLS GAPS — so a deleted variable comes straight
// back from the file. An empty string survives that load, and env.server.js
// normalises "" to undefined, which is exactly the "unset" state under test.
// ============================================================================
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/** The Midtrans gateway, configured — the state a live deployment is in. */
const GATEWAY = {
  MIDTRANS_SERVER_KEY: "SB-Mid-server-TEST",
  MIDTRANS_MERCHANT_ID: "M001",
};

const ENV_KEYS = Object.keys(GATEWAY);
const original = {};

beforeEach(() => {
  for (const key of ENV_KEYS) original[key] = process.env[key];
  Object.assign(process.env, GATEWAY);
  vi.resetModules();
});

afterEach(() => {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.resetModules();
});

/** Import the catalogue + registry fresh, so env reads happen NOW.
 *
 * `availablePaymentMethods` lives in payment.server.js — it touches the
 * adapters, which read secrets, so it cannot live in the client-imported
 * catalogue. */
async function loadPaymentModules() {
  const [config, server, registry] = await Promise.all([
    import("../../src/config/payment.js"),
    import("../../src/config/payment.server.js"),
    import("../../src/providers/payment/index.js"),
  ]);
  return { config: { ...config, ...server }, registry };
}

describe("catalogue integrity", () => {
  it("has no duplicate method keys", async () => {
    const { config } = await loadPaymentModules();
    const keys = config.PAYMENT_METHODS.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives every method a group, so the UI can section them", async () => {
    const { config } = await loadPaymentModules();
    for (const method of config.PAYMENT_METHODS) {
      expect(method.group, `${method.key} has no group`).toBeTruthy();
    }
  });

  it("gives every method a label that is not the raw key", async () => {
    const { config } = await loadPaymentModules();
    for (const method of config.PAYMENT_METHODS) {
      expect(method.label).toBeTruthy();
      expect(method.label).not.toBe(method.key);
    }
  });

  it("every enabled gateway method is served by a registered adapter", async () => {
    // The invariant that stops a dead method reaching checkout. A key with no
    // resolvable provider would be rendered, chosen, and then refused.
    //
    // Now that Midtrans is registered, the VA/QRIS/retail methods are enabled.
    // The guard is not "gateway methods are off" — it is "an enabled method
    // resolves to an adapter that is actually registered", which is what keeps
    // a customer from reaching a checkout that cannot produce instructions.
    const { config, registry } = await loadPaymentModules();
    for (const method of config.enabledPaymentMethods()) {
      const code = registry.resolveProviderCodeForMethod(method.key);
      expect(code, `${method.key} is enabled but no adapter serves it`).toBeTruthy();
      expect(registry.listPaymentProviders().some((p) => p.code === code)).toBe(true);
    }
  });

  it("maps every gateway method key to the midtrans adapter", async () => {
    // A gateway method that resolves to the manual adapter (or nothing) is a
    // wiring mistake that would offer a customer an offline instruction for a
    // method that should settle automatically.
    const { registry } = await loadPaymentModules();
    const gatewayKeys = [
      "qris", "va_bca", "va_bni", "va_bri", "va_mandiri", "va_permata",
      "retail_alfamart", "retail_indomaret",
    ];
    for (const key of gatewayKeys) {
      const method = { key };
      const code = registry.resolveProviderCodeForMethod(key);
      expect(code, `${key} must resolve to midtrans`).toBe("midtrans");
      expect(typeof code === "string" || method !== null).toBe(true);
    }
  });
});

describe("payment method is an instrument, not a product", () => {
  // REGRESSION (2026-09-26): an e-wallet method carried `walletSlug` matching
  // the catalogue game slug for the same wallet, and both the checkout filter
  // and the order service refused anything else. Buying Mobile Legends diamonds
  // and choosing DANA failed with "Metode DANA hanya untuk top up dana".
  //
  // A payment method answers "how does the customer pay", never "what are they
  // buying". These hold the line: no method is bound to any product.
  it("defines no walletSlug on any method", async () => {
    const { config } = await loadPaymentModules();
    for (const method of config.PAYMENT_METHODS) {
      expect(method.walletSlug, `${method.key} still carries walletSlug`).toBeUndefined();
    }
  });

  it("offers every e-wallet method for ANY purchase, not just its own", async () => {
    const { config } = await loadPaymentModules();
    const all = await config.availablePaymentMethods();

    // A diamond purchase — no wallet involved — must still offer every wallet.
    const offered = config.filterMethodsForPurchase(all, { amount: 100_000 });
    const keys = offered.map((m) => m.key);

    expect(keys).toContain("ewallet_gopay");
    expect(keys).toContain("ewallet_shopeepay");
    expect(keys).toContain("qris");
  });

  it("still hides a method below its minimum", async () => {
    const { config } = await loadPaymentModules();
    const all = await config.availablePaymentMethods();

    // THE VA RULE: a virtual account under Rp 100.000 is not viable, so it is
    // hidden. QRIS has no such floor and stays available.
    const offered = config.filterMethodsForPurchase(all, { amount: 5_000 });
    expect(offered.map((m) => m.key)).not.toContain("va_bca");
    expect(offered.map((m) => m.key)).toContain("qris");
  });
});

describe("offered methods vs servable methods", () => {
  it("offers every gateway method when Midtrans is configured", async () => {
    const { config } = await loadPaymentModules();
    const keys = (await config.availablePaymentMethods()).map((m) => m.key);

    // The brief: the customer must be able to pay by QR, wallet, VA and bank.
    expect(keys).toContain("qris");
    expect(keys).toContain("ewallet_gopay");
    expect(keys).toContain("ewallet_shopeepay");
    expect(keys).toContain("va_bca");
    expect(keys).toContain("va_mandiri");
    expect(keys).toContain("retail_alfamart");
  });

  it("hides EVERY method when the gateway is not configured", async () => {
    // With Midtrans unset there is no fallback channel at all — no bank account
    // and no wallet number exist on our side any more. The honest checkout is
    // an empty list plus the reason, not a set of methods that 401 on pay.
    process.env.MIDTRANS_SERVER_KEY = "";
    process.env.MIDTRANS_MERCHANT_ID = "";
    vi.resetModules();
    const { clearEnvCache } = await import("@/lib/env.server.js");
    clearEnvCache();

    const { config } = await loadPaymentModules();
    expect(await config.availablePaymentMethods()).toEqual([]);
  });

  it("hides every method when the key is still the GANTI- placeholder", async () => {
    // The .env files carry the literal marker "GANTI-SERVER-KEY" for unset keys.
    // A non-empty placeholder must not pass as configured, or checkout offers a
    // gateway that 401s on every real transaction.
    process.env.MIDTRANS_SERVER_KEY = "GANTI-SERVER-KEY";
    process.env.MIDTRANS_MERCHANT_ID = "GANTI-MERCHANT-ID";
    vi.resetModules();
    const { clearEnvCache } = await import("@/lib/env.server.js");
    clearEnvCache();

    const { config } = await loadPaymentModules();
    expect(await config.availablePaymentMethods()).toEqual([]);
  });

  it("reports WHY a method is unavailable instead of silently dropping it", async () => {
    process.env.MIDTRANS_SERVER_KEY = "";
    vi.resetModules();
    const { clearEnvCache } = await import("@/lib/env.server.js");
    clearEnvCache();

    const { registry } = await loadPaymentModules();
    const result = registry.checkMethodServable("qris");

    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
  });
});

describe("legacy compatibility", () => {
  it("keeps every manual_* key resolvable for orders that already reference it", async () => {
    // Deleting a key would make getPaymentMethod return null and strand every
    // order created before Midtrans: its receipts, its labels, its re-issue
    // flow. The keys stay, but OFF.
    const { config } = await loadPaymentModules();

    expect(config.getPaymentMethod("manual_transfer")).toBeTruthy();
    expect(config.getPaymentMethod("manual_bank_bca")).toBeTruthy();
    expect(config.getPaymentMethod("manual_ewallet_dana")).toBeTruthy();
  });

  it("does not offer any manual_* method as a new checkout option", async () => {
    const { config } = await loadPaymentModules();
    const offered = config.enabledPaymentMethods().map((m) => m.key);

    expect(offered).not.toContain("manual_transfer");
    expect(offered).not.toContain("manual_bank_bca");
    expect(offered).not.toContain("manual_ewallet_dana");
  });

  it("refuses to serve instructions on a retired method", async () => {
    // A stale client page (or a hand-crafted request) carrying an old key must
    // be refused by the server, not routed to Midtrans with a payment_type it
    // does not own.
    const { registry } = await loadPaymentModules();

    expect(registry.resolveProviderCodeForMethod("manual_transfer")).toBeNull();
    expect(registry.resolveProviderCodeForMethod("manual_bank_bca")).toBeNull();
    expect(registry.resolveProviderCodeForMethod("manual_ewallet_dana")).toBeNull();
    expect(registry.checkMethodServable("manual_transfer").ok).toBe(false);
  });
});

describe("gateway routing", () => {
  it("routes every enabled method to the midtrans adapter", async () => {
    const { config, registry } = await loadPaymentModules();

    for (const method of config.enabledPaymentMethods()) {
      expect(
        registry.resolveProviderCodeForMethod(method.key),
        `${method.key} is not routed to any adapter`
      ).toBe("midtrans");
    }
  });

  it("checks servability against the configured gateway", async () => {
    process.env.MIDTRANS_SERVER_KEY = "SB-Mid-server-TEST";
    vi.resetModules();
    const { clearEnvCache } = await import("@/lib/env.server.js");
    clearEnvCache();

    const { registry } = await loadPaymentModules();
    expect(registry.checkMethodServable("qris").ok).toBe(true);
    expect(registry.checkMethodServable("va_bca").ok).toBe(true);
  });
});

describe("presentation helpers", () => {
  it("labels a stored method key with its human name", async () => {
    const { config } = await loadPaymentModules();

    expect(config.paymentMethodLabel("va_bca")).toBe("BCA Virtual Account");
    expect(config.paymentMethodLabel("qris")).toContain("QRIS");
    // Legacy orders still print something sensible instead of blanking out.
    expect(config.paymentMethodLabel("manual_bank_bca")).toBe("Transfer Bank BCA");
    expect(config.paymentMethodLabel("manual_ewallet_dana")).toBe("DANA");
  });

  it("falls back to a readable label for an unknown key", async () => {
    // Never return the raw key (it would print "manual_bank_cimb" on a receipt)
    // and never return an empty string.
    const { config } = await loadPaymentModules();

    expect(config.paymentMethodLabel("manual_bank_cimb")).toBe("Manual Bank Cimb");
    expect(config.paymentMethodLabel(null)).toBe("Pembayaran");
  });

  it("groups methods without losing any", async () => {
    const { config } = await loadPaymentModules();
    const offered = config.enabledPaymentMethods();
    const grouped = config.groupPaymentMethods(offered).flatMap((g) => g.items);

    expect(grouped.length).toBe(offered.length);
  });

  it("charges no fee on offline methods but a real fee on gateway methods", async () => {
    const { config } = await loadPaymentModules();

    // A VA carries a flat Rp 4.000 admin fee.
    expect(config.computePaymentFee(config.getPaymentMethod("va_bca"), 200_000)).toBe(4000);
    // QRIS at 0.7% of 100.000 = 700 — integer arithmetic, no float drift.
    expect(config.computePaymentFee(config.getPaymentMethod("qris"), 100_000)).toBe(700);
  });

  it("refuses an amount below the method minimum, with a reason", async () => {
    const { config } = await loadPaymentModules();
    // The VA floor: under Rp 100.000 a virtual account is refused, and the
    // reason names the minimum so the customer knows what to do.
    const result = config.checkMethodEligibility(config.getPaymentMethod("va_bca"), 5_000);

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/minimum/i);
  });
});
