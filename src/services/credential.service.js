// ============================================================================
// Game credential service, the only module that reads or writes
// `game_credentials`.
//
// WHAT THIS IS
//
// Some games' provider flow requires the customer's OWN account login.
// eFootball on Melostore asks for {"target": "Login", "zone": "Password"}.
// The customer opts in at checkout, the login half is stored in plaintext (it
// identifies the account the way a User ID does), and the secret half is stored
// AES-256-GCM encrypted (src/lib/crypto.js), keyed off AUTH_SECRET.
//
// WHAT THIS NEVER DOES
//
//   * returns a plaintext to a caller. `resolveForDispatch` is the ONE function
//     that decrypts, and it hands the value to the single provider call that
//     needs it. Every other consumer gets `{ id, login }` at most.
//   * writes a plaintext to the database, a TransactionLog, or a log line.
//   * reads a row that does not belong to the requesting user. `userId` is
//     part of every `where`, so a credential id from another account is simply
//     not found (the same IDOR discipline as /api/orders/[id]).
//
// WHY LOGIN IS PLAINTEXT AND THE SECRET IS NOT
//
// The login identifies the account; the secret grants access to it. Showing the
// login back is how the customer recognises which stored login this is, the
// same reason Order.customerInput shows a player id. Storing the login
// encrypted would add a key dependency to a value that is not a secret, and
// would mean the "which login is this?" list could not render without
// decrypting anything.
// ============================================================================
import "server-only";

import { prisma } from "../lib/db.js";
import { encryptCredential, decryptCredential } from "../lib/crypto.js";
import { AppError } from "../lib/errors.js";

/** The fields a UI may show. Never includes the ciphertext helpers. */
const SAFE_SELECT = {
  id: true,
  login: true,
  lastUsedAt: true,
  createdAt: true,
};

/**
 * Logins the user has stored for one game, newest-used first.
 *
 * @param {{ userId: string, gameId: string }} input
 * @returns {Promise<Array<{ id: string, login: string, lastUsedAt: Date|null, createdAt: Date }>>}
 */
export async function listGameCredentials({ userId, gameId }) {
  if (!userId || !gameId) return [];
  return prisma.gameCredential.findMany({
    where: { userId, gameId },
    select: SAFE_SELECT,
    orderBy: [{ lastUsedAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }],
  });
}

/**
 * Store (or refresh) a game login for a user.
 *
 * The row is keyed on (userId, gameId, login): re-saving the same login
 * re-encrypts the secret with a fresh IV rather than creating a second row.
 * A customer with several accounts on the same game keeps several rows.
 *
 * @param {{ userId: string, gameId: string, login: string, secret: string }} input
 * @returns {Promise<{ id: string, login: string }>} the stored row, never the secret
 */
export async function saveGameCredential({ userId, gameId, login, secret }) {
  if (!userId || !gameId) throw new AppError("ITP_INVALID_INPUT", "Kredensial game tidak lengkap.");
  if (typeof login !== "string" || !login.trim()) {
    throw new AppError("ITP_INVALID_INPUT", "Login akun game wajib diisi.");
  }
  if (typeof secret !== "string" || !secret) {
    throw new AppError("ITP_INVALID_INPUT", "Password akun game wajib diisi.");
  }

  const { cipher, iv } = encryptCredential(secret);

  const row = await prisma.gameCredential.upsert({
    where: { userId_gameId_login: { userId, gameId, login: login.trim() } },
    create: { userId, gameId, login: login.trim(), secretCipher: cipher, secretIv: iv },
    update: { secretCipher: cipher, secretIv: iv },
    select: SAFE_SELECT,
  });

  return row;
}

/**
 * Delete a stored login. Scoped to the requesting user: an id that is not
 * theirs is reported as not found rather than deleted.
 *
 * @param {{ userId: string, credentialId: string }} input
 * @returns {Promise<boolean>} true when a row was removed
 */
export async function deleteGameCredential({ userId, credentialId }) {
  if (!userId || !credentialId) return false;

  const deleted = await prisma.gameCredential.deleteMany({
    where: { id: credentialId, userId },
  });
  return deleted.count === 1;
}

/**
 * Resolve the plaintext secret for dispatch, from a stored login the user owns.
 *
 * This is the ONLY decrypt path reachable from a request. The value it returns
 * is handed straight to the provider call and dropped afterwards. Nothing
 * callers do with it may persist it (see the order service, which builds the
 * provider payload in memory and never writes the secret anywhere).
 *
 * @param {{ userId: string, credentialId: string }} input
 * @returns {Promise<{ id: string, login: string, secret: string }>}
 */
export async function resolveForDispatch({ userId, credentialId }) {
  const row = await prisma.gameCredential.findFirst({
    where: { id: credentialId, userId },
    select: { ...SAFE_SELECT, secretCipher: true, secretIv: true },
  });

  if (!row) throw new AppError("ITP_CREDENTIAL_NOT_FOUND", "Login game tersimpan tidak ditemukan.");

  const secret = decryptCredential({ cipher: row.secretCipher, iv: row.secretIv });

  // Usage signal only. Not attempts, not failures; those would turn this table
  // into an oracle for which logins are valid.
  await prisma.gameCredential
    .updateMany({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return { id: row.id, login: row.login, secret };
}

/**
 * The login identifier of a stored credential, without decrypting anything.
 *
 * Used to display which stored login an order used, and to pre-fill the login
 * field when a customer picks a stored login at checkout.
 *
 * @param {{ userId: string, credentialId: string }} input
 * @returns {Promise<{ id: string, login: string } | null>}
 */
export async function describeGameCredential({ userId, credentialId }) {
  if (!userId || !credentialId) return null;
  return prisma.gameCredential.findFirst({
    where: { id: credentialId, userId },
    select: { id: true, login: true },
  });
}
