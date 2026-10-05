-- Add PromoVisibility: PUBLIC vouchers are listed on /promo and claimable,
-- HIDDEN ones are usable only by typing their code at checkout.
--
-- This is a PUBLISHING control, not a security boundary. The checkout validates
-- every voucher code server-side — active window, scope, min spend, quota,
-- ownership — with no regard for visibility, so a hidden voucher is not
-- "secret-protected" and knowing a public one is not an attack surface.
--
-- Idempotent: guards with IF NOT EXISTS, because `prisma migrate deploy`
-- re-runs the whole file on retry.

-- (1) The enum.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t WHERE t.typname = 'PromoVisibility') THEN
    CREATE TYPE "PromoVisibility" AS ENUM ('PUBLIC', 'HIDDEN');
  END IF;
END$$;

-- (2) The column. Default PUBLIC so a voucher created before this column
--     existed keeps appearing exactly where it already appeared: no existing
--     voucher silently disappears from /promo.
ALTER TABLE "promos"
  ADD COLUMN IF NOT EXISTS "visibility" "PromoVisibility" NOT NULL DEFAULT 'PUBLIC';

-- (3) Backfill is a no-op by construction (the DEFAULT above populated it for
--     every pre-existing row during the ADD COLUMN), but leaving an explicit
--     statement makes the intent auditable and covers a database that already
--     had the column added without a default in a partial run.
UPDATE "promos" SET "visibility" = 'PUBLIC' WHERE "visibility" IS NULL;

-- (4) The listing filter. /promo and the claimable shelf both resolve to
--     "PUBLIC and live", so this is the index they hit.
CREATE INDEX IF NOT EXISTS "promos_visibility_isActive_idx"
  ON "promos" ("visibility", "isActive");
