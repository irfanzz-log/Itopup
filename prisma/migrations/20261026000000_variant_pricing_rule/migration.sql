-- ============================================================================
-- product_variants.pricingRule: remember WHICH pricing rule wrote a price.
--
-- THE BUG THIS FIXES
--
-- The catalogue sync decides whether it may overwrite a variant's sellingPrice
-- by asking "is this row still derived from the current rule?". It answered
-- that by recomputing the derivation and comparing it to the stored price
-- (sync.service.js:410). That is not a test for "an admin edited this", it is a
-- test for "the rule has not changed since this row was written".
--
-- So the moment an operator changed PRICING_MARKUP_MULTIPLIER, every derived
-- row stopped matching, was misread as a manual override, and the sync skipped
-- all of them. Changing the markup looked like a no-op: sync reports success,
-- zero prices change, no error anywhere. That is exactly the reported symptom.
--
-- With this column the sync compares the rule that WROTE the price against the
-- rule in force now:
--   * pricingRule IS NULL            -> written before this column existed
--   * pricingRule = current rule     -> still derived, reprice from cost
--   * pricingRule <> current rule    -> an admin set it by hand, leave alone
--
-- WHY THE BACKFILL SETS A RULE RATHER THAN LEAVING NULL
--
-- Every existing row was in fact produced by a rule (the seed and the sync both
-- derive), so NULL would be a lie of omission. Backfilling with the CURRENT
-- fingerprint is the honest statement: "this is the rule we believe produced
-- it". The consequence is that the next sync reprices these rows — which is
-- precisely what an operator who changed the multiplier is asking for.
--
-- Idempotent, additive, and safe to re-run: ADD COLUMN IF NOT EXISTS, and the
-- UPDATE only touches rows that still have no rule.
-- ============================================================================

ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "pricingRule" TEXT;

-- Backfill. The value must match pricingRuleFingerprint() in
-- src/config/pricing.js for the CURRENT environment; the exact string does not
-- matter for correctness (any non-null value older than the live rule makes the
-- row eligible for repricing), but matching it means a sync immediately after
-- this migration is a no-op instead of a reprice.
--
-- 'derived:v1' is the format for rows migrated without knowing their original
-- rule: the sync treats an unrecognised fingerprint as "derived by an older
-- rule" and reprices, which is the behaviour an operator wants after changing
-- the multiplier.
UPDATE "product_variants"
   SET "pricingRule" = 'derived:v1'
 WHERE "pricingRule" IS NULL;
