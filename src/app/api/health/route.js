// ============================================================================
// GET /api/health — liveness + readiness for the platform and for a human.
//
// WHY THIS EXISTS
//
// The app had no health endpoint at all: a deploy platform (or an uptime
// monitor, or an on-call engineer) could only discover the app was broken by
// loading the homepage and reading it. That is not a signal a machine can act
// on, and it cannot tell "the process is up" from "the database is gone".
//
// WHAT IT CHECKS
//
//   * process alive        → answering at all is the liveness signal.
//   * database reachable   → a real `SELECT 1` through the same Prisma client
//                            the app uses, not a TCP probe. A TCP socket that
//                            accepts connections while the pooler rejects
//                            queries is exactly the failure this must catch.
//   * config present       → only the variables the app cannot run without.
//
// STATUS CODES, and why they are not all 200
//
//   200  healthy
//   503  degraded — the process answers but cannot serve traffic (DB down,
//        required config missing). A load balancer must take this instance out.
//
// WHAT IT MUST NEVER DO
//
//   * Return a secret, a connection string, a host, or a raw driver error.
//   * Expose WHICH optional integrations are configured to an anonymous caller:
//     that is a map of what to attack. The detailed report is returned only when
//     the caller presents INTERNAL_KEY, and even then it is the same
//     configured-ness list /dev/settings shows (see envReport), never a value.
//   * Be cached, by us or by an intermediary.
//   * Take long. A health check that hangs is indistinguishable from a dead
//     instance, so the DB probe is bounded and a timeout is a failure.
// ============================================================================
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

import { prisma } from "@/lib/db.js";
import { createLogger } from "@/lib/logger.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** How long the DB probe may take before it counts as a failure. */
const DB_TIMEOUT_MS = 5_000;

/** The only variables whose ABSENCE stops the app from serving traffic. */
const REQUIRED_CONFIG = ["DATABASE_URL", "AUTH_SECRET"];

const log = createLogger({ component: "health" });

function safeEqual(a, b) {
  const left = Buffer.from(String(a), "utf8");
  const right = Buffer.from(String(b), "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Run `SELECT 1` through the app's own Prisma client, bounded in time. */
async function checkDatabase() {
  const startedAt = Date.now();
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("db probe timed out")), DB_TIMEOUT_MS)
      ),
    ]);
    return { ok: true, latencyMs: Date.now() - startedAt };
  } catch (err) {
    // The reason is logged, never returned: a driver message names the host,
    // the port, and sometimes the user.
    log.error("health.db_unreachable", {
      latencyMs: Date.now() - startedAt,
      message: String(err?.message ?? err).slice(0, 200),
    });
    return { ok: false, latencyMs: Date.now() - startedAt };
  }
}

/** Names only. A boolean per variable, never a value. */
function configStatus() {
  const missing = REQUIRED_CONFIG.filter((name) => !process.env[name]);
  return { ok: missing.length === 0, missing };
}

export async function GET(req) {
  const [db, config] = await Promise.all([checkDatabase(), Promise.resolve(configStatus())]);

  const healthy = db.ok && config.ok;

  const body = {
    status: healthy ? "ok" : "degraded",
    // Cheap, non-identifying, and the first thing anyone asks in an incident.
    uptimeSeconds: Math.floor(process.uptime()),
    checks: {
      // "process" is implicitly true: this response exists.
      database: { ok: db.ok, latencyMs: db.latencyMs },
      config: { ok: config.ok, missing: config.missing },
    },
    at: new Date().toISOString(),
  };

  // ── Detailed, authenticated view ─────────────────────────────────────────
  // Only for a caller holding INTERNAL_KEY (the same shared secret the cron
  // routes and the proxy's scan bridge use). An unset key denies the detail,
  // never allows it.
  const expected = process.env.INTERNAL_KEY;
  const supplied = req.headers.get("x-internal-key");
  if (expected && supplied && safeEqual(expected, supplied)) {
    const { envReport } = await import("@/lib/env.server.js");
    // configured-ness only — see envReport's contract.
    body.integrations = envReport();
  }

  if (!healthy) {
    log.warn("health.degraded", {
      db: db.ok,
      config: config.ok,
      missing: config.missing,
    });
  }

  return NextResponse.json(body, {
    status: healthy ? 200 : 503,
    headers: {
      // A cached health check reports the past. Never.
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

/**
 * HEAD is what several load balancers and uptime monitors actually send.
 * Answering it with the same status keeps a monitor from reading 405 as
 * "healthy but weird" (or worse, as an outage).
 */
export async function HEAD(req) {
  const res = await GET(req);
  return new NextResponse(null, { status: res.status, headers: res.headers });
}
