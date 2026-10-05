// ============================================================================
// /api/vouchers, voucher claim & list.
//
// The customer's voucher wallet. Claiming is a POST (it mutates a quota), and
// the list is a GET scoped to the session user. Discount math never happens
// here: this route only hands out and lists the vouchers; the checkout
// recomputes the discount server-side from the rule.
// ============================================================================
import { route, ok, readJson, guardMutation, requestContext, bucket, parse } from "@/lib/api.js";
import { presets } from "@/lib/rate-limit.js";
import { requireAuth } from "@/lib/auth/guards.js";

import { uuid } from "@/lib/validation.js";
import { z } from "zod";
import { claimVoucher, listMyVouchers, listClaimableVouchers } from "@/services/promo.service.js";

const claimSchema = z
  .object({
    action: z.literal("claim"),
    promoId: uuid,
  })
  .strict();

// GET /api/vouchers, the customer's wallet + what they are still allowed to
// claim. One round trip, so the voucher section renders in one pass.
export const GET = route(async (req, _ctx, { log }) => {
  const user = await requireAuth(req);

  const [mine, claimable] = await Promise.all([
    listMyVouchers({ userId: user.id }),
    listClaimableVouchers({ userId: user.id }),
  ]);

  log.info("vouchers.list", { userId: user.id, mine: mine.length, claimable: claimable.length });

  return ok({ mine, claimable }, { req });
});

// POST /api/vouchers, claim a voucher into the wallet.
export const POST = route(async (req, _ctx, { log }) => {
  const requestCtx = requestContext(req);
  const body = await readJson(req, { maxBytes: 16 * 1024 });

  const user = await requireAuth(req);

  await guardMutation(req, {
    rateLimit: [bucket("claim", presets.admin, { userId: user.id })],
    log,
  });

  const input = parse(claimSchema, body);

  log.info("vouchers.claim", { userId: user.id, promoId: input.promoId });

  const { claim } = await claimVoucher({ userId: user.id, promoId: input.promoId });

  return ok({ claim }, { req, status: 201 });
});
