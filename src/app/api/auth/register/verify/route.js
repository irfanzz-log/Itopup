// ============================================================================
// POST /api/auth/register/verify — stage two of registration.
//
// Confirms the 6-digit code and creates the account. The user is still NOT
// signed in afterwards: they log in explicitly, so a hijacked or mistyped
// verification cannot leave someone signed into an account they do not control.
//
// Rate limited on the code attempt, not on registration, because this is the
// guess surface: the per-IP bucket is what stops a brute force on a 6-digit
// code. The service also burns the code after MAX_ATTEMPTS, so both layers have
// to be defeated.
// ============================================================================
import { route, ok, readJson, guardMutation, requestContext, bucket } from "@/lib/api.js";
import { presets } from "@/lib/rate-limit.js";
import { confirmRegistration } from "@/services/user.service.js";

export const POST = route(async (req, _ctx, { log }) => {
  const ctx = requestContext(req);

  await guardMutation(req, {
    rateLimit: [
      bucket("otp", presets.otp, { ip: ctx.ip }),
      // Global ceiling: a distributed guess against one address still hits this.
      ["otp:global", { ...presets.otp, limit: presets.otp.limit * 10 }],
    ],
    log,
  });

  const body = await readJson(req, { maxBytes: 4 * 1024 });
  const user = await confirmRegistration(body, ctx);

  log.info("auth.registered", { userId: user.id });

  return ok(
    {
      user,
      // Explicit: verification does not sign you in.
      requiresLogin: true,
    },
    { status: 201, req: ctx },
  );
});
