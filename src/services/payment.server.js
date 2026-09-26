// ============================================================================
// Payment service — server-only entry points.
//
// WHY THIS FILE EXISTS
//
// services/payment.service.js is imported by route handlers and (indirectly) by
// client components through the payment-instructions API flow. It must not
// carry the `server-only` guard itself, or the API routes that re-export its
// helpers would fail to bundle — so the pieces that MUST stay server-only
// (settlePayment touches the order state machine and the top-up dispatch) live
// here, imported only from server contexts (this webhook route).
//
// The webhook route dynamic-imports this module: a static import from a route
// handler is fine, but the dynamic form keeps the Midtrans adapter chain out of
// any bundle that does not need it.
// ============================================================================
import "server-only";
export { settlePayment } from "./payment.service.js";
