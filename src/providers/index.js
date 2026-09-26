// ============================================================================
// Top-up provider registry.
//
// The ONLY module the rest of the app imports to reach a top-up provider.
// Swapping providers is a config change (TOPUP_PROVIDER=…), not a code change.
//
// Adapters are imported statically so that a missing adapter is a build error
// rather than a runtime surprise on the first customer checkout.
// ============================================================================
import { assertTopupProvider } from "./contract.js";
import { melostoreProvider } from "./melostore/index.js";

/** @type {Record<string, object>} */
const REGISTRY = {
  melostore: melostoreProvider,
};

/** Default adapter when TOPUP_PROVIDER is unset. */
const DEFAULT_PROVIDER = "melostore";

/**
 * Resolve a top-up adapter by code.
 * @param {string} [code] defaults to the TOPUP_PROVIDER env var
 */
export function getTopupProvider(code) {
  const key = (code || process.env.TOPUP_PROVIDER || DEFAULT_PROVIDER).trim().toLowerCase();
  const adapter = REGISTRY[key];
  if (!adapter) {
    throw new Error(
      `Top-up provider "${key}" tidak dikenal. Pilihan yang tersedia: ${Object.keys(REGISTRY).join(", ")}.`
    );
  }
  return assertTopupProvider(adapter);
}

/** All registered adapters, for the admin provider list. */
export function listTopupProviders() {
  return Object.values(REGISTRY);
}

export function isRegisteredProvider(code) {
  return Boolean(REGISTRY[String(code || "").trim().toLowerCase()]);
}

export { REGISTRY as TOPUP_PROVIDER_REGISTRY };
