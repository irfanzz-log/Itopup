// ============================================================================
// Email one-time codes.
//
// A register flow asks for a code, we generate one, store only its hash, and
// email the plaintext to the address the user just claimed. Storing the hash is
// the whole point: a read of this table is not a read of valid codes.
//
// WHY A HASH AND NOT THE PLAINTEXT
//
//   The code is a short secret (6 digits, 1e6 space). If it were stored as-is,
//   a SQL dump, a misconfigured log, or an admin with read access to the table
//   would be enough to take over any unverified account. A hash means the
//   plaintext exists in exactly two places: the user's inbox, and the request
//   that verifies it.
//
// WHY THE ROW PERSISTS AFTER USE
//
//   `consumedAt` marks a code spent instead of deleting it, so a replay attempt
//   can be distinguished from a first attempt, and so an audit trail survives.
//   Rows are reaped by the expiresAt index when expired and unused.
// ============================================================================
import { createHash, randomInt } from "node:crypto";
import { prisma } from "../lib/db.js";
import { AppError } from "../lib/errors.js";
import { sendMail, isMailConfigured } from "../lib/mail.js";
import { optional } from "../lib/env.server.js";

/** Validity window. 10 minutes: short enough that a leaked code goes stale,
 * long enough that an email delayed by a minute or two still works. */
const TTL_MINUTES = 10;

/** Ceiling on wrong submissions per code before the code is burned. */
const MAX_ATTEMPTS = 5;

const APP_NAME = optional("NEXT_PUBLIC_APP_NAME") ?? "ITOPUP";

/** sha256 hex, the same shape as the session token hash. */
function hashCode(code) {
  return createHash("sha256").update(code).digest("hex");
}

/**
 * Generate a 6-digit code. Uses `randomInt`, not `Math.random()`: the latter is
 * not crypto-strong, and for a 6-digit space a weak RNG plus a billion guesses
 * is a real attack.
 *
 * @returns {string} a zero-padded 6-digit string
 */
export function generateOtp() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * Issue a code for a subject + purpose, replacing any existing one.
 *
 * @param {Object} input
 * @param {string} input.subject  the email address the code is for
 * @param {"REGISTER"} input.purpose
 * @param {string|null} [input.ip]  request IP, stored for rate-limit forensics
 * @param {Object|null} [payload]  data to carry to the confirmation step
 * @returns {Promise<string>} the plaintext code, to be emailed by the caller
 */
export async function issueOtp({ subject, purpose, ip = null, payload = null }) {
  const code = generateOtp();
  const expiresAt = new Date(Date.now() + TTL_MINUTES * 60 * 1000);

  // upsert, not create: exactly one live row per (subject, purpose), so a
  // re-send invalidates the previous code instead of multiplying the chances.
  await prisma.emailOtp.upsert({
    where: { subject_purpose: { subject, purpose } },
    create: { subject, purpose, codeHash: hashCode(code), expiresAt, ip, payload },
    update: { codeHash: hashCode(code), expiresAt, ip, attempts: 0, consumedAt: null, payload },
  });

  return code;
}

/**
 * Send a register verification email.
 *
 * @param {Object} input
 * @param {string} input.to
 * @param {string} input.code
 * @returns {Promise<boolean>} false when SMTP is not configured or rejected it
 */
export async function sendOtpEmail({ to, code }) {
  const minutes = TTL_MINUTES;
  const html = `<!doctype html>
<html lang="id">
  <body style="margin:0;padding:0;background:#f4f4f5;font-family:ui-sans-serif,system-ui,sans-serif">
    <div style="max-width:480px;margin:0 auto;padding:24px 16px">
      <div style="background:#fff;border:1px solid #e4e4e7;border-radius:12px;padding:24px">
        <h1 style="margin:0 0 4px;font-size:18px;color:#18181b">Verifikasi email ${APP_NAME}</h1>
        <p style="margin:0 0 20px;color:#71717a;font-size:14px">Masukkan kode ini untuk menyelesaikan pendaftaran:</p>
        <div style="background:#f4f4f5;border-radius:8px;padding:16px;text-align:center">
          <span style="font-size:32px;font-weight:700;letter-spacing:8px;color:#18181b">${code}</span>
        </div>
        <p style="margin:16px 0 0;color:#71717a;font-size:13px">Kode berlaku ${minutes} menit. Jangan bagikan kode ini kepada siapa pun.</p>
      </div>
      <p style="margin:16px 0 0;text-align:center;color:#a1a1aa;font-size:12px">Email ini dikirim otomatis. Jika Anda tidak merasa mendaftar, abaikan saja.</p>
    </div>
  </body>
</html>`;

  return sendMail({
    to,
    subject: `Kode verifikasi ${APP_NAME}: ${code}`,
    html,
    text: `Kode verifikasi ${APP_NAME} Anda adalah ${code}. Berlaku ${minutes} menit.`,
  });
}

/**
 * Verify a submitted code and return the row, so the caller can act on the
 * payload it stored. Throws AppError on every failure path so the route
 * returns a precise status rather than a generic 500.
 *
 * @param {Object} input
 * @param {string} input.subject
 * @param {"REGISTER"} input.purpose
 * @param {string} input.code  the plaintext the user typed
 * @returns {Promise<Object>} the consumed row
 */
export async function verifyOtp({ subject, purpose, code }) {
  const row = await prisma.emailOtp.findUnique({
    where: { subject_purpose: { subject, purpose } },
  });

  // No row means no code was ever issued for this address, which means the
  // caller skipped the send step. Report it as "not sent", not "wrong".
  if (!row) {
    throw new AppError("ITP_OTP_NOT_SENT", "Belum ada kode yang dikirim ke email ini.");
  }

  if (row.consumedAt) {
    throw new AppError("ITP_OTP_ALREADY_USED", "Kode sudah pernah dipakai. Minta kode baru.");
  }

  if (row.expiresAt.getTime() <= Date.now()) {
    throw new AppError("ITP_OTP_EXPIRED", "Kode sudah kedaluwarsa. Minta kode baru.");
  }

  // Increment first, then compare: the attempt count must reflect this
  // submission even if this check throws.
  const attempts = row.attempts + 1;
  await prisma.emailOtp.update({
    where: { id: row.id },
    data: { attempts },
  });

  if (attempts > MAX_ATTEMPTS) {
    throw new AppError(
      "ITP_OTP_TOO_MANY_ATTEMPTS",
      "Terlalu banyak percobaan salah. Minta kode baru.",
    );
  }

  // Timing-safe comparison would be marginal here (constant-length hex digests,
  // attacker-rate-limited), but a plain inequality on hashes is honest: the
  // digest is fixed-width, so there is no length oracle and no early exit on
  // the secret itself.
  if (hashCode(code) !== row.codeHash) {
    throw new AppError("ITP_OTP_INVALID", "Kode salah.");
  }

  // Burn the code so it cannot be replayed.
  await prisma.emailOtp.update({
    where: { id: row.id },
    data: { consumedAt: new Date() },
  });

  return row;
}

/**
 * True when mail is ready to send codes. Registration calls this before doing
 * any work so a misconfigured deploy fails with an actionable message instead
 * of a silent email that never arrives.
 *
 * @returns {boolean}
 */
export function isOtpReady() {
  return isMailConfigured();
}

/** Exported for tests that need to compute the digest of a known code. */
export const __hashForTests = hashCode;
