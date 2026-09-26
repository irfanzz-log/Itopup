// ============================================================================
// Provider service — the boundary between the core app and any top-up provider.
//
// Nothing outside src/providers/ may import an adapter. Everything goes through
// here, which gives three things in one place:
//   * structured logging with duration and outcome for every provider call,
//   * translation of provider error codes into internal ITP_* codes,
//   * a cached-account-validation path so the storefront cannot be used as a
//     free player-lookup API (and cannot burn provider quota).
// ============================================================================
import { createLogger } from "../lib/logger.js";
import { AppError } from "../lib/errors.js";
import { getTopupProvider, listTopupProviders } from "../providers/index.js";
import { PROVIDER_ERROR, toInternalCode } from "../providers/contract.js";
import { prisma } from "../lib/db.js";

/** How long a successful validation stays usable, per player id. */
const VALIDATION_CACHE_MS = Number(process.env.VALIDATION_CACHE_MS || 10 * 60 * 1000);

/**
 * Translate a failed provider result into an AppError.
 *
 * `unknown: true` outcomes (timeout, unclassified) get a message that says the
 * status is being verified — NOT "failed". Telling a customer their top-up
 * failed when it may have succeeded is what produces support tickets and
 * duplicate purchases.
 */
export function providerFailureToError(result) {
  const code = toInternalCode(result?.error?.code);
  const detail = result?.error?.message;

  if (result?.error?.unknown) {
    return new AppError(code, "Status transaksi sedang diverifikasi. Silakan cek riwayat transaksi.", {
      meta: { providerCode: result.error.code, detail },
    });
  }

  return new AppError(code, undefined, { meta: { providerCode: result.error?.code, detail } });
}

/**
 * Validate a customer account against the provider.
 *
 * @param {{ gameSlug: string, fields: Record<string,string>, userId?: string|null, skipCache?: boolean }} input
 * @returns {Promise<{ valid: boolean, nickname: string|null, server: string|null, cached: boolean }>}
 */
export async function validateAccount({ gameSlug, fields, userId = null, skipCache = false }) {
  const provider = getTopupProvider();
  const log = createLogger({ component: "provider", gameSlug });

  if (!provider.isConfigured()) {
    const gaps = provider.configurationGaps();
    log.warn("provider.not_configured", { provider: provider.code, missing: gaps.missing });
    throw new AppError("ITP_PROVIDER_NOT_CONFIGURED", undefined, {
      meta: { provider: provider.code, missing: gaps.missing },
    });
  }

  const cacheKey = buildValidationCacheKey(provider.code, gameSlug, fields);

  if (!skipCache) {
    const cached = await readValidationCache(cacheKey);
    if (cached) {
      log.debug("provider.validation_cache_hit", { cacheKey: cacheKey.slice(0, 12) });
      return { ...cached, cached: true };
    }
  }

  const startedAt = Date.now();
  const result = await provider.validateAccount({ gameSlug, fields, log });
  const durationMs = Date.now() - startedAt;

  if (!result.ok) {
    log.warn("provider.validate_failed", {
      provider: provider.code,
      durationMs,
      code: result.error?.code,
      // The provider's own message is for operators; the customer gets the
      // mapped ITP_* message instead.
      detail: result.error?.message,
    });
    throw providerFailureToError(result);
  }

  const data = result.data ?? {};

  // Only cache a POSITIVE result. Caching a negative one would keep telling a
  // customer "not found" for ten minutes after they fixed a typo.
  if (data.valid) {
    await writeValidationCache(cacheKey, data);
  }

  log.info("provider.validated", {
    provider: provider.code,
    durationMs,
    valid: Boolean(data.valid),
    userId,
  });

  return {
    valid: Boolean(data.valid),
    nickname: data.nickname ?? null,
    server: data.server ?? null,
    cached: false,
  };
}

/**
 * A cache key must be stable for the same (provider, game, fields) and must not
 * collide across games. Fields are sorted so key order cannot change it.
 */
function buildValidationCacheKey(providerCode, gameSlug, fields) {
  const normalised = Object.keys(fields || {})
    .sort()
    .map((k) => `${k}=${String(fields[k]).trim()}`)
    .join("&");
  return `validation:${providerCode}:${gameSlug}:${normalised}`;
}

async function readValidationCache(key) {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key } });
    if (!row) return null;
    const value = row.value;
    if (!value || typeof value !== "object") return null;
    if (new Date(value.expiresAt).getTime() <= Date.now()) {
      // Expired: delete lazily rather than waiting for a sweep.
      await prisma.appSetting.delete({ where: { key } }).catch(() => {});
      return null;
    }
    return { valid: Boolean(value.valid), nickname: value.nickname ?? null, server: value.server ?? null };
  } catch {
    // A cache failure must never break validation — fall through to the provider.
    return null;
  }
}

async function writeValidationCache(key, data) {
  const expiresAt = new Date(Date.now() + VALIDATION_CACHE_MS).toISOString();
  try {
    await prisma.appSetting.upsert({
      where: { key },
      create: { key, value: { valid: true, nickname: data.nickname ?? null, server: data.server ?? null, expiresAt } },
      update: { value: { valid: true, nickname: data.nickname ?? null, server: data.server ?? null, expiresAt } },
    });
  } catch {
    /* best effort */
  }
}

/**
 * Fetch the provider's balance and persist it on the Provider row.
 * Returns a result object rather than throwing: the dashboard must render even
 * when the provider is unreachable.
 */
export async function syncBalance() {
  const provider = getTopupProvider();
  const log = createLogger({ component: "provider", job: "syncBalance" });

  if (!provider.isConfigured()) {
    return { ok: false, code: PROVIDER_ERROR.NOT_CONFIGURED, missing: provider.configurationGaps().missing };
  }

  const startedAt = Date.now();
  const result = await provider.getBalance({ log });
  const durationMs = Date.now() - startedAt;

  if (!result.ok) {
    log.warn("provider.balance_failed", { code: result.error?.code, durationMs });
    await prisma.provider
      .updateMany({ where: { code: provider.code }, data: { lastSyncStatus: `balance:${result.error?.code}` } })
      .catch(() => {});
    return { ok: false, code: result.error?.code, message: result.error?.message, durationMs };
  }

  await prisma.provider.upsert({
    where: { code: provider.code },
    create: {
      code: provider.code,
      kind: "TOPUP",
      name: provider.name,
      baseUrl: process.env.MELOSTORE_BASE_URL || null,
      balance: result.data.balance,
      balanceUpdatedAt: new Date(),
      lastSyncAt: new Date(),
      lastSyncStatus: "ok",
    },
    update: {
      balance: result.data.balance,
      balanceUpdatedAt: new Date(),
      lastSyncAt: new Date(),
      lastSyncStatus: "ok",
    },
  });

  log.info("provider.balance_synced", { provider: provider.code, durationMs });
  return { ok: true, balance: result.data.balance, currency: result.data.currency, durationMs };
}

/**
 * Diagnostics for /dev/providers. Reports configuration STATE and missing env
 * var NAMES — never a value, never a partial value.
 */
export function providerDiagnostics() {
  return listTopupProviders().map((provider) => {
    const gaps = provider.configurationGaps?.() ?? { missing: [] };
    const extra = typeof provider.diagnostics === "function" ? provider.diagnostics() : {};
    return {
      code: provider.code,
      name: provider.name,
      kind: provider.kind,
      configured: provider.isConfigured?.() ?? false,
      missing: gaps.missing,
      ...extra,
    };
  });
}

/** The provider selected by configuration. */
export function activeProviderCode() {
  return (process.env.TOPUP_PROVIDER || "melostore").trim().toLowerCase();
}
