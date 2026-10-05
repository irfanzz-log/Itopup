// ============================================================================
// /api/member/credentials, the stored game logins the customer owns.
//
// GET    list the logins for one game (login + timestamps only)
// DELETE remove one stored login
//
// SECURITY CONTRACT
//
//   * `userId` comes from the session and is part of every database `where`.
//     A credential id belonging to another user is simply not found, and the
//     response is identical to the id never having existed, no oracle.
//   * The ciphertext is never returned. GET exposes only { id, login,
//     lastUsedAt, createdAt } (see SAFE_SELECT in the credential service), and
//     DELETE deletes; neither endpoint can decrypt.
//   * The response never carries the secret, so `readJson`/`ok` sizes stay
//     small and no log line this route emits can leak one.
// ============================================================================
import { route, ok, readJson, guardMutation, requestContext, bucket } from "@/lib/api.js";
import { presets } from "@/lib/rate-limit.js";
import { slug, uuid, parse } from "@/lib/validation.js";
import { z } from "@/lib/validation.js";
import { requireAuth } from "@/lib/auth/guards.js";
import {
  listGameCredentials,
  deleteGameCredential,
} from "@/services/credential.service.js";

const listSchema = z
  .object({
    gameSlug: slug,
  })
  .strict();

const deleteSchema = z
  .object({
    id: uuid,
  })
  .strict();

export const dynamic = "force-dynamic";

export const GET = route(async (req, _ctx, { log }) => {
  const user = await requireAuth(req);

  const { searchParams } = new URL(req.url);
  const { gameSlug } = parse(listSchema, {
    gameSlug: searchParams.get("gameSlug") ?? undefined,
  });

  const credentials = await listGameCredentials({ userId: user.id, gameSlug });

  log.debug("member.credentials_listed", { userId: user.id, gameSlug, count: credentials.length });

  return ok({ credentials }, { req });
});

export const DELETE = route(async (req, _ctx, { log }) => {
  const ctx = requestContext(req);
  const body = await readJson(req, { maxBytes: 4 * 1024 });

  const user = await requireAuth(req);

  await guardMutation(req, {
    rateLimit: [bucket("credential", presets.def, { userId: user.id }), bucket("credential", presets.def, { ip: ctx.ip })],
    log,
  });

  const { id } = parse(deleteSchema, body);

  const deleted = await deleteGameCredential({ userId: user.id, credentialId: id });

  log.info("member.credential_deleted", { userId: user.id, credentialId: id, deleted });

  // Same answer whether or not the row existed: telling a caller "that id was
  // not yours" would confirm which ids are real.
  return ok({ deleted }, { req });
});
