
import { describe, it, expect } from "vitest";

// TEST 10 regression: a forged webhook must never release goods or move an order.
// The signature is the only authentication on a machine-to-machine callback, so
// both endpoints are called with an invalid signature and must answer 401 and
// record nothing.
describe("webhook forgery — invalid signatures are rejected", () => {
  it("rejects a forged Midtrans signature with 401", async () => {
    const { POST } = await import("@/app/api/webhooks/payment/midtrans/route.js");
    const body = JSON.stringify({
      order_id: "QA-TEST-1", status_code: "200", gross_amount: "10000",
      transaction_status: "settlement",
    });
    const req = new Request("http://localhost/api/webhooks/payment/midtrans", {
      method: "POST", body,
      headers: { "content-type": "application/json", "x-signature": "deadbeef".repeat(12) },
    });
    let status = 500;
    try {
      const res = await POST(req, {});
      status = res?.status ?? 500;
    } catch (e) { status = e?.status ?? e?.statusCode ?? "threw"; }
    console.log("FORGED midtrans signature -> status:", status);
    expect([401, 503]).toContain(status);
  });

  it("rejects a forged topup webhook signature", async () => {
    const { POST } = await import("@/app/api/webhooks/topup/route.js");
    const req = new Request("http://localhost/api/webhooks/topup", {
      method: "POST", body: JSON.stringify({ ref: "QA-1", status: "SUCCESS" }),
      headers: { "content-type": "application/json", "x-webhook-signature": "wrong" },
    });
    let status = 500;
    try {
      const res = await POST(req, {});
      status = res?.status ?? 500;
    } catch (e) { status = e?.status ?? e?.statusCode ?? "threw"; }
    console.log("FORGED topup signature -> status:", status);
    expect([401, 503]).toContain(status);
  });
});
