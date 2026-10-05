// ============================================================================
// Payment outage tracking, a self-healing circuit breaker per payment method.
//
// WHY THIS EXISTS
//
// Midtrans serves a bank/partner failure INSIDE an HTTP 200:
//
//   {"status_code":"502","status_message":"Sorry. The bank/payment partner is
//    experiencing issues. Please retry later."}
//
// Before this module, one of those failed the customer's checkout outright and
// the error we showed was "Respon server pembayaran tidak berisi data
// transaksi." The charge classification is fixed (client.js), but a channel
// that is DOWN still has to be paid for by the customer: they fill the whole
// form, reach the last step, and only then learn the method they picked cannot
// pay. Nothing offered them an alternative, and nothing stopped the next
// customer from picking the same dead channel.
//
// THE DESIGN: record a strike, hide the method while it is failing, let it back
// in as soon as it recovers.
//
//   * A charge failure with an UNAVAILABLE code records a strike in AppSetting.
//   * `availablePaymentMethods()` asks `isMethodOut()` and drops the method, so
//     checkout never offers it. No redeploy, no `enabled: false` edit: flipping
//     a config flag takes a release, and an outage does not wait for one.
//   * A charge SUCCESS clears the strikes. Recovery is automatic and needs no
//     operator action at all; the channel comes back the moment it works.
//
// WHY PER-METHOD, NOT PER-PROVIDER
//
// The 502 names "the bank/payment partner", not Midtrans. BCA can fail while
// QRIS works; Permata can fail while BNI works. Killing the whole provider
// takes down every working channel over one bank's outage.
//
// WHY THE THRESHOLD IS 2, NOT 1
//
// A single 502 is ordinary sandbox flakiness and a retry already covers it
// (RECHARGE_ATTEMPTS). Only a channel that fails PAST its retries is treated as
// out. Recording every transient blip would flicker the checkout for every
// customer the moment the gateway hiccups.
//
// WHY THE RECORD EXPIRES
//
// Strikes auto-expire after OUTAGE_TTL_MS so a channel that stopped failing is
// never left disabled by a stale record. The success-clear is the primary
// recovery path, and this is the backstop if the success path never ran
// (the order was abandoned, the charge was never retried).
//
// THIS IS AN AVAILABILITY MEASURE, NOT A SECURITY ONE. The strike record is
// operator-visible state written by the charge path; it is never trusted as an
// authentication or authorisation input, and reading it never gates access to
// a customer's own data, only which methods checkout offers.
// ============================================================================

import { prisma } from "../lib/db.js";

/** Strikes before a method is hidden. See the header for the reasoning. */
export const OUTAGE_STRIKE_THRESHOLD = 2;

/** How long a strike is remembered before it auto-expires. */
export const OUTAGE_TTL_MS = 30 * 60 * 1000;

/**
 * Record that a payment method failed to charge.
 *
 * Called from the charge path ONLY (createPaymentInstructions), after the
 * bounded retries are exhausted. A transient blip that a retry fixed never
 * reaches here, which is what keeps ordinary flakiness out of the record.
 *
 * @param {string} methodKey the PAYMENT_METHODS key, e.g. `va_bca`
 * @param {string} code the PAYMENT_ERROR code from the adapter
 */
export async function recordPaymentOutage(methodKey, code) {
  if (!methodKey || typeof methodKey !== "string") return;
  // Only gateway-side unavailability is a channel outage. A REJECTED means OUR
  // payload was wrong. Recording a strike would hide a working channel over
  // our own bug, and the fix is the payload, not the checkout.
  if (code !== "UNAVAILABLE") return;

  const key = outageKey(methodKey);
  const now = Date.now();

  try {
    const existing = await prisma.appSetting.findUnique({ where: { key } });
    const strikes = filterLive(existing?.value, now);
    strikes.push({ at: now, code });

    await prisma.appSetting.upsert({
      where: { key },
      create: { key, value: { strikes, updatedAt: now } },
      update: { value: { strikes, updatedAt: now } },
    });
  } catch {
    // Outage tracking is best effort: a DB failure here must not turn a payment
    // problem into a checkout outage. The next charge tries again.
  }
}

/**
 * Clear a method's outage record on success. Recovery is automatic, nothing
 * waits for an operator, so a channel that starts working is offered again on
 * the very next checkout.
 *
 * @param {string} methodKey
 */
export async function clearPaymentOutage(methodKey) {
  if (!methodKey || typeof methodKey !== "string") return;
  const key = outageKey(methodKey);
  try {
    // delete() throws when the row is absent; that is the common case on a
    // healthy channel and is not an error worth propagating.
    await prisma.appSetting.delete({ where: { key } }).catch(() => {});
  } catch {
    /* best effort */
  }
}

/**
 * Is this method currently failing past the threshold?
 *
 * Read by `availablePaymentMethods()` to decide what checkout offers. It must
 * stay cheap and never throw. A lookup failure would take the whole checkout
 * list down rather than showing one possibly-dead method.
 *
 * @param {string} methodKey
 * @returns {Promise<boolean>} true when the method should be hidden
 */
export async function isMethodOut(methodKey) {
  if (!methodKey || typeof methodKey !== "string") return false;
  const key = outageKey(methodKey);
  try {
    const row = await prisma.appSetting.findUnique({ where: { key } });
    if (!row) return false;
    const strikes = filterLive(row.value, Date.now());
    return strikes.length >= OUTAGE_STRIKE_THRESHOLD;
  } catch {
    return false;
  }
}

/** Stable record key, namespaced so it cannot collide with the validation cache. */
function outageKey(methodKey) {
  return `payment:outage:${methodKey}`;
}

/** Drop expired strikes. A record with only stale entries is treated as clean. */
function filterLive(value, now) {
  const strikes = Array.isArray(value?.strikes) ? value.strikes : [];
  return strikes.filter((s) => {
    const at = Number(s?.at);
    return Number.isFinite(at) && now - at < OUTAGE_TTL_MS;
  });
}
