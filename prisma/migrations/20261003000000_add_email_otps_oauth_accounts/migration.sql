-- ============================================================================
-- email_otps + oauth_accounts.
--
-- These tables were created in the DEV database with `prisma db push`, not with
-- a migration, so `prisma migrate deploy` never carried them to PROD. The
-- registration-OTP flow and Google OAuth both depend on them, so prod is
-- currently missing the storage for two shipped features.
--
-- The statements are idempotent (IF NOT EXISTS / DO $$ EXCEPTION) because
-- `migrate deploy` re-runs a migration that was marked rolled back, and because
-- dev already has the tables.
-- ============================================================================

-- EmailOtpPurpose enum. Only REGISTER today; adding a variant is a data change,
-- not a schema rebuild.
DO $$ BEGIN
  CREATE TYPE "EmailOtpPurpose" AS ENUM ('REGISTER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- One row per issued one-time code. `codeHash` is the only secret-ish value and
-- it is a hash, so the code itself is never stored or recoverable.
CREATE TABLE IF NOT EXISTS "email_otps" (
  "id"        TEXT NOT NULL,
  "subject"   TEXT NOT NULL,
  "purpose"   "EmailOtpPurpose" NOT NULL,
  "codeHash"  TEXT NOT NULL,
  "attempts"  INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "ip"        TEXT,
  "payload"   JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "email_otps_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "email_otps_subject_purpose_key"
  ON "email_otps" ("subject", "purpose");
CREATE INDEX IF NOT EXISTS "email_otps_expiresAt_idx"
  ON "email_otps" ("expiresAt");

-- A Google-issued identity linked to a local user. `subject` is Google's own
-- stable account id; the (provider, subject) pair is what makes an OAuth login
-- resolve to exactly one row. `email` is denormalised for lookups and admin
-- display, and can legitimately drift from the user's current Google email.
CREATE TABLE IF NOT EXISTS "oauth_accounts" (
  "id"          TEXT NOT NULL,
  "userId"      TEXT NOT NULL,
  "provider"    TEXT NOT NULL DEFAULT 'google',
  "subject"     TEXT NOT NULL,
  "email"       TEXT NOT NULL,
  "linkedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastLoginAt" TIMESTAMP(3),

  CONSTRAINT "oauth_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "oauth_accounts_provider_subject_key"
  ON "oauth_accounts" ("provider", "subject");
CREATE UNIQUE INDEX IF NOT EXISTS "oauth_accounts_provider_email_key"
  ON "oauth_accounts" ("provider", "email");
CREATE INDEX IF NOT EXISTS "oauth_accounts_userId_idx"
  ON "oauth_accounts" ("userId");

-- onDelete: CASCADE matches the Prisma schema: deleting a user drops their
-- linked OAuth identities. There is no "keep the Google identity of a deleted
-- user" use case, and a dangling row would make the email-lookup unique index
-- permanently occupy an address.
ALTER TABLE "oauth_accounts"
  DROP CONSTRAINT IF EXISTS "oauth_accounts_userId_fkey";

ALTER TABLE "oauth_accounts"
  ADD CONSTRAINT "oauth_accounts_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
