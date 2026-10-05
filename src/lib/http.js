// ============================================================================
// HTTP response envelope.
//
// Every API route returns either
//   { success: true,  data: <payload>, requestId }
//   { success: false, error: { code, message, details? }, requestId }
//
// `requestId` is echoed so a customer can quote it and support can find the
// exact log line, without the response ever carrying internals.
// ============================================================================
import { NextResponse } from "next/server";
import { AppError, ERROR_STATUS } from "./errors.js";
import { createLogger } from "./logger.js";

export function requestId(req) {
  return (
    req?.headers?.get?.("x-request-id") ||
    globalThis.crypto?.randomUUID?.() ||
    `req_${Date.now().toString(36)}`
  );
}

export function ok(data, { status = 200, req, headers } = {}) {
  const res = NextResponse.json(
    { success: true, data, requestId: requestId(req) },
    { status }
  );
  if (headers) for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
  return res;
}

export function fail(code, message, { status, details, req } = {}) {
  const resolved = ERROR_STATUS[code] ? code : "ITP_INTERNAL_ERROR";
  return NextResponse.json(
    {
      success: false,
      error: {
        code: resolved,
        message: message || "Terjadi kesalahan. Silakan coba lagi.",
        ...(details ? { details } : {}),
      },
      requestId: requestId(req),
    },
    { status: status ?? ERROR_STATUS[resolved] ?? 400 }
  );
}

/**
 * Convert any thrown value into a safe HTTP response.
 *
 * A non-AppError (a raw Prisma error, a TypeError from a bug) is logged in full
 * server-side and returned to the client as a generic 500; leaking a driver
 * message would expose table and column names.
 */
export function toFail(err, { req, logger: parentLogger } = {}) {
  const rid = requestId(req);
  const log = parentLogger || createLogger({ requestId: rid });

  if (err instanceof AppError) {
    // Expected, handled conditions: warn, not error. The technical cause is
    // logged; the client only sees `message`.
    log.warn("request.failed", {
      code: err.code,
      status: err.status,
      message: err.message,
      cause: err.cause,
      meta: err.meta,
      path: req?.nextUrl?.pathname,
      method: req?.method,
    });
    return fail(err.code, err.message, { status: err.status, details: err.details, req });
  }

  // A ZodError is a CLIENT error, not a server fault. Without this branch every
  // malformed request body would surface as HTTP 500, which hides real 500s in
  // monitoring and tells the caller nothing about what to fix. The field-level
  // messages are returned so a form can render them, but only the paths and
  // messages: never the submitted values.
  //
  // Detected by `name` rather than `instanceof` so this module stays free of a
  // direct zod import; the shape is the stable part of the contract.
  if (err?.name === "ZodError" && Array.isArray(err.issues)) {
    const details = err.issues.slice(0, 10).map((issue) => ({
      field: issue.path?.join(".") || "_root",
      message: issue.message,
    }));
    log.warn("request.invalid_input", {
      path: req?.nextUrl?.pathname,
      method: req?.method,
      fields: details.map((d) => d.field),
    });
    return fail("ITP_VALIDATION_ERROR", details[0]?.message || "Data tidak valid.", {
      status: ERROR_STATUS.ITP_VALIDATION_ERROR,
      details,
      req,
    });
  }

  log.error("request.unhandled_error", {
    error: err,
    path: req?.nextUrl?.pathname,
    method: req?.method,
  });
  return fail("ITP_INTERNAL_ERROR", undefined, { req });
}

/**
 * Wrap a route handler so that:
 *   * every thrown AppError becomes a correct status + safe message,
 *   * every unexpected throw becomes a logged 500,
 *   * the logger carries the request id.
 *
 * @param {(req: Request, ctx: object, helpers: { log: object, rid: string }) => Promise<Response>} handler
 */
export function route(handler) {
  return async function wrapped(req, ctx) {
    const rid = requestId(req);
    const log = createLogger({
      requestId: rid,
      path: req?.nextUrl?.pathname,
      method: req?.method,
    });
    try {
      return await handler(req, ctx, { log, rid });
    } catch (err) {
      return toFail(err, { req, logger: log });
    }
  };
}

/** Parse a JSON body with a hard size ceiling, returning a safe error on garbage. */
export async function readJson(req, { maxBytes = 64 * 1024 } = {}) {
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared && declared > maxBytes) {
    throw new AppError("ITP_PAYLOAD_TOO_LARGE");
  }

  let text;
  try {
    text = await req.text();
  } catch {
    throw new AppError("ITP_BAD_REQUEST", "Body tidak dapat dibaca.");
  }

  if (!text) return {};
  // A streamed body can lie about content-length; check the real size.
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new AppError("ITP_PAYLOAD_TOO_LARGE");
  }

  try {
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new AppError("ITP_BAD_REQUEST", "Body harus berupa objek JSON.");
    }
    return parsed;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError("ITP_BAD_REQUEST", "Body bukan JSON yang valid.");
  }
}
