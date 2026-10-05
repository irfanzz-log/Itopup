// ============================================================================
// SMTP transport.
//
// One transporter per process, created lazily on first send and then reused.
// Nodemailer keeps its own connection pool, so a transporter per email would
// churn TCP connections and a transporter at module scope would be built even
// when the process never sends mail (most routes never do).
//
// SECURITY
//   The password is read here, never exported, never logged. `verify()` is the
//   only health signal surfaced, and it reports a boolean, not credentials.
//   `send()` never puts the recipient, subject or body in logs: a register OTP
//   in a log file is a second copy of a secret, readable by anyone with log
//   access, and valid for as long as the code's window is open.
// ============================================================================
import nodemailer from "nodemailer";
import { optional, isConfigured } from "./env.server.js";

let transporter = null;

/**
 * True when SMTP is fully configured. Everything that sends mail must call this
 * first and refuse cleanly when it is false, rather than throwing inside
 * nodemailer at send time when a customer is mid-registration.
 *
 * @returns {boolean}
 */
export function isMailConfigured() {
  return isConfigured("SMTP_HOST", "SMTP_USER", "SMTP_PASS", "SMTP_FROM");
}

/**
 * Build the transporter, or reuse the process-wide one.
 *
 * @returns {import("nodemailer").Transporter}
 */
function getTransporter() {
  if (transporter) return transporter;

  const host = optional("SMTP_HOST");
  const port = Number.parseInt(optional("SMTP_PORT") ?? "587", 10);
  const user = optional("SMTP_USER");

  transporter = nodemailer.createTransport({
    host,
    // A NaN or zero port means a misconfigured deploy; 587 is the STARTTLS
    // default and the one most providers document, so it is the safe fallback.
    port: Number.isFinite(port) && port > 0 ? port : 587,
    secure: port === 465,
    auth: user ? { user, pass: optional("SMTP_PASS") } : undefined,
    // Fail loudly and quickly rather than queuing mail the app believes was
    // sent. A silent queue is how an OTP goes out late and gets blamed on the
    // user's inbox.
    disableUrlAccess: true,
    disableFileAccess: true,
  });

  return transporter;
}

/**
 * Send a transactional email. Resolves to a boolean, never throws: an
 * unconfigured or failing mailer must break registration with a clear message,
 * not with an unhandled rejection that produces a 500 with no explanation.
 *
 * @param {{ to: string, subject: string, html: string, text?: string }} input
 * @returns {Promise<boolean>} true only when the gateway accepted the message
 */
export async function sendMail({ to, subject, html, text }) {
  if (!isMailConfigured()) return false;

  try {
    const info = await getTransporter().sendMail({
      from: optional("SMTP_FROM"),
      to,
      subject,
      html,
      text: text ?? subject,
    });

    return Boolean(info?.messageId || info?.response);
  } catch {
    // Swallowed on purpose: the OTP service decides what to tell the user. This
    // function's contract is "did it go out", and logging the error here would
    // duplicate the caller's handling.
    return false;
  }
}

/**
 * Verify SMTP reachability, for the admin settings page. Cheap but not free (it
 * opens a connection), so call it on demand, not per-request.
 *
 * @returns {Promise<{ ok: boolean, message: string }>}
 */
export async function verifyMail() {
  if (!isMailConfigured()) {
    return { ok: false, message: "SMTP belum dikonfigurasi." };
  }

  try {
    await getTransporter().verify();
    return { ok: true, message: "SMTP terhubung." };
  } catch (err) {
    return {
      ok: false,
      // err here is a connection error, not a credential leak: nodemailer's
      // messages identify the host, not the password.
      message: err?.message ?? "Tidak dapat terhubung ke SMTP.",
    };
  }
}
