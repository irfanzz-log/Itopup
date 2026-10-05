// ============================================================================
// Input field presets.
//
// These describe what the CHECKOUT UI must collect and how to validate it.
// They are deliberately provider-agnostic: no Melostore parameter name appears
// here. Turning `userId` into whatever the provider calls it is the adapter
// mapper's job (src/providers/melostore/mapper.js); that is the whole point of
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

  /** Indonesian mobile number: the e-wallet and pulsa entry point.
   *
   * The customer may type the number in any of the shapes they see it in:
   * 0812…, 812…, +62 812…, or 62 812…. `validateFields` normalises all of them
   * to the local 08… form before this pattern ever runs, so the pattern only has
   * to describe the canonical shape. `minLength`/`maxLength` are also expressed
   * in the canonical form, so a 13-digit number typed as "+62 812…" is not
   * rejected for being "too long" before normalisation has even run.
   *
   * The top-up input holds the canonical 08… form and displays it as-is. It does
   * NOT apply `formatPhoneInternational`: a formatted value is two characters
   * longer than the number it represents, so the browser's maxLength cut the
   * last digits off in the DOM and the customer watched their number get
   * shorter as they typed.
   *
   * The operator-prefix check (src/config/operators.js) runs after this and
   * refuses a number that does not belong to the selected product's operator. */
  phoneNumber: {
    key: "phoneNumber",
    label: "Nomor HP",
    // The placeholder matches the canonical 08… form, which is the shape the
    // field actually accepts. A "+62 …" placeholder made the field look
    // two characters shorter than it is, so a customer typing along would hit
    // the visible end of the input and stop before the number was complete.
    placeholder: "08xx xxx xxxx",
    type: "tel",
    inputMode: "tel",
    // Matches the canonical 08… form AFTER normalisation.
    pattern: "^0[0-9]{8,13}$",
    minLength: 9,
    maxLength: 14,
    required: true,
    helpText: "Masukkan nomor tanpa spasi, contoh 081234567890 atau +6281234567890.",
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

  /** Email destination: stored-value gift cards the provider redeems by email.
   *
   * The provider's own inquiry form for these brands declares
   * `type: "email"` with the placeholder "Masukkan alamat email", so the field
   * must accept an address. The generic `username` preset above forbids `@`,
   * which made a valid Google Play / Razer Gold target fail validation at
   * checkout — the input contract came from a username-shaped game, not from
   * the product being sold.
   *
   * The pattern is deliberately not the full RFC: the provider's own validation
   * is what decides whether an address can be redeemed, and a stricter local
   * check would only add new ways to reject an address the supplier accepts.
   * It pins the two things a mistyped address cannot survive: exactly one `@`
   * and a domain with a dot.
   */
  email: {
    key: "email",
    label: "Email",
    placeholder: "email@contoh.com",
    type: "email",
    inputMode: "email",
    autoCapitalize: "off",
    autoComplete: "email",
    pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$",
    minLength: 5,
    maxLength: 254,
    required: true,
    helpText: "Email akun tempat voucher dikirim.",
    errorMessage: "Masukkan alamat email yang valid, contoh nama@email.com.",
  },

  /** Riot ID, for Riot's own games: Valorant, Wild Rift, TFT, LoL, Runeterra.
   *
   * The provider labels this field "Riot ID" (inquiry form type `text`), not
   * "username". Riot IDs carry a `#TAG`, so unlike the generic username preset
   * the pattern admits `#` and uppercase letters.
   */
  riotId: {
    key: "riotId",
    label: "Riot ID",
    placeholder: "Contoh: Player#1234",
    type: "text",
    inputMode: "text",
    pattern: "^[A-Za-z0-9._# -]{3,32}$",
    minLength: 3,
    maxLength: 32,
    required: true,
    helpText: "Riot ID terlihat di profil atau pengaturan akun di dalam game.",
    errorMessage: "Riot ID harus 3–32 karakter (huruf, angka, . _ # -).",
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

  /// ── Game-login fields ─────────────────────────────────────────────────────
  ///
  /// These are NOT contact/account identifiers like the presets above. They
  /// carry a secret that grants access to the customer's own game account, so
  /// they are treated differently everywhere they appear:
  ///
  ///   * `secret: true` marks a field whose value must never be written to
  ///     Order.customerInput, never logged, and never returned by an API.
  ///     `validateFields` still validates it, but the checkout service moves
  ///     the value into the encrypted credential store before the order is
  ///     created, so the plaintext never reaches the database.
  ///   * the UI renders them with type="password" + autocomplete="off" and
  ///     asks whether to remember the login.
  ///

  /** The login identifier of the customer's own game account (not a secret). */
  gameLogin: {
    key: "gameLogin",
    label: "Login Akun Game",
    placeholder: "Email atau ID login akun game",
    type: "text",
    inputMode: "text",
    // Provider login identifiers are emails or Konami-style ids; keep the class
    // wide and cap the length rather than guessing a specific format.
    pattern: "^[A-Za-z0-9._@+-]{3,64}$",
    minLength: 3,
    maxLength: 64,
    required: true,
    helpText: "Login akun game Anda sendiri (bukan User ID dalam game).",
    errorMessage: "Login akun game harus 3–64 karakter (huruf, angka, . _ @ + -).",
    /** Marks this field as the identifier half of a stored game login. */
    isCredentialLogin: true,
  },

  /** The secret of the customer's own game account. Handled as a secret. */
  gamePassword: {
    key: "gamePassword",
    label: "Password Akun Game",
    placeholder: "Password akun game",
    type: "password",
    inputMode: "text",
    // Never echo the value back or let the browser autofill it: the customer
    // should type it deliberately, and this field is not an account we own.
    autoComplete: "off",
    minLength: 1,
    maxLength: 128,
    required: true,
    helpText:
      "Diperlukan oleh penyedia untuk eFootball. Password tidak disimpan dalam bentuk teks biasa, hanya dipakai untuk transaksi ini.",
    errorMessage: "Password akun game wajib diisi.",
    /**
     * SECURITY: this value is a secret. It must never land in
     * Order.customerInput, in a log, or in an API response.
     */
    secret: true,
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
    let raw = values?.[def.key];
    let value = typeof raw === "string" ? raw.trim() : raw == null ? "" : String(raw).trim();

    // ── Normalise a phone number BEFORE the pattern check ──────────────────
    //
    // The field accepts anything the customer might type: 0812…, 812…,
    // +62 812…, 62 812…, and canonicalises it to the local 08… form, so the
    // customer never has to reason about the trunk prefix or the country code.
    //
    // This is a STORED-FORMAT decision as much as a UX one: the operator prefix
    // lookup, the stored `customerInput`, and the target sent to the provider
    // all key on the 08… shape. Storing the raw input would mean "62812…" and
    // "0812…" were two different customers.
    if (def.key === "phoneNumber" && value) {
      value = normalisePhoneId(value);
    }

    if (!value) {
      if (required) errors.push({ field: def.key, message: `${def.label} wajib diisi.` });
      continue;
    }

    // ── Validate a phone number on its NORMALISED form ─────────────────────
    //
    // `normalisePhoneId` ran above, so for `phoneNumber` `value` is already the
    // canonical 08… form. Testing that (instead of the raw input) is what
    // makes the length and pattern checks say true things about the number the
    // customer actually entered. The raw text can be longer than the number
    // (a leading +62) or shorter (no trunk prefix at all), and a length check
    // on it would misreport both directions.
    const tested = def.key === "phoneNumber" ? normalisePhoneId(value) : value;

    // Length first, pattern second. A regex with an open upper bound (ours is
    // `^0[0-9]{8,13}$`, but a custom `pattern` need not be) passes a number of
    // any length as long as the character class fits, so the explicit limits
    // are what actually reject an over-long number. Ordering them first also
    // gives a length-specific message instead of the generic "tidak valid."
    if (def.minLength && tested.length < def.minLength) {
      errors.push({
        field: def.key,
        message: phoneErrorMessage(def, tested) || `${def.label} minimal ${def.minLength} karakter.`,
      });
      continue;
    }
    if (def.maxLength && tested.length > def.maxLength) {
      errors.push({
        field: def.key,
        message: phoneErrorMessage(def, tested) || `${def.label} maksimal ${def.maxLength} karakter.`,
      });
      continue;
    }
    if (def.pattern && !new RegExp(def.pattern).test(tested)) {
      errors.push({
        field: def.key,
        message: phoneErrorMessage(def, tested) || def.errorMessage || `${def.label} tidak valid.`,
      });
      continue;
    }

    out[def.key] = value;
  }

  if (errors.length) return { ok: false, errors };

  // A secret field was VALIDATED above (length, pattern, required) but must not
  // be RETURNED. This object is what the order row stores, what the request hash
  // digests, and what any log line that prints "customer input" would see. The
  // plaintext lives only in the raw request and, for a stored login, in the
  // encrypted credential row.
  for (const key of secretFieldKeys(fieldDefs)) {
    delete out[key];
  }

  return { ok: true, values: out };
}

/**
 * Names of the secret fields a game's contract declares.
 *
 * Used by checkout to split the request into "store on the order" and "hold in
 * memory for one provider call". A game with no secret fields returns [].
 *
 * @param {InputField[]} fieldDefs
 * @returns {string[]}
 */
export function secretFieldKeys(fieldDefs) {
  if (!Array.isArray(fieldDefs)) return [];
  return fieldDefs.filter((f) => f.secret).map((f) => f.key);
}

/**
 * Is this field's value a secret that must never be persisted or echoed?
 *
 * @param {InputField} def
 * @returns {boolean}
 */
export function isSecretField(def) {
  return Boolean(def?.secret);
}

/**
 * Normalise an Indonesian phone number to the local 08… form.
 * Pulsa and e-wallet products are keyed on the operator/prefix, so a consistent
 * shape is required; otherwise 62812… and 0812… become two different products.
 */
export function normalisePhoneId(input) {
  const digits = String(input || "").replace(/[^0-9+]/g, "");
  if (digits.startsWith("+62")) return `0${digits.slice(3)}`;
  if (digits.startsWith("62")) return `0${digits.slice(2)}`;
  if (digits.startsWith("0")) return digits;
  if (digits.startsWith("8")) return `0${digits}`;
  return digits;
}

/**
 * Tell the customer, in plain terms, what is wrong with a phone number.
 *
 * "Nomor HP tidak valid." is true of every bad number and useful for none of
 * them. The three cases below cover what people actually type wrong, and each
 * one names the fix rather than the rule: a number that turns out not to start
 * with "08" almost always means the trunk prefix was dropped, not that the
 * digits are garbage.
 *
 * Callers pass the NORMALISED value, so the length reported here is the length
 * of the number, not the length of the text it was typed in.
 *
 * @param {InputField} def
 * @param {string} normalised the canonical 08… form
 * @returns {string|null} a specific message, or null to fall back to the default
 */
export function phoneErrorMessage(def, normalised) {
  if (def.key !== "phoneNumber") return null;
  const digits = String(normalised || "");
  if (!/^0/.test(digits)) {
    // Anything that normalised to a non-0-leading string had neither a trunk
    // prefix nor a country code nor a leading 8: the customer typed the
    // number without any prefix at all.
    return "Nomor HP harus dimulai dari 0 (contoh: 081234567890) atau +62/62.";
  }
  if (digits.length < 9) return "Nomor HP terlalu pendek. Pastikan Anda mengetik semua digitnya.";
  if (digits.length > 14) return "Nomor HP terlalu panjang. Periksa apakah ada digit yang berlebih.";
  return null;
}

/**
 * Display a local 08… number in international +62… form.
 *
 * Exported for anything that shows a number OUTSIDE the input (an order
 * receipt, a support transcript) where the customer reads the number as it
 * appears on their own phone. The top-up input itself does not use it: that
 * field holds the canonical 08… form, because a formatted value is longer than
 * the number it represents and enforcing maxLength on it truncated the last
 * digits (see the phoneNumber preset above).
 */
export function formatPhoneInternational(input) {
  const local = normalisePhoneId(input);
  if (!local.startsWith("0")) return local;
  return `+62 ${local.slice(1)}`;
}