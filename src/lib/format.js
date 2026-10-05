// ============================================================================
// Formatting helpers. Used by BOTH server and client components, so nothing
// here may import a server-only module or read a secret.
//
// ⚠️  DETERMINISTIC BY CONSTRUCTION: do not reintroduce Intl currency
//
// These functions used to call `Intl.NumberFormat("id-ID", { style: "currency",
// currency: "IDR" })`. That rendered "Rp 1.600" on the server and "Rp1.600" in
// the browser, because the two runtimes ship DIFFERENT ICU/CLDR data for the
// id-ID currency pattern (the non-breaking space after "Rp" is present in Node's
// ICU and absent in some browser builds).
//
// React compares the server HTML against the client render and, on a mismatch,
// throws "Hydration failed because the server rendered text didn't match the
// client" and regenerates the whole tree, which is exactly what happened on the
// nominal buttons of /topup/*.
//
// The fix is NOT a `suppressHydrationWarning` band-aid: that hides the symptom
// while leaving two different strings in the DOM. It is to stop depending on
// ICU locale data for a string we can assemble ourselves. Grouping is done with
// an explicit regex, so the output is byte-identical on every runtime.
//
// The same reasoning applies to the date formatters below: they still use Intl
// (a real calendar needs locale data) but pin `timeZone: "Asia/Jakarta"`, so the
// server and the client, which may run in different timezones, agree.
// ============================================================================

/**
 * Group a number with "." every three digits and "," before the decimals: the
 * Indonesian convention ("1.234.567,89").
 *
 * Deliberately NOT `Intl.NumberFormat`: see the file header. Handles a decimal
 * part so a percentage like 0.7% renders as "0,7%" and not as a truncated "0".
 * silently dropping the fraction of a fee is the kind of error a customer only
 * notices on their bank statement.
 */
function groupThousands(value) {
  // Reject empty input BEFORE Number(): `Number(null)` and `Number("")` are both
  // 0, so a missing amount used to render as a perfectly legitimate "Rp 0".
  // worse than "Rp NaN", because a customer reads it as a free order. Only a
  // real number (or a non-empty numeric string) may produce digits.
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string" && value.trim() === "") return null;

  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  // Exponential notation (|n| >= 1e21) has no thousands structure to group; the
  // regex below would mangle it. No rupiah amount or percentage reaches this.
  const raw = String(Math.abs(n));
  if (raw.includes("e") || raw.includes("E")) return raw;

  const negative = n < 0;
  const [intPart, fracPart] = raw.split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const out = fracPart ? `${grouped},${fracPart}` : grouped;
  return negative ? `-${out}` : out;
}

const DATE_TIME = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Jakarta",
});

const DATE_ONLY = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium",
  timeZone: "Asia/Jakarta",
});

/** "Rp 22.000": identical on server and client. */
export function formatIDR(value) {
  const grouped = groupThousands(value);
  if (grouped === null) return "-";
  return `Rp ${grouped}`;
}

/** "22.000": for inputs and tables where the Rp prefix is in the header. */
export function formatNumber(value) {
  const grouped = groupThousands(value);
  return grouped === null ? "-" : grouped;
}

export function formatDateTime(value) {
  if (!value) return "-";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return DATE_TIME.format(d);
}

export function formatDate(value) {
  if (!value) return "-";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return DATE_ONLY.format(d);
}

/**
 * "3 menit lalu": relative, for order lists.
 *
 * Takes `now` explicitly rather than reading the clock itself, so a caller can
 * pass a server-derived timestamp and both renders agree.
 */
export function formatRelative(value, now = Date.now()) {
  if (!value) return "-";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "-";

  const diffMs = now - d.getTime();
  const future = diffMs < 0;
  const abs = Math.abs(diffMs);

  const units = [
    ["detik", 1000],
    ["menit", 60_000],
    ["jam", 3_600_000],
    ["hari", 86_400_000],
  ];

  let label = "detik";
  let divisor = 1000;
  for (const [name, ms] of units) {
    if (abs >= ms) {
      label = name;
      divisor = ms;
    }
  }
  const n = Math.floor(abs / divisor);
  return future ? `dalam ${n} ${label}` : `${n} ${label} lalu`;
}

/** Mask an email for display next to a session: bu***@mail.com */
export function maskEmail(value) {
  if (typeof value !== "string" || !value.includes("@")) return "-";
  const [local, domain] = value.split("@");
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(2, local.length - visible.length))}@${domain}`;
}

/** Mask a player id / phone number, keeping the last 4 characters. */
export function maskTail(value, keep = 4) {
  if (typeof value !== "string" || value.length <= keep) return value ?? "-";
  return `${"*".repeat(value.length - keep)}${value.slice(-keep)}`;
}

/** "1.234,5 ms" style duration for admin tables. */
export function formatDuration(ms) {
  if (ms === null || ms === undefined || ms === "") return "-";
  const n = Number(ms);
  if (!Number.isFinite(n)) return "-";
  if (n < 1000) return `${n} ms`;
  return `${(n / 1000).toFixed(1)} s`;
}

export function initials(name) {
  if (typeof name !== "string" || !name.trim()) return "?";
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}
