// ============================================================================
// POST /api/dev/promos, create, update, deactivate a promo.
//
// The discount is ALWAYS computed server-side at checkout (see
// promo.service.js); nothing stored here is trusted by the checkout path beyond
// the rule itself. So this route only owns the rule and its audit trail.
//
// Deactivation is a soft delete: an order that used a promo keeps its historical
// link, so a hard delete would orphan the audit trail.
// ============================================================================
import { route, ok, readJson, guardMutation, requestContext, bucket, parse } from "@/lib/api.js";
import { presets } from "@/lib/rate-limit.js";
import { requireStaff } from "@/lib/auth/guards.js";
import { AppError } from "@/lib/errors.js";
import { uuid } from "@/lib/validation.js";
import { z } from "zod";
import { createPromo, updatePromo, deactivatePromo, deletePromo } from "@/services/promo.service.js";

const schema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("create"),
      // The full promo payload is validated by promoCreateSchema inside the
      // service, one definition of a valid promo, not two that can drift.
      promo: z.record(z.string(), z.unknown()),
    })
    .strict(),
  z
    .object({
      action: z.literal("update"),
      promoId: uuid,
      promo: z.record(z.string(), z.unknown()),
    })
    .strict(),
  z.object({ action: z.literal("deactivate"), promoId: uuid }).strict(),
  z.object({ action: z.literal("delete"), promoId: uuid }).strict(),
]);

export const POST = route(async (req, _ctx, { log }) => {
  const requestCtx = requestContext(req);
  const body = await readJson(req, { maxBytes: 32 * 1024 });

  const actor = await requireStaff(req);

  await guardMutation(req, {
    rateLimit: [bucket("admin", presets.admin, { userId: actor.id })],
    log,
  });

  const input = parse(schema, body);

  log.info("dev.promo_action", { action: input.action, actorId: actor.id });

  switch (input.action) {
    case "create": {
      const promo = await createPromo({ actor, input: input.promo, request: requestCtx });
      return ok({ promo }, { req, status: 201 });
    }
    case "update": {
      const promo = await updatePromo({ actor, promoId: input.promoId, input: input.promo, request: requestCtx });
      return ok({ promo }, { req });
    }
    case "deactivate": {
      const promo = await deactivatePromo({ actor, promoId: input.promoId, request: requestCtx });
      return ok({ promo }, { req });
    }
    case "delete": {
      // Only a promo that has never been used reaches the database delete. The
      // service refuses a used one with a 409 and an explanation, because
      // deactivating is the right answer there, the endpoint never decides.
      const result = await deletePromo({ actor, promoId: input.promoId, request: requestCtx });
      return ok(result, { req });
    }
    default:
      throw new AppError("ITP_INVALID_INPUT", "Aksi tidak dikenal.");
  }
});
