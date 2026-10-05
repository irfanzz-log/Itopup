// ============================================================================
// /api/internal/reconcile, the status sweep that nothing else runs.
//
// THE BUG THIS ROUTE EXISTS TO FIX
//
// Two reconciliation sweeps were written and never wired to anything:
//
//   `reconcilePendingOrders`, orders stuck in PROCESSING whose top-up
//                                 status was never reported back.
//   `reconcilePendingPayments`, payments still open at the gateway whose
//                                 settlement notification never arrived.
//
// Both were exported from their services and called by NOTHING. No timer, no
// route, no hook. Only `reconcilePendingPayments` was reachable at all, and
// only through an admin button on the order detail page, which is manual, and
// which an operator only presses once a customer complains.
//
// The consequence is a hung order: the customer paid, Midtrans settled, the
// top-up succeeded at Melostore, but neither fact reached the database. The
// order sits in PENDING_PAYMENT or PROCESSING until a human notices. That is
// money collected and goods never credited, the one failure state a top-up
// business cannot tolerate.
//
// WHY RECONCILIATION IS THE LOAD-BEARING PATH, NOT THE WEBHOOKS
//
// Both webhooks exist and both verify their signatures, but neither is a
// sufficient guarantee on its own:
//
//   * The Melostore webhook needs MELOSTORE_WEBHOOK_SECRET, which has to be
//     set on the host. Without it every callback is refused, and the order
//     only ever settles because of this sweep.
//   * The Midtrans webhook can be dropped by a transient network failure, and
//     Midtrans retries a notification only a handful of times.
//
// So this route is not a backup: it is what makes the guarantees. The webhooks
// are the fast path; this sweep is the certain one. Every order in a non-
// terminal state is reconciled against the provider and the gateway until it
// reaches a terminal state, no matter what the callbacks did or did not do.
//
// CADENCE
//
// Every 2 minutes. The `staleAfterMinutes`/`olderThanMs` defaults (2 minutes
// for payments, 1 for orders) are the rate limit: `updatedAt` on each row is
// bumped by a check, so a row just polled is not polled again this cycle. A
// tighter interval would raise gateway load without improving freshness.
//
// FAILURE MODE
//
// An unreachable database or provider inside the sweep must not 500 the cron.
// The next tick retries; a 3am page for a transient blip is worse than a
// 2-minute delay. Counts are returned so the caller CAN alert on a persistent
// zero-scanned or rising error count.
// ============================================================================
import { ok, fail } from "@/lib/http.js";
import { reconcilePendingOrders } from "@/services/order.service.js";
import { reconcilePendingPayments } from "@/services/payment.service.js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

  // Reconciliation moves orders to terminal states and releases goods. It must
  // not be public. Same two-credential scheme as /api/internal/expire, for the
  // same reason: an unauthenticated caller could force-settle orders and
  // release credit for payments that never arrived. See that route for the
  // rationale on requiring BOTH the secret and the user agent for Vercel cron.
  const internalKey = process.env.INTERNAL_KEY;
  const cronSecret = process.env.CRON_SECRET;
  const suppliedKey = req.headers.get("x-internal-key");
  const authHeader = req.headers.get("authorization") ?? "";
  const userAgent = req.headers.get("user-agent") ?? "";

  const keyOk = !!internalKey && !!suppliedKey && timingSafeEqual(internalKey, suppliedKey);
  const cronOk =
    !!cronSecret &&
    userAgent.includes("vercel-cron") &&
    authHeader.startsWith("Bearer ") &&
    timingSafeEqual(cronSecret, authHeader.slice(7));

  if (!keyOk && !cronOk) {
    return fail("ITP_UNAUTHORIZED", "Tidak diizinkan.", { status: 401, req });
  }

  try {
    // Payments first: settling a payment is what triggers the top-up dispatch,
    // so running it first means this same tick can also deliver the goods
    // rather than waiting for the next one.
    const payments = await reconcilePendingPayments({ limit: 100, source: "SCHEDULER" });
    // Then orders already dispatched whose provider status never came back.
    const orders = await reconcilePendingOrders({ limit: 100 });

    return ok(
      {
        payments,
        orders,
        at: new Date().toISOString(),
      },
      { req }
    );
  } catch (err) {
    return fail("ITP_INTERNAL", "Sweep rekonsiliasi gagal dijalankan.", {
      status: 502,
      req,
      details: { message: String(err?.message ?? err).slice(0, 200) },
    });
  }
}

/** Constant-time compare, the credentials are secrets. */
function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
