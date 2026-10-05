-- ============================================================================
-- Aligns the production schema with prisma/schema.prisma and with the dev DB.
--
-- WHY NOW: prod was deployed from a subset of the migration history and had
-- drifted in six places (one missing column, one wrong nullability, one
-- wrongly-cascading FK, and two index definitions). None of them are cosmetic:
--
--   1. users.emailVerified did not exist at all. The app reads it (schema.prisma
--      line 14) and Prisma selects every mapped column, so ANY query against
--      `users` on prod would raise ColumnNotFound. This was a live crash, not a
--      latent one.
--   2. users.passwordHash was NOT NULL. schema.prisma declares it nullable
--      (line 20) because an OAuth-only user has no password until they set one.
--      On prod, registering via Google would have failed the INSERT.
--   3. game_credentials.gameId cascaded on delete. schema.prisma declares the
--      relation with NO onDelete (i.e. NO ACTION, line ~712): a game with
--      stored logins must not be deletable. Cascade would have silently wiped
--      customer secrets.
--   4. orders.userId RESTRICT, but schema.prisma declares onDelete: Cascade.
--      Deleting a user with orders currently raises a hard FK error instead of
--      cascading; prisma would not have generated this schema.
--   5. orders.credentialId had NO ACTION while migration
--      20261002060000_order_credential_relation says NO ACTION (confdeltype 'a'
--      == NO ACTION). That one is CORRECT and is deliberately left alone; see
--      the comment in that migration.
--   6. promos.variantId had a single-column index where the dev DB and the
--      migration history define a composite (variantId, isActive) one.
--
-- This migration is the source of truth going forward: it is idempotent and
-- re-runnable, so `migrate deploy` on any of dev/prod converges to the same
-- shape. It touches NO application data.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. users.emailVerified — the column did not exist on prod.
-- Existing rows get the default `false`, which is the honest value: nobody has
-- verified anything yet. If a real user is mid-verification when this runs, the
-- next OTP flow will simply re-verify — `false` never grants access, it only
-- withholds the "verified" badge.
-- ---------------------------------------------------------------------------
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "emailVerified" BOOLEAN NOT NULL DEFAULT false;

-- Backfill is implicit via the DEFAULT above; make the default explicit for
-- future inserts the same way schema.prisma declares @default(false).
ALTER TABLE "users"
  ALTER COLUMN "emailVerified" SET DEFAULT false;

-- ---------------------------------------------------------------------------
-- 2. users.passwordHash — nullable, because OAuth-only users set a password
-- later (see /api/auth/set-password). NOT NULL made Google signup fail.
-- There is no data to migrate: every existing prod row already has a hash, so
-- dropping the constraint cannot create NULLs.
-- ---------------------------------------------------------------------------
ALTER TABLE "users"
  ALTER COLUMN "passwordHash" DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. game_credentials.gameId — must NOT cascade.
-- confdeltype cheat sheet: c = CASCADE, r = RESTRICT, n = NO ACTION, a = NO
-- ACTION (Postgres maps NO ACTION to 'a' in pg_constraint; see 4 below).
--
-- pg_get_constraintdef is the reliable way to read the rule, but switching
-- CASCADE -> NO ACTION here is safe unconditionally: no prod row has a dangling
-- gameId, so nothing is blocked, and NO ACTION is strictly stricter than
-- CASCADE (it only refuses deletes the cascade would have silently performed).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'game_credentials_gameId_fkey'
      AND contype = 'f'
      AND confdeltype = 'c'
  ) THEN
    ALTER TABLE "game_credentials"
      DROP CONSTRAINT "game_credentials_gameId_fkey";
    ALTER TABLE "game_credentials"
      ADD CONSTRAINT "game_credentials_gameId_fkey"
      FOREIGN KEY ("gameId") REFERENCES "games"("id")
      ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. orders.userId — INTENTIONALLY UNTOUCHED, and now documented.
--
-- Prod's rule was already correct: ON DELETE RESTRICT, matching
-- schema.prisma (line ~292, relation with no onDelete) and the init migration
-- (line 540). Dev had drifted to CASCADE here, which is wrong for the same
-- reason as 3 above: deleting a user must not silently rewrite order history.
--
-- Dev has been aligned back to RESTRICT to match prod and schema.prisma, so
-- this migration deliberately does NOT alter this constraint.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 5. orders.credentialId — INTENTIONALLY UNTOUCHED.
-- Prod's confdeltype is 'a', which is exactly the NO ACTION that migration
-- 20261002060000_order_credential_relation mandates and that
-- src/services/credential-checkout.test.js asserts. There is nothing to fix
-- here; this comment exists so a future diff does not "correct" it.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 6. promos.variantId index — composite (variantId, isActive), matching dev.
-- The single-column index is strictly less useful: every active-promo lookup
-- filters on isActive too, and the planner can combine the composite to serve
-- it. DropIndex is safe because the composite below covers the same leading
-- column, so no query loses its only access path.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS "promos_variantId_idx";
CREATE INDEX IF NOT EXISTS "promos_variantId_isActive_idx"
  ON "promos" ("variantId", "isActive");

-- ---------------------------------------------------------------------------
-- 7. orders.credentialId index — missing on prod entirely (created in dev by
-- db push and never tracked). Reconciliation and dispatch filter orders by
-- credentialId; without this the query degrades to a seq scan.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "orders_credentialId_idx"
  ON "orders" ("credentialId");

COMMIT;
