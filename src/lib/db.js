// ============================================================================
// Prisma client singleton.
//
// Prisma 7 emits a TypeScript client (`prisma-client` generator) but it is
// compiled by the bundler — the emitted files are imported extensionless so
// both Next's bundler and Vitest resolve them.
//
// The driver adapter (@prisma/adapter-pg) is used instead of the Rust engine:
// it works with Supabase's transaction pooler and keeps the connection count
// under control in serverless deployments.
// ============================================================================
import { loadEnv } from "./env.js";

loadEnv();

import { PrismaClient } from "../../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis;

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and fill it in."
    );
  }

  const adapter = new PrismaPg({
    connectionString,
    // Supabase's pooler terminates idle connections; keep the pool small and
    // let the pooler do the heavy multiplexing.
    max: Number(process.env.PG_POOL_MAX || 10),
  });

  return new PrismaClient({
    adapter,
    // Never log query parameters or connection strings — Prisma's query log
    // includes raw values, which would leak player ids and emails into stdout.
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createClient();

// In dev, hot reload would otherwise open a new pool on every edit.
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
