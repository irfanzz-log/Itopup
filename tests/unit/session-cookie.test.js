import { describe, it, expect } from "vitest";
import { tokenFromRequest, SESSION_COOKIE } from "@/lib/auth/session.js";

function reqWithCookie(raw) {
  return { headers: { get: (name) => (name === "cookie" ? raw : null) } };
}

describe("session cookie name", () => {
  it("derives an env-suffixed name outside production", () => {
    // In the vitest environment NODE_ENV=test → itp_session_test.
    expect(SESSION_COOKIE).toMatch(/^itp_session(_test|_dev)?$/);
    expect(SESSION_COOKIE).not.toBe("itp_session"); // test/dev must never touch the prod name
  });
});

describe("tokenFromRequest", () => {
  it("reads a single cookie", () => {
    const req = reqWithCookie(`${SESSION_COOKIE}=abc`);
    expect(tokenFromRequest(req)).toBe("abc");
  });

  it("decodes a URI-encoded value", () => {
    const req = reqWithCookie(`${SESSION_COOKIE}=a%2Fb`);
    expect(tokenFromRequest(req)).toBe("a/b");
  });

  it("returns the LAST duplicate, not the first", () => {
    // A stale Secure-flagged clone (planted by a production-mode run) and a
    // fresh login cookie can coexist in one jar. Browsers send the
    // most-specific/oldest-first per RFC 6265 §5.4 ordering; the freshest
    // server-issued value is the last one. First-match-wins would resurrect
    // the dead token and log the user out on every page.
    const req = reqWithCookie(`${SESSION_COOKIE}=STALE; ${SESSION_COOKIE}=FRESH`);
    expect(tokenFromRequest(req)).toBe("FRESH");
  });

  it("matches the name exactly, ignoring prefix lookalikes", () => {
    const req = reqWithCookie(`${SESSION_COOKIE}_x=noise; ${SESSION_COOKIE}=real`);
    expect(tokenFromRequest(req)).toBe("real");
  });

  it("returns null without a cookie header", () => {
    expect(tokenFromRequest({ headers: { get: () => null } })).toBeNull();
  });
});
