// ============================================================================
// POST /api/payment/instructions — issue (or re-issue) payment instructions.
//
// The customer never sends an amount: the order's total is read from the
// database and the instructions are generated server-side. Re-issuing is
// idempotent — the manual adapter derives its unique amount code from the
// invoice, so reloading the checkout page cannot change what the customer owes.
// ============================================================================
import { route, ok, readJson, guardMutation, requestContext, bucket, parse } from "@/lib/api.js";
import { presets } from "@/lib/rate-limit.js";
import { requireAuth } from "@/lib/auth/guards.js";
import { uuid } from "@/lib/validation.js";
import { AppError } from "@/lib/errors.js";
import { z } from "zod";
import { getOrderForUser } from "@/services/order.service.js";
import { issuePaymentInstructions } from "@/services/payment.service.js";
import { ORDER_STATUS } from "@/lib/constants.js";

const schema = z
  .object({
    orderId: uuid,
    paymentMethod: z.string().trim().min(2).max(40),
  })
  .strict();

export const POST = route(async (req, _ctx, { log }) => {
  const ctx = requestContext(req);
  const body = await readJson(req, { maxBytes: 4 * 1024 });

  const user = await requireAuth(req);

  await guardMutation(req, {
    rateLimit: [bucket("payment", presets.payment, { userId: user.id })],
    log,
  });

  const { orderId, paymentMethod } = parse(schema, body);

  // Ownership check first: this is the IDOR boundary. `getOrderForUser` filters
  // by userId in the QUERY, so another member's order is simply not found.
  const order = await getOrderForUser({ orderId, userId: user.id });

  if (order.status !== ORDER_STATUS.PENDING_PAYMENT && order.status !== ORDER_STATUS.PAYMENT_PROCESSING) {
    throw new AppError("ITP_ORDER_NOT_PAYABLE");
  }

  const { payment, instructions } = await issuePaymentInstructions({
    order: { ...order, user: { name: user.name, email: user.email } },
    paymentMethod,
    request: ctx,
  });

  log.info("payment.instructions_ok", { orderId: order.id, method: paymentMethod });

  // `instructions` is what the customer must be shown (bank accounts, the exact
  // payable amount). It contains no credential — only what they need to pay.
  return ok({ payment, instructions }, { req });
});
