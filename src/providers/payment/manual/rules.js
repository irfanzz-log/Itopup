// ============================================================================
// Manual / offline transfer: the pure rules.
//
// WHY THIS FILE EXISTS
//
// `client.js` reads secrets from the environment, so it carries the
// server-only guard and can never be imported from a client component.
// The rules in THIS file answer questions that need no secrets at all:
// which channel a method key names, and how a key narrows a destination
// list. They are shared so one definition decides both the offer and the
// instruction; two copies is how the UI offers a method the server then
// declines.
// ============================================================================
import { formatNumber } from "../../../lib/format.js";

/** Re-exported here so callers import channel rules from one place. */
export { buildTransferSteps } from "../amount.js";

/** One destination the customer may send money to. */
export function normaliseDestination(raw, kindHint) {
  const declared = String(raw?.kind ?? "").trim().toLowerCase();
  const kind = declared === "ewallet" || declared === "bank" ? declared : kindHint;
  return {
    kind,
    /// Bank name, or e-wallet name (DANA, OVO, …).
    name: String(raw?.name ?? raw?.bank ?? "").trim(),
    /// Account number, or the e-wallet phone number.
    number: String(raw?.number ?? "").trim(),
    /// Account holder name.
    holder: String(raw?.holder ?? "").trim(),
  };
}

/**
 * Parse one destination list from a JSON string.
 *
 * Configured as JSON so an operator can change destinations without a code
 * change:
 *   MANUAL_BANK_ACCOUNTS='[{"bank":"BCA","number":"1234567890","holder":"PT ITOPUP"}]'
 *
 * An empty list means that channel is not usable; the caller reports it, so
 * checkout refuses rather than showing a customer a destination that does not
 * exist.
 */
export function parseDestinations(raw, kindHint) {
  if (!raw) return [];

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Konfigurasi tujuan ${kindHint} bukan JSON yang valid.`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`Konfigurasi tujuan ${kindHint} harus berupa array.`);
  }

  return parsed
    .filter((item) => item && typeof item === "object")
    .map((item) => normaliseDestination(item, kindHint))
    .filter((d) => d.name && d.number);
}

/**
 * Which channel a method key names.
 *
 * `manual_ewallet_*` is the e-wallet channel, everything else is a bank
 * transfer (the generic `manual_transfer` key and the legacy
 * `manual_bank_lainnya` key both land here).
 */
export function channelForMethod(method) {
  return String(method || "").startsWith("manual_ewallet") ? "ewallet" : "bank";
}

/**
 * Narrow a channel's destination list to the ONE the chosen method named.
 *
 * A method key is `manual_<channel>_<id>`, e.g. `manual_bank_bca` or
 * `manual_ewallet_dana`. The trailing id is matched case-insensitively
 * against each destination's name, so a customer who picks DANA is shown only
 * the DANA number, not every wallet we hold. Listing them all after the
 * customer already chose one is how money lands in the wrong wallet.
 *
 * The GENERIC methods keep the whole list, on purpose:
 *   * `manual_bank_lainnya` / `manual_ewallet_lainnya` mean the customer's own
 *     bank or wallet is not among the ones we named, so they pick from what we
 *     do have; the list is the answer.
 *   * the legacy `manual_transfer` key never named a destination at all.
 *
 * A name that matches nothing also falls back to the full list rather than to
 * an empty one: showing nothing would leave the customer with an amount and
 * nowhere to send it.
 */
export function destinationsForMethod(method, all) {
  const list = Array.isArray(all) ? all : [];
  const suffix = String(method || "")
    .split("_")
    .slice(2)
    .join("_")
    .trim()
    .toLowerCase();
  if (!suffix || suffix === "lainnya") return list;

  const matched = list.filter((d) => String(d.name).trim().toLowerCase() === suffix);
  return matched.length > 0 ? matched : list;
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
export function methodConfiguredResult(method, all) {
  const list = Array.isArray(all) ? all : [];
  if (list.length > 0) return { ok: true };
  const channel = channelForMethod(method);
  return {
    ok: false,
    reason:
      channel === "ewallet"
        ? "Nomor e-wallet tujuan belum dikonfigurasi."
        : "Rekening bank tujuan belum dikonfigurasi.",
  };
}

/** Keeps `formatNumber` in the bundle graph of this module; it formats the
 * account number on the server when building instructions. */
export const _formats = { formatNumber };
