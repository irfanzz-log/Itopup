// ============================================================================
// POST /api/auth/register — stage one of registration.
//
// Validates the form, then sends a 6-digit code to the email it was given. The
// account is NOT created here; it is created by POST /api/auth/register/verify
// once the code is confirmed. See user.service requestRegistration for why the
// form is held on the OTP row instead of being created-and-flagged-unverified.
//
// Security properties:
//   * same-origin check (CSRF) before anything else,
//   * two rate-limit buckets (IP + a coarse global),
//   * server-side Zod validation with `.strict()`, an unexpected field is an
//     error, not a silently ignored value,
//   * no session is issued at any point: the member logs in explicitly.
// ============================================================================
import { route, ok, readJson, guardMutation, requestContext, bucket } from "@/lib/api.js";
import { presets } from "@/lib/rate-limit.js";
import { isOtpReady } from "@/services/otp.service.js";
import { requestRegistration } from "@/services/user.service.js";

export const POST = route(async (req, _ctx, { log }) => {
  const ctx = requestContext(req);

  // Refuse before spending an email when SMTP is down, with a code the client
  // can show verbatim instead of a generic 500.
  if (!isOtpReady()) {
    log.warn("auth.register.mail_unavailable");
    return Response.json(
      { success: false, error: { code: "ITP_OTP_MAIL_UNAVAILABLE", message: "Layanan email belum dikonfigurasi." } },
      { status: 503 },
    );
  }

  await guardMutation(req, {
    rateLimit: [
      bucket("register", presets.register, { ip: ctx.ip }),
      // Global ceiling so rotating IPs cannot multiply the per-IP allowance.
      ["register:global", { ...presets.register, limit: presets.register.limit * 10 }],
    ],
    log,
  });

  const body = await readJson(req, { maxBytes: 8 * 1024 });
  await requestRegistration(body, ctx);

  log.info("auth.register.otp_sent", { ip: ctx.ip });

  // The client shows the "enter your code" step on this response. It does not
  // tell the caller whether the address was unknown, for the same reason the
  // duplicate check stays generic.
  return ok({ otpRequested: true }, { status: 200, req: ctx });
});
