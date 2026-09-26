// ============================================================================
// POST /api/auth/register
//
// Security properties:
//   * same-origin check (CSRF) before anything else,
//   * two rate-limit buckets (IP + a coarse global),
//   * server-side Zod validation with `.strict()` — an unexpected field is an
//     error, not a silently ignored value,
//   * the account is created but NO session is issued: the member logs in
//     explicitly, so a mistyped email cannot leave someone signed in.
// ============================================================================
import { route, ok, readJson, guardMutation, requestContext, bucket } from "@/lib/api.js";
import { presets } from "@/lib/rate-limit.js";
import { registerUser } from "@/services/user.service.js";

export const POST = route(async (req, _ctx, { log }) => {
  const ctx = requestContext(req);

  await guardMutation(req, {
    rateLimit: [
      bucket("register", presets.register, { ip: ctx.ip }),
      // Global ceiling so rotating IPs cannot multiply the per-IP allowance.
      ["register:global", { ...presets.register, limit: presets.register.limit * 10 }],
    ],
    log,
  });

  const body = await readJson(req, { maxBytes: 8 * 1024 });
  const user = await registerUser(body, ctx);

  log.info("auth.registered", { userId: user.id });

  return ok(
    {
      user,
      // Explicit: registration does not sign you in.
      requiresLogin: true,
    },
    { status: 201, req }
  );
});
