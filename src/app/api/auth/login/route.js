// ============================================================================
// POST /api/auth/login
//
// The rate-limit key uses the SUBMITTED email even when it does not exist, so
// the limiter cannot be used as an account-enumeration oracle (a key that only
// exists for real accounts would leak which emails are registered).
// ============================================================================
import { route, ok, readJson, guardMutation, requestContext, authRateLimitKeys, withSessionCookie } from "@/lib/api.js";
import { loginSchema, parse } from "@/lib/validation.js";
import { loginUser } from "@/services/user.service.js";

export const POST = route(async (req, _ctx, { log }) => {
  const ctx = requestContext(req);
  const body = await readJson(req, { maxBytes: 8 * 1024 });

  // Parse just the identifier for the limiter, before the full validation, so a
  // malformed password does not skip the rate limit.
  const identifier = typeof body?.email === "string" ? body.email.trim().toLowerCase().slice(0, 255) : null;

  await guardMutation(req, {
    rateLimit: authRateLimitKeys({ scope: "login", identifier, ip: ctx.ip }),
    log,
  });

  const { email, password } = parse(loginSchema, body);
  const { user, token } = await loginUser({ email, password }, ctx);

  log.info("auth.login", { userId: user.id, role: user.role });

  return withSessionCookie(ok({ user }, { req }), token);
});
