-- Fix the structurally broken unique constraint on voucher_claims.
--
-- The old constraint `voucher_claims_userId_promoId_status_key` included the
-- claim's STATUS in the key. Status is state, not identity: redeeming a claim
-- flips it ACTIVE → REDEEMED, and once that has happened the customer can never
-- claim that promo again, because re-redeeming a fresh claim collides with the
-- existing REDEEMED row on the same (userId, promoId, status) triple. The
-- observable failure is a P2002 out of `redeemVoucherClaim`'s updateMany and a
-- raw 500 on POST /api/orders (requestId f9405f6a-638f-4ebc-b268-715ec70df2ea).
--
-- The fix is to enforce exactly one row per (user, promo), with status as a
-- plain column. Re-claiming a promo then revives the existing row.
--
-- Idempotent: every statement guards with IF NOT EXISTS / IF EXISTS, because
-- `prisma migrate deploy` re-runs the whole file on retry and the dev/staging
-- databases may already be partially past this point.

-- (1) Deduplicate before enforcing one-row-per-pair. The broken constraint let
--     a customer who already spent a promo claim it again, leaving a REDEEMED
--     row and a later ACTIVE row for the same (userId, promoId). The ACTIVE one
--     is the redundant artifact — it has never been spent (no redeemedInvoice),
--     and deleting it is what lets the unique index be created. The REDEEMED
--     row is the real history and is kept; the customer simply no longer holds
--     a spendable copy, which is the intended end state for a used voucher.
--
--     Deletes only ACTIVE rows that have a same-pair REDEEMED sibling, so a
--     legit pair of (ACTIVE, VOIDED) is untouched and a lone ACTIVE claim is
--     never deleted.
DELETE FROM voucher_claims c
WHERE c.status = 'ACTIVE'
  AND EXISTS (
    SELECT 1 FROM voucher_claims s
    WHERE s."userId" = c."userId"
      AND s."promoId"  = c."promoId"
      AND s.status     = 'REDEEMED'
  );

-- (2) One row per user+promo. NULLs are never present (both columns are
--     required by the schema), so a plain UNIQUE INDEX is safe.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'voucher_claims_userId_promoId_key'
       AND tablename = 'voucher_claims'
  ) THEN
    CREATE UNIQUE INDEX "voucher_claims_userId_promoId_key"
      ON "voucher_claims" ("userId", "promoId");
  END IF;
END $$;

-- (2) The broken constraint goes away. Any (userId, promoId, status) triple is
--     now allowed to repeat across the row's lifetime, which is exactly the
--     point — the row changes status, it does not get a new identity.
DROP INDEX IF EXISTS "voucher_claims_userId_promoId_status_key";
