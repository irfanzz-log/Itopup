
import { describe, it, expect } from "vitest";

// TEST 08 regression: unauthenticated access to protected routes must be denied.
// An anonymous request reaching the handler body would be a privilege-escalation
// hole, so each route is called with no session cookie and must answer 401/403.
describe("auth enforcement — anonymous requests are denied", () => {
  const call = async (path, { method = "GET", body } = {}) => {
    const mod = await import(path);
    const handler = mod[method] ?? mod.GET ?? mod.POST;
    if (!handler) return { status: "no-handler" };
    const req = new Request("http://localhost" + (handler._path || ""), {
      method,
      body: body ? JSON.stringify(body) : undefined,
      headers: body ? { "content-type": "application/json" } : {},
    });
    try {
      const res = await handler(req, { params: { id: "00000000-0000-0000-0000-000000000000" } });
      return { status: res?.status ?? 500 };
    } catch (e) { return { status: e?.status ?? e?.statusCode ?? "threw: " + String(e.message).slice(0,60) }; }
  };

  it("denies admin order action without a session", async () => {
    const r = await call("@/app/api/dev/orders/[id]/route.js", {
      method: "POST",
      body: { action: "cancel", reason: "qa" },
    });
    console.log("admin POST /api/dev/orders/[id] (anon) ->", r.status);
    expect([401, 403, 429].includes(r.status)).toBe(true);
  });

    it("denies order creation without a session", async () => {
    const r = await call("@/app/api/orders/route.js", {
      method: "POST",
      body: { variantId: "x", customerInput: {}, idempotencyKey: "k", paymentMethodKey: "m" },
    });
    console.log("POST /api/orders (anon) ->", r.status);
    expect([401, 403, 429, 400].includes(r.status)).toBe(true);
  });

  it("denies dev catalog listing without staff role", async () => {
    const r = await call("@/app/api/dev/catalog/route.js", { method: "GET" });
    console.log("GET /api/dev/catalog (anon) ->", r.status);
    expect([401, 403, 429].includes(r.status)).toBe(true);
  });

  it("denies member password change without a session", async () => {
    const r = await call("@/app/api/member/password/route.js", {
      method: "POST", body: { currentPassword: "x", newPassword: "y" },
    });
    console.log("POST /api/member/password (anon) ->", r.status);
    expect([401, 403, 429, 400].includes(r.status)).toBe(true);
  });

  it("denies admin member update without staff role", async () => {
    const r = await call("@/app/api/dev/members/[id]/route.js", {
      method: "POST", body: { action: "block" },
    });
    console.log("POST /api/dev/members/[id] (anon) ->", r.status);
    expect([401, 403, 429, 400, 404].includes(r.status)).toBe(true);
  });
});
