// ============================================================================
// Payment catalogue: server-only entry point.
//
// WHY THIS FILE EXISTS
//
// config/payment.js holds the static method catalogue and is imported by client
// components (TopupForm renders it into a checkout). This file is the only place
// the catalogue meets the payment ADAPTERS.
//
// That boundary matters: the adapters read secrets (bank and e-wallet
// destination numbers) from the environment, and env.server.js imports env.js,
// which reads a file off disk at build time. Importing the adapters from
// config/payment.js made Turbopack trace the whole project and inline
// src/lib/env.js into the CLIENT bundle, the "Dynamic filesystem access"
// warning in the deploy log, and a real leak of the env-loading path.
//
// Keeping the split means the client gets the pure catalogue only, and the
// adapter chain is reachable from server components and route handlers alone.
// ============================================================================
import "server-only";
import { enabledPaymentMethods } from "./payment.js";
import { checkMethodServable } from "../providers/payment/index.js";
import { isMethodOut } from "../services/payment-outage.service.js";

/**
 * Methods that can actually complete a payment: implemented AND served by a
 * configured adapter.
 *
 * `enabledPaymentMethods()` alone is not enough to render a checkout. A method
 * whose adapter is missing configuration would be offered to the customer, they
 * would fill the whole form, and the order would be refused at the last step.
 * This is the list the UI and the order service must both agree on.
 *
 * OUTAGE FILTER: a method whose channel is failing past its retries is dropped
 * here too. Midtrans serves a bank/partner outage as a 502 body status, and
 * without this filter the customer only discovers the channel is dead at the
 * last step, after filling the whole form. See payment-outage.service.js; the
 * record clears itself on the next successful charge, so recovery is automatic.
 */
export async function availablePaymentMethods() {
  const methods = [];
  for (const method of enabledPaymentMethods()) {
    if (!checkMethodServable(method.key).ok) continue;
    // A hidden channel is not removed from PAYMENT_METHODS (historical orders
    // still need its label) and is not disabled forever; it is simply not
    // offered while it is failing.
    if (await isMethodOut(method.key)) continue;
    methods.push(method);
  }
  return methods;
}
