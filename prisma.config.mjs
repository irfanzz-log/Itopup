// ============================================================================
// Prisma 7 CLI configuration.
//
// Migrations and introspection must run over the DIRECT (non-pooled) Supabase
// connection: DDL through a transaction pooler fails. The application itself
// never reads this file — it connects through the driver adapter in
// src/lib/db.js using DATABASE_URL (pooled).
//
// `.js` (ESM, because package.json has no "type" field so .mjs is not needed —
// see the note below) is used instead of `.ts` so the repository contains zero
// TypeScript files.
// ============================================================================
import "dotenv/config";
import { defineConfig } from "prisma/config";

const direct = process.env.DIRECT_URL?.trim();
const pooled = process.env.DATABASE_URL?.trim();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "node prisma/seed.js" },
  // DIRECT_URL wins when present (Supabase: port 5432). Falls back to the
  // pooled URL so a local Postgres with a single connection string still works.
  datasource: { url: direct || pooled },
});
