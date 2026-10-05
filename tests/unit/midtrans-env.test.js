import { describe, it, expect, vi } from "vitest";
describe("midtrans env wiring", () => {
  it("reads merchant id, server key, client key from env", async () => {
    const { clearEnvCache } = await import("@/lib/env.server.js");
    clearEnvCache();
    process.env.MIDTRANS_MERCHANT_ID = "M001";
    process.env.MIDTRANS_SERVER_KEY = "SB-test";
    process.env.MIDTRANS_CLIENT_KEY = "SB-client";
    process.env.MIDTRANS_IS_PRODUCTION = "true";
    process.env.MIDTRANS_ENABLED_PAYMENTS = '["qris","bca_va"]';
    vi.resetModules();
    const { midtransConfig } = await import("@/providers/payment/midtrans/index.js");
    const c = midtransConfig();
    expect(c.merchantId).toBe("M001");
    expect(c.serverKey).toBe("SB-test");
    expect(c.baseUrl).toBe("https://api.midtrans.com");
    expect(c.isProduction).toBe(true);
    expect(c.enabledPayments).toEqual(["qris", "bca_va"]);
    expect(midtransConfig().clientKey ?? "not-read-by-server").toBe("not-read-by-server");
  });
  it("sandbox by default when MIDTRANS_IS_PRODUCTION unset", async () => {
    // loadEnv() runs at import time and may have pulled the placeholder values
    // from .env.dev into process.env, so every Midtrans var is cleared by hand
    // before this assertion, otherwise a "not configured" test silently
    // passes against leftover placeholder values.
    const { clearEnvCache } = await import("@/lib/env.server.js");
    clearEnvCache();
    // `""` not `delete`: loadEnv() re-fills a deleted variable from .env.test on
    // first import, while an empty string survives it and env.server.js
    // normalises "" to undefined, the honest "unset" state.
    process.env.MIDTRANS_IS_PRODUCTION = "";
    process.env.MIDTRANS_SERVER_KEY = "";
    process.env.MIDTRANS_MERCHANT_ID = "";
    process.env.MIDTRANS_CLIENT_KEY = "";
    process.env.MIDTRANS_ENABLED_PAYMENTS = "";
    vi.resetModules();
    const { midtransConfig } = await import("@/providers/payment/midtrans/index.js");
    expect(midtransConfig().baseUrl).toBe("https://api.sandbox.midtrans.com");
    expect(midtransConfig().serverKey).toBeNull();
  });
});
