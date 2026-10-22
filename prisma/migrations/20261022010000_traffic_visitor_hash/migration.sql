-- ============================================================================
-- traffic_events.visitorHash: identity for the self-built view engine.
--
-- WHY THIS COLUMN EXISTS
--
-- Counting DISTINCT ip as "unique visitors" is wrong in both directions: an
-- office behind one NAT is one visitor no matter how many people browse, and a
-- phone switching between Wi-Fi and mobile data is two. The app therefore issues
-- its own first-party visitor id (cookie `itp_vid`) and stores only its SHA-256
-- here. Unique visitors = COUNT(DISTINCT visitorHash).
--
-- The raw id never reaches the database, and the hash cannot be reversed into
-- the cookie value without the original, so this column is not a tracking
-- identifier that can be joined across sites — it is scoped to this origin and
-- useless outside it.
--
-- Nullable on purpose: rows written before this migration, and any client that
-- blocks cookies, have no visitorHash. Readers fall back to `ip` for those
-- (COALESCE), which is why the fallback stays honest instead of counting every
-- cookieless request as one visitor.
--
-- Idempotent like the table migration: `db push` may have created it already,
-- and a re-run must be a no-op.
-- ============================================================================

ALTER TABLE "traffic_events"
  ADD COLUMN IF NOT EXISTS "visitorHash" TEXT;

CREATE INDEX IF NOT EXISTS "traffic_events_visitorHash_createdAt_idx"
  ON "traffic_events" ("visitorHash", "createdAt");
