// ============================================================================
// The checkout sign-in gate.
//
// The bug these tests pin was live and silent: a guest who filled the whole
// form and pressed "Lanjut ke Pembayaran" stayed on the page reading "Silakan
// masuk terlebih dahulu". `apiFetch` returns the HTTP status inside `error`
// (`{ ok: false, error: { code, status } }`) while the component tested
// `result.status === 401` — `undefined === 401`, forever. Nothing failed,
// because nothing was asserting it.
//
// Each assertion below is written to FAIL against that version: it feeds the
// real envelope shape and requires the guest decision to come out true.
// ============================================================================
import { describe, it, expect } from "vitest";
import {
  isUnauthorized,
  checkoutReturnPath,
  loginUrlFor,
} from "../../src/lib/checkout-session.js";

describe("isUnauthorized", () => {
  it("recognises the real apiFetch failure envelope", () => {
    // The exact shape src/lib/api-client.js builds for a 401.
    expect(
      isUnauthorized({
        ok: false,
        error: { code: "ITP_UNAUTHORIZED", message: "Silakan masuk terlebih dahulu.", status: 401 },
      })
    ).toBe(true);
  });

  it("recognises a 401 whose body was lost", () => {
    // A proxy/error page: status present, no error object.
    expect(isUnauthorized({ ok: false, status: 401 })).toBe(true);
  });

  it("recognises the code without a status", () => {
    expect(isUnauthorized({ ok: false, error: { code: "ITP_UNAUTHORIZED" } })).toBe(true);
  });

  // The whole point of a GATE: it must not open for failures that are not
  // about the session. Bouncing a signed-in customer to /login because the
  // network blinked loses their work.
  it("does not treat a network failure as a guest", () => {
    expect(
      isUnauthorized({ ok: false, error: { code: "ITP_NETWORK_ERROR", status: 0 } })
    ).toBe(false);
  });

  it("does not treat a server error as a guest", () => {
    expect(isUnauthorized({ ok: false, error: { code: "ITP_INTERNAL_ERROR", status: 500 } })).toBe(false);
  });

  it("does not treat a validation failure as a guest", () => {
    expect(
      isUnauthorized({ ok: false, error: { code: "ITP_INVALID_INPUT", status: 422 } })
    ).toBe(false);
  });

  it("does not treat success as a guest", () => {
    expect(isUnauthorized({ ok: true, data: { user: { id: "u1" } } })).toBe(false);
  });

  it("survives an empty result", () => {
    expect(isUnauthorized(undefined)).toBe(false);
    expect(isUnauthorized(null)).toBe(false);
  });
});

describe("checkoutReturnPath", () => {
  const game = { slug: "mobile-legends", categoryKind: "GAME" };

  it("returns the game page for a game purchase", () => {
    expect(checkoutReturnPath(game, { slug: "diamonds" })).toBe("/topup/game/mobile-legends");
  });

  // Pulsa operators live at /topup/pulsa/<operator>. The old code built
  // /topup/pulsa/pulsa for the landing product, which is the ambiguous path
  // that route now redirects away from.
  it("returns the operator page for a pulsa purchase", () => {
    expect(
      checkoutReturnPath({ slug: "pulsa", categoryKind: "PULSA" }, { slug: "telkomsel" })
    ).toBe("/topup/pulsa/telkomsel");
  });

  it("falls back to the category path when the operator slug is missing", () => {
    expect(checkoutReturnPath({ slug: "pulsa", categoryKind: "PULSA" }, null)).toBe(
      "/topup/pulsa/pulsa"
    );
  });

  it("treats a missing categoryKind as a game", () => {
    expect(checkoutReturnPath({ slug: "free-fire", categoryKind: null }, null)).toBe(
      "/topup/game/free-fire"
    );
  });
});

describe("loginUrlFor", () => {
  it("encodes the next path exactly once", () => {
    expect(loginUrlFor("/topup/game/mobile-legends")).toBe(
      "/login?next=%2Ftopup%2Fgame%2Fmobile-legends"
    );
  });

  // A path with a query string must survive; an unencoded `?` would truncate
  // `next` at the first one and lose the rest.
  it("keeps a query string inside next", () => {
    const url = loginUrlFor("/topup/game/mobile-legends?promo=ITOPUP10");
    expect(url.startsWith("/login?next=")).toBe(true);
    const decoded = decodeURIComponent(url.slice("/login?next=".length));
    expect(decoded).toBe("/topup/game/mobile-legends?promo=ITOPUP10");
  });

  it("never produces a double-encoded value the login page cannot parse", () => {
    const url = loginUrlFor("/topup/pulsa/telkomsel");
    const next = new URLSearchParams(url.split("?")[1]).get("next");
    expect(next).toBe("/topup/pulsa/telkomsel");
  });
});
