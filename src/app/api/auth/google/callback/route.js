// ============================================================================
// GET /api/auth/google/callback — Google redirects here with the code.
//
// Verifies the state cookie (CSRF + PKCE verifier), exchanges the code for
// tokens, reads the verified userinfo, resolves it to a local user, and opens a
// session. The state cookie is cleared on every exit path: it is single-use, so
// leaving it set would let a replayed redirect be accepted twice.
//
// Errors land on /login with a reason code, because a JSON body is useless to a
// browser that arrives here via a 302 from accounts.google.com.
// ============================================================================
import { route, requestContext } from "@/lib/api.js";
import { completeGoogleLogin } from "@/lib/google-oauth.js";
import { isProduction } from "@/lib/env.server.js";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "@/lib/auth/session.js";
import { cookies } from "next/headers";

const OAUTH_COOKIE = "itp_oauth";
const OAUTH_TICKET_COOKIE = "itp_oauth_ticket";
const OAUTH_TICKET_TTL_SECONDS = 600;

// Response.redirect() is the Web Fetch API, not Next: it rejects relative URLs
// ("Failed to parse URL from /login?..."), so paths must be made absolute
// against the request origin before redirecting.
function absoluteUrl(req, path) {
  const origin = new URL(req.url).origin;
  return new URL(path, origin).toString();
}

function failureUrl(reason) {
  const params = new URLSearchParams({ google_error: reason });
  return `/login?${params.toString()}`;
}

export const GET = route(async (req, _ctx, { log }) => {
  const ctx = requestContext(req);
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  // The cookie must exist and match the state. This is checked inside the
  // service too; failing here avoids a token exchange we already know is bad.
  const cookie = req.cookies.get(OAUTH_COOKIE)?.value ?? null;

  const jar = await cookies();
  const setCookie = (name, value, options) => {
    if (value === null) jar.delete(name);
    else jar.set(name, value, options);
  };
  const cookieOptions = { httpOnly: true, secure: isProduction(), sameSite: "lax", path: "/" };

  if (!code || !state) {
    log.warn("auth.google.callback.missing_params");
    jar.delete(OAUTH_COOKIE);
    return Response.redirect(absoluteUrl(req, failureUrl("missing")), 302);
  }

  try {
    const result = await completeGoogleLogin({
      code,
      state,
      cookie,
      request: ctx,
    });

    // A returning user with a password: straight in.
    if (!result.needsPassword) {
      log.info("auth.google.success", { userId: result.user.id });

      setCookie(SESSION_COOKIE, result.token, { ...cookieOptions, maxAge: SESSION_MAX_AGE_SECONDS });
      jar.delete(OAUTH_COOKIE);
      return Response.redirect(absoluteUrl(req, result.nextPath), 302);
    }

    // A new Google identity (or a password-less one): do NOT sign in. Send the
    // user to set a password, carrying the resolved identity in a short-lived
    // signed cookie so the set-password page never trusts a query param.
    log.info("auth.google.password_required");

    setCookie(OAUTH_TICKET_COOKIE, result.oauthTicket, {
      ...cookieOptions,
      maxAge: OAUTH_TICKET_TTL_SECONDS,
    });
    jar.delete(OAUTH_COOKIE);
    return Response.redirect(absoluteUrl(req, "/auth/set-password"), 302);
  } catch (err) {
    // A distinct code per failure, so the login page can say what actually
    // happened without exposing provider internals.
    const reason = err?.code === "ITP_EMAIL_NOT_VERIFIED"
      ? "unverified"
      : err?.code === "ITP_UNAUTHORIZED"
        ? "state"
        : "provider";

    log.warn("auth.google.callback.failed", { code: err?.code ?? "ITP_INTERNAL_ERROR" });
    jar.delete(OAUTH_COOKIE);
    return Response.redirect(absoluteUrl(req, failureUrl(reason)), 302);
  }
});
