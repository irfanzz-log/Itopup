// ============================================================================
// Game credential crypto: AES-256-GCM at rest.
//
// THE ONE PLACE a stored game secret is encrypted or decrypted. Everything
// else in the app sees ciphertext, or nothing at all.
//
// WHY GCM
//
//   * authenticated: GCM detects tampering, so a flipped bit in the DB is a
//     decryption failure rather than a silently-valid alternate plaintext.
//   * no padding oracle: the tag is verified before any plaintext is released.
//   * fast, and in Node's OpenSSL it needs no extra dependency.
//
// KEY MANAGEMENT
//
// There is no second secret to leak. The key is HKDF-derived from AUTH_SECRET,
// which the app already requires and already rotates, and the derivation is
// keyed to "game-credential/v1" so a future key can be added without
// disturbing existing ciphertexts. Rotating AUTH_SECRET invalidates every
// stored credential, which is deliberate: a credential that survives a
// compromised-secret rotation is not a secured credential.
//
// WHAT THIS MODULE NEVER DOES
//
//   * log a plaintext or a ciphertext,
//   * return a plaintext to a caller that will serialise it (see the typed
//     return of decryptCredential: it is a string, and the only consumer is
//     the one provider call that needs it),
//   * cache a key in a way that survives the process (the derivation is
//     memoised per process, which is fine and desirable; see below).
//
// `import "server-only"` is what keeps this out of a client bundle: the
// decrypt path holds the key, and a browser chunk must never be able to.
// ============================================================================
import "server-only";
import { createCipheriv, createDecipheriv, createHmac, createSecretKey, randomBytes } from "node:crypto";
import { optional } from "./env.server.js";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;

/**
 * Per-process derived key.
 *
 * Deriving on every call costs a few microseconds; memoising it costs one
 * closure and guarantees that a mid-process env change cannot make two
 * encrypt/decrypt calls disagree about which key is canonical, the same
 * reasoning as env.server.js's process-lifetime cache.
 */
let cachedKey = null;

/**
 * The 32-byte AES-256 key, HKDF-derived from AUTH_SECRET.
 *
 * @returns {import("node:crypto").KeyObject}
 */
function key() {
  if (cachedKey) return cachedKey;
  const authSecret = optional("AUTH_SECRET");
  if (!authSecret || authSecret.length < 32) {
    throw new Error(
      "AUTH_SECRET belum dikonfigurasi (minimal 32 karakter). Kredensial game tidak dapat dienkripsi."
    );
  }
  // HKDF without a salt is HMAC-based and deterministic, which is what we want:
  // the same AUTH_SECRET always yields the same key, so rows stay readable
  // across restarts. The info string scopes the key to this one purpose.
  const info = Buffer.from("itopup:game-credential:v1", "utf8");
  const prk = createHmac("sha256", Buffer.alloc(32, 0)).update(authSecret).digest();
  const okm = createHmac("sha256", prk).update(Buffer.concat([info, Buffer.from([1])])).digest();
  cachedKey = createSecretKey(okm.subarray(0, 32));
  return cachedKey;
}

/**
 * Encrypt a game-account secret.
 *
 * @param {string} plaintext the customer's game password/secret
 * @returns {{ cipher: string, iv: string }} base64 ciphertext + base64 IV
 */
export function encryptCredential(plaintext) {
  if (typeof plaintext !== "string" || !plaintext) {
    throw new Error("Kredensial game tidak boleh kosong.");
  }
  // 12 bytes is GCM's standard IV size. A random IV per encryption is what
  // keeps GCM safe: an IV reused with the same key leaks the plaintext of
  // both messages, so this MUST stay random and MUST be stored alongside the
  // ciphertext (it is not a secret).
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key(), iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    cipher: Buffer.concat([encrypted, tag]).toString("base64"),
    iv: iv.toString("base64"),
  };
}

/**
 * Decrypt a stored game-account secret.
 *
 * @param {{ cipher: string, iv: string }} stored
 * @returns {string} the plaintext, for the ONE provider call that needs it
 */
export function decryptCredential({ cipher, iv }) {
  if (!cipher || !iv) throw new Error("Kredensial game tidak lengkap.");

  const data = Buffer.from(cipher, "base64");
  const ivBuf = Buffer.from(iv, "base64");
  if (ivBuf.length !== IV_BYTES) throw new Error("IV kredensial game tidak valid.");

  // GCM appends the 16-byte tag to the stored ciphertext (see encryptCredential).
  if (data.length < 16) throw new Error("Kredensial game rusak.");

  const tag = data.subarray(data.length - 16);
  const body = data.subarray(0, data.length - 16);

  const decipher = createDecipheriv(ALGO, key(), ivBuf);
  decipher.setAuthTag(tag);

  try {
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  } catch {
    // Tampering, a wrong key (rotated AUTH_SECRET), or a truncated row. Never
    // distinguish them to the caller; "cannot be decrypted" is the whole
    // signal, and the recovery is the same: ask the customer to re-enter it.
    throw new Error("Kredensial game tidak dapat didekripsi. Silakan masukkan kembali.");
  }
}
