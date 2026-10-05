// ============================================================================
// /api/dev/products, catalogue mutations from the admin panel.
//
// Actions:
//   update_price, set a variant's selling price (absolute rupiah)
//   reassign_sku, re-point a variant at a different provider SKU
//   delete, remove a variant, or a product and its variants
//
// WHY THE PRICE IS NEVER TRUSTED FROM THE CLIENT
//
// `sellingPrice` is what the order service charges. A client-side number that
// reached the database unvalidated would be a price an attacker could set to
// 1. Validation here is defense in depth, not the only gate, the checkout
// re-reads the row from the database inside its transaction.
//
// WHY reassign_sku VALIDATES AGAINST THE LIVE PROVIDER
//
// The operator is picking from a list of SKUs the provider currently lists. A
// code that is not on that list, or is on it but out of stock, is rejected
// rather than written, a successful write that leaves the variant unbuyable is
// worse than a clear error, because it looks fixed in the admin panel.
//
// AUDIT: every action writes an AuditLog row with the before/after values.
// A price or SKU change is a financial event.
// ============================================================================
import { route, ok, readJson, guardMutation, requestContext, bucket, parse } from "@/lib/api.js";
import { presets } from "@/lib/rate-limit.js";
import { requireStaff } from "@/lib/auth/guards.js";
import { AppError } from "@/lib/errors.js";
import { uuid } from "@/lib/validation.js";
import { z } from "zod";
import {
  updateVariantPrice,
  reassignVariantSku,
  deleteCatalogEntry,
  getVariantSkuStatus,
} from "@/services/admin-catalog.service.js";

const schema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("update_price"),
      variantId: uuid,
      sellingPrice: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      action: z.literal("reassign_sku"),
      variantId: uuid,
      providerCode: z.string().trim().min(2).max(60).toLowerCase(),
    })
    .strict(),
  z
    .object({
      action: z.literal("delete"),
      variantId: uuid.optional(),
      productId: uuid.optional(),
    })
    .strict(),
]);

export const GET = route(async (req, ctx, { log }) => {
  const { searchParams } = new URL(req.url);
  const variantId = searchParams.get("variantId");

  // The SKU candidate list is the one admin read that contacts the provider,
  // it needs the same guard as a mutation, just with the read-only budget.
  await requireStaff(req);
  await guardMutation(req, {
    rateLimit: [bucket("admin", presets.admin, { userId: "sku-candidates" })],
    log,
  });

  if (!variantId) {
    throw new AppError("ITP_VALIDATION_ERROR", "Parameter variantId wajib diisi.");
  }

  const status = await getVariantSkuStatus({ variantId, log });
  return ok(status, { req });
});

export const POST = route(async (req, _ctx, { log }) => {
  const requestCtx = requestContext(req);
  const body = await readJson(req, { maxBytes: 16 * 1024 });

  const actor = await requireStaff(req);

  await guardMutation(req, {
    rateLimit: [bucket("admin", presets.admin, { userId: actor.id })],
    log,
  });

  const input = parse(schema, body);

  log.info("dev.product_action", { action: input.action, actorId: actor.id });

  switch (input.action) {
    case "update_price": {
      const variant = await updateVariantPrice({
        variantId: input.variantId,
        sellingPrice: input.sellingPrice,
        actor,
        request: requestCtx,
      });
      return ok({ variant }, { req });
    }

    case "reassign_sku": {
      const result = await reassignVariantSku({
        variantId: input.variantId,
        providerCode: input.providerCode,
        actor,
        request: requestCtx,
      });
      return ok({ result }, { req });
    }

    case "delete": {
      if (!input.variantId && !input.productId) {
        throw new AppError("ITP_VALIDATION_ERROR", "Variant atau produk harus ditentukan.");
      }
      const result = await deleteCatalogEntry({
        variantId: input.variantId,
        productId: input.productId,
        actor,
        request: requestCtx,
      });
      return ok({ result }, { req });
    }

    default:
      // discriminatedUnion makes this unreachable; kept so a future schema
      // addition cannot fall through to a silent 200.
      throw new AppError("ITP_BAD_REQUEST", `Aksi tidak dikenali: ${input.action}`);
  }
});
