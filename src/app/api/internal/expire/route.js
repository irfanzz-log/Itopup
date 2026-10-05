// ============================================================================
// /api/internal/expire, the expiry sweep that nothing else runs.
//
// THE BUG THIS ROUTE EXISTS TO FIX
//
// `expireStaleOrders()` in src/services/order.service.js was written as the
// global, cron-shaped version of `expireOwnStaleOrders()`. The customer-scoped
// one is called on the checkout path, so a customer's OWN orders expire the
// moment that customer comes back. The global one was called by NOTHING, no
// timer, no route, no hook. Its own comment said so:
//
//     "Nothing else runs `expireStaleOrders()` on a timer yet"
//
// The consequence is exactly what the operator saw: an order whose payment
// window closed a day ago still shows "Menunggu Pembayaran" in /dev/orders,
// because the only thing in the whole system that would have expired it was the
// customer who abandoned it. An order stuck in PENDING_PAYMENT also holds stock
// (a variant shows as unavailable while a charge nobody will pay is still open)
// and blocks the idempotency replay in `createOrder` until that customer
// returns, a deadlock that only the customer who walked away can break.
//
// HOW IT RUNS NOW
//
// Next.js does not give us a durable timer, and no cron was deployed here. This
// route is the thing an external scheduler calls:
//
//     curl -X POST https://host/api/internal/expire \
//          -H "X-Internal-Key: $INTERNAL_KEY"
//
// Every two minutes is the right cadence: the order window is 60 minutes, so a
// 2-minute sweep bounds staleness at ~2 minutes for an admin watching /dev/orders,
// while staying far below the rate limit on this route (presets.internal).
//
// The key is a shared secret in INTERNAL_KEY. GET is also honoured so a simple
// health-check style cron can poll it, but it does the same work either way,
// there is no read-only mode here, because a read-only expiry check is the bug.
//
// WHY THE SWEEP IS STILL ONLY A BACKSTOP
//
// Expiry must not depend on this route being called. The admin order pages and
// the member order page ALSO run the sweep before they read (see the call sites
// in those pages), so an operator looking at a stale order never sees a status
// the database has already decided is wrong. This route is what keeps the
// background true when nobody is looking; the pages are what keep it true when
// somebody is.
// ============================================================================
import { ok, fail } from "@/lib/http.js";
import { expireStaleOrders } from "@/services/order.service.js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Methods accepted. POST is what a scheduler sends; GET is for simple pollers. */
const ALLOWED = new Set(["POST", "GET"]);

export async function GET(req) {
  return handle(req);
}

export async function POST(req) {
  return handle(req);
}

async function handle(req) {
  if (!ALLOWED.has(req.method)) {
    return fail("ITP_METHOD_NOT_ALLOWED", "Metode tidak diizinkan.", { status: 405, req });
  }

  // The sweep changes order state and cancels gateway charges, so it must never
  // be a public endpoint. Two callers reach it, and either credential is enough:
  //
  //   1. An external scheduler we run ourselves (a system cron, a monitoring
  //      tool). It sends X-Internal-Key against INTERNAL_KEY.
  //   2. Vercel's cron, which cannot send a custom header at all. It signs the
  //      request automatically with `Authorization: Bearer $CRON_SECRET` and a
  //      `vercel-cron/1.0` user agent; that is Vercel's documented mechanism and
  //      the only one available for a vercel.json cron.
  //
  // An UNSET key denies every request rather than allowing all of them, an
  // empty env var must not turn this into an open endpoint that mass-expires
  // orders and voids every pending QRIS charge in the system. Both comparisons
  // are constant time: these are secrets.
  const internalKey = process.env.INTERNAL_KEY;
  const cronSecret = process.env.CRON_SECRET;
  const suppliedKey = req.headers.get("x-internal-key");
  const authHeader = req.headers.get("authorization") ?? "";
  const userAgent = req.headers.get("user-agent") ?? "";

  const keyOk = !!internalKey && !!suppliedKey && timingSafeEqual(internalKey, suppliedKey);
  // Vercel's cron is trusted only when BOTH the bearer secret matches and the
  // request actually came from the scheduler. The user agent alone would be
  // trivially spoofable; the secret alone could be a leaked bearer from
  // somewhere else. Requiring both is the check that means something.
  const cronOk =
    !!cronSecret &&
    userAgent.includes("vercel-cron") &&
    authHeader.startsWith("Bearer ") &&
    timingSafeEqual(cronSecret, authHeader.slice(7));

  if (!keyOk && !cronOk) {
    return fail("ITP_UNAUTHORIZED", "Tidak diizinkan.", { status: 401, req });
  }

  // A full sweep is bounded inside the service (`take` ≤ 500). An unreachable
  // database inside the sweep is the one failure mode that must not 500 the
  // cron: the next tick should try again, not page somebody at 3am. The counts
  // are still reported so the caller can alert on a persistent zero.
  try {
    const result = await expireStaleOrders({ limit: 500 });
    return ok({ ...result, at: new Date().toISOString() }, { req });
  } catch (err) {
    return fail("ITP_INTERNAL", "Sweep kedaluwarsa gagal dijalankan.", {
      status: 502, req,
      details: { message: String(err?.message ?? err).slice(0, 200) },
    });
  }
}

/** Constant-time string compare, so the key is not leaked by a timing probe. */
function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
