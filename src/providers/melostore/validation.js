// ============================================================================
// Melostore H2H — account validation (check nickname).
//
// The provider is the ONLY authority on whether a player id exists. The frontend
// never decides, and neither does a local format check beyond the game's own
// field contract.
//
// IMPLEMENTED FROM THE OFFICIAL DOCUMENTATION (h2h.melostore.id/id/docs):
//
//   POST /api/v1/h2h/check-nickname
//   Body: { game_code, customer_target, customer_target_zone?, sku_code? }
//
//   Success → 200 { success: true, data: { username, region, … } }
//   Not found → 422 { success: false, error: { code: 4001, category: "not_found" } }
//
// ⚠️  THE DISTINCTION THAT MATTERS: an unknown account is an HTTP 422 with
// `error.category: "not_found"` — NOT a 200 with a flag. So a 422 is a
// NORMAL, EXPECTED answer meaning "no such player", while a 5xx or a timeout is
// an outage. Reporting an outage as "account not found" would make a customer
// retype a correct player id forever; reporting a wrong id as an outage would
// make them retry a typo. Both are handled separately below.
//
// Billing: the docs note each check consumes a free quota or costs 1 MC, and
// that REPEAT checks for the same account are billed too. The caller (service
// layer) is responsible for not calling this in a loop; this adapter adds no
// cache of its own, so it never silently serves a stale "valid".
// ============================================================================
import { PROVIDER_ERROR, providerErr } from "../contract.js";
import { call } from "./client.js";
import { mapGameToProvider, normalizeValidationResponse, mapFieldsToProvider } from "./mapper.js";

export const VALIDATE_PATH = "/api/v1/h2h/check-nickname";

/**
 * Validate a customer-supplied account against the provider.
 *
 * @param {{ gameSlug: string, fields: Record<string,string>, skuCode?: string, log?: object }} input
 * @returns {Promise<import('../contract.js').ProviderResult<import('../contract.js').NormalizedAccount>>}
 */
export async function validateAccount({ gameSlug, fields, skuCode, log } = {}) {
  let gameCode;
  try {
    gameCode = mapGameToProvider(gameSlug);
  } catch (err) {
    return providerErr(PROVIDER_ERROR.NOT_CONFIGURED, String(err?.message || err), {
      retryable: false,
    });
  }

  let target;
  try {
    // Reuses the order mapper so the target/zone/additional_data split is
    // defined in exactly one place.
    target = mapFieldsToProvider({ gameSlug, fields });
  } catch (err) {
    return providerErr(PROVIDER_ERROR.REJECTED, String(err?.message || err), { retryable: false });
  }

  const payload = { game_code: gameCode, ...target };
  if (skuCode) payload.sku_code = String(skuCode);

  const result = await call({
    path: VALIDATE_PATH,
    method: "POST",
    payload,
    // A read: retrying is safe from the provider's side. The service layer
    // decides whether a retry is worth another billed check.
    idempotent: true,
    log,
    operation: "validateAccount",
  });

  if (!result.ok) {
    // The documented "not found" is a 422. client.js classifies
    // `error.category === "not_found"` as REJECTED, which is what lets us turn
    // it into a clean { valid: false } instead of surfacing an error to the
    // customer — while a 5xx/timeout still propagates as an outage.
    const isNotFound =
      result.error?.code === PROVIDER_ERROR.REJECTED &&
      /akun tidak ditemukan|user id|not found/i.test(result.error?.message || "");

    if (isNotFound) {
      return {
        ok: true,
        data: {
          valid: false,
          nickname: null,
          server: null,
          accountId: null,
          region: null,
          purchaseCheck: null,
        },
        meta: { ...result.meta, notFound: true },
      };
    }
    return result;
  }

  try {
    return { ok: true, data: normalizeValidationResponse(result.data), meta: result.meta };
  } catch (err) {
    return providerErr(PROVIDER_ERROR.UNKNOWN, String(err?.message || err), { retryable: false });
  }
}
