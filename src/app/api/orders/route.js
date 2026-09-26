// ============================================================================
// POST /api/orders — create an order.
//
// The security-critical route of the whole app. Its contract:
//
//   * authenticated (a visitor must log in before buying; the checkout draft is
//     kept client-side so nothing is lost),
//   * same-origin (CSRF) + rate limited per user AND per IP,
//   * `.strict()` validation, so a client that sends `price`, `total`,
//     `providerCode` or `status` is REJECTED rather than having its numbers
//     silently ignored — a silent ignore hides a broken or hostile client,
//   * every amount is recomputed from the database by order.service.
//
// Duplicate submissions are absorbed by the idempotency key: a double click or a
// retried request returns the SAME order with 200 instead of creating a second
// one with 201.
// ============================================================================
import {
  route, ok, readJson, guardMutation, requestContext, bucket,
} from "@/lib/api.js";
import { presets } from "@/lib/rate-limit.js";
import { checkoutSchema, parse } from "@/lib/validation.js";
import { requireAuth } from "@/lib/auth/guards.js";
import { createOrder } from "@/services/order.service.js";

export const POST = route(async (req, _ctx, { log }) => {
  const ctx = requestContext(req);
  const body = await readJson(req, { maxBytes: 8 * 1024 });

  // Authorization BEFORE any business logic. ITP_UNAUTHORIZED → 401, which the
  // checkout form turns into a redirect to /login?next=… .
  const user = await requireAuth(req);

  await guardMutation(req, {
    rateLimit: [
      bucket("order", presets.order, { userId: user.id }),
      bucket("order", presets.order, { ip: ctx.ip }),
    ],
    log,
  });

  const input = parse(checkoutSchema, body);

  const { order, reused, instructions } = await createOrder({
    userId: user.id,
    input,
    request: ctx,
    user,
  });

  log.info("orders.create", {
    userId: user.id,
    orderId: order.id,
    invoice: order.invoice,
    reused,
    instructionsIssued: Boolean(instructions),
  });

  // 200 (not 201) when the order already existed: nothing was created, and a
  // client that retries must not be told it just bought something new.
  return ok({ order, reused }, { status: reused ? 200 : 201, req });
});
