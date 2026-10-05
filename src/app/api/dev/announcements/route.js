// ============================================================================
// POST /api/dev/announcements — set the public announcement banner.
// DELETE /api/dev/announcements — remove it entirely.
//
// Staff-only. The body is written to a single AppSetting row; the public layout
// reads it at request time, so the next page load reflects the change.
//
// Empty title => the banner is stored disabled (draft preserved) rather than
// dropped, so an operator who clears the headline by accident does not lose the
// rest of the form. DELETE is the explicit "start from blank" action.
// ============================================================================
import { route, ok, readJson, guardMutation, requestContext, bucket } from "@/lib/api.js";
import { presets } from "@/lib/rate-limit.js";
import { requireStaff } from "@/lib/auth/guards.js";
import { writeAnnouncement, deleteAnnouncement } from "@/services/announcement.service.js";
import { z } from "zod";

// `.strict()` so a client sending fields we do not know about is rejected
// rather than silently ignored — the same rule the order route applies, for the
// same reason: a silent ignore hides a broken or hostile client.
const schema = z.object({
  enabled: z.boolean(),
  tone: z.enum(["info", "warning", "error"]),
  title: z.string().trim().max(200),
  body: z.string().trim().max(500).optional().nullable(),
  pauseCheckout: z.boolean(),
});

export const POST = route(async (req, _ctx, { log }) => {
  const ctx = requestContext(req);
  const actor = await requireStaff(req);

  await guardMutation(req, {
    rateLimit: [bucket("admin", presets.admin, { userId: actor.id })],
    log,
  });

  const body = await readJson(req, { maxBytes: 16 * 1024 });
  const result = schema.safeParse(body);
  if (!result.success) {
    return Response.json(
      { success: false, error: { code: "ITP_VALIDATION_ERROR", message: "Data pengumuman tidak valid." } },
      { status: 400 },
    );
  }
  const input = result.data;

  const stored = await writeAnnouncement({
    enabled: input.enabled,
    tone: input.tone,
    title: input.title,
    body: input.body ?? null,
    pauseCheckout: input.pauseCheckout === true,
  });

  log.info("announcement.set", {
    actorId: actor.id,
    enabled: stored.enabled,
    tone: stored.tone,
    pauseCheckout: stored.pauseCheckout,
    // The title/body themselves are operator text, not a secret, but logging
    // a banner's text on every save is noise; the flags are the signal.
  });

  return ok({ announcement: stored }, { status: 200, req: ctx });
});

export const DELETE = route(async (req, _ctx, { log }) => {
  const ctx = requestContext(req);
  const actor = await requireStaff(req);

  await guardMutation(req, {
    rateLimit: [bucket("admin", presets.admin, { userId: actor.id })],
    log,
  });

  const removed = await deleteAnnouncement();

  log.info("announcement.deleted", {
    actorId: actor.id,
    removed,
    // Same reason as the POST handler: the flags are the signal, not the text.
  });

  // 200 either way. Deleting an already-absent row is the desired end state,
  // so telling the operator "it was already gone" would be noise.
  return ok({ removed }, { status: 200, req: ctx });
});
