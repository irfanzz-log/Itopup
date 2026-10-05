-- ============================================================================
-- Promo scope (per kategori/game/product/variant), distribution AUTO|VOUCHER,
-- voucher audience + claim quota, and VoucherClaim.
--
-- Design notes:
--   * scope/target columns are all NULLABLE. scope=ALL means "no target" and
--     leaves them null, so a global promo needs no join row at all.
--   * variant_id is UNIQUE because scope=VARIANT targets exactly one nominal
--     (1:1). The other targets are many promos per category/game/product.
--   * claim_limit is NULL = unlimited. The atomic guard lives in the claim
--     path (a conditional updateWhere), not in this DDL.
--   * Back-relations (Category.promos, Game.promos, Product.promos,
--     User.voucherClaims) are IMPLICIT in Prisma — resolved through the FKs
--     below, no columns on the parent side. Do not add array columns here.
-- ============================================================================

-- Create the new enums.
DO $$ BEGIN
    CREATE TYPE "PromoScope" AS ENUM ('ALL', 'CATEGORY', 'GAME', 'PRODUCT', 'VARIANT');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "PromoDistribution" AS ENUM ('AUTO', 'VOUCHER');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "VoucherAudience" AS ENUM ('ALL_USERS', 'NEW_CUSTOMER', 'LOYAL_CUSTOMER');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "ClaimStatus" AS ENUM ('ACTIVE', 'REDEEMED', 'VOIDED');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Promo: scope + targets.
ALTER TABLE "promos"
    ADD COLUMN IF NOT EXISTS "scope" "PromoScope" NOT NULL DEFAULT 'ALL',
    ADD COLUMN IF NOT EXISTS "categoryId" TEXT,
    ADD COLUMN IF NOT EXISTS "gameId" TEXT,
    ADD COLUMN IF NOT EXISTS "productId" TEXT,
    -- Unique: one promo targets at most one variant (scope=VARIANT).
    ADD COLUMN IF NOT EXISTS "variantId" TEXT;

-- Promo: distribution, audience and claim quota.
ALTER TABLE "promos"
    ADD COLUMN IF NOT EXISTS "distribution" "PromoDistribution" NOT NULL DEFAULT 'VOUCHER',
    ADD COLUMN IF NOT EXISTS "audience" "VoucherAudience" NOT NULL DEFAULT 'ALL_USERS',
    ADD COLUMN IF NOT EXISTS "minCompletedOrders" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "claimLimit" INTEGER,
    ADD COLUMN IF NOT EXISTS "claimCount" INTEGER NOT NULL DEFAULT 0;

-- FKs for the new target columns. Indexes come first so the planner can use
-- them immediately, then the unique constraint materialises the 1:1 on
-- variantId (nullable, so multiple NULLs are still allowed = scope=ALL rows).
CREATE INDEX IF NOT EXISTS "promos_scope_isActive_idx" ON "promos"("scope", "isActive");
CREATE INDEX IF NOT EXISTS "promos_distribution_isActive_idx" ON "promos"("distribution", "isActive");
CREATE INDEX IF NOT EXISTS "promos_categoryId_isActive_idx" ON "promos"("categoryId", "isActive");
CREATE INDEX IF NOT EXISTS "promos_gameId_isActive_idx" ON "promos"("gameId", "isActive");
CREATE INDEX IF NOT EXISTS "promos_productId_isActive_idx" ON "promos"("productId", "isActive");
CREATE INDEX IF NOT EXISTS "promos_variantId_idx" ON "promos"("variantId");

CREATE UNIQUE INDEX IF NOT EXISTS "promos_variantId_key" ON "promos"("variantId");

ALTER TABLE "promos"
    ADD CONSTRAINT "promos_categoryId_fkey"
        FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "promos_gameId_fkey"
        FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "promos_productId_fkey"
        FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "promos_variantId_fkey"
        FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- VoucherClaim: one user's ownership of one claimable voucher.
-- A row here IS the customer's voucher ("Voucher Saya").
-- ============================================================================

CREATE TABLE IF NOT EXISTS "voucher_claims" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "promoId" TEXT NOT NULL,
    "status" "ClaimStatus" NOT NULL DEFAULT 'ACTIVE',
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redeemedAt" TIMESTAMP(3),
    "redeemedInvoice" TEXT,

    CONSTRAINT "voucher_claims_pkey" PRIMARY KEY ("id")
);

-- One ACTIVE claim per (user, promo). Redeemed/voided claims stay, so a
-- re-claim after a refund makes a new ACTIVE row instead of colliding.
CREATE UNIQUE INDEX IF NOT EXISTS "voucher_claims_userId_promoId_status_key"
    ON "voucher_claims"("userId", "promoId", "status");

CREATE INDEX IF NOT EXISTS "voucher_claims_userId_status_idx" ON "voucher_claims"("userId", "status");
CREATE INDEX IF NOT EXISTS "voucher_claims_promoId_status_idx" ON "voucher_claims"("promoId", "status");

ALTER TABLE "voucher_claims"
    ADD CONSTRAINT "voucher_claims_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "voucher_claims_promoId_fkey"
        FOREIGN KEY ("promoId") REFERENCES "promos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
