// ============================================================================
// Shared client-side API helper.
//
// Reads the CSRF cookie and echoes it in the header. The cookie is not a secret
// (it is readable by design); it proves the request was built by our own page,
// which is the second layer after the SameSite cookie and the Origin check.
//
// The error envelope is normalised so every form can render `error.message`
// without inspecting the response shape.
// ============================================================================
import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/csrf-constants";

function readCookie(name) {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/** Ensure a CSRF cookie exists before a mutating request. */
function ensureCsrfCookie() {
  let token = readCookie(CSRF_COOKIE);
  if (!token) {
    token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    // Not HttpOnly on purpose: the client must be able to read it back.
    document.cookie = `${CSRF_COOKIE}=${token}; path=/; SameSite=Lax`;
  }
  return token;
}

/**
 * @param {string} url
 * @param {{ method?: string, body?: unknown, signal?: AbortSignal }} [options]
 * @returns {Promise<{ ok: true, data: any } | { ok: false, error: { code: string, message: string, details?: any[] } }>}
 */
export async function apiFetch(url, { method = "GET", body, signal } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET" && method !== "HEAD") headers[CSRF_HEADER] = ensureCsrfCookie();

  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      credentials: "same-origin",
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    return {
      ok: false,
      error: { code: "ITP_NETWORK_ERROR", message: "Koneksi bermasalah. Periksa jaringan Anda." },
    };
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // A non-JSON body (a proxy error page, a 502): report it generically.
    return {
      ok: false,
      error: {
        code: "ITP_INTERNAL_ERROR",
        message: "Terjadi kesalahan. Silakan coba lagi.",
        status: response.status,
      },
    };
  }

  if (!response.ok || payload?.success === false) {
    return {
      ok: false,
      error: {
        code: payload?.error?.code || "ITP_INTERNAL_ERROR",
        message: payload?.error?.message || "Terjadi kesalahan. Silakan coba lagi.",
        details: payload?.error?.details,
        status: response.status,
        requestId: payload?.requestId,
      },
    };
  }

  return { ok: true, data: payload?.data };
}

/**
 * Convenience wrapper for JSON POSTs.
 *
 * Returns the same discriminated union as `apiFetch`, so callers branch on
 * `result.ok` and never have to look at a status code, except where the status
 * itself is the decision (401 → send the visitor to /login).
 */
export function apiPost(url, body, options = {}) {
  return apiFetch(url, { ...options, method: "POST", body });
}

/** Same, for a GET with no body. */
export function apiGet(url, options = {}) {
  return apiFetch(url, { ...options, method: "GET" });
}

/** Same, for PATCH/PUT. */
export function apiSend(url, body, { method = "PATCH", ...options } = {}) {
  return apiFetch(url, { ...options, method, body });
}

/**
 * Validate a `?next=` redirect target.
 *
 * Accepts ONLY a same-site absolute path. `//evil.com` and `https://evil.com`
 * are protocol-relative/absolute URLs that a naive `startsWith("/")` check
 * would let through. That is a classic open redirect.
 */
export function safeNextPath(value, fallback = "/member") {
  if (typeof value !== "string" || !value) return fallback;
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//")) return fallback;
  if (value.includes("\\")) return fallback;
  // Reject anything that parses to a different origin.
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin) return fallback;
    return `${url.pathname}${url.search}`;
  } catch {
    return fallback;
  }
}
