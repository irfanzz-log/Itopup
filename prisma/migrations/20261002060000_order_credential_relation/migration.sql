-- Enforces Order.credentialId → game_credentials.

-- WHY NOW: the column was added without a constraint in
-- 20261001000000_game_credentials so an order would outlive a stored login the
-- customer later deleted. That property is kept — the FK is NO ACTION, not
-- CASCADE. Deleting a credential that an order still points at is REFUSED
-- rather than silently rewriting history, and the service layer reports it as a
-- clear error instead of the database raising a raw 23503.

-- GUARD: a leftover id with no matching row (a credential deleted while the FK
-- did not exist) would make CREATE fail. The FK is only added once nothing
-- dangles, so this migration is safe to run on a database that predates it.
DELETE FROM "orders"
WHERE "credentialId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "game_credentials" g WHERE g.id = "orders"."credentialId");

ALTER TABLE "orders"
  DROP CONSTRAINT IF EXISTS "orders_credentialId_fkey";

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_credentialId_fkey" FOREIGN KEY ("credentialId")
  REFERENCES "game_credentials"("id")
  ON DELETE NO ACTION
  ON UPDATE NO ACTION;

-- Dispatch reads orders by credential id when reconciling which stored login a
-- pending order used.
CREATE INDEX IF NOT EXISTS "orders_credentialId_idx"
  ON "orders" ("credentialId");
