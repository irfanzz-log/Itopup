// ============================================================================
// Prisma client singleton.
//
// Prisma 7 emits a TypeScript client (`prisma-client` generator) but it is
// compiled by the bundler; the emitted files are imported extensionless so
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

  // Supabase's pooler (port 6543, `pgbouncer=true`) runs in TRANSACTION mode:
  // it multiplexes many clients over few server backends and, critically, does
  // NOT support prepared statements. `pg` speaks the extended query protocol by
  // default, which pins each statement to one backend. Under transaction mode
  // that pinning is what surfaces as `ETIMEDOUT` on a warm pool: the pooler has
  // already recycled the backend the statement was bound to, and the driver
  // waits on a socket that will never answer.
  const pgbouncer = /pgbouncer=true/i.test(connectionString);

  const adapter = new PrismaPg({
    connectionString,
    // Supabase's pooler terminates idle connections; keep the pool small and
    // let the pooler do the heavy multiplexing.
    max: Number(process.env.PG_POOL_MAX || 10),
    // Required for transaction-mode pooling: no server-side statement state may
    // outlive the transaction that created it.
    ...(pgbouncer ? { prepare: false } : {}),
    // Recycle a connection well before the pooler's own ~30s idle kill. Without
    // this, the pool hands out a connection the pooler has already closed and
    // the query hangs until the socket times out.
    idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 20_000),
    // Fail fast instead of hanging: a pool that cannot produce a connection in
    // 10s is a pool we want to surface as a clean 503, not a stalled request.
    connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS || 10_000),
    // Keep the TCP socket honest across the pooler's NAT: without keepalive, a
    // half-open connection looks alive to `pg` until a query is issued.
    keepAlive: true,
  });

  return new PrismaClient({
    adapter,
    // Never log query parameters or connection strings: Prisma's query log
    // includes raw values, which would leak player ids and emails into stdout.
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

// A Prisma query can hit "Connection terminated unexpectedly" when the pooler
// recycles a backend mid-flight. Under load (several pages open, each doing an
// order read plus a gateway call) the pool is exhausted and pg kills the oldest
// connection; the request that owned it sees the socket die. Prisma does not
// retry on this; the caller gets a 500 for a failure that would have succeeded
// on the next attempt.
//
// The same is true of pool exhaustion itself: once `max` connections are
// checked out, `pg` waits `connectionTimeoutMillis` for a free one and then
// surfaces "timeout exceeded when trying to connect" (Prisma P2024). That is a
// transient condition by definition (the pool drains a moment later), but the
// original regex only matched the "connection terminated" family, so a pool
// timeout escaped the retry and became a hard 500. Observed in dev: 4 such
// errors in one second on cold start, and a 20.5s request that only survived
// because Next re-entered the handler.
//
// Both pool-timeout phrasings are covered: the driver-level text above and
// Prisma's own P2024 wording, in case the engine wraps it.
const RETRYABLE_CONN =
  /(Connection terminated unexpectedly|Connection terminated due to connection timeout|timeout exceeded when trying to connect|Timed out fetching a new connection from the connection pool|ConnectionError|Can't reach database server)/i;

// The extension is also exported so its retry classification can be tested
// directly: the regex below decides whether a customer sees a page or a 500,
// and a miss is silent (the error falls straight through to the caller).
export const prismaRetryExtension = {
  name: "itopupConnRetry",
  query: {
    $allOperations({ operation, query, args }) {
      return query(args).catch((error) => {
        const message = String(error?.message ?? error);
        if (!RETRYABLE_CONN.test(message)) throw error;
        // Only retry reads: writes are not idempotent, and a retry that lands
        // twice would corrupt a counter or double-insert. Prisma marks reads.
        const isRead = operation === "findUnique" || operation === "findFirst" || operation === "findMany" || operation === "aggregate" || operation === "count";
        if (!isRead) throw error;
        return new Promise((resolve, reject) => {
          setTimeout(() => query(args).then(resolve, reject), 250);
        });
      });
    },
  },
};

let prismaClient = globalForPrisma.prisma ?? createClient();
prismaClient = prismaClient.$extends(prismaRetryExtension);

export const prisma = prismaClient;

// In dev, hot reload would otherwise open a new pool on every edit.
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prismaClient;
