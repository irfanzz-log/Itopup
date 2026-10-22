// ============================================================================
// /api/health contract.
//
// The endpoint is what a load balancer and an uptime monitor act on, so two
// properties matter more than the payload shape:
//
//   1. It must FAIL when the database is unreachable. A health check that
//      answers 200 while the app cannot serve a query is worse than no health
//      check: it keeps a broken instance in rotation.
//   2. It must never leak a secret, a connection string, or which optional
//      integrations are configured to an anonymous caller — that is a map of
//      what to attack.
//
// The route is exercised through its real handler with a synthetic Request, so
// the assertions are about the shipped code, not a copy of it.
// ============================================================================
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

import { GET, HEAD } from "../../src/app/api/health/route.js";

function req(headers = {}) {
  return new Request("http://localhost:3200/api/health", { headers });
}

const SECRETS = ["postgresql://", "password", "AUTH_SECRET=", "sk_live", "Bearer "];

beforeAll(() => {
  process.env.INTERNAL_KEY = "test-internal-key-0123456789";
});

afterAll(() => {
  delete process.env.INTERNAL_KEY;
});

describe("health endpoint", () => {
  it("reports 200 and ok when the database answers", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.checks.database.ok).toBe(true);
    expect(typeof body.checks.database.latencyMs).toBe("number");
    expect(body.checks.config.ok).toBe(true);
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it("is never cacheable", async () => {
    const res = await GET(req());
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
    expect(res.headers.get("x-robots-tag")).toMatch(/noindex/);
  });

  it("answers HEAD with the same status, for load balancers", async () => {
    const res = await HEAD(req());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });

  it("hides which integrations are configured from an anonymous caller", async () => {
    const body = await (await GET(req())).json();
    expect(body).not.toHaveProperty("integrations");
  });

  it("hides them from a caller with the WRONG key", async () => {
    const body = await (await GET(req({ "x-internal-key": "wrong" }))).json();
    expect(body).not.toHaveProperty("integrations");
  });

  it("returns configured-ness (never values) to a caller with the right key", async () => {
    const body = await (await GET(req({ "x-internal-key": "test-internal-key-0123456789" }))).json();
    expect(Array.isArray(body.integrations)).toBe(true);
    expect(body.integrations.length).toBeGreaterThan(0);
    for (const entry of body.integrations) {
      // The contract of envReport: a name and a boolean, nothing else.
      expect(Object.keys(entry).sort()).toEqual(["configured", "name"]);
      expect(typeof entry.configured).toBe("boolean");
    }
  });

  it("leaks no secret in the body in any mode", async () => {
    for (const headers of [{}, { "x-internal-key": "test-internal-key-0123456789" }]) {
      const text = await (await GET(req(headers))).text();
      for (const needle of SECRETS) {
        expect(text.toLowerCase(), `leaked "${needle}"`).not.toContain(needle.toLowerCase());
      }
    }
  });

  it("reports 503 when the database probe fails", async () => {
    // Break the shared client for this one call: the route must translate a
    // query failure into a non-2xx, which is the whole point of the endpoint.
    const { prisma } = await import("../../src/lib/db.js");
    const spy = vi.spyOn(prisma, "$queryRaw").mockRejectedValueOnce(new Error("connection refused"));

    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.status).toBe("degraded");
    expect(body.checks.database.ok).toBe(false);

    // The driver message must not reach the caller.
    expect(JSON.stringify(body)).not.toContain("connection refused");

    spy.mockRestore();
  });

  it("recovers to 200 once the database answers again", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
  });
});
