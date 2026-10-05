// ============================================================================
// Manual / offline transfer: environment loaders.
//
// WHY THIS FILE IS SERVER-ONLY
//
// It reads secrets: bank account numbers and e-wallet numbers from the
// environment. Those must never reach a client bundle, so this module imports
// the `server-only` guard; importing it from a client component is a build
// error, not a warning. Before this guard the chain
//   config/payment.js → providers/payment/index.js → manual/index.js
//   → client.js → env.server.js → env.js
// pulled `env.js` (which calls path.resolve) into the CLIENT bundle, which is
// the Turbopack "dynamic filesystem access" warning in the Vercel log.
//
// The PURE rules live in rules.js (no secrets, importable anywhere): which
// channel a method names, how a key narrows a list. This file only reads the
// two JSON strings and hands them to those rules. Keeping the split means the
// rules have exactly one definition, and nothing client-facing can reach a
// secret by following this import.
// ============================================================================
import "server-only";
import { optional } from "@/lib/env.server.js";
import {
  buildTransferSteps,
  parseDestinations,
  channelForMethod,
  destinationsForMethod,
  methodConfiguredResult,
} from "./rules.js";

export { buildTransferSteps };
export { channelForMethod };
export { destinationsForMethod };

/**
 * Read one destination list from the environment.
 *
 * Configured as JSON so an operator can change destinations without a code
 * change:
 *   MANUAL_BANK_ACCOUNTS='[{"bank":"BCA","number":"1234567890","holder":"PT ITOPUP"}]'
 *   MANUAL_EWALLET_NUMBERS='[{"name":"DANA","number":"081234567890","holder":"PT ITOPUP"}]'
 *
 * An empty list means that channel is not usable, and `isConfigured()` reports
 * it, so checkout refuses rather than showing a customer a destination that does
 * not exist.
 */
function loadDestinations(varName, kindHint) {
  return parseDestinations(optional(varName), kindHint);
}

/** Bank accounts customers may transfer to. */
export function loadBankAccounts() {
  return loadDestinations("MANUAL_BANK_ACCOUNTS", "bank");
}

/** E-wallet numbers customers may send to. */
export function loadEwalletNumbers() {
  return loadDestinations("MANUAL_EWALLET_NUMBERS", "ewallet");
}

/** Every destination across both channels, in declaration order. */
export function loadAllDestinations() {
  return [...loadBankAccounts(), ...loadEwalletNumbers()];
}

/**
 * Whether THIS method's channel has a destination configured.
 *
 * Adapter-wide `isConfigured()` answers a different question ("can this adapter
 * take any payment at all"). Offering a bank transfer when only an e-wallet
 * number is configured passes that check and then hands the customer
 * instructions they cannot follow, so per-method servability is asked
 * separately, and the reason names the missing channel.
 */
export function isMethodConfigured(method) {
  const channel = channelForMethod(method);
  const all = channel === "ewallet" ? loadEwalletNumbers() : loadBankAccounts();
  return methodConfiguredResult(method, all);
}

/** How long the customer has to complete the transfer. */
export function transferWindowMinutes() {
  const raw = optional("MANUAL_TRANSFER_WINDOW_MINUTES");
  if (!raw) return 180;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`MANUAL_TRANSFER_WINDOW_MINUTES harus angka positif, bukan "${raw}".`);
  }
  return parsed;
}

export function configurationGaps() {
  const missing = [];
  if (loadBankAccounts().length === 0) missing.push("MANUAL_BANK_ACCOUNTS");
  if (loadEwalletNumbers().length === 0) missing.push("MANUAL_EWALLET_NUMBERS");
  return { missing };
}

/**
 * Usable when AT LEAST ONE channel has a destination.
 *
 * Deliberately not "both": an operator who has a bank account but no e-wallet
 * number can still take payments. Requiring both would disable a method that
 * works.
 */
export function isConfigured() {
  return loadAllDestinations().length > 0;
}
