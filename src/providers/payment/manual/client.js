// ============================================================================
// Manual / offline transfer — configuration.
//
// WHY THIS ADAPTER EXISTS
//
// The brief requires that a member can PAY, but no payment gateway has been
// chosen. Rather than invent a gateway API, this adapter implements the
// payment methods Indonesian stores actually use before they have a gateway:
// a transfer the customer makes, which an operator verifies against the bank
// statement (or the e-wallet notification) and confirms in the admin panel.
//
// It is a REAL adapter, not a stub: it satisfies src/providers/payment/contract.js
// completely. What it does NOT have is an HTTP API — there is nothing to call —
// so `verifyWebhook` honestly reports that no callback exists instead of
// pretending to verify one.
//
// TWO CHANNELS, ONE ADAPTER
//
// Bank transfer and e-wallet transfer (DANA/OVO/GoPay/ShopeePay to a merchant
// number) are the same business process: the customer sends money, a human
// confirms it arrived. They differ only in the destination and the wording.
// Two near-identical adapters would drift, and the drift would be silent —
// the amounts would still look right. So the channel is configuration, not a
// separate code path.
//
// SECRETS: account numbers and wallet numbers live in the environment and are
// read HERE only. The customer sees them through the payment instructions the
// server issues; they are never inlined into a client bundle.
// ============================================================================
import { optional } from "@/lib/env.server.js";

// The instruction builder is pure and shared between the offline methods.
// Re-exported so callers have one import path for this adapter's helpers.
export { buildTransferSteps } from "../amount.js";

/** One destination the customer may send money to. */
function normaliseDestination(raw, kindHint) {
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
 * Parse one destination list from the environment.
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
  const raw = optional(varName);
  if (!raw) return [];

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${varName} bukan JSON yang valid.`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`${varName} harus berupa array.`);
  }

  return parsed
    .filter((item) => item && typeof item === "object")
    .map((item) => normaliseDestination(item, kindHint))
    // A destination missing any field is unusable: showing a partial account
    // number is worse than showing none.
    .filter((dest) => dest.name && dest.number && dest.holder);
}

/** Bank accounts customers may transfer to. */
export function loadBankAccounts() {
  return loadDestinations("MANUAL_BANK_ACCOUNTS", "bank");
}

/** E-wallet numbers customers may send to. */
export function loadEwalletNumbers() {
  return loadDestinations("MANUAL_EWALLET_NUMBERS", "ewallet");
}

/**
 * Which destination channel a method key uses.
 *
 * Lives here, next to the destination loaders, because the answer decides which
 * list is consulted. The adapter's `channelForMethod` is the same rule; keeping
 * both in one file means a new method prefix cannot be handled in one place and
 * forgotten in the other.
 */
export function channelForMethod(method) {
  return String(method || "").startsWith("manual_ewallet") ? "ewallet" : "bank";
}

/**
 * Whether THIS method's channel has a destination configured.
 *
 * Adapter-wide `isConfigured()` answers a different question ("can this adapter
 * take any payment at all"). Offering a bank transfer when only an e-wallet
 * number is configured passes that check and then hands the customer
 * instructions they cannot follow — so per-method servability is asked
 * separately, and the reason names the missing channel.
 */
export function isMethodConfigured(method) {
  const channel = channelForMethod(method);
  const destinations = channel === "ewallet" ? loadEwalletNumbers() : loadBankAccounts();
  if (destinations.length > 0) return { ok: true };
  return {
    ok: false,
    reason:
      channel === "ewallet"
        ? "Nomor e-wallet tujuan belum dikonfigurasi."
        : "Rekening bank tujuan belum dikonfigurasi.",
  };
}

/**
 * Narrow a channel's destination list to the ONE the chosen method named.
 *
 * A method key is `manual_<channel>_<id>` — `manual_bank_bca`,
 * `manual_ewallet_dana`. The trailing id is matched case-insensitively
 * against each destination's name, so a customer who picks DANA is shown only
 * the DANA number, not every wallet we hold. Listing them all after the
 * customer already chose one is how money lands in the wrong wallet.
 *
 * The GENERIC methods keep the whole list, on purpose:
 *   * `manual_bank_lainnya` / `manual_ewallet_lainnya` mean the customer's own
 *     bank or wallet is not among the ones we named, so they pick from what we
 *     do have — the list is the answer.
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

/** Every destination across both channels, in declaration order. */
export function loadAllDestinations() {
  return [...loadBankAccounts(), ...loadEwalletNumbers()];
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
