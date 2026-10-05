// ============================================================================
// GET /api/auth/google/start — begin "Sign in with Google".
//
// Issues a signed state cookie (the CSRF token and PKCE verifier for the flow)
// and redirects to Google. The cookie is short-lived: 10 minutes covers a human
// picking an account, and is tight enough that a stolen redirect URL cannot be
// replayed next week.
// ============================================================================
import { route, requestContext } from "@/lib/api.js";
import { isGoogleEnabled, buildAuthorizationUrl } from "@/lib/google-oauth.js";
import { safeNextPathServer } from "@/lib/redirect.js";
import { cookies } from "next/headers";
import { isProduction } from "@/lib/env.server.js";

const COOKIE = "itp_oauth";
const STATE_TTL_SECONDS = 600;

export const GET = route(async (req, _ctx, { log }) => {
  const ctx = requestContext(req);
  const url = new URL(req.url);

  if (!isGoogleEnabled()) {
    return Response.json(
      { success: false, error: { code: "ITP_PROVIDER_NOT_CONFIGURED", message: "Login dengan Google belum dikonfigurasi." } },
      { status: 503 },
    );
  }

  // The post-login destination is chosen here, server-side, from a validated
  // path. It rides in the signed state, so a tampered ?next= cannot steer the
  // user somewhere unintended after login.
  const nextPath = safeNextPathServer(url.searchParams.get("next"));

  const { url: authorizationUrl, cookie } = await buildAuthorizationUrl({ nextPath });

  const response = Response.redirect(authorizationUrl, 302);
  // Written via next/headers instead of on the Response: Response.redirect()
  // returns a plain Response whose .cookies is undefined, so setting it here
  // throws "Cannot read properties of undefined (reading 'set')".
  const jar = await cookies();
  jar.set(COOKIE, cookie, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/",
    maxAge: STATE_TTL_SECONDS,
  });

  log.info("auth.google.start", { ip: ctx.ip });

  return response;
});
