// ============================================================================
// Payment method catalogue — invariants that must hold before a customer sees
// a checkout.
//
// The bug these lock down: a method could be `enabled: true` in the catalogue,
// appear in the checkout, and then fail at the last step because its adapter was
// not configured. Worse, the adapter's configuration is PER CHANNEL — bank
// accounts and e-wallet numbers are separate lists — so a bank method could be
// offered while only an e-wallet number existed, sending the customer to
// instructions they could not follow.
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

/** Both channels configured — the state a live deployment is in. */
const BOTH_CHANNELS = {
  MANUAL_BANK_ACCOUNTS: JSON.stringify([
    { bank: "BCA", number: "1234567890", holder: "PT ITOPUP" },
  ]),
  MANUAL_EWALLET_NUMBERS: JSON.stringify([
    { name: "DANA", number: "081234567890", holder: "PT ITOPUP" },
  ]),
};

const ENV_KEYS = ["MANUAL_BANK_ACCOUNTS", "MANUAL_EWALLET_NUMBERS"];
const original = {};

beforeEach(() => {
  for (const key of ENV_KEYS) original[key] = process.env[key];
  Object.assign(process.env, BOTH_CHANNELS);
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
  const [config, server, registry, client] = await Promise.all([
    import("../../src/config/payment.js"),
    import("../../src/config/payment.server.js"),
    import("../../src/providers/payment/index.js"),
    import("../../src/providers/payment/manual/client.js"),
  ]);
  return { config: { ...config, ...server }, registry, client };
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

    expect(keys).toContain("manual_ewallet_dana");
    expect(keys).toContain("manual_ewallet_ovo");
    expect(keys).toContain("manual_ewallet_gopay");
    expect(keys).toContain("manual_ewallet_shopeepay");
  });

  it("still hides a method below its minimum", async () => {
    const { config } = await loadPaymentModules();
    const all = await config.availablePaymentMethods();

    // The ONE legitimate restriction survives: a bank transfer under Rp 100.000.
    const offered = config.filterMethodsForPurchase(all, { amount: 5_000 });
    expect(offered.map((m) => m.key)).not.toContain("manual_bank_bca");
    // The e-wallet floor is lower, so it stays available.
    expect(offered.map((m) => m.key)).toContain("manual_ewallet_dana");
  });
});

describe("offered methods vs servable methods", () => {
  it("offers every configured offline method when both channels exist", async () => {
    const { config } = await loadPaymentModules();
    const keys = (await config.availablePaymentMethods()).map((m) => m.key);

    // The brief: e-wallet AND multiple banks must be selectable.
    expect(keys).toContain("manual_bank_bca");
    expect(keys).toContain("manual_bank_mandiri");
    expect(keys).toContain("manual_ewallet_dana");
    expect(keys).toContain("manual_ewallet_ovo");
    expect(keys).toContain("manual_ewallet_gopay");
    expect(keys).toContain("manual_ewallet_shopeepay");
  });

  it("hides bank methods when no bank account is configured", async () => {
    process.env.MANUAL_BANK_ACCOUNTS = "";
    vi.resetModules();

    const { config } = await loadPaymentModules();
    const keys = (await config.availablePaymentMethods()).map((m) => m.key);

    expect(keys.some((k) => k.startsWith("manual_bank_"))).toBe(false);
    // The e-wallet channel is independent and must survive.
    expect(keys).toContain("manual_ewallet_dana");
  });

  it("hides e-wallet methods when no wallet number is configured", async () => {
    process.env.MANUAL_EWALLET_NUMBERS = "";
    vi.resetModules();

    const { config } = await loadPaymentModules();
    const keys = (await config.availablePaymentMethods()).map((m) => m.key);

    expect(keys.some((k) => k.startsWith("manual_ewallet_"))).toBe(false);
    expect(keys).toContain("manual_bank_bca");
  });

  it("offers nothing when neither channel is configured", async () => {
    // Clear the manual channel and the gateway channel. The gateway must be
    // cleared too: a test that set MIDTRANS_SERVER_KEY earlier in this process
    // would otherwise leak an enabled Midtrans method through the module cache
    // and make this assertion about "neither channel" wrong.
    process.env.MANUAL_BANK_ACCOUNTS = "";
    process.env.MANUAL_EWALLET_NUMBERS = "";
    delete process.env.MIDTRANS_SERVER_KEY;
    vi.resetModules();
    const { clearEnvCache } = await import("@/lib/env.server.js");
    clearEnvCache();

    const { config } = await loadPaymentModules();
    expect(await config.availablePaymentMethods()).toEqual([]);
  });

  it("reports WHY a method is unavailable instead of silently dropping it", async () => {
    process.env.MANUAL_EWALLET_NUMBERS = "";
    vi.resetModules();

    const { registry } = await loadPaymentModules();
    const result = registry.checkMethodServable("manual_ewallet_dana");

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/e-wallet/i);
  });
});

describe("legacy compatibility", () => {
  it("keeps manual_transfer resolvable for orders that already reference it", async () => {
    // Deleting the key would make getPaymentMethod return null and strand every
    // order created before the catalogue was split.
    const { config, registry } = await loadPaymentModules();

    expect(config.getPaymentMethod("manual_transfer")).toBeTruthy();
    expect(registry.resolveProviderCodeForMethod("manual_transfer")).toBe("manual");
  });

  it("does not offer manual_transfer as a new checkout option", async () => {
    const { config } = await loadPaymentModules();
    expect(config.enabledPaymentMethods().map((m) => m.key)).not.toContain("manual_transfer");
  });

  it("can still serve instructions for a legacy order", async () => {
    const { registry } = await loadPaymentModules();
    expect(registry.checkMethodServable("manual_transfer").ok).toBe(true);
  });
});

describe("channel routing", () => {
  it("routes every offline method to the correct channel", async () => {
    const { client } = await loadPaymentModules();

    expect(client.channelForMethod("manual_bank_bca")).toBe("bank");
    expect(client.channelForMethod("manual_ewallet_dana")).toBe("ewallet");
    // The legacy key defaults to bank, which is what it always meant.
    expect(client.channelForMethod("manual_transfer")).toBe("bank");
  });

  it("checks servability against the method's own channel", async () => {
    process.env.MANUAL_BANK_ACCOUNTS = "";
    process.env.MANUAL_EWALLET_NUMBERS = BOTH_CHANNELS.MANUAL_EWALLET_NUMBERS;
    vi.resetModules();

    const { client } = await loadPaymentModules();

    expect(client.isMethodConfigured("manual_ewallet_dana").ok).toBe(true);
    expect(client.isMethodConfigured("manual_bank_bca").ok).toBe(false);
  });

  it("drops a destination that is missing a field", async () => {
    // A half-configured account number must never reach a customer: showing a
    // partial number is worse than showing none.
    process.env.MANUAL_BANK_ACCOUNTS = JSON.stringify([
      { bank: "BCA", number: "1234567890", holder: "PT ITOPUP" },
      { bank: "Mandiri", number: "", holder: "PT ITOPUP" },
      { bank: "BNI", holder: "PT ITOPUP" },
    ]);
    vi.resetModules();

    const { client } = await loadPaymentModules();
    const accounts = client.loadBankAccounts();

    expect(accounts).toHaveLength(1);
    expect(accounts[0].name).toBe("BCA");
  });
});

describe("presentation helpers", () => {
  it("labels a stored method key with its human name", async () => {
    const { config } = await loadPaymentModules();

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

    expect(config.computePaymentFee(config.getPaymentMethod("manual_bank_bca"), 50_000)).toBe(0);
    // QRIS at 0.7% of 100.000 = 700 — integer arithmetic, no float drift.
    expect(config.computePaymentFee(config.getPaymentMethod("qris"), 100_000)).toBe(700);
  });

  it("refuses an amount below the method minimum, with a reason", async () => {
    const { config } = await loadPaymentModules();
    const result = config.checkMethodEligibility(config.getPaymentMethod("manual_bank_bca"), 500);

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/minimum/i);
  });
});
