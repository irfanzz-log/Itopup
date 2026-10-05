// ============================================================================
// POST /api/topup/validate, verify a customer account against the provider.
//
// Browsing requires no login (a visitor must be able to check their ID before
// signing up), so this route is public, and therefore the most attractive
// endpoint in the app to abuse, because every call costs a provider request.
// It is rate limited on two axes (IP and session) and the answer is cached
// server-side for a short window, so hammering it cannot drain provider quota.
//
// The client NEVER decides validity: this handler returns the provider's answer
// or an error, and nothing else.
// ============================================================================
import {
  route, ok, readJson, guardMutation, requestContext, bucket,
} from "@/lib/api.js";
import { presets } from "@/lib/rate-limit.js";
import { validateAccountSchema, parse } from "@/lib/validation.js";
import { getSessionUser } from "@/lib/auth/session.js";
import { validateAccount } from "@/services/provider.service.js";

export const POST = route(async (req, _ctx, { log }) => {
  const ctx = requestContext(req);
  const body = await readJson(req, { maxBytes: 4 * 1024 });

  // Read the session opportunistically: it sharpens the rate-limit key, but a
  // missing session is not an error here.
  const user = await getSessionUser(req);

  await guardMutation(req, {
    rateLimit: [
      bucket("validate", presets.validateIp, { ip: ctx.ip }),
      ...(user ? [bucket("validate", presets.validate, { userId: user.id })] : []),
    ],
    log,
  });

  const { gameSlug, fields } = parse(validateAccountSchema, body);

  const result = await validateAccount({
    gameSlug,
    fields,
    userId: user?.id ?? null,
  });

  log.info("topup.validate", {
    gameSlug,
    valid: result.valid,
    cached: result.cached,
    userId: user?.id ?? null,
  });

  // Only the fields the customer needs to see. The provider's raw payload stays
  // server-side.
  return ok(
    {
      valid: result.valid,
      nickname: result.nickname,
      server: result.server,
    },
    { req }
  );
});
