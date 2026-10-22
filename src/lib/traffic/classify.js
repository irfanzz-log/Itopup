// ============================================================================
// Traffic classification: is this event normal, suspicious, or hostile?
//
// WHY THIS IS PURE AND SEPARATE FROM THE WRITER
//
// The verdict is a JUDGEMENT, and a judgement is only worth anything if it is
// reproducible and testable. Everything here is a pure function of the facts a
// request already carries (path, method, status, error code, user agent) plus a
// small window of recent history for the caller. No database, no clock read
// inside the rules, no network: `classify()` takes `now` and returns a verdict.
// tests/unit/traffic-classify.test.js exercises every rule directly.
//
// THE THREE VERDICTS, AND WHY NOT TWO
//
//   NORMAL     — a plausible request. Includes ordinary 4xx: a customer with an
//                expired session is not an attacker, and flagging them would
//                drown the signal in noise.
//   SUSPICIOUS — worth a look, not worth a block: a scan for files that do not
//                exist, a burst of failed logins from one address, an
//                unauthenticated request to a staff API.
//   HOSTILE    — the shape of an attack in progress: brute force past the
//                threshold, a webhook with a bad signature, an attempt to
//                reach a credential-bearing path, an injected payload in the URL.
//
// WHY THE VERDICT IS STORED, NOT DERIVED ON READ
//
// If the rules are tuned later, every historical row would silently change its
// answer. "We flagged this at the time" is the forensic claim an operator needs;
// "we would flag it now" is not evidence. So the writer stamps the verdict and
// the rule that produced it, and the read side never recomputes.
// ============================================================================

/** Verdict values. Referenced everywhere so a typo cannot invent a fourth. */
export const VERDICT = {
  NORMAL: "NORMAL",
  SUSPICIOUS: "SUSPICIOUS",
  HOSTILE: "HOSTILE",
};

/** Event kinds. Kept coarse on purpose: the dashboard groups by these. */
export const KIND = {
  PAGE_VIEW: "PAGE_VIEW",
  API_CALL: "API_CALL",
  AUTH_FAILURE: "AUTH_FAILURE",
  WEBHOOK: "WEBHOOK",
  FATAL: "FATAL",
  BOT: "BOT",
  SCAN: "SCAN",
};

/** Severity ladder for the fatal log. Ordered; higher is worse. */
export const SEVERITY = {
  INFO: "INFO",
  WARN: "WARN",
  ERROR: "ERROR",
  FATAL: "FATAL",
};

export const SEVERITY_RANK = { INFO: 10, WARN: 20, ERROR: 30, FATAL: 40 };

/** Human labels, used by the UI. Kept next to the values they describe. */
export const VERDICT_LABEL = {
  NORMAL: "Normal",
  SUSPICIOUS: "Mencurigakan",
  HOSTILE: "Berbahaya",
};

export const VERDICT_TONE = {
  NORMAL: "success",
  SUSPICIOUS: "warning",
  HOSTILE: "danger",
};

export const KIND_LABEL = {
  PAGE_VIEW: "Kunjungan halaman",
  API_CALL: "Panggilan API",
  AUTH_FAILURE: "Gagal autentikasi",
  WEBHOOK: "Webhook",
  FATAL: "Fatal",
  BOT: "Bot",
  SCAN: "Pemindaian",
};

// ── Rules ───────────────────────────────────────────────────────────────────

/**
 * Paths that exist to be probed. A request for any of these is never a
 * customer: the app has no WordPress, no .env route, no phpMyAdmin. A hit means
 * an automated scanner is walking a wordlist.
 */
const SCAN_PATHS = [
  /^\/wp-admin/i,
  /^\/wp-login/i,
  /^\/wp-content/i,
  /^\/xmlrpc\.php/i,
  // Anchored to the exact filename or a dot-extension. A bare /^\/\.env/ would
  // also match "/.environment", which is a plausible future page name and not a
  // probe; the near-miss is covered by a test.
  /^\/\.env(\.|$)/i,
  /^\/\.git(\/|$)/i,
  /^\/\.aws(\/|$)/i,
  /^\/phpmyadmin/i,
  /^\/pma(\/|$)/i,
  /^\/admin\.php/i,
  /^\/config\.(php|json|ya?ml)/i,
  /^\/server-status/i,
  /^\/actuator/i,
  /^\/cgi-bin/i,
  /^\/vendor\/phpunit/i,
  /^\/\.DS_Store/i,
  /^\/backup/i,
  /^\/db\.(sql|dump)/i,
];

/**
 * Substrings that indicate someone is trying to smuggle an instruction or a
 * path traversal through a URL. Matched case-insensitively against the DECODED
 * path; the writer decodes once before calling this.
 */
const INJECTION_PATTERNS = [
  { re: /(\.\.\/){2,}|%2e%2e%2f/i, label: "path traversal" },
  { re: /<script|%3cscript/i, label: "skrip di URL" },
  { re: /\bunion\s+select\b|'\s*or\s*'1'='1/i, label: "pola SQL injection" },
  { re: /\$\{jndi:|\$\{env:/i, label: "pola Log4Shell" },
  { re: /etc\/passwd|\/proc\/self/i, label: "pembacaan file sistem" },
];

/**
 * User agents that are unambiguously automated. Deliberately a short list of
 * known-bad and known-crawler tokens, NOT a general "looks like a bot"
 * heuristic: legitimate link previewers (Slack, WhatsApp, Google) fetch pages
 * and must not be flagged, and a false HOSTILE on real traffic is worse than a
 * missed one.
 */
const HOSTILE_UA = [
  /sqlmap/i,
  /nikto/i,
  /nmap\s+scripting/i,
  /masscan/i,
  /zgrab/i,
  /acunetix/i,
  /nessus/i,
  /dirbuster/i,
  /gobuster/i,
  /wpscan/i,
  /hydra/i,
];

const CRAWLER_UA = [/bot\b/i, /crawler/i, /spider/i, /curl\//i, /wget\//i, /python-requests/i, /go-http-client/i, /axios\//i];

/** Is this path a scanner's target? Returns the matched pattern or null. */
export function scanPathHit(path) {
  if (!path) return null;
  for (const re of SCAN_PATHS) if (re.test(path)) return re.source;
  return null;
}

/** Does the path carry an injection attempt? Returns its label or null. */
export function injectionHit(path) {
  if (!path) return null;
  for (const { re, label } of INJECTION_PATTERNS) if (re.test(path)) return label;
  return null;
}

/** Classify the user agent. `hostile` wins over `crawler`. */
export function classifyUserAgent(userAgent) {
  if (!userAgent) {
    // No UA at all is unusual for a browser and typical of a raw script. Not
    // hostile by itself (some health checks send none), but it is a signal.
    return { automated: true, hostile: false, crawler: false, reason: "tanpa User-Agent" };
  }
  for (const re of HOSTILE_UA) {
    if (re.test(userAgent)) return { automated: true, hostile: true, crawler: false, reason: `perangkat serangan: ${re.source}` };
  }
  for (const re of CRAWLER_UA) {
    if (re.test(userAgent)) return { automated: true, hostile: false, crawler: true, reason: "klien otomatis" };
  }
  return { automated: false, hostile: false, crawler: false, reason: null };
}

// ── Thresholds ──────────────────────────────────────────────────────────────
// Named, exported, and in one place: an operator tuning "how many failed
// logins is too many" should change a number here, not hunt for a literal in a
// route handler.
export const THRESHOLDS = {
  /** Failed logins from one IP inside the window before it is called hostile. */
  authFailHostile: 8,
  /** Failed logins from one IP inside the window before it is suspicious. */
  authFailSuspicious: 3,
  /** Requests from one IP inside the window that read as a burst. */
  requestBurst: 120,
  /** 404s from one IP inside the window that read as enumeration. */
  notFoundBurst: 20,
  /** Window for all of the above, in ms. */
  windowMs: 5 * 60 * 1000,
};

/**
 * Decide the verdict for one event.
 *
 * @param {object} event
 * @param {string} event.kind       one of KIND
 * @param {string} [event.path]
 * @param {number} [event.status]
 * @param {string} [event.code]     internal ITP_* code
 * @param {string} [event.userAgent]
 * @param {number} [event.recentAuthFailures]  same IP, inside the window
 * @param {number} [event.recentRequests]      same IP, inside the window
 * @param {number} [event.recentNotFound]      same IP, inside the window
 * @returns {{ verdict: string, rule: string|null, reason: string|null, severity: string, kind: string }}
 */
export function classify(event = {}) {
  const {
    kind = KIND.API_CALL,
    path = "",
    status = null,
    code = null,
    userAgent = null,
    recentAuthFailures = 0,
    recentRequests = 0,
    recentNotFound = 0,
  } = event;

  const ua = classifyUserAgent(userAgent);

  // ── HOSTILE ───────────────────────────────────────────────────────────────
  // Order matters: the first match wins, and the list runs from "definitely an
  // attack" to "worth watching".

  if (ua.hostile) {
    return out(VERDICT.HOSTILE, "HOSTILE_USER_AGENT", ua.reason, SEVERITY.ERROR, kind);
  }

  const injection = injectionHit(path);
  if (injection) {
    return out(VERDICT.HOSTILE, "INJECTION_ATTEMPT", `Percobaan ${injection} pada URL`, SEVERITY.ERROR, kind);
  }

  if (code === "ITP_WEBHOOK_INVALID_SIGNATURE") {
    // A forged or misconfigured callback. Either way the request claimed to be
    // a provider and could not prove it: that is an attack shape, not a bug.
    return out(VERDICT.HOSTILE, "WEBHOOK_FORGERY", "Signature webhook tidak valid", SEVERITY.ERROR, kind);
  }

  if (recentAuthFailures >= THRESHOLDS.authFailHostile) {
    return out(
      VERDICT.HOSTILE,
      "AUTH_BRUTE_FORCE",
      `${recentAuthFailures} kegagalan login dari IP ini dalam ${Math.round(THRESHOLDS.windowMs / 60000)} menit`,
      SEVERITY.ERROR,
      kind
    );
  }

  if (recentRequests >= THRESHOLDS.requestBurst) {
    return out(
      VERDICT.HOSTILE,
      "REQUEST_FLOOD",
      `${recentRequests} permintaan dari IP ini dalam ${Math.round(THRESHOLDS.windowMs / 60000)} menit`,
      SEVERITY.WARN,
      kind
    );
  }

  // ── SUSPICIOUS ────────────────────────────────────────────────────────────

  const scan = scanPathHit(path);
  if (scan) {
    return out(VERDICT.SUSPICIOUS, "SCAN_PROBE", "Permintaan ke path yang tidak ada di aplikasi ini", SEVERITY.WARN, KIND.SCAN);
  }

  if (recentAuthFailures >= THRESHOLDS.authFailSuspicious) {
    return out(
      VERDICT.SUSPICIOUS,
      "AUTH_FAILURES",
      `${recentAuthFailures} kegagalan login dari IP ini dalam ${Math.round(THRESHOLDS.windowMs / 60000)} menit`,
      SEVERITY.WARN,
      kind
    );
  }

  if (recentNotFound >= THRESHOLDS.notFoundBurst) {
    return out(
      VERDICT.SUSPICIOUS,
      "NOT_FOUND_ENUMERATION",
      `${recentNotFound} respons 404 dari IP ini dalam ${Math.round(THRESHOLDS.windowMs / 60000)} menit`,
      SEVERITY.WARN,
      kind
    );
  }

  // A staff API reached without a session: someone is guessing at the admin
  // surface. Not hostile on its own (a stale cookie is common), but a burst of
  // them is what the counters above catch.
  if (status === 401 && path.startsWith("/api/dev")) {
    return out(VERDICT.SUSPICIOUS, "STAFF_API_UNAUTHENTICATED", "API staf diakses tanpa sesi", SEVERITY.WARN, kind);
  }

  if (ua.crawler) {
    // A crawler hitting an API is odd; hitting a page is normal. But an
    // AUTH_FAILURE must keep its own kind: "a bot tried to log in" is a
    // different fact from "a bot called an endpoint", and the login one is the
    // one an operator needs to see. So the crawler rule never rewrites kind for
    // an authentication event.
    if (kind === KIND.AUTH_FAILURE) {
      return out(VERDICT.NORMAL, null, null, SEVERITY.INFO, KIND.AUTH_FAILURE);
    }
    if (path.startsWith("/api/")) {
      return out(VERDICT.SUSPICIOUS, "CRAWLER_ON_API", "Klien otomatis memanggil API", SEVERITY.INFO, KIND.BOT);
    }
    return out(VERDICT.NORMAL, null, null, SEVERITY.INFO, KIND.BOT);
  }

  if (!userAgent) {
    return out(VERDICT.SUSPICIOUS, "NO_USER_AGENT", "Permintaan tanpa User-Agent", SEVERITY.INFO, kind);
  }

  // ── NORMAL ────────────────────────────────────────────────────────────────

  // A 5xx is the app's fault, not the caller's. It belongs in the fatal log,
  // but it is not a security verdict.
  if (status !== null && status >= 500) {
    return out(VERDICT.NORMAL, null, null, SEVERITY.ERROR, kind === KIND.FATAL ? KIND.FATAL : kind);
  }

  return out(VERDICT.NORMAL, null, null, SEVERITY.INFO, kind);
}

function out(verdict, rule, reason, severity, kind) {
  return { verdict, rule, reason, severity, kind };
}

/**
 * Severity for a status code, when no other rule applies.
 * Exported so the writer and the tests agree on the ladder.
 */
export function severityForStatus(status) {
  if (status === null || status === undefined) return SEVERITY.INFO;
  if (status >= 500) return SEVERITY.ERROR;
  if (status === 429) return SEVERITY.WARN;
  if (status >= 400) return SEVERITY.INFO;
  return SEVERITY.INFO;
}

/** True when a verdict should appear in the fatal/incident log by default. */
export function isIncident({ verdict, severity }) {
  return verdict === VERDICT.HOSTILE || SEVERITY_RANK[severity] >= SEVERITY_RANK[SEVERITY.ERROR];
}
