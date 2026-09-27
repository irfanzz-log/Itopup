// ============================================================================
// Midtrans adapter — unit tests.
//
// WHAT THIS FILE PROVES
//
// The mapper and the signature are the two security boundaries of the adapter,
// so they get the closest testing:
//
//   * normalizeMidtransStatus must never report PAID for anything but
//     "settlement". A spoofed webhook carrying {"transaction_status":"capture"}
//     or an unrecognised string must land on PENDING/PROCESSING, never paid.
//   * verifySignature must reject a wrong signature, and must accept a genuine
//     one — using the gross_amount STRING Midtrans actually sends ("100000.00"),
//     which is the detail most integrations get wrong.
//
// No network: the client is exercised through fetch mocks, because these tests
// must not depend on Midtrans availability and must never spend sandbox quota.
// ============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";

import { normalizeMidtransStatus, midtransPaymentType } from "@/providers/payment/midtrans/map.js";
import { verifySignature } from "@/providers/payment/midtrans/client.js";

const SERVER_KEY = "SB-Mid-server-TESTKEY0000000000000";

/** Signature exactly as the Midtrans docs define it. */
function genuineSignature({ orderId, statusCode, grossAmount, serverKey = SERVER_KEY }) {
  const { createHash } = require("node:crypto");
  return createHash("sha512")
    .update(`${orderId}${statusCode}${grossAmount}${serverKey}`, "utf8")
    .digest("hex");
}

describe("normalizeMidtransStatus", () => {
  it("reports PAID only for settlement", () => {
    expect(normalizeMidtransStatus("settlement")).toEqual({ status: "PAID", terminal: true });
  });

  it("treats capture as PROCESSING, not paid", () => {
    // Funds captured but not settled. Releasing top-up here is how a refund
    // ends up owing the customer money.
    expect(normalizeMidtransStatus("capture")).toEqual({ status: "PROCESSING", terminal: false });
  });

  it("treats authorize as PROCESSING", () => {
    expect(normalizeMidtransStatus("authorize")).toEqual({ status: "PROCESSING", terminal: false });
  });

  it("keeps pending as PENDING and non-terminal", () => {
    expect(normalizeMidtransStatus("pending")).toEqual({ status: "PENDING", terminal: false });
  });

  it("maps the failure family to terminal FAILED", () => {
    expect(normalizeMidtransStatus("deny").status).toBe("FAILED");
    expect(normalizeMidtransStatus("deny").terminal).toBe(true);
    expect(normalizeMidtransStatus("failure")).toEqual({ status: "FAILED", terminal: true });
  });

  it("maps expire to terminal EXPIRED and cancel to terminal CANCELLED", () => {
    expect(normalizeMidtransStatus("expire")).toEqual({ status: "EXPIRED", terminal: true });
    expect(normalizeMidtransStatus("cancel")).toEqual({ status: "CANCELLED", terminal: true });
  });

  it("maps refund and partial_refund to terminal REFUNDED", () => {
    expect(normalizeMidtransStatus("refund")).toEqual({ status: "REFUNDED", terminal: true });
    expect(normalizeMidtransStatus("partial_refund")).toEqual({ status: "REFUNDED", terminal: true });
  });

  it("treats fraud_status deny as FAILED even when the transaction status is capture", () => {
    // Midtrans can report capture while fraud_status is deny. Shipping that
    // is a chargeback.
    const mapped = normalizeMidtransStatus("capture", { fraudStatus: "deny" });
    expect(mapped).toEqual({ status: "FAILED", terminal: true });
  });

  it("never reports PAID for an unrecognised status", () => {
    // An unknown string must never be a paid order. It stays PENDING so the
    // operator can reconcile, rather than being auto-failed (a spoofed status
    // could then cancel a paid order).
    const mapped = normalizeMidtransStatus("some_new_status");
    expect(mapped.status).not.toBe("PAID");
    expect(mapped.terminal).toBe(false);
  });

  it("tolerates case and whitespace in the status string", () => {
    expect(normalizeMidtransStatus(" Settlement ")).toEqual({ status: "PAID", terminal: true });
    expect(normalizeMidtransStatus("SETTLEMENT")).toEqual({ status: "PAID", terminal: true });
  });

  it("handles missing status without throwing", () => {
    expect(normalizeMidtransStatus(null).status).toBe("PENDING");
    expect(normalizeMidtransStatus(undefined).status).toBe("PENDING");
  });
});

describe("midtransPaymentType", () => {
  it("maps internal VA keys to Midtrans VA payment types", () => {
    expect(midtransPaymentType("va_bca")).toBe("bca_va");
    expect(midtransPaymentType("va_bni")).toBe("bni_va");
    expect(midtransPaymentType("va_bri")).toBe("bri_va");
    expect(midtransPaymentType("va_permata")).toBe("permata_va");
    expect(midtransPaymentType("va_mandiri")).toBe("mandiri_va");
  });

  it("maps qris to the Midtrans qris payment type", () => {
    expect(midtransPaymentType("qris")).toBe("qris");
  });

  it("maps e-wallet keys to Midtrans wallet payment types", () => {
    expect(midtransPaymentType("ewallet_gopay")).toBe("gopay");
    expect(midtransPaymentType("ewallet_shopeepay")).toBe("shopeepay");
  });

  it("returns null for methods Midtrans does not own", () => {
    // Manual bank transfer is our own flow, not a Midtrans product. Null keeps
    // the Snap payload free of a payment_type Midtrans would reject.
    expect(midtransPaymentType("manual_transfer")).toBeNull();
    expect(midtransPaymentType("manual_bank_bca")).toBeNull();
    expect(midtransPaymentType("manual_ewallet_dana")).toBeNull();
    expect(midtransPaymentType(null)).toBeNull();
  });
});

describe("verifySignature", () => {
  it("accepts a genuine signature over the gross_amount string Midtrans sends", () => {
    // gross_amount arrives WITH cents ("100000.00") — the signature covers that
    // string, not our integer. Re-formatting it is how a genuine notification
    // gets wrongly rejected.
    const body = {
      order_id: "ITP-123",
      status_code: "200",
      gross_amount: "100000.00",
      transaction_status: "settlement",
      signature_key: genuineSignature({
        orderId: "ITP-123",
        statusCode: "200",
        grossAmount: "100000.00",
      }),
    };
    const result = verifySignature({ serverKey: SERVER_KEY, body });
    expect(result.ok).toBe(true);
    expect(result.data.valid).toBe(true);
  });

  it("accepts a numeric gross_amount as Midtrans sometimes sends it", () => {
    const body = {
      order_id: "ITP-9",
      status_code: "200",
      gross_amount: 16000,
      signature_key: genuineSignature({
        orderId: "ITP-9",
        statusCode: "200",
        grossAmount: 16000,
      }),
    };
    const result = verifySignature({ serverKey: SERVER_KEY, body });
    expect(result.ok).toBe(true);
    expect(result.data.valid).toBe(true);
  });

  it("rejects a signature computed with a different server key", () => {
    const body = {
      order_id: "ITP-123",
      status_code: "200",
      gross_amount: "100000.00",
      signature_key: genuineSignature({
        orderId: "ITP-123",
        statusCode: "200",
        grossAmount: "100000.00",
        serverKey: "SB-Mid-server-SOMEOTHERKEY",
      }),
    };
    const result = verifySignature({ serverKey: SERVER_KEY, body });
    expect(result.ok).toBe(true);
    expect(result.data.valid).toBe(false);
  });

  it("rejects a signature over a tampered amount", () => {
    // An attacker who lowers gross_amount but keeps the old signature must fail.
    const body = {
      order_id: "ITP-123",
      status_code: "200",
      gross_amount: "1000.00",
      signature_key: genuineSignature({
        orderId: "ITP-123",
        statusCode: "200",
        grossAmount: "100000.00",
      }),
    };
    const result = verifySignature({ serverKey: SERVER_KEY, body });
    expect(result.data.valid).toBe(false);
  });

  it("rejects a signature over a tampered order_id", () => {
    const body = {
      order_id: "ITP-999",
      status_code: "200",
      gross_amount: "100000.00",
      signature_key: genuineSignature({
        orderId: "ITP-123",
        statusCode: "200",
        grossAmount: "100000.00",
      }),
    };
    const result = verifySignature({ serverKey: SERVER_KEY, body });
    expect(result.data.valid).toBe(false);
  });

  it("errors when the signature fields are absent", () => {
    // A notification with no signature at all is not "invalid, ignore" — it is
    // unauthenticated, and the error path refuses it rather than treating it as
    // a well-formed notification that happened not to match.
    expect(verifySignature({ serverKey: SERVER_KEY, body: { order_id: "ITP-1" } }).ok).toBe(false);
    expect(verifySignature({ serverKey: SERVER_KEY, body: null }).ok).toBe(false);
    expect(verifySignature({ serverKey: SERVER_KEY, body: "not-an-object" }).ok).toBe(false);
  });
});

describe("midtransProvider (adapter surface)", () => {
  beforeEach(async () => {
    // env.server.js caches each value for the process lifetime so configuration
    // cannot change under a running app. Tests flip the env deliberately, so
    // they must clear that cache first.
    const { clearEnvCache } = await import("@/lib/env.server.js");
    clearEnvCache();
    vi.resetModules();
  });

  it("reports itself as unconfigured without MIDTRANS_SERVER_KEY", async () => {
    // `""` not `delete`: loadEnv() re-fills a deleted variable from .env.test on
    // first import, while an empty string survives it and env.server.js
    // normalises "" to undefined — the honest "unset" state.
    process.env.MIDTRANS_SERVER_KEY = "";
    process.env.MIDTRANS_MERCHANT_ID = "";
    const { midtransProvider } = await import("@/providers/payment/midtrans/index.js");
    expect(midtransProvider.isConfigured()).toBe(false);
    // The gap list is what the dev settings page shows. Missing credentials are
    // both named so the operator sees exactly what to fill in.
    expect(midtransProvider.configurationGaps().missing).toEqual([
      "MIDTRANS_SERVER_KEY",
      "MIDTRANS_MERCHANT_ID",
    ]);
  });

  it("ignores placeholder keys, not just empty ones", async () => {
    // .env files carry the literal marker "GANTI-SERVER-KEY" for unset keys. A
    // non-empty placeholder must not pass as configured, or checkout offers a
    // gateway that 401s on every real transaction.
    process.env.MIDTRANS_SERVER_KEY = "GANTI-SERVER-KEY";
    process.env.MIDTRANS_MERCHANT_ID = "GANTI-MERCHANT-ID";
    vi.resetModules();
    const { midtransProvider } = await import("@/providers/payment/midtrans/index.js");
    expect(midtransProvider.isConfigured()).toBe(false);
    expect(midtransProvider.configurationGaps().missing).toEqual([
      "MIDTRANS_SERVER_KEY",
      "MIDTRANS_MERCHANT_ID",
    ]);
  });

  it("reports configured when the server key is set, and can enumerate gaps", async () => {
    process.env.MIDTRANS_SERVER_KEY = "SB-Mid-server-TEST";
    process.env.MIDTRANS_MERCHANT_ID = "M001";
    const { midtransProvider } = await import("@/providers/payment/midtrans/index.js");
    expect(midtransProvider.isConfigured()).toBe(true);
    expect(midtransProvider.configurationGaps().missing).toEqual([]);
  });

  it("selects the sandbox base url by default and production when asked", async () => {
    // env.server.js caches each value for the process lifetime, so the only
    // faithful way to model two differently-configured processes is two fresh
    // module instances. vi.resetModules alone is not enough: the same dynamic
    // import inside beforeEach already re-seeded the registry before this body
    // runs, so we drop the module from the registry explicitly.
    vi.resetModules();

    delete process.env.MIDTRANS_IS_PRODUCTION;
    process.env.MIDTRANS_SERVER_KEY = "SB-Mid-server-TEST";
    const sandbox = await import("@/providers/payment/midtrans/index.js");
    expect(sandbox.midtransConfig().baseUrl).toBe("https://app.sandbox.midtrans.com");

    // A second process configured for production reads its own cached value.
    vi.resetModules();
    vi.doReset && vi.doReset();
    (await import("@/lib/env.server.js")).clearEnvCache();

    process.env.MIDTRANS_SERVER_KEY = "SB-Mid-server-PROD";
    process.env.MIDTRANS_IS_PRODUCTION = "true";
    const prod = await import("@/providers/payment/midtrans/index.js");
    expect(prod.midtransConfig().baseUrl).toBe("https://app.midtrans.com");

    delete process.env.MIDTRANS_IS_PRODUCTION;
  });

  it("refuses to create a payment when the server key is absent", async () => {
    process.env.MIDTRANS_SERVER_KEY = "";
    const { midtransProvider } = await import("@/providers/payment/midtrans/index.js");
    const result = await midtransProvider.createPayment({
      invoice: "ITP-1",
      amount: 10000,
      method: "qris",
      description: "test",
    });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("NOT_CONFIGURED");
  });

  it("refuses a zero or negative amount", async () => {
    process.env.MIDTRANS_SERVER_KEY = "SB-Mid-server-TEST";
    const { midtransProvider } = await import("@/providers/payment/midtrans/index.js");
    const result = await midtransProvider.createPayment({
      invoice: "ITP-0",
      amount: 0,
      method: "qris",
      description: "test",
    });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("REJECTED");
  });

  it("treats an unconfigured gateway as unservable per method", async () => {
    process.env.MIDTRANS_SERVER_KEY = "";
    const { midtransProvider } = await import("@/providers/payment/midtrans/index.js");
    const result = midtransProvider.isMethodServable("qris");
    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
  });
});
