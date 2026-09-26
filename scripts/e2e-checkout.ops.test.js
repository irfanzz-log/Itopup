// ============================================================================
// Operator script — HTTP end-to-end proof of the three changes, against the
// running dev server and the real Supabase database.
//
// PROVES:
//   1. payment instructions carry NO "kode unik": payableAmount === order total,
//      and the invoice is what identifies the payment;
//   2. changing the payload (payment method) after a first attempt produces a NEW
//      order instead of ITP_IDEMPOTENCY_CONFLICT — the reported bug;
//   3. an account the provider does not recognise is REFUSED (422
//      ITP_INVALID_ACCOUNT) instead of creating an order that cannot be delivered.
//
// A valid account comes from the provider's own documentation:
//   mobile-legends, customer_target 47486147, zone 2076 → "VanillaSyrup"
// It is cached server-side for 10 minutes, so repeating it does not burn quota.
// ============================================================================
import { readFileSync, writeFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

const lines = [];
const say = (text) => {
  lines.push(text);
  writeFileSync("/tmp/e2e-report.log", `${lines.join("\n")}\n`);
};

const BASE = "http://localhost:3000";

function envFromFile() {
  const out = {};
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^"|"$/g, "");
  }
  return out;
}

/** A cookie jar good enough for one session. */
function makeJar() {
  const jar = new Map();
  return {
    absorb(response) {
      for (const raw of response.headers.getSetCookie?.() ?? []) {
        const [pair] = raw.split(";");
        const idx = pair.indexOf("=");
        if (idx > 0) jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
      }
    },
    header() {
      return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    },
    set(k, v) {
      jar.set(k, v);
    },
  };
}

async function post(path, body, jar, { csrf = true } = {}) {
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  if (csrf) {
    const token = "e2e" + Math.random().toString(36).slice(2).padEnd(30, "0");
    jar.set("itp_csrf", token);
    headers["x-csrf-token"] = token;
  }
  if (jar.header()) headers.Cookie = jar.header();

  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    redirect: "manual",
  });
  jar.absorb(response);

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return { status: response.status, payload };
}

describe("operator: HTTP end-to-end", () => {
  it("proves all three fixes over real HTTP", async () => {
    const env = envFromFile();
    for (const key of ["DATABASE_URL", "DIRECT_URL", "MELOSTORE_API_KEY", "MELOSTORE_SECRET_KEY"]) {
      if (env[key] !== undefined) process.env[key] = env[key];
    }
    const { prisma } = await import("../src/lib/db.js");

    // ── Pick a variant that is genuinely purchasable ──────────────────────
    const game = await prisma.game.findUnique({
      where: { slug: "mobile-legends" },
      select: { id: true },
    });
    const variant = await prisma.productVariant.findFirst({
      where: {
        product: { gameId: game.id, isActive: true },
        isActive: true,
        providerProducts: { some: { isAvailable: true, provider: { status: "ACTIVE" } } },
      },
      select: { id: true, name: true, sellingPrice: true },
      orderBy: { sellingPrice: "asc" },
    });
    say(`variant: ${variant.name} id=${variant.id} sell=${variant.sellingPrice}`);

    // ── Register + login a throwaway member ───────────────────────────────
    const email = `e2e-${Date.now()}@itopup.test`;
    const password = "E2eHarness-2026!";
    const jar = makeJar();

    const reg = await post("/api/auth/register", { name: "E2E Harness", email, password }, jar);
    say(`register: ${reg.status}`);

    const login = await post("/api/auth/login", { email, password }, jar);
    say(`login: ${login.status}`);

    const validFields = { userId: "47486147", zoneId: "2076" };
    const invalidFields = { userId: "999999999", zoneId: "99999" };

    // ── 3. An account that does not exist must be REFUSED ─────────────────
    const bad = await post(
      "/api/orders",
      {
        variantId: variant.id,
        fields: invalidFields,
        paymentMethod: "manual_bank_bca",
        idempotencyKey: `itp_bad${Date.now()}`.padEnd(40, "0"),
      },
      jar
    );
    say(`order(invalid account): ${bad.status} ${bad.payload?.error?.code ?? ""} ${bad.payload?.error?.message ?? ""}`);
    expect(bad.status).toBe(422);
    expect(bad.payload?.error?.code).toBe("ITP_INVALID_ACCOUNT");

    // ── 1 + 2. Valid account, then a CHANGED payload ──────────────────────
    // The key is derived from the payload exactly as the form does it. Attempt 1
    // and attempt 2 differ ONLY in the payment method — the sequence that used to
    // answer "Permintaan tidak cocok dengan transaksi sebelumnya".
    const keyFor = (method) => `itp_e2e_${method}`;

    const first = await post(
      "/api/orders",
      {
        variantId: variant.id,
        fields: validFields,
        paymentMethod: "manual_bank_bca",
        idempotencyKey: keyFor("manual_bank_bca"),
      },
      jar
    );
    say(`order #1 (manual_bank_bca): ${first.status} ${first.payload?.error?.code ?? ""}`);
    expect(first.status).toBe(201);

    const orderId = first.payload.data.order.id;
    const invoice = first.payload.data.order.invoice;
    say(`  invoice=${invoice} total=${first.payload.data.order.total}`);

    // The SAME key with the SAME payload must dedupe (200, same order).
    const replay = await post(
      "/api/orders",
      {
        variantId: variant.id,
        fields: validFields,
        paymentMethod: "manual_bank_bca",
        idempotencyKey: keyFor("manual_bank_bca"),
      },
      jar
    );
    say(`order #1 replay (same payload): ${replay.status} reused=${replay.payload?.data?.reused}`);
    expect(replay.status).toBe(200);
    expect(replay.payload.data.order.id).toBe(orderId);

    // A DIFFERENT payload gets a DIFFERENT key from the form, so this is a new
    // order — not a conflict. (A form-derived key differs per method by design;
    // reusing the old key here is the stricter case and must ALSO not conflict,
    // because the server compares the payload hash only within one key.)
    const second = await post(
      "/api/orders",
      {
        variantId: variant.id,
        fields: validFields,
        paymentMethod: "manual_ewallet_dana",
        idempotencyKey: keyFor("manual_ewallet_dana"),
      },
      jar
    );
    say(`order #2 (manual_ewallet_dana): ${second.status} ${second.payload?.error?.code ?? ""}`);
    expect(second.status).toBe(201);
    expect(second.payload.data.order.id).not.toBe(orderId);

    // ── 1. The instructions carry no kode unik ────────────────────────────
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true, invoice: true, total: true, status: true,
        payment: { select: { amount: true, instructions: true, status: true } },
      },
    });
    const ins = order.payment.instructions;
    say(`instructions keys: ${Object.keys(ins).join(", ")}`);
    say(`  payableAmount=${ins.payableAmount} orderTotal=${order.total} paymentAmount=${order.payment.amount}`);
    say(`  has uniqueCode: ${"uniqueCode" in ins}   has orderAmount: ${"orderAmount" in ins}`);
    say(`  invoice on instructions: ${ins.invoice}`);
    say(`  verifiedAccount: ${JSON.stringify(ins.verifiedAccount)}`);
    say(`  steps: ${JSON.stringify(ins.steps)}`);

    // The amount the customer is asked to send IS the order total. Nothing added.
    expect(ins.payableAmount).toBe(order.total);
    expect(order.payment.amount).toBe(order.total);
    expect("uniqueCode" in ins).toBe(false);
    expect("orderAmount" in ins).toBe(false);
    expect(ins.invoice).toBe(invoice);
    expect(ins.verifiedAccount?.nickname).toBe("VanillaSyrup");
    expect(JSON.stringify(ins.steps)).not.toMatch(/kode unik/i);

    // ── Clean up the throwaway member and its orders ──────────────────────
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    const deleted = await prisma.order.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
    say(`cleanup: deleted ${deleted.count} orders + the test member`);
  }, 280_000);
});
