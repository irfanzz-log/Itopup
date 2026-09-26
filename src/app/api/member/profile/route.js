// ============================================================================
// PATCH /api/member/profile — update your own name/phone.
//
// The user id comes from the SESSION, never from the body: a member cannot
// change somebody else's profile by editing a field. `.strict()` on
// profileUpdateSchema rejects anything else (including `email` and `role`) rather
// than silently ignoring it.
// ============================================================================
import { route, ok, readJson, guardMutation, requestContext, bucket } from "@/lib/api.js";
import { presets } from "@/lib/rate-limit.js";
import { requireAuth } from "@/lib/auth/guards.js";
import { updateProfile } from "@/services/user.service.js";

export const PATCH = route(async (req, _ctx, { log }) => {
  const ctx = requestContext(req);
  const body = await readJson(req, { maxBytes: 4 * 1024 });

  const user = await requireAuth(req);

  await guardMutation(req, {
    rateLimit: [bucket("profile", presets.def, { userId: user.id })],
    log,
  });

  const updated = await updateProfile(user.id, body, ctx);

  log.info("member.profile_updated", { userId: user.id });

  return ok({ user: updated }, { req });
});
