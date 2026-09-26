// End-to-end check of the SKU swap against the live provider + live database.
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env"), override: true, quiet: true });
import { describe, it } from "vitest";
import { prisma } from "@/lib/db.js";
import { getVariantSkuStatus, reassignVariantSku } from "@/services/admin-catalog.service.js";

describe("ops: live reassign", () => {
  it("swaps a linked variant to another in-stock SKU", async () => {
    const variant = await prisma.productVariant.findFirst({
      where: { name: "5 Diamonds", providerProducts: { some: {} } },
      select: { id: true, name: true, costPrice: true, sellingPrice: true,
        providerProducts: { select: { providerCode: true, providerPrice: true } } },
    });
    if (!variant) { console.log("[ops] no variant"); return; }
    const before = variant.providerProducts[0];
    console.log(`\n[ops] BEFORE: sku=${before.providerCode} cost=${variant.costPrice} sell=${variant.sellingPrice}`);

    const status = await getVariantSkuStatus({ variantId: variant.id });
    const alt = status.inStockAlternates[0];
    if (!alt) { console.log("[ops] no in-stock alternate available"); return; }
    console.log(`[ops] swap target: ${alt.providerCode} @ ${alt.price}`);

    const result = await reassignVariantSku({
      variantId: variant.id,
      providerCode: alt.providerCode,
      actor: { id: "ops-script", role: "SUPERADMIN" },
    });
    console.log(`[ops] AFTER: fromSku=${result.fromSku} toSku=${result.toSku} cost=${result.costPrice} sell=${result.sellingPrice} pinned=${result.pricePinned}`);

    // Restore the original link so this script is idempotent.
    const back = await reassignVariantSku({
      variantId: variant.id,
      providerCode: before.providerCode,
      actor: { id: "ops-script", role: "SUPERADMIN" },
    });
    console.log(`[ops] RESTORED: toSku=${back.toSku} cost=${back.costPrice}`);
  }, 600_000);
});
