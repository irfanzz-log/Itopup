// ============================================================================
// POST /api/webhooks/topup — inbound provider callback.
//
// THE ORDER OF OPERATIONS IS THE SECURITY CONTROL:
//   1. read the RAW body (re-serialising changes bytes and breaks the HMAC),
//   2. verify the signature,
//   3. dedupe on the provider's event id,
//   4. only then touch an order.
//
// A callback parsed before it is verified is a spoofing vector: anyone who
// learns the URL can POST {"status":"SUCCESS"} and have goods delivered.
//
// This endpoint is NOT CSRF-guarded and NOT session-guarded — it is
// machine-to-machine. Its authentication is the signature, which is why the
// signature check must fail closed. Today the Melostore adapter's signature
// module has no algorithm implemented (documentation pending), so every
// callback is REFUSED. That is the correct failure mode: refusing a genuine
// callback is recoverable through reconciliation; accepting a forged one is not.
//
// Always returns 2xx for a callback we understood but chose not to act on, so
// the provider does not retry forever. Genuine failures return 5xx so it does.
// ============================================================================
import { NextResponse } from "next/server";
import { route } from "@/lib/api.js";
import { AppError } from "@/lib/errors.js";
import { clientIp, enforce, presets } from "@/lib/rate-limit.js";
import { getTopupProvider } from "@/providers/index.js";
import { PROVIDER_ERROR } from "@/providers/contract.js";
import { recordWebhookEvent, applyTopupCallback } from "@/services/webhook.service.js";

export const dynamic = "force-dynamic";

/** Hard ceiling on a callback body. A provider payload is small; a 1 MB one is an attack. */
const MAX_CALLBACK_BYTES = 64 * 1024;

export const POST = route(async (req, _ctx, { log, rid }) => {
  const ip = clientIp(req);

  // Flood protection only — the signature is the real authentication. Fails
  // open, because dropping a provider retry loses money.
  await enforce([["webhook:topup", presets.webhook]]);

  const raw = await readRawBody(req);

  const provider = getTopupProvider();
  const parsed = await provider.parseCallback({ headers: req.headers, rawBody: raw, log });

  if (!parsed.ok) {
    // NOT_CONFIGURED / REJECTED both mean "we cannot authenticate this". The
    // provider gets 401 and should not retry a forged payload.
    const status =
      parsed.error?.code === PROVIDER_ERROR.NOT_CONFIGURED ? 503 : 401;
    log.warn("webhook.topup_rejected", { code: parsed.error?.code, ip });

    // A 503 tells the provider to retry later, which is what we want while the
    // signature algorithm is still unimplemented.
    return NextResponse.json(
      { success: false, error: { code: "ITP_WEBHOOK_INVALID_SIGNATURE" }, requestId: rid },
      { status }
    );
  }

  const callback = parsed.data;

  // ── Replay protection ────────────────────────────────────────────────────
  // Insert the provider event id first. A duplicate (P2002) is a replay: ack it
  // and do nothing. This must happen BEFORE any state change.
  const recorded = await recordWebhookEvent({
    providerCode: provider.code,
    externalId: callback.eventId,
    eventType: callback.eventType,
    orderRef: callback.providerRef ?? null,
    payloadHash: callback.payloadHash,
    rawPayload: raw,
  });

  if (!recorded.fresh) {
    log.info("webhook.topup_replay", { externalId: callback.eventId });
    // 200: the provider's job is done, re-sending will not change anything.
    return NextResponse.json({ success: true, data: { received: true, duplicate: true }, requestId: rid });
  }

  const outcome = await applyTopupCallback({ callback, log });

  return NextResponse.json(
    { success: true, data: { received: true, ...outcome }, requestId: rid },
    { status: outcome.retryable ? 500 : 200 }
  );
});

/** Read the body as a string, enforcing the size ceiling. */
async function readRawBody(req) {
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared && declared > MAX_CALLBACK_BYTES) {
    throw new AppError("ITP_PAYLOAD_TOO_LARGE");
  }
  const text = await req.text();
  if (Buffer.byteLength(text, "utf8") > MAX_CALLBACK_BYTES) {
    throw new AppError("ITP_PAYLOAD_TOO_LARGE");
  }
  return text;
}
