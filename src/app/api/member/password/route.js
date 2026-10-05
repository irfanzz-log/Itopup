// ============================================================================
// POST /api/member/password, change your own password.
//
// Rate limited with the auth preset (per user AND per IP, fail-closed): this
// endpoint verifies a password, so it is a brute-force target even though the
// attacker must already hold a session.
//
// The service invalidates every session in the same transaction, the current
// one included. The client therefore follows a 200 with a full navigation to
// /login, not a router.refresh(), because the cookie it still holds is dead.
// ============================================================================
import {
  route,
  ok,
  readJson,
  guardMutation,
  requestContext,
  authRateLimitKeys,
  withClearedSessionCookie,
} from "@/lib/api.js";
import { requireAuth } from "@/lib/auth/guards.js";
import { changeOwnPassword } from "@/services/user.service.js";

export const POST = route(async (req, _ctx, { log }) => {
  const ctx = requestContext(req);
  const body = await readJson(req, { maxBytes: 4 * 1024 });

  const user = await requireAuth(req);

  await guardMutation(req, {
    rateLimit: authRateLimitKeys({ scope: "password", identifier: user.id, ip: ctx.ip }),
    log,
  });

  await changeOwnPassword(user.id, body, ctx);

  log.info("member.password_changed", { userId: user.id });

  // Every session was deleted (including this one), so clear the cookie on the
  // way out. Leaving a dead cookie in the browser would make the next request
  // look like a stale-session bug instead of a clean logout.
  const response = ok({ changed: true, reauthenticate: true }, { req });
  return withClearedSessionCookie(response);
});
