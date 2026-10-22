// ============================================================================
// Error-code registry contract.
//
// WHY THIS TEST EXISTS
//
// `fail()` and `AppError` both silently REWRITE an unknown code to
// ITP_INTERNAL_ERROR (see src/lib/http.js:36 and src/lib/errors.js:151). That
// fallback is right — it stops an internal code leaking to a client — but it
// also means a typo or a forgotten registry entry turns a designed 409 into a
// 500 with no error anywhere.
//
// It happened: /api/payment/cancel threw ITP_ORDER_NOT_CANCELLABLE for a paid
// order, the code was not in ERROR_STATUS, and the customer's browser received
// HTTP 500 "ITP_INTERNAL_ERROR". Monitoring would have counted a server fault
// for a perfectly ordinary state conflict.
//
// This test is the guard: every ITP_* literal that appears in src/ must have a
// status and a customer-facing message.
// ============================================================================
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { ERROR_STATUS, ERROR_MESSAGE, AppError } from "../../src/lib/errors.js";

const SRC = resolve(import.meta.dirname, "../../src");

/** Every file under src/, so a new directory cannot escape the scan. */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(js|jsx)$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Codes that are deliberately client-side only.
 *
 * ITP_NETWORK_ERROR is produced by src/lib/api-client.js when fetch itself
 * throws, i.e. no response ever existed, so no server status applies to it. It
 * is listed here rather than registered in ERROR_STATUS, because registering it
 * would imply the server can return it.
 */
const CLIENT_ONLY = new Set(["ITP_NETWORK_ERROR"]);

describe("error code registry", () => {
  const codesInSource = (() => {
    const found = new Set();
    for (const file of walk(SRC)) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/\b(ITP_[A-Z0-9_]+)\b/g)) found.add(match[1]);
    }
    return found;
  })();

  it("finds codes in the source tree (guards against a broken scan)", () => {
    expect(codesInSource.size).toBeGreaterThan(30);
  });

  it("registers a status for every ITP_* code used in src/", () => {
    const missing = [...codesInSource]
      .filter((code) => !ERROR_STATUS[code] && !CLIENT_ONLY.has(code))
      .sort();

    // The failure message names the codes so the fix is obvious.
    expect(missing, `unregistered error codes: ${missing.join(", ")}`).toEqual([]);
  });

  it("has a customer-facing message for every registered code", () => {
    const missing = Object.keys(ERROR_STATUS)
      .filter((code) => !ERROR_MESSAGE[code])
      .sort();
    expect(missing, `codes without a message: ${missing.join(", ")}`).toEqual([]);
  });

  it("keeps every registered status a plausible HTTP code", () => {
    for (const [code, status] of Object.entries(ERROR_STATUS)) {
      expect(Number.isInteger(status), `${code} status must be an integer`).toBe(true);
      expect(status, `${code} status out of range`).toBeGreaterThanOrEqual(400);
      expect(status, `${code} status out of range`).toBeLessThan(600);
    }
  });
});

describe("AppError keeps a registered code", () => {
  it("preserves ITP_ORDER_NOT_CANCELLABLE as a 409", () => {
    const err = new AppError("ITP_ORDER_NOT_CANCELLABLE", "Transaksi ini sudah berakhir.");
    expect(err.code).toBe("ITP_ORDER_NOT_CANCELLABLE");
    expect(err.status).toBe(409);
  });

  it("preserves ITP_METHOD_NOT_ALLOWED as a 405", () => {
    const err = new AppError("ITP_METHOD_NOT_ALLOWED");
    expect(err.status).toBe(405);
  });

  it("still degrades an UNKNOWN code to a 500, on purpose", () => {
    // The fallback itself is correct: an unrecognised code must not leak.
    const err = new AppError("ITP_NOT_A_REAL_CODE");
    expect(err.code).toBe("ITP_INTERNAL_ERROR");
    expect(err.status).toBe(500);
  });

  it("never loses a credential code to the fallback", () => {
    for (const code of ["ITP_CREDENTIAL_NOT_FOUND", "ITP_CREDENTIAL_UNAVAILABLE"]) {
      const err = new AppError(code);
      expect(err.code, code).toBe(code);
      expect(err.status, code).toBe(ERROR_STATUS[code]);
    }
  });
});
