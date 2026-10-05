// ============================================================================
// k6 load test — ITOPUP checkout-critical endpoints (local/dev only).
//
// RUN:   k6 run tests/load/smoke-checkout.js
//        k6 run -e BASE_URL=http://localhost:3200 -e STAGE=peak tests/load/smoke-checkout.js
//
// WHY THESE STAGES. The previous 12-point run left load testing BLOCKED with no
// baseline at all. This script deliberately targets the endpoints that a
// customer actually hits during a purchase, not the admin surface: catalog read
// traffic is what scales, and /api/topup/price is the per-variant call every
// checkout form makes. Payment charge is intentionally absent — the rules forbid
// real transactions, and a sandbox charge still consumes provider quota.
//
// STAGES:
//   smoke (default) — 20 vus, 30s. Catches "the endpoint 500s under any load".
//   peak            — 60 vus ramping over 2m. Roughly a small sale window.
//
// TARGETS are p95 thresholds, not capacity claims. Adjust after a real baseline.
// ============================================================================
import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const STAGE = __ENV.STAGE || "smoke";

const failRate = new Rate("failed_requests");
const priceLatency = new Trend("price_latency_ms");

const stages = {
  smoke: [{ duration: "30s", target: 20 }],
  peak: [
    { duration: "1m", target: 30 },
    { duration: "1m", target: 60 },
    { duration: "30s", target: 0 },
  ],
};

export const options = {
  stages: stages[STAGE] || stages.smoke,
  // Two thresholds, deliberately loose for a DEV run.
  //
  // `failed_requests` is the real signal here and it is strict: k6 counts any
  // non-2xx as a failure, but the checks below already expect 404/401 as
  // correct behaviour, so this metric only moves on a genuine 5xx.
  //
  // `http_req_duration` at p95 is informational on a dev server. `next dev`
  // compiles each route on first hit (observed: homepage 2.1s cold, 0.39s
  // warm) and the DB round trip to Supabase adds ~300-600ms per SSR page from
  // a laptop, neither of which reflects production latency. A production or
  // staging run should tighten this to p(95)<500.
  thresholds: {
    failed_requests: ["rate<0.05"],
    http_req_duration: ["p(95)<3500"],
  },
};

export default function () {
  // 1. Homepage — the landing path and the heaviest SSR page.
  const home = http.get(`${BASE_URL}/`);
  check(home, { "homepage 200": (r) => r.status === 200 });
  failRate.add(home.status !== 200);
  sleep(1);

  // 2. Catalog list.
  const catalog = http.get(`${BASE_URL}/topup`);
  check(catalog, { "catalog 200": (r) => r.status === 200 });
  failRate.add(catalog.status !== 200);
  sleep(1);

  // 3. Product page — the page the checkout form mounts on.
  const product = http.get(`${BASE_URL}/topup/game/mobile-legends`);
  check(product, { "product page 200 or 404": (r) => r.status === 200 || r.status === 404 });
  failRate.add(product.status !== 200 && product.status !== 404);

  // 4. Server-side price resolution — GET /api/topup/price?variantId=…, the
  //    call that must never trust client input. A failure here means checkout
  //    cannot quote a price at all. It is public (a logged-out customer sees
  //    the same price), so this is also the cheapest high-frequency endpoint.
  const priceRes = http.get(
    `${BASE_URL}/api/topup/price?variantId=00000000-0000-0000-0000-000000000000`
  );
  priceLatency.add(priceRes.timings.duration);
  // A made-up variant legitimately 404s; only a 5xx is a load symptom.
  check(priceRes, {
    "price endpoint reachable": (r) => r.status === 200 || r.status === 404 || r.status === 422,
  });
  failRate.add(priceRes.status >= 500);
  sleep(1);

  // 5. Auth gate — an unauthenticated request must get 401, not a 500. Under
  //    load, a missing DB connection shows up here first.
  const me = http.get(`${BASE_URL}/api/auth/me`);
  check(me, { "auth gate 401/403": (r) => r.status === 401 || r.status === 403 });
  failRate.add(me.status !== 401 && me.status !== 403);
}
