// ============================================================================
// Server environment access.
//
// Two exports with deliberately different behaviour:
//   * env        — lazily-read, validated on first access. Throws loudly when a
//                  required variable is missing, so a misconfigured deploy fails
//                  at boot instead of at the first customer checkout.
//   * optional   — for integrations that are allowed to be unconfigured in
//                  Phase 1 (payment gateway, external rate-limit store). These
//                  return null, and the code that needs them refuses to operate
//                  rather than faking success.
//
// NOTHING in this module may be imported from a client component: it reads
// server-only secrets. The filename (.server.js) is the guard.
// ============================================================================
import { loadEnv } from "./env.js";

loadEnv();

/** Variables that must exist for the app to run at all. */
const REQUIRED = ["DATABASE_URL", "AUTH_SECRET"];

const cache = new Map();

function read(name) {
  if (cache.has(name)) return cache.get(name);
  const raw = process.env[name];
  const value = typeof raw === "string" ? raw.trim() : raw;
  const normalised = value === "" ? undefined : value;
  cache.set(name, normalised);
  return normalised;
}

let validated = false;

/**
 * Validate the hard requirements once. Called at the top of `env()` so a missing
 * secret throws on first use with a message naming the variable.
 */
function validate() {
  if (validated) return;
  validated = true;

  const missing = REQUIRED.filter((name) => !read(name));
  if (missing.length) {
    throw new Error(
      `Konfigurasi environment belum lengkap: ${missing.join(", ")}. ` +
        `Salin .env.example ke .env dan isi nilainya.`
    );
  }

  if (read("AUTH_SECRET").length < 32) {
    throw new Error(
      "AUTH_SECRET terlalu pendek (minimal 32 karakter). " +
        "Generate: node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\""
    );
  }
}

export const env = new Proxy(
  {},
  {
    get(_t, prop) {
      if (typeof prop !== "string") return undefined;
      validate();
      const value = read(prop);
      if (value === undefined) {
        throw new Error(`Environment variable ${prop} belum diisi.`);
      }
      return value;
    },
  }
);

/** Read a variable that is allowed to be absent. Returns null when unset. */
export function optional(name) {
  return read(name) ?? null;
}

/** True when every named variable is present and non-empty. */
export function isConfigured(...names) {
  return names.every((n) => Boolean(read(n)));
}

/** Non-secret summary for health endpoints and the admin settings page. */
export function envReport() {
  const names = [
    "DATABASE_URL", "DIRECT_URL", "AUTH_SECRET", "NEXT_PUBLIC_APP_URL",
    "TOPUP_PROVIDER", "MELOSTORE_BASE_URL", "MELOSTORE_API_KEY",
    "MELOSTORE_SECRET", "MELOSTORE_WEBHOOK_SECRET", "MELOSTORE_SANDBOX",
    "PAYMENT_PROVIDER", "PAYMENT_API_KEY", "PAYMENT_SECRET", "PAYMENT_WEBHOOK_SECRET",
    "RATE_LIMIT_URL", "RATE_LIMIT_TOKEN",
  ];
  return names.map((name) => ({
    name,
    configured: Boolean(read(name)),
  }));
}

export const isProduction = () => process.env.NODE_ENV === "production";
export const isTest = () => process.env.NODE_ENV === "test";

// ── Server-side business rules ───────────────────────────────────────────────
// These live HERE, not in constants.js. constants.js is imported by client
// components (UserMenu), and Next replaces a non-NEXT_PUBLIC `process.env` read
// with `undefined` in the browser bundle — so the same constant would silently
// hold 60 on the server and NaN on the client. Domain constants stay pure;
// anything that reads the environment stays in this module.

/** How long an unpaid order stays payable before the expiry job cancels it. */
export const ORDER_TTL_MINUTES = (() => {
  const raw = optional("ORDER_TTL_MINUTES");
  if (raw === null) return 60;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`ORDER_TTL_MINUTES harus angka positif, bukan "${raw}".`);
  }
  return parsed;
})();
