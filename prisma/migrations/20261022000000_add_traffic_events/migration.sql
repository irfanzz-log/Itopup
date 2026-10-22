-- ============================================================================
-- traffic_events: the traffic / activity trail behind /dev/statistics.
--
-- WHY NOT `prisma migrate dev`: that command refuses to run on this database
-- because of PRE-EXISTING migration drift (two applied migrations were edited
-- afterwards, and 20261001210000_order_credential_relation exists only in the
-- database). `migrate dev` answers that by offering to DROP THE SCHEMA, which
-- is not an acceptable price for adding one table. So this migration is written
-- by hand in the same idempotent style as 20261003000000_add_email_otps, and
-- applied with `prisma migrate deploy`, which never resets.
--
-- Everything is IF NOT EXISTS: the table may already exist locally from an
-- earlier `db push`, and a re-run must be a no-op rather than an error.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "traffic_events" (
  "id"            TEXT NOT NULL,
  "kind"          TEXT NOT NULL,
  "method"        TEXT,
  "path"          TEXT NOT NULL,
  "status"        INTEGER,
  "code"          TEXT,
  "message"       TEXT,
  "metadata"      JSONB,
  "ip"            TEXT,
  "userAgent"     TEXT,
  "referrer"      TEXT,
  "userId"        TEXT,
  "requestId"     TEXT,
  "verdict"       TEXT NOT NULL DEFAULT 'NORMAL',
  "verdictReason" TEXT,
  "verdictRule"   TEXT,
  "severity"      TEXT NOT NULL DEFAULT 'INFO',
  "durationMs"    INTEGER,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "traffic_events_pkey" PRIMARY KEY ("id")
);

-- Indexes match the read patterns the statistics pages actually use:
--   newest-first list, filter by kind, filter by verdict, drill into one IP,
--   the fatal log (severity), and the per-path top table.
CREATE INDEX IF NOT EXISTS "traffic_events_createdAt_idx"
  ON "traffic_events" ("createdAt");
CREATE INDEX IF NOT EXISTS "traffic_events_kind_createdAt_idx"
  ON "traffic_events" ("kind", "createdAt");
CREATE INDEX IF NOT EXISTS "traffic_events_verdict_createdAt_idx"
  ON "traffic_events" ("verdict", "createdAt");
CREATE INDEX IF NOT EXISTS "traffic_events_ip_createdAt_idx"
  ON "traffic_events" ("ip", "createdAt");
CREATE INDEX IF NOT EXISTS "traffic_events_severity_createdAt_idx"
  ON "traffic_events" ("severity", "createdAt");
CREATE INDEX IF NOT EXISTS "traffic_events_path_createdAt_idx"
  ON "traffic_events" ("path", "createdAt");
