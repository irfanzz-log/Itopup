// ============================================================================
// Input field presets.
//
// These describe what the CHECKOUT UI must collect and how to validate it.
// They are deliberately provider-agnostic: no Melostore parameter name appears
// here. Turning `userId` into whatever the provider calls it is the adapter
// mapper's job (src/providers/melostore/mapper.js) — that is the whole point of
// the split, so swapping providers never touches this file.
//
// Stored on Game.inputFields as JSON so a new game can be added from the admin
// panel without a deploy. Keep every value JSON-serialisable (patterns are
// strings, not RegExp).
// ============================================================================

/** @typedef {Object} InputField
 *  @property {string}  key          stable identifier, used as the payload key
 *  @property {string}  label        shown to the customer
 *  @property {string}  [placeholder]
 *  @property {'text'|'tel'|'numeric'} [type]
 *  @property {string}  [inputMode]  soft-keyboard hint for mobile
 *  @property {string}  [pattern]    anchored regex, as a STRING (JSON-safe)
 *  @property {number}  [minLength]
 *  @property {number}  [maxLength]
 *  @property {boolean} [required]   default true
 *  @property {string}  [helpText]
 *  @property {string}  [errorMessage]
 */

/** @type {Record<string, InputField>} */
export const FIELD_PRESETS = {
  userId: {
    key: "userId",
    label: "User ID",
    placeholder: "Contoh: 123456789",
    type: "numeric",
    inputMode: "numeric",
    pattern: "^[0-9]{6,14}$",
    minLength: 6,
    maxLength: 14,
    required: true,
    helpText: "Buka profil di dalam game untuk melihat User ID.",
    errorMessage: "User ID harus berupa 6–14 angka.",
  },

  zoneId: {
    key: "zoneId",
    label: "Zone ID",
    placeholder: "Contoh: 1234",
    type: "numeric",
    inputMode: "numeric",
    pattern: "^[0-9]{3,8}$",
    minLength: 3,
    maxLength: 8,
    required: true,
    helpText: "Terletak di bawah User ID, di dalam tanda kurung.",
    errorMessage: "Zone ID harus berupa 3–8 angka.",
  },

  playerId: {
    key: "playerId",
    label: "Player ID",
    placeholder: "Masukkan Player ID",
    type: "text",
    inputMode: "text",
    pattern: "^[A-Za-z0-9._-]{4,24}$",
    minLength: 4,
    maxLength: 24,
    required: true,
    helpText: "Player ID bersifat permanen dan tidak dapat diubah.",
    errorMessage: "Player ID harus 4–24 karakter (huruf, angka, . _ -).",
  },

  serverId: {
    key: "serverId",
    label: "Server",
    placeholder: "Contoh: 2001",
    type: "numeric",
    inputMode: "numeric",
    pattern: "^[0-9]{3,8}$",
    minLength: 3,
    maxLength: 8,
    required: true,
    errorMessage: "Server harus berupa 3–8 angka.",
  },

  /** Indonesian mobile number — the e-wallet and pulsa entry point. */
  phoneNumber: {
    key: "phoneNumber",
    label: "Nomor HP",
    placeholder: "08xxxxxxxxxx",
    type: "tel",
    inputMode: "tel",
    pattern: "^0[0-9]{8,13}$",
    minLength: 9,
    maxLength: 14,
    required: true,
    helpText: "Masukkan nomor tanpa spasi, contoh 081234567890.",
    errorMessage: "Nomor HP tidak valid.",
  },

  /** Login identifier for providers that identify an e-wallet by username. */
  username: {
    key: "username",
    label: "Username",
    placeholder: "Username akun",
    type: "text",
    inputMode: "text",
    pattern: "^[A-Za-z0-9._-]{3,32}$",
    minLength: 3,
    maxLength: 32,
    required: true,
    errorMessage: "Username harus 3–32 karakter.",
  },

  region: {
    key: "region",
    label: "Region",
    placeholder: "Contoh: ID",
    type: "text",
    inputMode: "text",
    pattern: "^[A-Za-z]{2,4}$",
    minLength: 2,
    maxLength: 4,
    required: true,
    errorMessage: "Region harus 2–4 huruf.",
  },
};

/** Shallow copy of a preset, with overrides. Keeps the presets immutable. */
export function field(presetKey, overrides = {}) {
  const base = FIELD_PRESETS[presetKey];
  if (!base) throw new Error(`Unknown input field preset: ${presetKey}`);
  return { ...base, ...overrides };
}

/**
 * Validate a set of customer inputs against a game's field contract.
 *
 * Runs on the SERVER before anything is sent to a provider, and is also safe to
 * import in a client form for instant feedback. Unknown keys are REJECTED (not
 * dropped): silently discarding them would hide a client sending extra data to
 * the provider adapter.
 *
 * @param {InputField[]} fieldDefs
 * @param {Record<string, string>} values
 * @returns {{ ok: true, values: Record<string,string> } | { ok: false, errors: Array<{field:string,message:string}> }}
 */
export function validateFields(fieldDefs, values) {
  const errors = [];
  const out = {};

  if (!Array.isArray(fieldDefs) || fieldDefs.length === 0) {
    return { ok: false, errors: [{ field: "_root", message: "Konfigurasi input belum tersedia." }] };
  }

  const defs = new Map(fieldDefs.map((f) => [f.key, f]));

  for (const key of Object.keys(values || {})) {
    if (!defs.has(key)) {
      errors.push({ field: key, message: "Field tidak dikenal." });
    }
  }

  for (const def of fieldDefs) {
    const required = def.required !== false;
    const raw = values?.[def.key];
    const value = typeof raw === "string" ? raw.trim() : raw == null ? "" : String(raw).trim();

    if (!value) {
      if (required) errors.push({ field: def.key, message: `${def.label} wajib diisi.` });
      continue;
    }

    if (def.minLength && value.length < def.minLength) {
      errors.push({ field: def.key, message: def.errorMessage || `${def.label} minimal ${def.minLength} karakter.` });
      continue;
    }
    if (def.maxLength && value.length > def.maxLength) {
      errors.push({ field: def.key, message: def.errorMessage || `${def.label} maksimal ${def.maxLength} karakter.` });
      continue;
    }
    if (def.pattern && !new RegExp(def.pattern).test(value)) {
      errors.push({ field: def.key, message: def.errorMessage || `${def.label} tidak valid.` });
      continue;
    }

    out[def.key] = value;
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, values: out };
}

/**
 * Normalise an Indonesian phone number to the local 08… form.
 * Pulsa and e-wallet products are keyed on the operator/prefix, so a consistent
 * shape is required — otherwise 62812… and 0812… become two different products.
 */
export function normalisePhoneId(input) {
  const digits = String(input || "").replace(/[^0-9+]/g, "");
  if (digits.startsWith("+62")) return `0${digits.slice(3)}`;
  if (digits.startsWith("62")) return `0${digits.slice(2)}`;
  if (digits.startsWith("0")) return digits;
  if (digits.startsWith("8")) return `0${digits}`;
  return digits;
}
