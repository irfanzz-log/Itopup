// ============================================================================
// GET /api/topup/price, the server-authoritative price for a nominal.
//
// Why this exists: the checkout form shows a struck-through list price and the
// discounted price next to it. The customer decides whether to buy based on
// that number, so it has to come from the server, the same rule the order
// will apply, and never from the client's own arithmetic.
//
// Public (no auth): a logged-out customer browsing the catalog sees the same
// price as a logged-in one. Auto discounts are not personalised.
// ============================================================================
import { route, ok, parse } from "@/lib/api.js";
import { z } from "zod";
import { AppError } from "@/lib/errors.js";
import { resolveAutoDiscount, previewCheckout } from "@/services/promo.service.js";
import { getSellableVariant } from "@/services/catalog.service.js";
import { getPaymentMethod } from "@/config/payment";
import { formatIDR } from "@/lib/format";
import { prisma } from "@/lib/db.js";

const querySchema = z.object({
  variantId: z.string().uuid("ID nominal tidak valid."),
  // Optional, so the same endpoint feeds both the nominal grid (no voucher) and
  // the summary rail (with the customer's chosen voucher).
  voucherClaimId: z.string().uuid().optional(),
  paymentMethod: z.string().trim().min(2).max(40).optional(),
});

export const GET = route(async (req, _ctx, { log }) => {
  const url = new URL(req.url);
  const input = parse(querySchema, Object.fromEntries(url.searchParams.entries()));

  // The variant must be sellable, a disabled nominal must not advertise a
  // price, even a discounted one.
  const variant = await getSellableVariant(input.variantId);
  if (!variant) {
    throw new AppError("ITP_PRODUCT_UNAVAILABLE", "Nominal tidak tersedia.");
  }

  // A voucher preview needs the session. Anonymous callers get the auto
  // discount only, which is everything a logged-out customer can see anyway.
  let userId = null;
  try {
    const { requireAuth } = await import("@/lib/auth/guards.js");
    const user = await requireAuth(req);
    userId = user.id;
  } catch {
    // Not logged in: voucher preview is simply unavailable, not an error.
  }

  // The payment method decides the admin fee, but the admin fee is NOT part of
  // this preview. It is computed at checkout, after the customer picks a
  // method. Showing it here means the number changes again at payment, which
  // reads as a hidden charge. See previewCheckout for the rationale.
  if (input.paymentMethod) {
    // still validate it, so a typo is reported instead of silently ignored
    getPaymentMethod(input.paymentMethod);
  }

  const preview = await previewCheckout({
    variant,
    voucherClaimId: input.voucherClaimId ?? null,
    userId,
  });

  log.info("topup.price", {
    variantId: variant.id,
    autoDiscount: preview.autoDiscount,
    voucherDiscount: preview.voucherDiscount,
    voucherClaimId: input.voucherClaimId ?? null,
  });

  return ok(
    {
      variantId: variant.id,
      normal: preview.normal,
      // Kept for the nominal grid: the price the customer sees on the tile
      // before any voucher is applied.
      final: preview.afterAuto,
      discount: preview.autoDiscount,
      hasDiscount: preview.autoDiscount > 0,
      promo: preview.autoPromo
        ? { title: preview.autoPromo.title, slug: preview.autoPromo.slug, discountType: preview.autoPromo.discountType, discountValue: preview.autoPromo.discountValue }
        : null,
      normalLabel: formatIDR(preview.normal),
      finalLabel: formatIDR(preview.afterAuto),
      autoDiscount: { promo: preview.autoPromo, discount: preview.autoDiscount },
      // ── Simulasi total (tanpa biaya admin) ─────────────────────────────
      // Biaya admin dihitung server-side saat pembayaran, tergantung metode
      // yang dipilih. Di fase pemilihan nominal kita hanya tunjukkan potongan
      // diskon + total sebelum biaya, supaya tidak ada perubahan harga
      // mendadak yang membingungkan customer.
      voucherDiscount: preview.voucherDiscount,
      voucherPromo: preview.voucherPromo,
      voucherEligible: preview.voucherEligible,
      voucherReason: preview.voucherReason,
      voucherDiscountLabel: formatIDR(preview.voucherDiscount),
      afterVoucherLabel: formatIDR(preview.afterVoucher),
      total: preview.total,
      totalLabel: formatIDR(preview.total),
    },
    { req },
  );
});
