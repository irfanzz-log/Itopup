// ============================================================================
// Midtrans adapter, unit tests.
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
//     one, using the gross_amount STRING Midtrans actually sends ("100000.00"),
//     which is the detail most integrations get wrong.
//
// No network: the client is exercised through fetch mocks, because these tests
// must not depend on Midtrans availability and must never spend sandbox quota.
// ============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";

import { normalizeMidtransStatus, midtransPaymentType, midtransVaBank, midtransCstoreStore } from "@/providers/payment/midtrans/map.js";
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
  it("maps internal VA keys to Midtrans bank_transfer channels", () => {
    // Core API has ONE payment_type for the VA family, "bank_transfer", and
    // the bank is a separate `bank_transfer.bank` field (see midtransVaBank).
    expect(midtransPaymentType("va_bca")).toBe("bank_transfer");
    expect(midtransPaymentType("va_bni")).toBe("bank_transfer");
    expect(midtransPaymentType("va_bri")).toBe("bank_transfer");
    expect(midtransPaymentType("va_permata")).toBe("bank_transfer");
  });

  it("maps va_mandiri to the echannel payment type", () => {
    // Mandiri is not a bank_transfer in Core API: it returns bill_key +
    // biller_code instead of a va_number, so it has its own payment_type.
    expect(midtransPaymentType("va_mandiri")).toBe("echannel");
  });

  it("resolves the bank value for a VA method", () => {
    expect(midtransVaBank("va_bca")).toBe("bca");
    expect(midtransVaBank("va_bni")).toBe("bni");
    expect(midtransVaBank("va_bri")).toBe("bri");
    expect(midtransVaBank("va_permata")).toBe("permata");
    // Mandiri is echannel, it has no bank_transfer.bank value.
    expect(midtransVaBank("va_mandiri")).toBeNull();
  });

  it("maps retail methods to the cstore payment type and store", () => {
    expect(midtransPaymentType("retail_alfamart")).toBe("cstore");
    expect(midtransPaymentType("retail_indomaret")).toBe("cstore");
    expect(midtransCstoreStore("retail_alfamart")).toBe("alfamart");
    expect(midtransCstoreStore("retail_indomaret")).toBe("indomaret");
  });

  it("maps qris to the Midtrans qris payment type", () => {
    expect(midtransPaymentType("qris")).toBe("qris");
  });

  it("maps e-wallet keys to Midtrans wallet payment types", () => {
    // These keys are no longer OFFERED at checkout, QRIS covers both wallets,
    // but historical orders charged through them must still reconcile, so the
    // mapping is kept.
    expect(midtransPaymentType("ewallet_gopay")).toBe("gopay");
    expect(midtransPaymentType("ewallet_shopeepay")).toBe("shopeepay");
  });

  it("routes debit cards through the credit_card channel", () => {
    // Midtrans has no "debit_card" payment_type; BIN/acquirer routing decides
    // which network a card hits. Sending "debit_card" would be a 400.
    expect(midtransPaymentType("card_credit")).toBe("credit_card");
    expect(midtransPaymentType("card_debit")).toBe("credit_card");
  });

  it("returns null for methods Midtrans does not own", () => {
    // Manual bank transfer is our own flow, not a Midtrans product. Null keeps
    // the charge payload free of a payment_type Midtrans would reject.
    expect(midtransPaymentType("manual_transfer")).toBeNull();
    expect(midtransPaymentType("manual_bank_bca")).toBeNull();
    expect(midtransPaymentType("manual_ewallet_dana")).toBeNull();
    expect(midtransPaymentType(null)).toBeNull();
  });
});

describe("verifySignature", () => {
  it("accepts a genuine signature over the gross_amount string Midtrans sends", () => {
    // gross_amount arrives WITH cents ("100000.00"), the signature covers that
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
    // A notification with no signature at all is not "invalid, ignore", it is
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
    // normalises "" to undefined, the honest "unset" state.
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
    expect(sandbox.midtransConfig().baseUrl).toBe("https://api.sandbox.midtrans.com");

    // A second process configured for production reads its own cached value.
    vi.resetModules();
    vi.doReset && vi.doReset();
    (await import("@/lib/env.server.js")).clearEnvCache();

    process.env.MIDTRANS_SERVER_KEY = "SB-Mid-server-PROD";
    process.env.MIDTRANS_IS_PRODUCTION = "true";
    const prod = await import("@/providers/payment/midtrans/index.js");
    expect(prod.midtransConfig().baseUrl).toBe("https://api.midtrans.com");

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

  // ── Payload shape regressions ─────────────────────────────────────────────
  // Each of these was found by charging the real sandbox and catching a 400 or
  // a missing instrument. They are replayed against a stubbed fetch so the
  // shapes Midtrans requires stay required, with no network and no quota.

  /** Capture the JSON body the adapter would POST to /v2/charge. */
  async function chargeWithStub({ method, amount = 125_000, gatewayResponse }) {
    process.env.MIDTRANS_SERVER_KEY = "SB-Mid-server-TEST";
    process.env.MIDTRANS_MERCHANT_ID = "M001";
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    const calls = [];

    vi.resetModules();
    const { clearEnvCache } = await import("@/lib/env.server.js");
    clearEnvCache();

    globalThis.fetch = vi.fn(async () => ({
      status: 201,
      text: async () => JSON.stringify(gatewayResponse),
    }));
    calls.push("fetch-installed");

    const { midtransProvider } = await import("@/providers/payment/midtrans/index.js");
    const result = await midtransProvider.createPayment({
      invoice: "ITP-STUB-1",
      amount,
      method,
      description: "Top up test",
      customerName: "Tester",
      customerEmail: "test@itopup.local",
      expiresAt: null,
    });

    const lastCall = globalThis.fetch.mock.calls[globalThis.fetch.mock.calls.length - 1];
    globalThis.fetch.mockClear();
    return { result, body: lastCall?.[1]?.body };
  }

  it("sends bank_transfer.bank for a VA method, not a bare payment_type", async () => {
    const { body } = await chargeWithStub({
      method: "va_bca",
      gatewayResponse: sampleVaResponse("bca"),
    });
    const payload = JSON.parse(body);
    expect(payload.payment_type).toBe("bank_transfer");
    // "bank_transfer" alone does not say WHICH bank, without this Midtrans
    // cannot issue the VA.
    expect(payload.bank_transfer).toEqual({ bank: "bca" });
  });

  it("sends the echannel object for Mandiri, which Midtrans 400s without", async () => {
    // payment_type "echannel" with no echannel body is a hard 400 from Midtrans:
    // "echannel is required". This is the bug that hid until a live charge.
    const { body } = await chargeWithStub({
      method: "va_mandiri",
      gatewayResponse: sampleEchannelResponse(),
    });
    const payload = JSON.parse(body);
    expect(payload.payment_type).toBe("echannel");
    expect(payload.echannel).toBeDefined();
    expect(payload.echannel.bill_info1).toContain("ITP-STUB-1");
  });

  it("sends a callback_url for direct e-wallet charges, which Midtrans 400s without", async () => {
    // REGRESSION GUARD FOR HISTORICAL ORDERS. The direct wallet methods are no
    // longer offered, QRIS covers GoPay/ShopeePay, but payments already
    // charged through `ewallet_gopay` / `ewallet_shopeepay` are still live at
    // the gateway and still reconcile. This pins the payload shape so a refactor
    // cannot break a payment a customer is mid-way through.
    //
    // The two wallets ask for the URL in DIFFERENT places, and the wrong place
    // is a hard 400: ShopeePay takes a `shopeepay: {callback_url}` object and
    // ignores everything else; GoPay takes `callback_url` at the root.
    const shopee = await chargeWithStub({
      method: "ewallet_shopeepay",
      amount: 15_000,
      gatewayResponse: sampleQrResponse("shopeepay"),
    });
    const shopeeBody = JSON.parse(shopee.body);
    expect(shopeeBody.shopeepay?.callback_url).toMatch(/^http/);
    // The root key and the Snap-style object must NOT be sent for ShopeePay,
    // neither is honoured, and a stale `callbacks` would only confuse a reader.
    expect(shopeeBody.callback_url).toBeUndefined();
    expect(shopeeBody.callbacks).toBeUndefined();

    const gopay = await chargeWithStub({
      method: "ewallet_gopay",
      amount: 15_000,
      gatewayResponse: sampleQrResponse("gopay"),
    });
    expect(JSON.parse(gopay.body).callback_url).toMatch(/^http/);

    const qris = await chargeWithStub({
      method: "qris",
      amount: 15_000,
      gatewayResponse: sampleQrResponse("qris"),
    });
    // QRIS must NOT carry a wallet redirect callback of any shape.
    const qrisBody = JSON.parse(qris.body);
    expect(qrisBody.callbacks).toBeUndefined();
    expect(qrisBody.callback_url).toBeUndefined();
    expect(qrisBody.shopeepay).toBeUndefined();
  });

  it("refuses card methods instead of letting Midtrans reject them", async () => {
    // credit_card requires a browser-made token_id this app never produces, so
    // charging it server-side is a guaranteed 400. NOT_IMPLEMENTED names the
    // real reason to the operator instead of surfacing a gateway error.
    const { result } = await chargeWithStub({
      method: "card_credit",
      amount: 50_000,
      gatewayResponse: {},
    });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("NOT_IMPLEMENTED");
  });

  it("normalises permata_va_number into the va_numbers shape", async () => {
    // Permata is the one VA bank Midtrans returns as a top-level string rather
    // than a va_numbers array. Without this normalisation the instruction
    // builder sees an empty VA list and renders "not issued yet" for a charge
    // that succeeded.
    const { result } = await chargeWithStub({
      method: "va_permata",
      gatewayResponse: samplePermataResponse(),
    });
    expect(result.ok).toBe(true);
    expect(result.data.instructions.kind).toBe("va");
    expect(result.data.instructions.destinations).toHaveLength(1);
    expect(result.data.instructions.destinations[0].number).toBe("7980095679942073");
  });

  it("extracts a VA number, a QR string, and a payment code from the right fields", async () => {
    const va = await chargeWithStub({ method: "va_bca", gatewayResponse: sampleVaResponse("bca") });
    expect(va.result.data.instructions.destinations[0].number).toBe("79802832467703321191518");

    const qr = await chargeWithStub({
      method: "qris",
      amount: 15_000,
      gatewayResponse: sampleQrResponse("qris"),
    });
    expect(qr.result.data.instructions.kind).toBe("qr");
    expect(qr.result.data.instructions.qrString).toBeTruthy();
    expect(qr.result.data.instructions.qrImageUrl).toMatch(/generate-qr-code|qr-code/);

    const cstore = await chargeWithStub({
      method: "retail_alfamart",
      amount: 25_000,
      gatewayResponse: sampleCstoreResponse("alfamart"),
    });
    expect(cstore.result.data.instructions.kind).toBe("cstore");
    expect(cstore.result.data.instructions.destinations[0].number).toBe("4573766435204652");
  });

  // ---------------------------------------------------------------------------
  // A partner outage must be classified as UNAVAILABLE, not UNKNOWN.
  //
  // Midtrans serves a bank/partner failure INSIDE an HTTP 200:
  //   {"status_code":"502","status_message":"Sorry. The bank/payment partner
  //    is experiencing issues. Please retry later."}
  // Before the body status was honoured across the 4xx/5xx range, the 502 in the
  // body did not match the 4xx-only isBusinessRejection check, so the charge
  // fell through to `charge_bad_body` and surfaced as a meaningless
  // "Respon server pembayaran tidak berisi data transaksi.", with `status: 200`
  // in the error log, which made a partner outage look like our own parse bug.
  // ---------------------------------------------------------------------------
  it("classifies a 502 body status as UNAVAILABLE and keeps the message out of the UI", async () => {
    const { result } = await chargeWithStub({
      method: "qris",
      amount: 103_620,
      gatewayResponse: {
        status_code: "502",
        status_message: "Sorry. The bank/payment partner is experiencing issues. Please retry later.",
      },
    });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("UNAVAILABLE");
    expect(result.error.retryable).toBe(true);
    // The raw body is carried at the top level for the operator log.
    expect(result.raw).toBeTruthy();
    // The message is sanitized, the customer must never see the partner's name
    // or an English gateway string.
    expect(result.error.message).not.toMatch(/partner|Sorry/i);
  });

  it("classifies a body 406 as DUPLICATE so the caller can cancel and re-charge", async () => {
    const { result } = await chargeWithStub({
      method: "qris",
      gatewayResponse: { status_code: "406", status_message: "Order id has been taken" },
    });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("DUPLICATE");
  });
});

/** Sample /v2/charge response bodies, shaped exactly as the sandbox returns them. */
function sampleVaResponse(bank) {
  return {
    status_code: "201",
    transaction_id: `va-${bank}-1`,
    order_id: "ITP-STUB-1",
    gross_amount: "125000.00",
    payment_type: "bank_transfer",
    transaction_status: "pending",
    fraud_status: "accept",
    va_numbers: [{ bank, va_number: "79802832467703321191518" }],
    expiry_time: "2026-09-28 10:59:58",
  };
}

function samplePermataResponse() {
  // Permata has no va_numbers array, the number sits at the top level.
  return {
    status_code: "201",
    transaction_id: "va-permata-1",
    order_id: "ITP-STUB-1",
    gross_amount: "125000.00",
    payment_type: "bank_transfer",
    transaction_status: "pending",
    fraud_status: "accept",
    permata_va_number: "7980095679942073",
    expiry_time: "2026-09-28 10:59:58",
  };
}

function sampleEchannelResponse() {
  return {
    status_code: "201",
    transaction_id: "echannel-1",
    order_id: "ITP-STUB-1",
    gross_amount: "125000.00",
    payment_type: "echannel",
    transaction_status: "pending",
    fraud_status: "accept",
    bill_key: "749036720186",
    biller_code: "70012",
    expiry_time: "2026-09-28 11:01:24",
  };
}

function sampleQrResponse(paymentType) {
  return {
    status_code: "201",
    transaction_id: `qr-${paymentType}-1`,
    order_id: "ITP-STUB-1",
    gross_amount: "15000.00",
    payment_type: paymentType,
    transaction_status: "pending",
    fraud_status: "accept",
    qr_string: "00020101021226620014COM.GO-JEK.WWW",
    actions: [
      { name: "generate-qr-code", method: "GET", url: `https://api.sandbox.midtrans.com/v2/qris/qr-${paymentType}-1/qr-code` },
    ],
    expiry_time: "2026-09-27 11:14:58",
  };
}

function sampleCstoreResponse(store) {
  return {
    status_code: "201",
    transaction_id: `cstore-${store}-1`,
    order_id: "ITP-STUB-1",
    gross_amount: "25000.00",
    payment_type: "cstore",
    transaction_status: "pending",
    fraud_status: "accept",
    payment_code: "4573766435204652",
    store,
    expiry_time: "2026-09-28 11:01:24",
  };
}
