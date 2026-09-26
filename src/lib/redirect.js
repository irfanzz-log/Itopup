// ============================================================================
// Post-login redirect target validation — SERVER side.
//
// The client has its own copy (src/lib/api-client.js#safeNextPath) because a
// client form needs it too. This one is the authoritative version for server
// components: `redirect(next)` with an attacker-controlled absolute URL is an
// open redirect, which is a phishing primitive ("log in at itopup.com" that
// actually lands on evil.com).
//
// Rejects:
//   * anything not starting with "/",
//   * "//host" (protocol-relative),
//   * "/\host" (backslash is normalised to "/" by some browsers),
//   * control characters and newlines (header-injection hygiene),
//   * URLs that do not parse.
// ============================================================================

/** The default destination after login when no valid `next` is supplied. */
export const DEFAULT_AUTH_REDIRECT = "/member";

export function safeNextPathServer(value, fallback = DEFAULT_AUTH_REDIRECT) {
  if (typeof value !== "string") return fallback;

  const candidate = value.trim();
  if (!candidate) return fallback;
  if (!candidate.startsWith("/")) return fallback;
  if (candidate.startsWith("//")) return fallback;
  if (candidate.includes("\\")) return fallback;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(candidate)) return fallback;
  // A scheme-relative URL that survived the checks above (e.g. "/%2F%2Fevil")
  // is rejected by parsing it against a fixed base and comparing origins.
  try {
    const parsed = new URL(candidate, "https://itopup.invalid");
    if (parsed.origin !== "https://itopup.invalid") return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

/**
 * Validate an ABSOLUTE redirect URL (for OAuth-style returns). Only same-origin
 * URLs survive.
 */
export function safeRedirectUrl(value, appUrl) {
  if (typeof value !== "string" || !appUrl) return null;
  try {
    const target = new URL(value);
    const base = new URL(appUrl);
    if (target.origin !== base.origin) return null;
    return target.toString();
  } catch {
    return null;
  }
}
