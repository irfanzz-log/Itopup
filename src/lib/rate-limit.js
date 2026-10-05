// ============================================================================
// Rate limiting.
//
// Two backends behind one interface:
//   * in-memory (default): correct for a single instance; explicitly NOT
//     multi-instance safe, which is why the admin settings page reports which
//     backend is active.
//   * Upstash-compatible REST (`RATE_LIMIT_URL` + `RATE_LIMIT_TOKEN`): atomic
//     INCR + PEXPIRE across instances.
//
// Failure policy is per preset, not global. If the external store is
// unreachable, auth-critical buckets FAIL CLOSED (deny): an outage must not
// silently disable brute-force protection, while ordinary buckets fail open so
// a limiter outage cannot take down the whole site.
// ============================================================================
import { AppError } from "./errors.js";

const WINDOW_MS = 60_000;

function intFromEnv(name, fallback) {
  const n = parseInt(process.env[name] || "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const presets = {
  // Per account+IP: stops brute-forcing one account. Fails closed.
  login: { limit: intFromEnv("RL_LOGIN", 8), windowMs: WINDOW_MS, failClosed: true },
  // Per IP only, deliberately looser: a shared NAT must not lock out everyone
  // behind it, while credential spraying stays capped. Fails closed.
  loginIp: { limit: intFromEnv("RL_LOGIN_IP", 40), windowMs: WINDOW_MS, failClosed: true },
  register: { limit: intFromEnv("RL_REGISTER", 5), windowMs: WINDOW_MS, failClosed: true },
  // OTP verification is the guess surface for a 6-digit code, so this is the
  // tightest human-facing limit. Fails closed: an unverifiable burst is better
  // than a brute-forced account.
  otp: { limit: intFromEnv("RL_OTP", 10), windowMs: WINDOW_MS, failClosed: true },
  // Account validation costs a provider call, so it is the most attractive
  // endpoint to abuse. Two buckets: per session and per IP.
  validate: { limit: intFromEnv("RL_VALIDATE", 20), windowMs: WINDOW_MS, failClosed: false },
  validateIp: { limit: intFromEnv("RL_VALIDATE_IP", 120), windowMs: WINDOW_MS, failClosed: false },
  order: { limit: intFromEnv("RL_ORDER", 10), windowMs: WINDOW_MS, failClosed: true },
  payment: { limit: intFromEnv("RL_PAYMENT", 20), windowMs: WINDOW_MS, failClosed: false },
  // Webhooks are authenticated by signature, so the limit exists only to blunt
  // flooding. Generous on purpose: providers retry, and dropping a retry loses
  // money. Fails open.
  webhook: { limit: intFromEnv("RL_WEBHOOK", 300), windowMs: WINDOW_MS, failClosed: false },
  admin: { limit: intFromEnv("RL_ADMIN", 120), windowMs: WINDOW_MS, failClosed: false },
  def: { limit: intFromEnv("RL_DEFAULT", 60), windowMs: WINDOW_MS, failClosed: false },
};

// ── In-memory backend ───────────────────────────────────────────────────────
// Bounded map: an attacker generating unique keys must not grow it without
// limit. Sweeping on write keeps memory flat without a timer.
const MAX_BUCKETS = 50_000;
const buckets = new Map();
let lastSweep = 0;

function sweep(now) {
  if (now - lastSweep < 10_000 && buckets.size < MAX_BUCKETS) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (now > bucket.resetAt) buckets.delete(key);
  }
  if (buckets.size >= MAX_BUCKETS) {
    // Still over budget after sweeping expired entries: drop the oldest half.
    const entries = [...buckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
    for (let i = 0; i < Math.floor(entries.length / 2); i++) buckets.delete(entries[i][0]);
  }
}

function memoryCheck(key, { limit, windowMs }) {
  const now = Date.now();
  sweep(now);

  let bucket = buckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;

  if (bucket.count > limit) {
    return { allowed: false, retryAfterMs: bucket.resetAt - now, remaining: 0 };
  }
  return { allowed: true, remaining: limit - bucket.count, retryAfterMs: 0 };
}

// ── External (Upstash-compatible REST) backend ──────────────────────────────
// One HTTP round trip per check: INCR the counter, set the TTL only if absent,
// read the remaining TTL: all in a single pipeline so the three commands
// cannot interleave with another instance's.
async function remoteCheck(key, { limit, windowMs }) {
  const url = process.env.RATE_LIMIT_URL;
  const token = process.env.RATE_LIMIT_TOKEN;

  const res = await fetch(`${url.replace(/\/$/, "")}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([
      ["INCR", key],
      ["PEXPIRE", key, windowMs, "NX"],
      ["PTTL", key],
    ]),
    // A hung limiter must not hang the request.
    signal: AbortSignal.timeout(2000),
  });

  if (!res.ok) throw new Error(`rate-limit store responded ${res.status}`);

  const payload = await res.json();
  const count = Number(payload?.[0]?.result ?? 0);
  const ttl = Number(payload?.[2]?.result ?? windowMs);

  if (count > limit) {
    return { allowed: false, retryAfterMs: ttl > 0 ? ttl : windowMs, remaining: 0 };
  }
  return { allowed: true, remaining: Math.max(0, limit - count), retryAfterMs: 0 };
}

export function rateLimitBackend() {
  return process.env.RATE_LIMIT_URL && process.env.RATE_LIMIT_TOKEN
    ? "remote"
    : "memory";
}

/**
 * Consume one token from a bucket.
 * @returns {Promise<{ allowed: boolean, remaining?: number, retryAfterMs?: number }>}
 */
export async function check(key, preset) {
  const name = preset?.limit ? preset : presets.def;

  if (rateLimitBackend() === "remote") {
    try {
      return await remoteCheck(key, name);
    } catch (err) {
      console.error(
        JSON.stringify({ ts: new Date().toISOString(), level: "error", event: "ratelimit.store_unreachable", key, error: String(err?.message || err), failClosed: Boolean(name.failClosed) })
      );
      if (name.failClosed) {
        return { allowed: false, retryAfterMs: 5000, remaining: 0 };
      }
      return { allowed: true, degraded: true };
    }
  }

  return memoryCheck(key, name);
}

/**
 * Run several buckets and stop at the first exhausted one.
 * @param {Array<[string, object]>} entries
 */
export async function checkAll(entries) {
  for (const [key, preset] of entries) {
    const result = await check(key, preset);
    if (!result.allowed) return result;
  }
  return { allowed: true };
}

/** Throw the standard 429 so route handlers stay uniform. */
export async function enforce(entries) {
  const result = await checkAll(entries);
  if (!result.allowed) {
    const err = new AppError("ITP_RATE_LIMITED");
    err.meta = { retryAfterMs: result.retryAfterMs };
    err.retryAfterMs = result.retryAfterMs;
    throw err;
  }
  return result;
}

/**
 * Best-effort client address.
 *
 * `x-forwarded-for` is trivially spoofable when the app is NOT behind a proxy
 * that overwrites it, so it is only trusted when TRUST_PROXY is enabled. Any
 * real deployment (Vercel, nginx, Cloudflare) sits behind such a proxy.
 *
 * When the address cannot be trusted this returns null and callers fall back to
 * per-account / per-session keys. That is a deliberate trade-off: keying every
 * untrusted request on a shared "unknown" bucket would let one client exhaust
 * the limit for everybody.
 */
export function clientIp(req) {
  const trustProxy = (process.env.TRUST_PROXY ?? "true") !== "false";
  if (!trustProxy) return null;

  const header = process.env.TRUSTED_IP_HEADER || "x-forwarded-for";
  const raw = req?.headers?.get?.(header);
  if (!raw) return null;

  const first = raw.split(",")[0].trim();
  return first || null;
}

/** Stable rate-limit subject for a request: the user id when known, else the IP. */
export function subject({ userId, ip }) {
  if (userId) return `u:${userId}`;
  if (ip) return `ip:${ip}`;
  return "anon";
}

export function retryAfterSeconds(result) {
  return Math.max(1, Math.ceil((result?.retryAfterMs || 1000) / 1000));
}

/** Test seam: wipe the in-memory buckets. */
export function __resetBuckets() {
  buckets.clear();
  lastSweep = 0;
}
