// ============================================================================
// Traffic writer: the parts that are pure and security-relevant.
//
// `recordTraffic` itself needs a database, so it is exercised end-to-end by the
// HTTP checks against the dev server. What is tested here is the sanitising
// layer in front of it, because that layer is what keeps a caller-supplied
// string out of the table: a token in a query string, a scheme, a control
// character, or a 1 MB path.
// ============================================================================
import { describe, it, expect } from "vitest";
import { safePath, referrerHost } from "@/lib/traffic/record.js";

describe("safePath", () => {
  it("drops the query string so a token in a URL never lands in the table", () => {
    expect(safePath("/member/reset?token=super-secret-value")).toBe("/member/reset");
  });

  it("drops the fragment too", () => {
    expect(safePath("/promo#diskon")).toBe("/promo");
  });

  it("keeps a plain path untouched", () => {
    expect(safePath("/topup/game/mobile-legends")).toBe("/topup/game/mobile-legends");
  });

  it("decodes once, so the injection rules see what the server saw", () => {
    expect(safePath("/search%20page")).toBe("/search page");
  });

  it("survives malformed percent-encoding instead of throwing", () => {
    expect(safePath("/bad%E0%A4%A")).toBe("/bad%E0%A4%A");
  });

  it("strips control characters", () => {
    expect(safePath("/a\u0000b\u001fc")).toBe("/abc");
  });

  it("caps the length", () => {
    const long = `/${"a".repeat(2000)}`;
    expect(safePath(long).length).toBe(512);
  });

  it("falls back to / for an empty value", () => {
    expect(safePath("")).toBe("/");
    expect(safePath(null)).toBe("/");
  });
});

describe("referrerHost", () => {
  it("keeps the hostname and throws away the path and query", () => {
    // The full referrer can carry a search query with user data; only the host
    // is useful for "where did they come from".
    expect(referrerHost("https://www.google.com/search?q=topup+diamond&token=abc")).toBe("www.google.com");
  });

  it("returns null for a missing or unparseable referrer", () => {
    expect(referrerHost(null)).toBeNull();
    expect(referrerHost("")).toBeNull();
    expect(referrerHost("not a url")).toBeNull();
  });
});
