# Payment provider adapter: how to add one

No gateway is wired yet. `src/providers/payment/index.js` has an empty registry,
so `getPaymentProvider()` throws `ITP_PAYMENT_NOT_CONFIGURED` and the checkout
refuses to create a payment. That is the intended Phase 1 state: a stub that
"works" would be a stub that can lose someone's money.

## Files to create

```
src/providers/payment/<gateway-code>/
  client.js   HTTP plumbing: auth headers, timeouts, error classification
  map.js      THE ONLY file containing this gateway's field names and status strings
  index.js    assembles the adapter and exports it
```

## What the adapter must implement

See `src/providers/payment/contract.js` for the full shapes. In short:

| Method | Responsibility |
| --- | --- |
| `isConfigured()` | true only when every required credential is present |
| `configurationGaps()` | returns env var **names** that are missing, never values |
| `createPayment()` | create the payment, return instructions (VA number / QR / code) |
| `getPaymentStatus()` | poll by our reference; the reconciliation primitive |
| `verifyWebhook()` | verify signature FIRST, then parse; return a normalised webhook |
| `cancelPayment()` | release/cancel an unpaid payment |
| `refundPayment()` | refund a paid one |

## Non-negotiable rules

1. **Verify before parse.** `verifyWebhook()` receives the raw body string. Read
   the signature header, verify against the raw bytes, and only then `JSON.parse`.
   Parsing first and verifying second is a spoofing hole.
2. **Timing-safe comparison** for signatures (`crypto.timingSafeEqual`), never `===`.
3. **A timeout is UNKNOWN, not failed.** Return `PAYMENT_ERROR.TIMEOUT` with
   `unknown: true`; the caller reconciles. Never let a timeout mark a payment
   failed: the customer may have paid.
4. **Always return a non-empty `eventId`** from `verifyWebhook()`. It is what the
   `WebhookEvent` unique constraint uses to make a replay a no-op. If the gateway
   sends no event id, hash the raw body.
5. **Secrets are read in `client.js` only.** Never log them, never return them,
   never include them in an error message.
6. **Never trust an amount from a webhook** without cross-checking it against our
   own `Payment.amount`. A webhook that says "paid 1000" for a 500.000 order is
   either a bug or an attack; both must be caught server-side.

## Environment variables

```
PAYMENT_PROVIDER=<gateway-code>
PAYMENT_API_KEY=
PAYMENT_SECRET=
PAYMENT_WEBHOOK_SECRET=
```

Add gateway-specific variables to `.env.example` when you add the adapter, and
keep `.env` out of git.

## Enabling methods in the UI

`src/config/payment.js` lists the internal method keys (va_bca, qris, …), each
with `enabled: false`. After the adapter maps a method to the gateway's own code
and the mapping is tested, flip that entry to `enabled: true`. The checkout reads
this list, and it never hardcodes a method.

## Testing checklist for a new adapter

- [ ] createPayment with a valid input returns a reference and instructions
- [ ] createPayment with a rejected amount returns REJECTED (not a throw)
- [ ] a timeout returns `unknown: true` and does NOT mark anything failed
- [ ] verifyWebhook with a tampered body returns INVALID_SIGNATURE
- [ ] verifyWebhook called twice with the same event id is a no-op the second time
- [ ] a webhook amount that disagrees with our stored amount is rejected and logged
