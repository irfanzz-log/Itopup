// ============================================================================
// Traffic writer: records one event, computes the verdict, never throws.
//
// THE HARD RULE, same as the audit writer: recording traffic must NEVER break
// the request it is recording. A statistics table that can 500 the checkout is
// worse than no statistics table. So every failure here is swallowed and logged
// once, and the caller's response is already on its way.
//
// TWO SOURCES, ONE TABLE:
//   * server-side, from route handlers and the error path (status, code, IP),
//   * client-side, from the page-view beacon (no status; the browser knows it
//     rendered).
// Both funnel through `recordTraffic()`, so the verdict rules are applied in
// exactly one place.
//
// WINDOW COUNTERS: brute-force and flood rules need "how many like this from
// this IP recently". Asking the database on every request would double the
// query load of the whole app, so the counts come from a bounded in-process
// map. That is deliberately approximate: it is a per-instance hint, and a
// serverless deploy may undercount across instances. The rule is a signal, not
// a lockout — the actual lockout is the rate limiter, which is authoritative.
// ============================================================================
import { prisma } from "../db.js";
import { createLogger } from "../logger.js";
import { classify, KIND, SEVERITY, THRESHOLDS, VERDICT } from "./classify.js";

const log = createLogger({ component: "traffic" });

/** Rolling counters keyed by IP. Bounded so a spoofed-IP flood cannot grow it. */
const MAX_SUBJECTS = 20_000;
const windows = new Map(); // ip -> { start, requests, authFailures, notFound }

function windowFor(ip, now) {
  if (!ip) return { requests: 0, authFailures: 0, notFound: 0 };
  let w = windows.get(ip);
  if (!w || now - w.start > THRESHOLDS.windowMs) {
    w = { start: now, requests: 0, authFailures: 0, notFound: 0 };
    if (windows.size >= MAX_SUBJECTS) {
      // Drop the oldest half rather than grow without bound.
      const entries = [...windows.entries()].sort((a, b) => a[1].start - b[1].start);
      for (let i = 0; i < Math.floor(entries.length / 2); i++) windows.delete(entries[i][0]);
    }
    windows.set(ip, w);
  }
  return w;
}

/** Strip the query string: a token or an email in a URL must not be stored. */
export function safePath(raw) {
  if (!raw) return "/";
  let path = String(raw);
  const cut = path.search(/[?#]/);
  if (cut !== -1) path = path.slice(0, cut);
  // Decode once so the injection patterns see what the server saw, then strip
  // control characters and cap the length.
  try {
    path = decodeURIComponent(path);
  } catch {
    /* malformed percent-encoding: keep the raw form, the rules still apply */
  }
  path = path.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 512);
  return path || "/";
}

/** Referrer hostname only. The full URL can carry a query with user data. */
export function referrerHost(referrer) {
  if (!referrer) return null;
  try {
    return new URL(String(referrer)).hostname.slice(0, 255) || null;
  } catch {
    return null;
  }
}

/**
 * Record one traffic event.
 *
 * @param {object} input
 * @param {string} input.kind             KIND.*
 * @param {string} [input.path]
 * @param {string} [input.method]
 * @param {number|null} [input.status]
 * @param {string|null} [input.code]
 * @param {string|null} [input.message]
 * @param {object|null} [input.metadata]
 * @param {string|null} [input.ip]
 * @param {string|null} [input.userAgent]
 * @param {string|null} [input.referrer]
 * @param {string|null} [input.userId]
 * @param {string|null} [input.visitorHash]  SHA-256 of the visitor cookie (visitor.js)
 * @param {string|null} [input.requestId]
 * @param {number|null} [input.durationMs]
 * @param {string|null} [input.severity]  override the ladder (fatal handler)
 * @returns {Promise<object|null>} the created row, or null on any failure
 */
export async function recordTraffic(input = {}) {
  try {
    const now = Date.now();
    const path = safePath(input.path);
    const ip = input.ip ? String(input.ip).slice(0, 64) : null;
    const userAgent = input.userAgent ? String(input.userAgent).slice(0, 255) : null;

    // Counters are updated BEFORE classification so the event that crosses the
    // threshold is the one that gets flagged, not the one after it.
    //
    // ONLY LOGIN FAILURES FEED THE AUTH COUNTER. Counting every 401 would make
    // "a signed-out visitor loaded a member page" escalate to a brute-force
    // verdict, which is exactly the false HOSTILE that teaches an operator to
    // ignore the column. The auth rules are about the credential endpoint.
    const w = windowFor(ip, now);
    w.requests += 1;
    const isLoginAttempt = path.startsWith("/api/auth/login") || path.startsWith("/api/auth/register");
    if (isLoginAttempt && (input.code === "ITP_INVALID_CREDENTIALS" || input.code === "ITP_ACCOUNT_BLOCKED")) {
      w.authFailures += 1;
    }
    if (input.status === 404) w.notFound += 1;

    const verdictInfo = classify({
      kind: input.kind || KIND.API_CALL,
      path,
      status: input.status ?? null,
      code: input.code ?? null,
      userAgent,
      recentAuthFailures: w.authFailures,
      recentRequests: w.requests,
      recentNotFound: w.notFound,
    });

    const row = {
      kind: verdictInfo.kind || input.kind || KIND.API_CALL,
      method: input.method ? String(input.method).slice(0, 10) : null,
      path,
      status: Number.isInteger(input.status) ? input.status : null,
      code: input.code ? String(input.code).slice(0, 64) : null,
      message: input.message ? String(input.message).slice(0, 500) : null,
      metadata: input.metadata ?? undefined,
      ip,
      userAgent,
      referrer: referrerHost(input.referrer),
      // Already hashed by the caller (visitor.js). Stored as the hash only.
      visitorHash: input.visitorHash ? String(input.visitorHash).slice(0, 64) : null,
      userId: input.userId ?? null,
      requestId: input.requestId ? String(input.requestId).slice(0, 64) : null,
      verdict: verdictInfo.verdict,
      verdictReason: verdictInfo.reason,
      verdictRule: verdictInfo.rule,
      // A caller-supplied severity (the fatal path) may only RAISE the floor,
      // never lower a HOSTILE to INFO: an incident is an incident.
      severity: higherSeverity(input.severity, verdictInfo.severity),
      durationMs: Number.isInteger(input.durationMs) ? input.durationMs : null,
      createdAt: new Date(now),
    };

    return await prisma.trafficEvent.create({ data: row });
  } catch (err) {
    // One line, no stack, no payload: this must never become its own incident.
    log.error("traffic.write_failed", { error: err, kind: input?.kind, path: input?.path });
    return null;
  }
}

function higherSeverity(a, b) {
  const rank = { INFO: 10, WARN: 20, ERROR: 30, FATAL: 40 };
  const ra = rank[a] ?? 0;
  const rb = rank[b] ?? 0;
  return ra >= rb ? a || b || SEVERITY.INFO : b;
}

/** Test seam: clear the rolling counters. */
export function __resetTrafficWindows() {
  windows.clear();
}

export { VERDICT, KIND, SEVERITY };
