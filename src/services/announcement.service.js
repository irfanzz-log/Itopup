// ============================================================================
// Announcement / maintenance banner.
//
// A single AppSetting row carries the message the operator wants every visitor
// to see. It is read at request time by the public layout, so flipping it in
// /dev/announcements shows up on the next page load without a deploy.
//
// WHY AN AppSetting ROW, not an env var or a hardcoded string
//
//   An env change needs a rebuild and a redeploy, which is exactly what you
//   cannot do when the reason for the banner is a live incident. A DB row is
//   writable from the admin panel in one click and applies immediately.
//
// THE OFF SWITCH
//
//   `enabled: false` keeps the row but hides it, so an operator who flips a
//   banner on and off does not retype the message each time. Deleting the row
//   also works; readAnnouncement() treats "no row" and "disabled row" the same.
//
// WHAT THE BANNER CAN AND CANNOT DO
//
//   The banner is an announcement, not a lock. Setting it does not by itself
//   stop a checkout. Callers that must honour the maintenance window check
//   `isCheckoutPaused()` separately, because a banner a customer cannot act on
//   ("transactions are off") would be a lie while the button still works.
// ============================================================================
import { prisma } from "../lib/db.js";

const KEY = "announcement";

/**
 * The stored shape.
 *
 * @typedef {Object} Announcement
 * @property {boolean} enabled   Whether it is currently displayed.
 * @property {"info"|"warning"|"error"} tone  Severity, drives colour + icon.
 * @property {string} title      Short headline. Required when enabled.
 * @property {string|null} body  Optional supporting line.
 * @property {boolean} pauseCheckout  When true, checkout also refuses orders.
 * @property {string|null} updatedAt  ISO timestamp of the last edit.
 */

/**
 * Read the announcement for display.
 *
 * @returns {Promise<Announcement|null>} the live announcement, or null when
 *   there is no row, the row is disabled, or the shape is unusable. Returning
 *   null is what lets the public layout skip the banner entirely.
 */
export async function readAnnouncement() {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: KEY } });
    if (!row) return null;

    const value = row.value ?? {};
    if (!value || typeof value !== "object") return null;
    if (!value.enabled) return null;

    // A banner with no headline is not an announcement, it is a stray row.
    const title = typeof value.title === "string" ? value.title.trim() : "";
    if (!title) return null;

    return {
      enabled: true,
      tone: value.tone === "warning" || value.tone === "error" ? value.tone : "info",
      title,
      body: typeof value.body === "string" && value.body.trim() ? value.body.trim() : null,
      pauseCheckout: value.pauseCheckout === true,
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : null,
    };
  } catch {
    // A DB failure must never take the public site down over a banner. The
    // layout skips it and the page still renders.
    return null;
  }
}

/**
 * True when checkout must refuse new orders.
 *
 * Kept separate from readAnnouncement() because the two callers want different
 * failure modes: the layout wants "no banner" on error, the order route wants
 * a hard "not paused" default so an AppSetting outage does not stop trade.
 *
 * @returns {Promise<boolean>}
 */
export async function isCheckoutPaused() {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: KEY } });
    if (!row) return false;
    return row.value?.pauseCheckout === true && row.value?.enabled !== false;
  } catch {
    return false;
  }
}

/**
 * Save the announcement. An empty title disables it.
 *
 * @param {Object} input
 * @param {boolean} input.enabled
 * @param {"info"|"warning"|"error"} input.tone
 * @param {string} input.title
 * @param {string|null} [input.body]
 * @param {boolean} [input.pauseCheckout]
 * @returns {Promise<Object>} the stored value
 */
export async function writeAnnouncement({
  enabled,
  tone,
  title,
  body = null,
  pauseCheckout = false,
}) {
  const value = {
    enabled: enabled === true,
    tone: tone === "warning" || tone === "error" ? tone : "info",
    title: typeof title === "string" ? title.trim() : "",
    body: typeof body === "string" && body.trim() ? body.trim() : null,
    pauseCheckout: pauseCheckout === true,
  };

  // An empty title cannot be displayed, so the row is stored disabled rather
  // than dropped: the operator's draft survives for next time.
  if (!value.title) value.enabled = false;

  await prisma.appSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value },
    update: { value },
  });

  return value;
}

/**
 * Remove the announcement entirely.
 *
 * Unlike writeAnnouncement({ enabled: false }), which keeps the draft, this
 * drops the row. readAnnouncement() treats "no row" and "disabled row" the
 * same, so the banner disappears either way; this is the "start from blank"
 * action, and it also clears pauseCheckout, since a checkout gate with no
 * banner would refuse orders silently.
 *
 * @returns {Promise<boolean>} true when a row was actually removed
 */
export async function deleteAnnouncement() {
  try {
    await prisma.appSetting.delete({ where: { key: KEY } });
    return true;
  } catch (err) {
    // Prisma P2025 = row not found, which is the success case here.
    if (err?.code === "P2025") return false;
    throw err;
  }
}
