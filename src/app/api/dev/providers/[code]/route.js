// ============================================================================
// POST /api/dev/providers/[code], provider operations.
//
// Actions:
//   sync_catalog, pull the pricelist into the database (the only way products
//                   get created; nothing is hardcoded in the frontend)
//   dry_run, same, but writes nothing. This is the action an operator
//                   should reach for first, because a bad mapping is silent
//                   otherwise.
//   sync_balance, refresh the cached prepaid balance
//   test, credential + reachability check, no side effects
//
// All are staff-only, rate-limited, and audited. The provider credentials never
// leave the server: the response carries counts and diagnostics, never a key.
// ============================================================================
import { route, ok, readJson, guardMutation, requestContext, bucket, parse } from "@/lib/api.js";
import { presets } from "@/lib/rate-limit.js";
import { requireStaff } from "@/lib/auth/guards.js";
import { AppError } from "@/lib/errors.js";
import { z } from "zod";
import { syncProviderCatalog } from "@/services/sync.service.js";
import { syncBalance, providerDiagnostics } from "@/services/provider.service.js";
import { getTopupProvider } from "@/providers/index.js";

const schema = z
  .object({
    action: z.enum(["sync_catalog", "dry_run", "sync_balance", "test"]),
    category: z.string().trim().max(60).optional(),
  })
  .strict();

export const POST = route(async (req, ctx, { log }) => {
  const requestCtx = requestContext(req);
  const body = await readJson(req, { maxBytes: 4 * 1024 });

  const actor = await requireStaff(req);

  // A catalogue sync walks the provider's whole pricelist, so it is limited
  // harder than a normal admin action: a loop here hammers a partner API.
  await guardMutation(req, {
    rateLimit: [bucket("admin", presets.admin, { userId: actor.id })],
    log,
  });

  const { code } = await ctx.params;
  const providerCode = String(code).toLowerCase().slice(0, 40);
  const { action, category } = parse(schema, body);

  const provider = getTopupProvider(providerCode);

  log.info("dev.provider_action", { providerCode, action, actorId: actor.id });

  switch (action) {
    // ── Pull the pricelist. ───────────────────────────────────────────────
    case "sync_catalog":
    case "dry_run": {
      const dryRun = action === "dry_run";

      // A dry run must NOT require a configured provider? It does, there is
      // nothing to fetch without credentials. Report that clearly.
      if (!provider.isConfigured()) {
        const gaps = provider.configurationGaps();
        throw new AppError(
          "ITP_PROVIDER_NOT_CONFIGURED",
          `Provider belum dikonfigurasi. Variabel yang belum diisi: ${gaps.missing.join(", ") || "(tidak diketahui)"}.`
        );
      }

      const report = await syncProviderCatalog({
        category: category ?? null,
        dryRun,
        actor,
        request: requestCtx,
        log,
      });

      return ok(
        {
          dryRun,
          fetched: report.fetched,
          created: report.created,
          linked: report.linked,
          unchanged: report.unchanged,
          priceChanged: report.priceChanged,
          unavailable: report.unavailable,
          durationMs: report.durationMs,
          // Unmatched SKUs are returned so the operator can add a mapping rule.
          // Silently linking them would attach a product to the wrong game.
          unmatched: report.unmatched.slice(0, 50),
          unmatchedTotal: report.unmatched.length,
        },
        { req }
      );
    }

    // ── Refresh the cached balance. ───────────────────────────────────────
    case "sync_balance": {
      const result = await syncBalance();

      if (!result.ok) {
        throw new AppError(
          "ITP_PROVIDER_UNAVAILABLE",
          result.message || `Gagal mengambil saldo (${result.code}).`
        );
      }

      return ok({ balance: result.balance, currency: result.currency, durationMs: result.durationMs }, { req });
    }

    // ── Credential / reachability check. ─────────────────────────────────
    case "test": {
      const diagnostics = providerDiagnostics().find((row) => row.code === providerCode) ?? null;

      if (!provider.isConfigured()) {
        return ok(
          {
            reachable: false,
            configured: false,
            missing: provider.configurationGaps().missing,
            diagnostics,
          },
          { req }
        );
      }

      // A balance read is the cheapest real call: it proves the credentials work
      // AND the host is reachable, without creating anything.
      const result = await syncBalance();

      return ok(
        {
          reachable: result.ok,
          configured: true,
          code: result.ok ? null : result.code,
          message: result.ok ? "Koneksi dan kredensial valid." : result.message,
          diagnostics,
        },
        { req }
      );
    }

    default:
      throw new AppError("ITP_INVALID_INPUT", "Aksi tidak dikenal.");
  }
});
