// ============================================================================
// Audit log service.
//
// Every security-relevant action goes through here. Two rules:
//   1. The audit writer NEVER throws into the caller's path. An audit failure
//      must not roll back a legitimate business operation. It is logged loudly
//      instead. (Exception: when called inside a transaction with `strict`,
//      where atomicity is the point.)
//   2. Metadata is filtered. A password hash, a token, or an API key must never
//      reach this table, because audit logs are typically exported, shipped to
//      a SIEM, and read by more people than the database is.
// ============================================================================
import { prisma } from "../lib/db.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger({ component: "audit" });

/**
 * Keys that must never be written into `metadata`.
 * Matching is case-insensitive and applies at every depth.
 */
const FORBIDDEN_KEYS = new Set([
  "password", "passwordhash", "newpassword", "currentpassword", "token",
  "tokenhash", "secret", "apikey", "api_key", "authorization", "cookie",
  "signature", "cvv", "cardnumber", "otp", "credential", "sessionid",
]);

const REDACTED = "[redacted]";

/** Deep-filter a metadata object, dropping forbidden keys entirely. */
export function sanitizeMetadata(value, depth = 0) {
  if (depth > 4) return "[depth-limit]";
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 25).map((v) => sanitizeMetadata(v, depth + 1));

  if (typeof value === "object") {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
        out[key] = REDACTED;
        continue;
      }
      out[key] = sanitizeMetadata(val, depth + 1);
    }
    return out;
  }

  if (typeof value === "string" && value.length > 1000) {
    return `${value.slice(0, 1000)}…[truncated]`;
  }
  return value;
}

/**
 * Write one audit row.
 *
 * @param {object} input
 * @param {string} input.action        an AUDIT.* constant
 * @param {{ id?: string, role?: string }|null} [input.actor]
 * @param {string} [input.targetType]  model name, e.g. "User"
 * @param {string} [input.targetId]
 * @param {object} [input.metadata]
 * @param {{ ip?: string|null, userAgent?: string|null }} [input.request]
 * @param {object} [input.tx]          Prisma transaction client, for atomic writes
 * @param {boolean} [input.strict]     when true, a failure throws (use inside a tx)
 */
export async function writeAudit(input) {
  const {
    action,
    actor = null,
    targetType = null,
    targetId = null,
    metadata = null,
    // `request` is optional: a background job or operator script has no
    // inbound HTTP request, and destructuring it as if it always existed makes
    // the whole audit write fail on a null.
    request = {},
    tx = null,
    strict = false,
  } = input;

  const row = {
    action,
    actorId: actor?.id ?? null,
    actorRole: actor?.role ?? null,
    targetType,
    targetId,
    metadata: metadata ? sanitizeMetadata(metadata) : undefined,
    // IP is stored for security forensics only. It is a personal identifier, so
    // it is never surfaced in the member-facing UI.
    ip: request?.ip ? String(request.ip).slice(0, 64) : null,
    userAgent: request?.userAgent ? String(request.userAgent).slice(0, 255) : null,
  };

  const client = tx ?? prisma;

  try {
    return await client.auditLog.create({ data: row });
  } catch (err) {
    if (strict) throw err;
    log.error("audit.write_failed", { action, targetType, targetId, error: err });
    return null;
  }
}

/**
 * Read the audit trail, newest first.
 * @param {{ page?: number, limit?: number, action?: string, actorId?: string,
 *           targetType?: string, targetId?: string }} [query]
 */
export async function listAuditLogs(query = {}) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 30));

  const where = {};
  if (query.action) where.action = query.action;
  if (query.actorId) where.actorId = query.actorId;
  if (query.targetType) where.targetType = query.targetType;
  if (query.targetId) where.targetId = query.targetId;

  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        action: true,
        actorId: true,
        actorRole: true,
        targetType: true,
        targetId: true,
        metadata: true,
        ip: true,
        createdAt: true,
        actor: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.auditLog.count({ where }),
  ]);

  return {
    items,
    pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
  };
}
