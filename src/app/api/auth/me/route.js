// ============================================================================
// GET /api/auth/me
//
// Returns the current session's user, or 401. Used by client components that
// need to re-check auth after a long-lived page (e.g. the checkout wizard).
//
// `no-store` because the answer is per-session, a shared cache serving one
// user's profile to another would be a serious leak.
// ============================================================================
import { route, ok, fail } from "@/lib/api.js";
import { getSessionUser } from "@/lib/auth/session.js";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const user = await getSessionUser(req);
  if (!user) return fail("ITP_UNAUTHORIZED", undefined, { req });
  if (user.status === "BLOCKED") return fail("ITP_ACCOUNT_BLOCKED", undefined, { req });
  return ok({ user }, { req });
});
