// ============================================================================
// Melostore auth + webhook signature.
//
// The webhook test uses the algorithm the docs specify verbatim:
//
//   "Tanda tangan diperoleh dari hash HMAC SHA256 dari payload JSON mentah
//    menggunakan webhook_secret akun Anda."
//
// so the test computes the expected digest independently and checks the
// verifier accepts it — and, more importantly, REJECTS a tampered body.
// ============================================================================
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import {
  authorizeRequest,
  verifyCallbackSignature,
  loadAuthCredentials,
  AUTH_HEADERS,
  CALLBACK_SIGNATURE_HEADER,
} from "../../src/providers/melostore/signature.js";

const ENV_KEYS = ["MELOSTORE_API_KEY", "MELOSTORE_SECRET", "MELOSTORE_WEBHOOK_SECRET"];
const saved = {};

beforeEach(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("authorizeRequest", () => {
  it("sends the two documented auth headers", () => {
    process.env.MELOSTORE_API_KEY = "key-123";
    process.env.MELOSTORE_SECRET = "secret-456";

    const { headers } = authorizeRequest({ method: "GET" });

    expect(headers[AUTH_HEADERS.apiKey]).toBe("key-123");
    expect(headers[AUTH_HEADERS.secretKey]).toBe("secret-456");
    expect(AUTH_HEADERS.apiKey).toBe("X-API-Key");
    expect(AUTH_HEADERS.secretKey).toBe("X-Secret-Key");
  });

  it("adds Content-Type only for a request that has a body", () => {
    process.env.MELOSTORE_API_KEY = "k";
    process.env.MELOSTORE_SECRET = "s";

    expect(authorizeRequest({ method: "GET" }).headers).not.toHaveProperty("Content-Type");
    expect(authorizeRequest({ method: "POST", payload: { a: 1 } }).headers["Content-Type"]).toBe(
      "application/json"
    );
  });

  it("throws naming the missing variable, never a value", () => {
    delete process.env.MELOSTORE_API_KEY;
    process.env.MELOSTORE_SECRET = "s";

    expect(() => authorizeRequest({ method: "GET" })).toThrow(/MELOSTORE_API_KEY/);
  });
});

describe("loadAuthCredentials", () => {
  it("treats an empty string as unset", () => {
    process.env.MELOSTORE_API_KEY = "   ";
    process.env.MELOSTORE_SECRET = "";
    process.env.MELOSTORE_WEBHOOK_SECRET = "";

    const creds = loadAuthCredentials();
    expect(creds.apiKey).toBeNull();
    expect(creds.secretKey).toBeNull();
    expect(creds.missing).toEqual(["MELOSTORE_API_KEY", "MELOSTORE_SECRET"]);
    expect(creds.webhookMissing).toEqual(["MELOSTORE_WEBHOOK_SECRET"]);
  });
});

describe("verifyCallbackSignature", () => {
  const secret = "webhook-secret-under-test";
  const rawBody = JSON.stringify({
    id: "e93ad291-ffb0-40e1-b849-c1248ab02390",
    buyer_trx_id: "unique_tx_ref_001",
    status: "success",
    price_charged: 18700.0,
  });

  function headersWith(signature) {
    return new Headers(signature ? { [CALLBACK_SIGNATURE_HEADER]: signature } : {});
  }

  function sign(body, key) {
    return createHmac("sha256", key).update(body, "utf8").digest("hex");
  }

  it("accepts a correctly signed body", () => {
    process.env.MELOSTORE_WEBHOOK_SECRET = secret;
    const result = verifyCallbackSignature({ headers: headersWith(sign(rawBody, secret)), rawBody });
    expect(result.valid).toBe(true);
  });

  it("accepts an uppercase hex signature (case-insensitive comparison)", () => {
    process.env.MELOSTORE_WEBHOOK_SECRET = secret;
    const upper = sign(rawBody, secret).toUpperCase();
    expect(verifyCallbackSignature({ headers: headersWith(upper), rawBody }).valid).toBe(true);
  });

  it("REJECTS a tampered body — the whole point of the signature", () => {
    process.env.MELOSTORE_WEBHOOK_SECRET = secret;
    const signature = sign(rawBody, secret);
    const tampered = rawBody.replace('"status":"success"', '"status":"failed"');

    const result = verifyCallbackSignature({ headers: headersWith(signature), rawBody: tampered });
    expect(result.valid).toBe(false);
  });

  it("rejects a signature computed with the wrong secret", () => {
    process.env.MELOSTORE_WEBHOOK_SECRET = secret;
    const result = verifyCallbackSignature({
      headers: headersWith(sign(rawBody, "attacker-secret")),
      rawBody,
    });
    expect(result.valid).toBe(false);
  });

  it("rejects a missing signature header", () => {
    process.env.MELOSTORE_WEBHOOK_SECRET = secret;
    expect(verifyCallbackSignature({ headers: headersWith(null), rawBody }).valid).toBe(false);
  });

  it("fails CLOSED when no webhook secret is configured", () => {
    delete process.env.MELOSTORE_WEBHOOK_SECRET;
    const result = verifyCallbackSignature({ headers: headersWith(sign(rawBody, "")), rawBody });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/MELOSTORE_WEBHOOK_SECRET/);
  });

  it("does not throw on a signature of a different length", () => {
    process.env.MELOSTORE_WEBHOOK_SECRET = secret;
    // timingSafeEqual throws on length mismatch; the guard must catch this first.
    expect(() =>
      verifyCallbackSignature({ headers: headersWith("short"), rawBody })
    ).not.toThrow();
  });
});
