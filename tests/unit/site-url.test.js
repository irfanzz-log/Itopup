// ============================================================================
// Canonical origin: the sitemap must never advertise localhost.
//
// THE BUG THIS PINS
//
// NEXT_PUBLIC_APP_URL is inlined at build time and `.env.prod` is not committed.
// On a host that injects variables at runtime, a build that never saw the
// variable fell back to `http://localhost:3200`, and the deployed sitemap.xml
// served localhost URLs — a crawl error on every entry.
//
// The tests below drive the REAL module and the REAL sitemap function, with the
// environment arranged to reproduce each case.
// ============================================================================
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const ORIGINAL = { ...process.env };

/** Re-import site-url with a specific environment (the module resolves once). */
async function loadSiteUrl(env) {
  vi.resetModules();
  for (const key of ["NEXT_PUBLIC_APP_URL", "VERCEL_PROJECT_PRODUCTION_URL", "VERCEL_URL", "NODE_ENV"]) {
    delete process.env[key];
  }
  Object.assign(process.env, env);
  return import("../../src/lib/site-url.js");
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL);
  vi.restoreAllMocks();
});

describe("site URL resolution", () => {
  it("uses NEXT_PUBLIC_APP_URL when set", async () => {
    const { SITE_URL } = await loadSiteUrl({
      NODE_ENV: "production",
      NEXT_PUBLIC_APP_URL: "https://itopup.my.id",
    });
    expect(SITE_URL).toBe("https://itopup.my.id");
  });

  it("strips a trailing slash so paths never double up", async () => {
    const { absoluteUrl } = await loadSiteUrl({
      NODE_ENV: "production",
      NEXT_PUBLIC_APP_URL: "https://itopup.my.id/",
    });
    expect(absoluteUrl("/topup")).toBe("https://itopup.my.id/topup");
    expect(absoluteUrl("/")).toBe("https://itopup.my.id");
  });

  it("falls back to the canonical domain in production, NOT localhost", async () => {
    // This is the regression: a production build with no variable configured.
    const { SITE_URL, isProductionOrigin } = await loadSiteUrl({ NODE_ENV: "production" });
    expect(SITE_URL).toBe("https://itopup.my.id");
    expect(SITE_URL).not.toContain("localhost");
    expect(isProductionOrigin).toBe(true);
  });

  it("prefers the platform's production host when the variable is absent", async () => {
    const { SITE_URL } = await loadSiteUrl({
      NODE_ENV: "production",
      VERCEL_PROJECT_PRODUCTION_URL: "itopup.my.id",
    });
    expect(SITE_URL).toBe("https://itopup.my.id");
  });

  it("keeps localhost OUTSIDE production, so local dev stays usable", async () => {
    const { SITE_URL, isProductionOrigin } = await loadSiteUrl({ NODE_ENV: "development" });
    expect(SITE_URL).toBe("http://localhost:3200");
    expect(isProductionOrigin).toBe(false);
  });
});

describe("sitemap output", () => {
  // These assert the PRODUCTION shape. Vitest runs with NODE_ENV=test (set by
  // tests/setup.js), where a localhost origin is correct — so production is
  // arranged explicitly here rather than assumed.
  beforeEach(() => {
    vi.resetModules();
    process.env.NODE_ENV = "production";
    process.env.NEXT_PUBLIC_APP_URL = "https://itopup.my.id";
  });

  it("emits only absolute https URLs on the canonical domain", async () => {
    const { default: sitemap } = await import("../../src/app/sitemap.js");
    const entries = await sitemap();

    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.url, entry.url).toMatch(/^https:\/\/itopup\.my\.id(\/|$)/);
      expect(entry.url).not.toContain("localhost");
      expect(entry.url).not.toContain("127.0.0.1");
      expect(entry.url).not.toContain("?");
    }
  });

  it("contains no duplicate URLs (a duplicate is a Search Console error)", async () => {
    const { default: sitemap } = await import("../../src/app/sitemap.js");
    const urls = (await sitemap()).map((e) => e.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("refuses to publish a non-public origin in production", async () => {
    // Simulate the misconfiguration directly: a production build whose origin
    // resolved to http://localhost. The sitemap must go empty rather than
    // advertise localhost, and must log why.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.resetModules();
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    delete process.env.VERCEL_URL;
    process.env.NODE_ENV = "production";
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3200";

    const { default: sitemap } = await import("../../src/app/sitemap.js");
    const entries = await sitemap();

    expect(entries).toEqual([]);
    expect(errorSpy).toHaveBeenCalled();
    const logged = errorSpy.mock.calls.map((c) => String(c[0])).join(" ");
    expect(logged).toContain("sitemap.non_public_origin");
  });
});

describe("robots.txt", () => {
  it("points at the canonical sitemap and host", async () => {
    vi.resetModules();
    process.env.NODE_ENV = "production";
    process.env.NEXT_PUBLIC_APP_URL = "https://itopup.my.id";

    const { default: robots } = await import("../../src/app/robots.js");
    const out = robots();

    expect(out.sitemap).toEqual(["https://itopup.my.id/sitemap.xml"]);
    expect(out.host).toBe("itopup.my.id");
    for (const url of out.sitemap) expect(url).not.toContain("localhost");
  });
});
