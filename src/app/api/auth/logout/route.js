// ============================================================================
// POST /api/auth/logout
//
// Deletes the session ROW, not just the cookie. Clearing only the cookie would
// leave a valid token in an attacker's hands if it had been copied.
// Idempotent: logging out twice is not an error.
// ============================================================================
import { route, ok, guardMutation, requestContext, withClearedSessionCookie } from "@/lib/api.js";
import { destroySession, getSessionUser } from "@/lib/auth/session.js";
import { AUDIT } from "@/lib/constants.js";
import { writeAudit } from "@/services/audit.service.js";

export const POST = route(async (req, _ctx, { log }) => {
  const ctx = requestContext(req);
  await guardMutation(req, { log });

  // Resolve the user BEFORE destroying the session, so the audit row can name
  // the actor.
  const user = await getSessionUser(req);
  await destroySession(req);

  if (user) {
    await writeAudit({
      action: AUDIT.LOGOUT,
      actor: { id: user.id, role: user.role },
      targetType: "User",
      targetId: user.id,
      request: ctx,
    });
    log.info("auth.logout", { userId: user.id });
  }

  return withClearedSessionCookie(ok({ loggedOut: true }, { req }));
});
