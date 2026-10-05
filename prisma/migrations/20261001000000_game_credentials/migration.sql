-- eFootball + stored game logins.
--
-- Adds the encrypted-credential store that games with `needsGameLogin` use at
-- checkout (eFootball on Melostore asks for the customer's own game Login +
-- Password), the `needsGameLogin` flag itself, and the order-side reference to
-- the stored login used for a purchase.
--
-- SECURITY: `secretCipher`/`secretIv` are AES-256-GCM ciphertext + IV. The key
-- is derived in the app from AUTH_SECRET; no key material lives in the database.

-- ── needsGameLogin ──────────────────────────────────────────────────────────
ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "needsGameLogin" BOOLEAN NOT NULL DEFAULT false;

-- ── Encrypted game logins ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "game_credentials" (
  "id"           TEXT NOT NULL,
  "userId"       TEXT NOT NULL,
  "gameId"       TEXT NOT NULL,
  "login"        TEXT NOT NULL,
  "secretCipher" TEXT NOT NULL,
  "secretIv"     TEXT NOT NULL,
  "lastUsedAt"   TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "game_credentials_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "game_credentials_userId_gameId_login_key"
  ON "game_credentials" ("userId", "gameId", "login");

CREATE INDEX IF NOT EXISTS "game_credentials_userId_gameId_idx"
  ON "game_credentials" ("userId", "gameId");

-- A stored login belongs to one user and one game.
--
-- userId cascades: deleting a user removes their stored logins.
--
-- gameId does NOT cascade — ON DELETE RESTRICT, mirroring schema.prisma where
-- GameCredential.game is declared with no explicit onDelete (NO ACTION). A game
-- that customers have stored logins against must not be deletable: those
-- ciphertext rows are the customer's only copy of their password, and deleting
-- the game would silently destroy them. Deleting the game is refused instead,
-- so the operator must remove the credentials first and knows exactly what is
-- going away. This comment also pins the rule against the neighbouring
-- 20261002060000 migration, which uses NO ACTION for the same reason.
ALTER TABLE "game_credentials"
  DROP CONSTRAINT IF EXISTS "game_credentials_userId_fkey";
ALTER TABLE "game_credentials"
  ADD CONSTRAINT "game_credentials_userId_fkey" FOREIGN KEY ("userId")
  REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "game_credentials"
  DROP CONSTRAINT IF EXISTS "game_credentials_gameId_fkey";
ALTER TABLE "game_credentials"
  ADD CONSTRAINT "game_credentials_gameId_fkey" FOREIGN KEY ("gameId")
  REFERENCES "games" ( "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Order → stored login ────────────────────────────────────────────────────
-- nullable: only orders on a `needsGameLogin` game carry one.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "credentialId" TEXT;

-- The FK that enforces this reference is added by
-- 20261002060000_order_credential_relation, with ON DELETE NO ACTION so an
-- order still outlives a credential the customer later deletes (a delete that
-- would orphan history is refused instead). See the Order.credentialId doc
-- comment in the schema.
