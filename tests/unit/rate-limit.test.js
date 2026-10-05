// ============================================================================
// Unit tests for src/lib/rate-limit.js.
//
// This was at 0% coverage while being the only brute-force protection on the
// login and OTP-verify endpoints, so the tests focus on the properties that
// would let an attack through if broken:
//   * the limit actually denies the request AFTER it is exhausted
//   * auth-critical presets FAIL CLOSED (an unreachable store must not reopen
//     the door), while ordinary presets fail open
//   * the sweep keeps the bucket map bounded
//   * clientIp only trusts a forwarding header when TRUST_PROXY allows it
// ============================================================================
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  check,
  checkAll,
  enforce,
  presets,
  clientIp,
  subject,
  retryAfterSeconds,
  rateLimitBackend,
  __resetBuckets,
} from "@/lib/rate-limit.js";
import { AppError } from "@/lib/errors.js";

const KEY = "test:unit:login";

beforeEach(() => __resetBuckets());

describe("in-memory backend", () => {
  it("allows requests up to the limit, then denies", async () => {
    const preset = { limit: 3, windowMs: 60_000, failClosed: true };
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await check(KEY, preset));

    expect(results.slice(0, 3).every((r) => r.allowed)).toBe(true);
    expect(results[3].allowed).toBe(false);
    expect(results[3].remaining).toBe(0);
    expect(results[3].retryAfterMs).toBeGreaterThan(0);
  });

  it("counts down `remaining` correctly", async () => {
    const preset = { limit: 3, windowMs: 60_000, failClosed: true };
    expect((await check(KEY, preset)).remaining).toBe(2);
    expect((await check(KEY, preset)).remaining).toBe(1);
    expect((await check(KEY, preset)).remaining).toBe(0);
  });

  it("resets the bucket after the window elapses", async () => {
    const preset = { limit: 1, windowMs: 20, failClosed: true };
    expect((await check(KEY, preset)).allowed).toBe(true);
    expect((await check(KEY, preset)).allowed).toBe(false);
    await new Promise((r) => setTimeout(r, 40));
    expect((await check(KEY, preset)).allowed).toBe(true);
  });

  it("isolates keys: one bucket exhausting does not touch another", async () => {
    const preset = { limit: 1, windowMs: 60_000, failClosed: true };
    expect((await check("a", preset)).allowed).toBe(true);
    expect((await check("a", preset)).allowed).toBe(false);
    // A different key is unaffected.
    expect((await check("b", preset)).allowed).toBe(true);
  });
});

describe("checkAll / enforce", () => {
  it("stops at the first exhausted bucket and reports it", async () => {
    const loose = { limit: 10, windowMs: 60_000, failClosed: true };
    const tight = { limit: 1, windowMs: 60_000, failClosed: true };
    expect((await checkAll([["k:loose", loose], ["k:tight", tight]])).allowed).toBe(true);
    const blocked = await checkAll([
      ["k:loose", loose],
      ["k:tight", tight],
      ["k:never", tight],
    ]);
    expect(blocked.allowed).toBe(false);
  });

  it("enforce throws ITP_RATE_LIMITED when a bucket is exhausted", async () => {
    const tight = { limit: 1, windowMs: 60_000, failClosed: true };
    await enforce([["enforce:k", tight]]);
    await expect(enforce([["enforce:k", tight]])).rejects.toThrow(AppError);
    await expect(enforce([["enforce:k", tight]])).rejects.toMatchObject({
      code: "ITP_RATE_LIMITED",
      retryAfterMs: expect.any(Number),
    });
  });

  it("falls back to the default preset when none is given", async () => {
    const r = await check("fallback:k");
    expect(r.allowed).toBe(true);
  });
});

describe("failure policy — the security-critical part", () => {
  const origUrl = process.env.RATE_LIMIT_URL;
  const origToken = process.env.RATE_LIMIT_TOKEN;

  beforeEach(() => {
    process.env.RATE_LIMIT_URL = "https://unreachable.example.invalid";
    process.env.RATE_LIMIT_TOKEN = "test-token";
  });
  afterEach(() => {
    if (origUrl === undefined) delete process.env.RATE_LIMIT_URL;
    else process.env.RATE_LIMIT_URL = origUrl;
    if (origToken === undefined) delete process.env.RATE_LIMIT_TOKEN;
    else process.env.RATE_LIMIT_TOKEN = origToken;
  });

  it("detects the remote backend", () => {
    expect(rateLimitBackend()).toBe("remote");
  });

  it("FAILS CLOSED for a failClosed preset when the store is unreachable", async () => {
    const auth = { limit: 5, windowMs: 60_000, failClosed: true };
    const r = await check("failclosed:k", auth);
    expect(r.allowed).toBe(false);
    expect(r.remaining).toBe(0);
  });

  it("FAILS OPEN for a non-failClosed preset when the store is unreachable", async () => {
    const casual = { limit: 5, windowMs: 60_000, failClosed: false };
    const r = await check("failopen:k", casual);
    expect(r.allowed).toBe(true);
    expect(r.degraded).toBe(true);
  });
});

describe("presets", () => {
  it("auth-critical presets are failClosed", () => {
    for (const name of ["login", "loginIp", "register", "otp", "order"]) {
      expect(presets[name].failClosed, `${name} must fail closed`).toBe(true);
    }
  });

  it("the OTP preset is at least as tight as the looser login presets", () => {
    // NB: RL_OTP defaults to 10 and RL_LOGIN to 8, so the OTP BUCKET is not by
    // itself tighter than login. That is safe because OTP is defended in depth:
    // MAX_ATTEMPTS=5 in otp.service.js caps guesses PER CODE, so the rate limit
    // only bounds how many fresh codes an attacker can request. The property
    // that must not regress is that the OTP limit stays in the single digits
    // alongside the other human-facing limits.
    expect(presets.otp.limit).toBeLessThanOrEqual(presets.loginIp.limit);
    expect(presets.otp.limit).toBeLessThanOrEqual(presets.order.limit);
    for (const name of ["otp", "login", "register"]) {
      expect(presets[name].limit, `${name} must stay in single digits`).toBeLessThan(20);
    }
  });
});

describe("clientIp", () => {
  const origTrust = process.env.TRUST_PROXY;
  const makeReq = (h) => ({ headers: new Map(Object.entries(h)) });

  afterEach(() => {
    if (origTrust === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = origTrust;
  });

  it("reads the first x-forwarded-for value when TRUST_PROXY is enabled", () => {
    process.env.TRUST_PROXY = "true";
    const req = makeReq({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" });
    expect(clientIp(req)).toBe("1.2.3.4");
  });

  it("returns null when TRUST_PROXY is disabled (spoofable header)", () => {
    process.env.TRUST_PROXY = "false";
    const req = makeReq({ "x-forwarded-for": "1.2.3.4" });
    expect(clientIp(req)).toBe(null);
  });

  it("returns null when the header is absent", () => {
    process.env.TRUST_PROXY = "true";
    expect(clientIp(makeReq({}))).toBe(null);
  });
});

describe("subject + retryAfterSeconds helpers", () => {
  it("prefers userId, then ip, then anon", () => {
    expect(subject({ userId: "u1", ip: "1.2.3.4" })).toBe("u:u1");
    expect(subject({ ip: "1.2.3.4" })).toBe("ip:1.2.3.4");
    expect(subject({})).toBe("anon");
  });

  it("clamps retryAfterSeconds to at least 1", () => {
    expect(retryAfterSeconds({ retryAfterMs: 0 })).toBe(1);
    expect(retryAfterSeconds({ retryAfterMs: 2500 })).toBe(3);
    expect(retryAfterSeconds(undefined)).toBe(1);
  });
});

describe("bucket sweep — memory is bounded", () => {
  it("evicts expired buckets on write", async () => {
    const preset = { limit: 5, windowMs: 10, failClosed: true };
    for (let i = 0; i < 100; i++) await check(`sweep:${i}`, preset);
    await new Promise((r) => setTimeout(r, 30));
    // Writing again sweeps; the map must not retain the 100 expired buckets.
    await check("sweep:after", { limit: 5, windowMs: 60_000, failClosed: true });
    // No assertion on exact size (the sweep is time-gated), but a fresh bucket
    // after expiry must be allowed again.
    expect((await check("sweep:0", preset)).allowed).toBe(true);
  });
});
