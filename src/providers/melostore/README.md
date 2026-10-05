# Melostore H2H adapter

Implemented against the official documentation at
**https://h2h.melostore.id/id/docs** (Indonesian). Every endpoint path, header
name, parameter name and status string in this directory is taken from that
documentation, and none is guessed.

## Status

| File | Status |
| --- | --- |
| `signature.js` | **Complete.** Outbound auth = two headers. Inbound webhook = HMAC-SHA256 over the raw body. |
| `client.js` | **Complete.** Timeouts, retry policy, error classification, credential redaction. |
| `mapper.js` | **Complete.** Field/status/response mapping, all from documented payloads. |
| `products.js` | **Complete.** Pricelist with cursor pagination. |
| `validation.js` | **Complete.** `check-nickname`, including the 422 "not found" distinction. |
| `order.js` | **Complete.** Create transaction + status check + smart order. |
| `balance.js` | **Complete.** `profile/balance`. |
| `callback.js` | **Complete.** Verify-then-parse webhook handling. |
| `index.js` | The assembled adapter satisfying `../contract.js`. |

## Authentication (documented)

Outbound: two headers on every request.

| Header | Env var |
| --- | --- |
| `X-API-Key` | `MELOSTORE_API_KEY` |
| `X-Secret-Key` | `MELOSTORE_SECRET` |

`Content-Type: application/json` is required on POST.

There is **no username** in the documented scheme, so `MELOSTORE_USERNAME` is
deliberately unused.

Inbound: the webhook is signed, and it is a *separate secret*.

> "Gunakan header signature `X-H2H-Signature` ... Tanda tangan diperoleh dari
> hash HMAC SHA256 dari payload JSON mentah menggunakan `webhook_secret` akun
> Anda."

That means `MELOSTORE_WEBHOOK_SECRET` (`webhook_secret` in the partner
dashboard). Without it every callback is refused and orders settle only through
reconciliation polling. See `configurationGaps()` in `client.js`.

## Endpoints

| Operation | Method | Path |
| --- | --- | --- |
| Profile | GET | `/api/v1/h2h/profile` |
| Balance | GET | `/api/v1/h2h/profile/balance` |
| Categories | GET | `/api/v1/h2h/pricelists/categories` |
| Pricelist | GET | `/api/v1/h2h/pricelists` |
| Pricelist by category | GET | `/api/v1/h2h/pricelists/{category_slug}` |
| Smart pricelist | GET | `/api/v1/h2h/smart-pricelists` |
| Create transaction | POST | `/api/v1/h2h/transaction` |
| Smart transaction | POST | `/api/v1/h2h/smart-transaction` |
| Transaction status | GET | `/api/v1/h2h/transaction/{id}` |
| Check nickname | POST | `/api/v1/h2h/check-nickname` |

## Decisions worth knowing

### `buyer_trx_id` makes retries safe

The docs state the field exists "untuk mencegah pemesanan ganda", and for smart
orders: "Request duplikat dengan `buyer_trx_id` yang sama mengembalikan transaksi
sebelumnya dengan HTTP 200 tanpa membuat order baru."

So `PROVIDER_SUPPORTS_CLIENT_REFERENCE = true` in `order.js`. A transport retry
with the same idempotency key cannot buy twice. A **timeout is still never
retried**. The correct resolution for an ambiguous outcome is reconciliation by
reference, not a resend.

### An unknown account is a 422, not a flag

Documented: a missing player id returns HTTP 422 with
`error.category: "not_found"` (code 4001). `validation.js` turns exactly that
into `{ valid: false }`, while a 5xx or timeout still propagates as an outage.
Conflating the two would either make a customer retype a correct id forever or
retry a typo.

### `limit` is always sent

The docs warn that full responses without `limit` stop working on
**28 August 2026**. The adapter always sends `limit` and paginates with the
documented cursor, so it is already correct for the post-deprecation API.

### Status strings map 1:1, everything else is UNKNOWN

`pending | processing | success | failed | refunded` → `PENDING | PROCESSING |
SUCCESS | FAILED | REFUND`. An unrecognised value becomes `UNKNOWN`, which
triggers reconciliation, never a wrong terminal state.

### Field mapping has no per-game field table

The documented transaction target is three slots (`customer_target`,
`customer_target_zone`, `additional_data`) for every game. So
`PRIMARY_TARGET_FIELD` says *which customer input fills the target slot* per
game, and everything else goes into `additional_data` keyed as the game config
names it, matching the documented `inquiry_forms` contract.

### Money is rupiah, and the balance is not cash

`h2h_balance` is IDR (the docs show 15750000.0 ≈ 926.47 USD at 17000). The docs
also describe it as prepaid purchase credit, "Non-Refundable (No-Cashout)". The
admin UI must label it **saldo prabayar**, never a withdrawable balance.

## Not implemented

- **Smart Order (max-bid) end to end.** `createOrder` supports a smart SKU when
  `maxBid` is supplied, but nothing in the app sets one yet: no product is
  configured as smart. Wiring it needs a business decision about how `max_bid` is
  chosen.
- **`mobile-legends/purchase-limit`.** Documented, not needed by the current
  flow. Add it if the UI ever needs to warn about weekly-pass / double-diamond
  eligibility before checkout.
- **Zone code list.** The docs expose a "List Zone Available" table; it is not
  fetched, so zone input is free text validated per game config.

## Testing

```
npm run test:db:reset   # migrate + truncate the TEST database
npm test                # 47 tests, incl. the mocked-fetch sync integration suite
```

`tests/unit/melostore.mapper.test.js` and `tests/unit/melostore.signature.test.js`
assert against payloads copied from the documentation.
`tests/integration/sync.service.test.js` runs the real adapter path with only
`fetch` mocked, so a drift in the documented shape fails the suite.

## Rules that must not be broken

- No provider parameter name may appear outside `src/providers/melostore/`.
- No secret may be read anywhere except `signature.js` / `client.js`.
- A timeout must never be translated into a failure: it is `unknown: true`.
- `parseCallback` must verify the signature BEFORE reading any field from the body.
