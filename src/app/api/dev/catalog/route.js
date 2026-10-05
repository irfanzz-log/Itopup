// ============================================================================
// GET /api/dev/catalog?level=CATEGORY|GAME|PRODUCT|VARIANT
//
// Feeds the promo form's scope dropdown. Returns names + ids so the operator
// picks a target by name and the form sends the id, typing a UUID by hand is
// unworkable and a mistyped id silently produces a promo that never fires.
//
// Staff-only: this is the admin catalogue index, not the storefront one.
// ============================================================================
import { route, ok } from "@/lib/api.js";
import { z } from "zod";
import { prisma } from "@/lib/db.js";
import { requireStaff } from "@/lib/auth/guards.js";

const levelSchema = z.enum(["CATEGORY", "GAME", "PRODUCT", "VARIANT"]);

export const GET = route(async (req, _ctx, { log }) => {
  await requireStaff(req);

  const url = new URL(req.url);
  const level = levelSchema.parse(url.searchParams.get("level") ?? "GAME");

  let items = [];

  if (level === "CATEGORY") {
    items = await prisma.category.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    });
  } else if (level === "GAME") {
    items = await prisma.game.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, category: { select: { name: true } } },
    });
    // Show the parent category so identically named games stay distinguishable.
    items = items.map((g) => ({ id: g.id, name: g.name, label: `${g.name}${g.category ? ` (${g.category.name})` : ""}` }));
  } else if (level === "PRODUCT") {
    items = await prisma.product.findMany({
      where: { isActive: true },
      orderBy: [{ name: "asc" }],
      select: { id: true, name: true, game: { select: { name: true } } },
    });
    items = items.map((p) => ({ id: p.id, name: p.name, label: `${p.name}${p.game ? ` (${p.game.name})` : ""}` }));
  } else {
    items = await prisma.productVariant.findMany({
      where: { isActive: true },
      orderBy: [{ sellingPrice: "asc" }],
      select: {
        id: true,
        name: true,
        sellingPrice: true,
        product: { select: { name: true, game: { select: { name: true } } } },
      },
      take: 200,
    });
    // 95 variants is a long list; the parent names are what make it scannable.
    items = items.map((v) => ({
      id: v.id,
      name: v.name,
      label: `${v.product?.game?.name ?? ""} · ${v.product?.name ?? ""} · ${v.name} · ${new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(v.sellingPrice)}`,
    }));
  }

  // `label` is what the dropdown renders; categories have no parent to append.
  if (level === "CATEGORY") {
    items = items.map((c) => ({ id: c.id, name: c.name, label: c.name }));
  }

  log.info("dev.catalog", { level, count: items.length });

  return ok({ items }, { req });
});
