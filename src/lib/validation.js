// ============================================================================
// Validation layer: Zod schemas + helpers.
//
// Every schema here is used SERVER-SIDE. The same schema may also be imported by
// a client form for instant feedback, which is fine: the client copy is a UX
// nicety, the server copy is the contract.
//
// Nothing here ever trusts a client-supplied price, status, role, or provider
// code; those are rejected by `.strict()` object shapes rather than silently
// ignored, so an attempted override fails loudly in tests.
// ============================================================================
import { z } from "zod";
import { AppError } from "./errors.js";

// ── Primitives ──────────────────────────────────────────────────────────────

export const email = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(255)
  .email("Format email tidak valid.");

export const password = z
  .string()
  .min(8, "Password minimal 8 karakter.")
  .max(128, "Password maksimal 128 karakter.")
  // bcrypt silently truncates at 72 bytes; refusing long input is friendlier
  // than accepting it and hashing only part of it.
  .refine((v) => Buffer.byteLength(v, "utf8") <= 72, "Password terlalu panjang.");

export const uuid = z.string().uuid("ID tidak valid.");

export const slug = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9-]+$/, "Slug hanya boleh berisi huruf kecil, angka, dan tanda hubung.");

export const phoneId = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s\-().]/g, ""))
  .refine((v) => /^(\+62|62|0)8[1-9][0-9]{6,11}$/.test(v), {
    message: "Nomor HP Indonesia tidak valid.",
  })
  .transform((v) => {
    // Normalise to the local 08… form; adapters convert to whatever the
    // provider expects. Storing one canonical shape keeps lookups reliable.
    if (v.startsWith("+62")) return `0${v.slice(3)}`;
    if (v.startsWith("62")) return `0${v.slice(2)}`;
    return v;
  });

/**
 * Player/user id as it appears in game top-up forms. Deliberately permissive on
 * the character class; the real format is game-specific and enforced by
 * per-game patterns in src/config/games.js, but strict on length and on
 * rejecting anything that could be used for injection or log forging.
 */
export const playerId = z
  .string()
  .trim()
  .min(4, "User ID minimal 4 karakter.")
  .max(32, "User ID maksimal 32 karakter.")
  .regex(/^[A-Za-z0-9._@-]+$/, "User ID mengandung karakter yang tidak diizinkan.");

export const zoneId = z
  .string()
  .trim()
  .min(1, "Zone ID wajib diisi.")
  .max(16, "Zone ID maksimal 16 karakter.")
  .regex(/^[A-Za-z0-9-]+$/, "Zone ID mengandung karakter yang tidak diizinkan.");

export const invoice = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^ITP-\d{8}-[A-Z0-9]{8}$/, "Format invoice tidak valid.");

export const idempotencyKey = z
  .string()
  .trim()
  .min(16, "Idempotency key terlalu pendek.")
  .max(80)
  .regex(/^[A-Za-z0-9._:-]+$/, "Idempotency key mengandung karakter yang tidak diizinkan.");

export const pagination = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ── Auth ────────────────────────────────────────────────────────────────────

export const registerSchema = z
  .object({
    name: z.string().trim().min(2, "Nama minimal 2 karakter.").max(100),
    email,
    password,
    // Optional so the form stays short; used for order notifications later.
    phone: phoneId.optional(),
  })
  .strict();

export const loginSchema = z
  .object({
    email,
    // No length rule beyond a sane ceiling: rejecting a short password here
    // would tell an attacker the real one is longer.
    password: z.string().min(1, "Password wajib diisi.").max(128),
  })
  .strict();

export const registerOtpSchema = z
  .object({
    email,
    code: z.string().trim().regex(/^\d{6}$/, "Kode harus 6 angka."),
  })
  .strict();

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: password,
  })
  .strict();

export const profileUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    phone: phoneId.optional(),
  })
  .strict();

// ── Top-up / order ──────────────────────────────────────────────────────────

/**
 * Account validation request. `fields` is an arbitrary key→value map whose
 * allowed keys are decided by the game's `inputFields` config; the service
 * validates each entry against that contract, so an attacker cannot smuggle
 * extra keys into the provider call.
 */
export const validateAccountSchema = z
  .object({
    gameSlug: slug,
    fields: z.record(z.string().max(32), z.string().trim().min(1).max(64)),
  })
  .strict();

/**
 * Checkout request.
 *
 * Note what is ABSENT: price, total, discount, fee, providerCode, status.
 * The server recomputes all of them. A client that sends them is rejected by
 * `.strict()` rather than silently having its numbers ignored.
 *
 * CREDENTIALS: a game whose provider flow requires the customer's own login
 * (Game.needsGameLogin) sends its secret under `fields.gamePassword`. It is
 * validated but never persisted; the service moves it into the encrypted
 * GameCredential store and stores only the row id on the order. `credentialId`
 * is for a returning customer reusing a stored login; `saveCredential` opts the
 * current login into being stored.
 */
export const checkoutSchema = z
  .object({
    variantId: uuid,
    fields: z.record(z.string().max(32), z.string().trim().min(1).max(128)),
    promoCode: z.string().trim().toUpperCase().min(3).max(40).optional(),
    // A voucher claim from "Voucher Saya". Mutually exclusive with promoCode in
    // practice (one promo per order), but both are validated server-side.
    voucherClaimId: uuid.optional(),
    // Reuse a previously stored game login for this game. The row is scoped to
    // the requesting user server-side; an id from another user is not found.
    credentialId: uuid.optional(),
    // Store this game login for reuse next time. Opt-in per checkout: the
    // customer decides whether this platform keeps the credential.
    saveCredential: z.boolean().optional(),
    paymentMethod: z.string().trim().min(2).max(40),
    idempotencyKey,
  })
  .strict();

export const orderStatusSchema = z
  .object({
    status: z.enum([
      "PENDING_PAYMENT", "PAYMENT_PROCESSING", "PAID", "PROCESSING",
      "SUCCESS", "FAILED", "REFUND", "EXPIRED", "CANCELLED",
    ]),
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

// ── Admin ───────────────────────────────────────────────────────────────────

export const memberBlockSchema = z
  .object({
    reason: z.string().trim().min(3, "Alasan blokir wajib diisi.").max(500),
  })
  .strict();

export const memberRoleSchema = z
  .object({
    role: z.enum(["MEMBER", "DEV", "SUPERADMIN"]),
  })
  .strict();

export const adminResetPasswordSchema = z
  .object({
    newPassword: password,
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

const promoBaseSchema = z
  .object({
    title: z.string().trim().min(3).max(200),
    slug,
    description: z.string().trim().max(2000).optional(),
    image: z.string().trim().url().max(500).optional(),
    discountType: z.enum(["FIXED", "PERCENT"]),
    discountValue: z.number().int().min(1).max(100_000_000),
    maxDiscount: z.number().int().min(0).max(100_000_000).optional(),
    minSpend: z.number().int().min(0).max(100_000_000).default(0),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    isActive: z.boolean().default(true),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .min(3)
      .max(40)
      .regex(/^[A-Z0-9-]+$/, "Kode promo hanya boleh huruf, angka, dan tanda hubung.")
      .optional(),
    usageLimit: z.number().int().min(1).max(1_000_000).nullable().optional(),
    perUserLimit: z.number().int().min(1).max(100).nullable().optional(),

    // ── Scope: what does this promo apply to? ─────────────────────────────
    // Exactly one of the four target ids, and it must match `scope`.
    scope: z.enum(["ALL", "CATEGORY", "GAME", "PRODUCT", "VARIANT"]).default("ALL"),
    categoryId: uuid.nullable().optional(),
    gameId: uuid.nullable().optional(),
    productId: uuid.nullable().optional(),
    variantId: uuid.nullable().optional(),

    // ── Distribution: code, or applied automatically? ──────────────────────
    // AUTO = "diskon manual": no code needed, applied to every eligible
    // purchase inside its window. VOUCHER = must be claimed (or its code typed)
    // at checkout.
    distribution: z.enum(["AUTO", "VOUCHER"]).default("VOUCHER"),

    // ── Visibility: is this voucher listed publicly? ──────────────────────
    // PUBLIC appears on /promo and on the claimable shelf. HIDDEN is usable
    // only by typing its code; the operator distributes the code themselves.
    // Default PUBLIC so a voucher created through any path that omits the
    // field keeps appearing where vouchers appeared before this existed.
    visibility: z.enum(["PUBLIC", "HIDDEN"]).default("PUBLIC"),

    // ── Voucher audience: who is allowed to claim it? ──────────────────────
    // NEW_CUSTOMER resolves against COMPLETED orders, not signups: "10 user
    // baru" = 10 customers who have never completed a transaction.
    audience: z.enum(["ALL_USERS", "NEW_CUSTOMER", "LOYAL_CUSTOMER"]).default("ALL_USERS"),
    // LOYAL_CUSTOMER: at least this many completed orders.
    minCompletedOrders: z.number().int().min(0).max(1_000).default(0),
    // VOUCHER-only. How many people may claim this voucher in total.
    claimLimit: z.number().int().min(1).max(1_000_000).nullable().optional(),
  })
  .strict();

// Zod 4 removed `.innerType()` (the Zod 3 `ZodEffects` unwrap). The refinements
// are therefore attached to a DERIVED schema instead of being chained onto the
// one we need to reuse, so the base object stays available for `.partial()`.
export const promoCreateSchema = promoBaseSchema
  // A scope that names no target applies to nothing. Catching it here gives the
  // operator a field-level error instead of a promo that silently never fires.
  .refine((v) => targetForScope(v.scope, v) != null || v.scope === "ALL", {
    message: "Pilih kategori/game/produk/nominal untuk scope ini.",
    path: ["scope"],
  })
  .refine((v) => onlyOneTarget(v), {
    message: "Hanya satu target yang boleh dipilih per promo.",
    path: ["scope"],
  })
  .refine((v) => v.endsAt > v.startsAt, {
    message: "Tanggal berakhir harus setelah tanggal mulai.",
    path: ["endsAt"],
  });

export const promoUpdateSchema = promoBaseSchema.partial();

// `scope` points at exactly one target column; this returns the id written into
// it, or null when none is set.
function targetForScope(scope, values) {
  switch (scope) {
    case "CATEGORY": return values.categoryId ?? null;
    case "GAME": return values.gameId ?? null;
    case "PRODUCT": return values.productId ?? null;
    case "VARIANT": return values.variantId ?? null;
    default: return null;
  }
}

// Exactly one target set at a time. Two set at once would make the resolution
// order a silent policy decision; reject it instead.
function onlyOneTarget(values) {
  const set = [
    values.categoryId ?? null,
    values.gameId ?? null,
    values.productId ?? null,
    values.variantId ?? null,
  ].filter((v) => v !== null);
  return set.length <= 1;
}

export const variantUpdateSchema = z
  .object({
    sellingPrice: z.number().int().min(0).max(1_000_000_000).optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().min(-10_000).max(10_000).optional(),
  })
  .strict();

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Parse or throw a 422 AppError carrying field-level details.
 * The details are safe to show: they name a field and a rule, never a value.
 */
export function parse(schema, data, { code = "ITP_VALIDATION_ERROR" } = {}) {
  const result = schema.safeParse(data);
  if (result.success) return result.data;

  const details = result.error.issues.slice(0, 10).map((issue) => ({
    field: issue.path.join(".") || "_root",
    message: issue.message,
  }));

  throw new AppError(code, details[0]?.message || "Data tidak valid.", { details });
}

/** Non-throwing variant for places that need to branch (webhook payloads). */
export function tryParse(schema, data) {
  const result = schema.safeParse(data);
  return result.success ? { ok: true, data: result.data } : { ok: false, error: result.error };
}

export { z };
