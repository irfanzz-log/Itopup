// ============================================================================
// Structured logging — one JSON object per line.
//
// Everything logged goes through `log()` so redaction happens in exactly one
// place. The rules are the same as the error layer: a log line must be useful
// to an engineer and harmless if it leaks, because logs end up in third-party
// systems with different access controls than the database.
// ============================================================================
import { randomUUID } from "node:crypto";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL = LEVELS[process.env.LOG_LEVEL] ?? (process.env.NODE_ENV === "production" ? LEVELS.info : LEVELS.debug);

/**
 * Keys whose values must never reach a log sink. Matched case-insensitively
 * against the key name anywhere in the object tree.
 */
const REDACT_KEYS = [
  "password", "passwordhash", "passwd", "token", "tokenhash", "accesstoken",
  "refreshtoken", "authorization", "cookie", "apikey", "api_key", "secret",
  "clientsecret", "signature", "sign", "privatekey", "sessionid", "session",
  "cardnumber", "cvv", "cvc", "pin", "otp", "credential",
];

const REDACTED = "[redacted]";

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Recursively redact secrets and truncate anything that looks like a payload dump. */
export function redact(value, depth = 0) {
  if (depth > 6) return "[depth-limit]";
  if (value === null || value === undefined) return value;
  if (value instanceof Error) {
    return { name: value.name, message: value.message, code: value.code };
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (isPlainObject(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = REDACT_KEYS.includes(k.toLowerCase()) ? REDACTED : redact(v, depth + 1);
    }
    return out;
  }
  if (typeof value === "string" && value.length > 500) return `${value.slice(0, 500)}…[truncated]`;
  return value;
}

function emit(level, event, fields) {
  if (LEVELS[level] < MIN_LEVEL) return;

  const line = {
    ts: new Date().toISOString(),
    level,
    event,
    ...redact(fields || {}),
  };

  const serialised = JSON.stringify(line);
  if (level === "error") console.error(serialised);
  else if (level === "warn") console.warn(serialised);
  else console.log(serialised);
}

/**
 * Create a logger bound to a request id, so every line of one request can be
 * grepped as a unit.
 *
 * @param {{ requestId?: string, orderId?: string, userId?: string }} [ctx]
 */
export function createLogger(ctx = {}) {
  const base = { requestId: ctx.requestId || randomUUID(), ...ctx };

  const bind = (extra) => ({ ...base, ...extra });

  return {
    requestId: base.requestId,
    debug: (event, fields) => emit("debug", event, bind(fields)),
    info: (event, fields) => emit("info", event, bind(fields)),
    warn: (event, fields) => emit("warn", event, bind(fields)),
    error: (event, fields) => emit("error", event, bind(fields)),
    /** Return a child logger carrying extra context (orderId, providerRef…). */
    child: (extra) => createLogger({ ...base, ...extra }),
  };
}

/** Standalone logger for background jobs and scripts that have no request. */
export const logger = createLogger({ component: "app" });
