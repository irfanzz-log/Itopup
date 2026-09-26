// ============================================================================
// Password hashing.
//
// bcrypt (via bcryptjs — pure JS, no native build step) with cost 12.
// Explicitly NOT: plaintext, MD5, SHA-1, SHA-256, or a home-grown scheme.
//
// bcrypt truncates input at 72 bytes, so the validation layer rejects longer
// passwords rather than silently hashing a prefix.
// ============================================================================
import bcrypt from "bcryptjs";

/** Cost factor. 12 ≈ 250ms on current hardware — slow enough to matter, fast enough for login. */
const COST = Number(process.env.BCRYPT_COST || 12);

/** A hash of a random string, used to equalise timing when a user is absent. */
export const DUMMY_HASH =
  "$2a$12$C6UzMDM.H6dfI/f/IKcEeO1Z0I7MkVjLmQ0vJj2WJ0zQ7t9zY8X0a";

export async function hashPassword(plain) {
  if (typeof plain !== "string" || plain.length === 0) {
    throw new Error("hashPassword requires a non-empty string");
  }
  return bcrypt.hash(plain, COST);
}

export async function verifyPassword(plain, hash) {
  if (typeof plain !== "string" || typeof hash !== "string") return false;
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

/**
 * Burn the same amount of CPU as a real comparison.
 *
 * Without this, "email not found" returns in ~1ms while a real account takes
 * ~250ms — a timing oracle that enumerates registered emails. Called on the
 * user-not-found branch of login.
 */
export async function equaliseTiming() {
  try {
    await bcrypt.compare("timing-equalisation", DUMMY_HASH);
  } catch {
    /* the comparison result is irrelevant; only the elapsed time matters */
  }
}

/**
 * Password strength beyond length. Rejected at register/change-password.
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export function assessPasswordStrength(password) {
  if (typeof password !== "string") return { ok: false, message: "Password wajib diisi." };
  if (password.length < 8) return { ok: false, message: "Password minimal 8 karakter." };
  if (password.length > 128) return { ok: false, message: "Password maksimal 128 karakter." };

  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (classes < 2) {
    return {
      ok: false,
      message: "Password harus menggabungkan huruf dan angka.",
    };
  }

  // A tiny blocklist. A real deployment should swap this for a breached-password
  // corpus check (k-anonymity range query) — noted in the security checklist.
  const common = new Set([
    "password", "password1", "password123", "12345678", "123456789",
    "qwerty123", "iloveyou", "admin123", "letmein123", "itopup123",
  ]);
  if (common.has(password.toLowerCase())) {
    return { ok: false, message: "Password terlalu mudah ditebak." };
  }

  return { ok: true };
}
