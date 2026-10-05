// ============================================================================
// GET /api/auth/set-password — the second half of a Google sign-up.
//
// The member has already proved the Google identity; this endpoint accepts the
// password they want, stores it, and opens a session. It is NOT a general
// "set any password" endpoint: the identity is bound to the signed ticket in
// the itp_oauth_ticket cookie, which only /api/auth/google/callback can issue.
// ============================================================================
import { route, ok, readJson, guardMutation, requestContext, bucket } from "@/lib/api.js";
import { presets } from "@/lib/rate-limit.js";
import { completeGoogleSignup } from "@/lib/google-oauth.js";
import { isProduction } from "@/lib/env.server.js";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "@/lib/auth/session.js";

export const POST = route(async (req, _ctx, { log }) => {
  const ctx = requestContext(req);

  await guardMutation(req, {
    rateLimit: [
      bucket("otp", presets.otp, { ip: ctx.ip }),
      ["set-password:global", { ...presets.otp, limit: presets.otp.limit * 10 }],
    ],
    log,
  });

  const body = await readJson(req, { maxBytes: 4 * 1024 });
  const { password } = body ?? {};

  const result = await completeGoogleSignup({
    ticket: req.cookies.get("itp_oauth_ticket")?.value ?? null,
    password,
    request: ctx,
  });

  log.info("auth.google.signup_completed", { userId: result.user.id });

  const response = ok({ user: result.user }, { status: 201, req: ctx });

  // The ticket is single-use: burn it now that it has been consumed.
  response.cookies.set("itp_oauth_ticket", "", {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  response.cookies.set(SESSION_COOKIE, result.token, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  return response;
});
