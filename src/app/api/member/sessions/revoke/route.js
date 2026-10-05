// ============================================================================
// POST /api/member/sessions/revoke, end every OTHER session.
//
// "Log me out everywhere else" is the standard response to a suspected account
// compromise, and it is only useful if it keeps the current device signed in,
// otherwise the member locks themselves out of the tab they are using.
// revokeOtherSessions() therefore excludes the caller's own session id.
// ============================================================================
import { route, ok, readJson, guardMutation, requestContext, bucket } from "@/lib/api.js";
import { presets } from "@/lib/rate-limit.js";
import { requireAuth } from "@/lib/auth/guards.js";
import { revokeOtherSessions } from "@/lib/auth/session.js";
import { AUDIT } from "@/lib/constants.js";
import { writeAudit } from "@/services/audit.service.js";

export const POST = route(async (req, _ctx, { log }) => {
  const ctx = requestContext(req);
  await readJson(req, { maxBytes: 1 * 1024 });

  const user = await requireAuth(req);

  await guardMutation(req, {
    rateLimit: [bucket("sessions", presets.def, { userId: user.id })],
    log,
  });

  const revoked = await revokeOtherSessions(req, user.id);

  await writeAudit({
    action: AUDIT.SESSIONS_INVALIDATED,
    actor: { id: user.id, role: user.role },
    targetType: "User",
    targetId: user.id,
    metadata: { revoked, scope: "others" },
    request: ctx,
  });

  log.info("member.sessions_revoked", { userId: user.id, revoked });

  return ok({ revoked }, { req });
});
