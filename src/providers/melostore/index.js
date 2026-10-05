// ============================================================================
// Melostore H2H: assembled adapter.
//
// This is the object src/providers/index.js hands out. It satisfies the contract
// in ../contract.js and is the ONLY surface the core app sees.
//
// It carries no provider-specific knowledge of its own; it wires the focused
// modules together, so each concern (signing, mapping, dispatch, reconciliation)
// stays independently testable.
// ============================================================================
import { assertTopupProvider } from "../contract.js";
import { configurationGaps, isConfigured } from "./client.js";
import { getProducts, getCategories } from "./products.js";
import { validateAccount } from "./validation.js";
import { createOrder, getOrderStatus, PROVIDER_SUPPORTS_CLIENT_REFERENCE } from "./order.js";
import { getBalance } from "./balance.js";
import { parseCallback, CALLBACKS_SUPPORTED } from "./callback.js";
import { mapperStatus } from "./mapper.js";
import { signatureImplemented, loadAuthCredentials } from "./signature.js";

export const melostoreProvider = assertTopupProvider({
  code: "melostore",
  name: "Melostore H2H",
  kind: "TOPUP",

  isConfigured,
  configurationGaps,

  getProducts,
  validateAccount,
  createOrder,
  getOrderStatus,
  getBalance,
  parseCallback,

  /** Not part of the contract; used by the product sync job. */
  getCategories,

  /** Extra, non-contract diagnostics surfaced on /dev/providers. */
  diagnostics() {
    const gaps = configurationGaps();
    const mapper = mapperStatus();
    const { webhookMissing } = loadAuthCredentials();
    return {
      code: "melostore",
      configured: isConfigured(),
      missing: gaps.missing,
      signatureImplemented: signatureImplemented(),
      mapper,
      callbacksSupported: CALLBACKS_SUPPORTED,
      webhookConfigured: webhookMissing.length === 0,
      supportsClientReference: PROVIDER_SUPPORTS_CLIENT_REFERENCE,
      ready: isConfigured() && mapper.ready && webhookMissing.length === 0,
    };
  },
});

export default melostoreProvider;
