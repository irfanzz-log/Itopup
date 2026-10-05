// ============================================================================
// Melostore mapper, verified against the payloads printed in the official
// documentation (h2h.melostore.id/id/docs).
//
// Every fixture below is COPIED FROM THE DOCS, not invented. If Melostore
// changes a field name, these tests fail, which is the point: the mapping is
// the one thing that must never silently drift.
// ============================================================================
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mapFieldsToProvider,
  buildOrderPayload,
  mapGameToProvider,
  mapProviderStatus,
  normalizeOrderResponse,
  normalizeStatusResponse,
  normalizeValidationResponse,
  normalizeProductEntry,
  normalizePricelistMeta,
  normalizeCallback,
  mapperStatus,
  DOCUMENTED_GAME_CODES,
} from "../../src/providers/melostore/mapper.js";

describe("mapFieldsToProvider", () => {
  it("puts Mobile Legends userId+zoneId into the documented target slots", () => {
    const out = mapFieldsToProvider({
      gameSlug: "mobile-legends",
      fields: { userId: "12345678", zoneId: "2039" },
    });

    expect(out).toEqual({
      customer_target: "12345678",
      customer_target_zone: "2039",
    });
  });

  it("omits customer_target_zone for a game that needs no zone", () => {
    const out = mapFieldsToProvider({
      gameSlug: "free-fire",
      fields: { playerId: "510380815" },
    });

    expect(out).toEqual({ customer_target: "510380815" });
    expect(out).not.toHaveProperty("customer_target_zone");
  });

  it("sends a phone number as the target for pulsa", () => {
    const out = mapFieldsToProvider({
      gameSlug: "pulsa",
      fields: { phoneNumber: "08123456789" },
    });
    expect(out.customer_target).toBe("08123456789");
  });

  it("routes extra fields into additional_data, as the docs require", () => {
    // The docs' Genshin example uses { "zone_2": "1" } inside additional_data.
    const out = mapFieldsToProvider({
      gameSlug: "genshin-impact",
      fields: { userId: "803391737", zoneId: "1", zone2: "1" },
    });

    expect(out.customer_target).toBe("803391737");
    expect(out.customer_target_zone).toBe("1");
    expect(out.additional_data).toEqual({ zone2: "1" });
  });

  it("throws when the primary target is missing instead of sending a blank", () => {
    expect(() =>
      mapFieldsToProvider({ gameSlug: "mobile-legends", fields: { zoneId: "2039" } })
    ).toThrow(/userId/);
  });

  it("trims and caps a hostile over-long value", () => {
    const out = mapFieldsToProvider({
      gameSlug: "mobile-legends",
      fields: { userId: `  ${"9".repeat(200)}  `, zoneId: "1" },
    });
    expect(out.customer_target).toHaveLength(64);
  });
});

describe("buildOrderPayload", () => {
  // `sandbox_mode` is only added when MELOSTORE_SANDBOX is explicitly "true" or
  // "false". Left unset, the payload must NOT carry the key at all, the sandbox
  // flag is an account-level setting, and sending it unasked would let a local
  // .env silently point a production call at the sandbox.
  const originalSandbox = process.env.MELOSTORE_SANDBOX;

  beforeEach(() => {
    delete process.env.MELOSTORE_SANDBOX;
  });

  afterEach(() => {
    if (originalSandbox === undefined) delete process.env.MELOSTORE_SANDBOX;
    else process.env.MELOSTORE_SANDBOX = originalSandbox;
  });

  it("matches the documented POST /transaction body exactly", () => {
    // Docs example:
    //   { sku_code, customer_target, customer_target_zone, buyer_trx_id, sandbox_mode }
    // sandbox_mode is omitted here because it is optional and not configured,
    // the assertion below is the "unset" case.
    const payload = buildOrderPayload({
      idempotencyKey: "unique_tx_ref_001",
      providerCode: "ML86",
      gameSlug: "mobile-legends",
      fields: { userId: "12345678", zoneId: "2039" },
    });

    expect(payload).toEqual({
      sku_code: "ML86",
      customer_target: "12345678",
      customer_target_zone: "2039",
      buyer_trx_id: "unique_tx_ref_001",
    });
  });

  it("omits sandbox_mode when it is not explicitly configured", () => {
    const payload = buildOrderPayload({
      idempotencyKey: "tx_1",
      providerCode: "ML86",
      gameSlug: "mobile-legends",
      fields: { userId: "1", zoneId: "2" },
    });
    expect("sandbox_mode" in payload).toBe(false);
  });

  it("sends sandbox_mode only when explicitly set to true or false", () => {
    process.env.MELOSTORE_SANDBOX = "true";
    expect(buildOrderPayload({
      idempotencyKey: "tx_2",
      providerCode: "ML86",
      gameSlug: "mobile-legends",
      fields: { userId: "1", zoneId: "2" },
    }).sandbox_mode).toBe(true);

    process.env.MELOSTORE_SANDBOX = "false";
    expect(buildOrderPayload({
      idempotencyKey: "tx_3",
      providerCode: "ML86",
      gameSlug: "mobile-legends",
      fields: { userId: "1", zoneId: "2" },
    }).sandbox_mode).toBe(false);

    // Anything else (typo, empty) must not guess a value.
    process.env.MELOSTORE_SANDBOX = "yes";
    expect("sandbox_mode" in buildOrderPayload({
      idempotencyKey: "tx_4",
      providerCode: "ML86",
      gameSlug: "mobile-legends",
      fields: { userId: "1", zoneId: "2" },
    })).toBe(false);
  });

  it("refuses to build a payload without an idempotency key", () => {
    // Without buyer_trx_id the provider cannot deduplicate, which is exactly
    // what would allow a double purchase.
    expect(() =>
      buildOrderPayload({
        providerCode: "ML86",
        gameSlug: "mobile-legends",
        fields: { userId: "1", zoneId: "2" },
      })
    ).toThrow(/idempotencyKey/);
  });

  it("refuses to build a payload without a SKU", () => {
    expect(() =>
      buildOrderPayload({
        idempotencyKey: "x".repeat(16),
        gameSlug: "mobile-legends",
        fields: { userId: "1", zoneId: "2" },
      })
    ).toThrow(/sku_code/);
  });
});

describe("mapGameToProvider", () => {
  it("maps every slug we ship to a documented game_code", () => {
    for (const slug of ["mobile-legends", "pubg-mobile", "free-fire", "codm", "roblox", "genshin-impact"]) {
      const code = mapGameToProvider(slug);
      expect(DOCUMENTED_GAME_CODES.has(code)).toBe(true);
    }
  });

  it("throws for an unmapped slug rather than sending a guess", () => {
    expect(() => mapGameToProvider("some-new-game")).toThrow(/belum dipetakan/);
  });
});

describe("mapProviderStatus", () => {
  it("maps every status the docs list", () => {
    expect(mapProviderStatus("pending")).toBe("PENDING");
    expect(mapProviderStatus("processing")).toBe("PROCESSING");
    expect(mapProviderStatus("success")).toBe("SUCCESS");
    expect(mapProviderStatus("failed")).toBe("FAILED");
    expect(mapProviderStatus("refunded")).toBe("REFUND");
  });

  it("returns UNKNOWN for anything unrecognised — never SUCCESS", () => {
    expect(mapProviderStatus("weird_new_status")).toBe("UNKNOWN");
    expect(mapProviderStatus(undefined)).toBe("UNKNOWN");
    expect(mapProviderStatus("")).toBe("UNKNOWN");
  });
});

describe("normalizeOrderResponse", () => {
  it("reads the documented create-transaction response", () => {
    const body = {
      success: true,
      message: "Transaction successfully created and queued.",
      data: {
        id: "e93ad291-ffb0-40e1-b849-c1248ab02390",
        buyer_trx_id: "unique_tx_ref_001",
        sku_code: "ML86",
        product_name: "Mobile Legends 86 Diamonds",
        customer_target: "12345678",
        customer_target_zone: "2039",
        price: 18700.0,
        status: "pending",
        serial_number: null,
        webhook_delivery_status: "pending",
        is_sandbox: false,
        created_at: "2026-07-10T17:40:00+00:00",
      },
    };

    const out = normalizeOrderResponse(body);
    expect(out.providerOrderId).toBe("e93ad291-ffb0-40e1-b849-c1248ab02390");
    expect(out.providerRef).toBe("unique_tx_ref_001");
    expect(out.status).toBe("PENDING");
    expect(out.price).toBe(18700);
  });

  it("surfaces a documented failure with its error_code", () => {
    const out = normalizeStatusResponse({
      success: true,
      data: {
        id: "e93ad291-ffb0-40e1-b849-c1248ab02390",
        buyer_trx_id: "unique_tx_ref_001",
        sku_code: "ML86",
        price: 18700.0,
        status: "failed",
        error_code: "PRICE_UNAVAILABLE",
        message: "Price is currently unavailable.",
        serial_number: null,
      },
    });

    expect(out.status).toBe("FAILED");
    expect(out.errorCode).toBe("PRICE_UNAVAILABLE");
    expect(out.message).toContain("PRICE_UNAVAILABLE");
  });
});

describe("normalizeValidationResponse", () => {
  it("reads the documented check-nickname success payload", () => {
    const out = normalizeValidationResponse({
      success: true,
      data: {
        game_code: "mobile-legends",
        customer_target: "47486147",
        customer_target_zone: "2076",
        username: "VanillaSyrup",
        region: "Indonesia",
      },
    });

    expect(out.valid).toBe(true);
    expect(out.nickname).toBe("VanillaSyrup");
    expect(out.server).toBe("2076");
  });

  it("exposes the documented purchase_check when a sku_code was sent", () => {
    const out = normalizeValidationResponse({
      success: true,
      data: {
        game_code: "mobile-legends",
        customer_target: "47486147",
        username: "VanillaSyrup",
        purchase_check: {
          sku_code: "ml-id-ft500",
          sku_name: "1000 Diamonds (500+500) first top up",
          sku_type: "first_topup",
          can_purchase: false,
          error_code: -101,
          error_msg: "SKU ini tidak tersedia atau sudah pernah diklaim oleh akun ini.",
        },
      },
    });

    expect(out.purchaseCheck.canPurchase).toBe(false);
    expect(out.purchaseCheck.skuType).toBe("first_topup");
  });
});

describe("normalizeProductEntry", () => {
  it("reads a documented compact pricelist row", () => {
    const out = normalizeProductEntry({
      name: "1.045 Diamonds",
      sku_code: "ml-id-1045",
      price: 263316,
      category_name: "Game",
      brand_id: 12,
      type_name: "ML Diamonds",
      server_code: "S1",
      server_name: "Server 1",
      status: "active",
      inquiry_form_key: "8b13246e0ecfae5d3f3fdd15bd180798ce97d968",
    });

    expect(out.providerCode).toBe("ml-id-1045");
    expect(out.price).toBe(263316);
    expect(out.available).toBe(true);
    expect(out.inquiryFormKey).toBe("8b13246e0ecfae5d3f3fdd15bd180798ce97d968");
  });

  it("marks a non-active row unavailable", () => {
    const out = normalizeProductEntry({ name: "X", sku_code: "x-1", price: 1, status: "inactive" });
    expect(out.available).toBe(false);
  });

  it("throws on a row without a sku_code instead of importing junk", () => {
    expect(() => normalizeProductEntry({ name: "no sku", price: 100 })).toThrow(/sku_code/);
  });

  it("throws on a non-numeric price instead of importing 0", () => {
    expect(() => normalizeProductEntry({ name: "X", sku_code: "x", price: "abc" })).toThrow(/tidak valid/);
  });
});

describe("normalizePricelistMeta", () => {
  it("reads brands, inquiry_forms and pagination from the documented meta", () => {
    const meta = normalizePricelistMeta({
      brands: [{ id: 12, name: "Mobile Legends (Indonesia)", thumbnail: "https://cdn/x.webp", order: 1 }],
      inquiry_forms: {
        abc123: {
          fields: [
            { key: "target_id", name: "User ID", type: "text", placeholder: "Masukkan User ID" },
            { key: "target_zone", name: "Zone ID", type: "text", placeholder: "Masukkan Zone ID" },
          ],
        },
      },
      pagination: { cursor: null, next_cursor: "eyJ==", limit: 500, total: 10234, has_more: true },
    });

    expect(meta.brands[0].id).toBe(12);
    expect(meta.inquiryForms.abc123.fields).toHaveLength(2);
    expect(meta.pagination.hasMore).toBe(true);
    expect(meta.pagination.total).toBe(10234);
  });
});

describe("normalizeCallback", () => {
  it("reads the documented webhook payload and derives a replay-safe event id", () => {
    const out = normalizeCallback({
      id: "e93ad291-ffb0-40e1-b849-c1248ab02390",
      buyer_trx_id: "unique_tx_ref_001",
      sku_code: "ML86",
      customer_target: "12345678",
      customer_target_zone: "2039",
      price_charged: 18700.0,
      status: "failed",
      error_code: "PRICE_UNAVAILABLE",
      message: "Price is currently unavailable.",
      serial_number: null,
      is_sandbox: false,
    });

    expect(out.status).toBe("FAILED");
    expect(out.providerRef).toBe("unique_tx_ref_001");
    expect(out.priceCharged).toBe(18700);
    // Same transaction + same status => same eventId => deduplicated.
    expect(out.eventId).toBe("e93ad291-ffb0-40e1-b849-c1248ab02390:failed");
  });

  it("produces a DIFFERENT event id when the status changes", () => {
    const base = { id: "abc", buyer_trx_id: "ref", status: "pending" };
    const a = normalizeCallback(base);
    const b = normalizeCallback({ ...base, status: "success" });
    expect(a.eventId).not.toBe(b.eventId);
  });

  it("throws when the payload carries no identifier at all", () => {
    expect(() => normalizeCallback({ status: "success" })).toThrow(/buyer_trx_id/);
  });
});

describe("mapperStatus", () => {
  it("reports ready now that the documented mapping is in place", () => {
    const status = mapperStatus();
    expect(status.ready).toBe(true);
    expect(status.unmappedGames).toEqual([]);
    expect(status.statusesMapped).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Catalogue ↔ mapper contract.
//
// This is the regression guard for a real bug: the catalogue can grow a game
// (a new e-wallet, an operator) while PRIMARY_TARGET_FIELD does not, and the
// mapper then falls back to `userId`, throwing "Field userId wajib diisi" at
// checkout, or worse, dispatching a payload with the wrong target slot. A test
// that only exercises slugs the mapper already knows can never catch that, so
// these iterate the CATALOGUE and require the mapper to cover it.
// ─────────────────────────────────────────────────────────────────────────────
describe("catalogue ↔ mapper contract", () => {
  it("maps every catalogue game to a primary target field", async () => {
    const { GAME_SEED } = await import("../../src/config/games.js");
    const { PRIMARY_TARGET_FIELD } = await import(
      "../../src/providers/melostore/mapper.js"
    );

    // PRIMARY_TARGET_FIELD is required for DISPATCH, so it must cover the whole
    // catalogue. A missing entry falls back to `userId` and either throws at
    // checkout or, worse, sends a payload with the wrong target slot.
    const missing = GAME_SEED.map((g) => g.slug).filter(
      (slug) => !PRIMARY_TARGET_FIELD[slug]
    );
    expect(missing).toEqual([]);
  });

  it("only points a game at a field that game actually declares", async () => {
    const { GAME_SEED } = await import("../../src/config/games.js");
    const { PRIMARY_TARGET_FIELD } = await import(
      "../../src/providers/melostore/mapper.js"
    );

    // The bug this locks out: PRIMARY_TARGET_FIELD said "userId" for a game whose
    // checkout form only collects "playerId". Both tables looked individually
    // fine; only their intersection was wrong.
    const mismatched = GAME_SEED.filter((game) => {
      const target = PRIMARY_TARGET_FIELD[game.slug];
      return !game.inputFields.some((f) => f.key === target);
    }).map((g) => g.slug);

    expect(mismatched).toEqual([]);
  });

  it("gives a provider game_code to every game that claims validation support", async () => {
    const { GAME_SEED } = await import("../../src/config/games.js");
    const { GAME_MAP } = await import("../../src/providers/melostore/mapper.js");

    // GAME_MAP is only used by the check-nickname path, so it is required
    // exactly for the games that advertise validation, not for every catalogue
    // entry. A game may be dispatchable while its game_code stays unverified.
    const missing = GAME_SEED.filter((g) => g.supportsValidation)
      .map((g) => g.slug)
      .filter((slug) => !GAME_MAP[slug]);

    expect(missing).toEqual([]);
  });

  it("resolves a payload for every game using only its declared inputFields", async () => {
    const { GAME_SEED } = await import("../../src/config/games.js");

    // Build a plausible value per declared field key, so the test never depends
    // on a hardcoded sample that could drift from the field contract.
    //
    // A secret field is sampled too: `mapFieldsToProvider` places it in the
    // zone slot for the game that declares it, and this test must exercise that
    // path rather than skipping it.
    const SAMPLE = {
      userId: "123456789",
      zoneId: "1234",
      serverId: "2001",
      playerId: "510380815",
      username: "someuser",
      email: "player@example.com",
      riotId: "Player#1234",
      phoneNumber: "081234567890",
      region: "ID",
      gameLogin: "player@example.com",
      gamePassword: "hunter2-efootball",
    };

    for (const game of GAME_SEED) {
      const fields = {};
      for (const def of game.inputFields) fields[def.key] = SAMPLE[def.key];

      // No game in the catalogue may declare a field we cannot sample, that
      // would make this test silently vacuous for that game.
      expect(Object.values(fields)).not.toContain(undefined);

      const out = mapFieldsToProvider({ gameSlug: game.slug, fields });
      expect(out.customer_target, `game ${game.slug}`).toBeTruthy();
    }
  });

  it("never sends a phone-number product with a game-id target", async () => {
    const { GAME_SEED } = await import("../../src/config/games.js");

    const phoneGames = GAME_SEED.filter((g) =>
      g.inputFields.some((f) => f.key === "phoneNumber")
    );
    // Guard against the list silently becoming empty and the assertions below
    // never running.
    expect(phoneGames.length).toBeGreaterThan(0);

    for (const game of phoneGames) {
      const out = mapFieldsToProvider({
        gameSlug: game.slug,
        fields: { phoneNumber: "081234567890" },
      });
      expect(out.customer_target, `game ${game.slug}`).toBe("081234567890");
    }
  });

  it("asks for an email on every brand whose provider form is an email form", async () => {
    // Read off the provider's own inquiry forms (form key
    // 76af692ff8ef88e1146e67fe4602414f914dc912, label "Email", type "email"):
    // Google Play, Razer Gold, Battle.net, Garena Shells, TikTok, Unipin and
    // Roblox all redeem to an address. These were declared as `username`, whose
    // pattern forbids `@`, so a valid address was rejected at checkout by our
    // own validation while the provider was waiting for one.
    const { GAME_SEED } = await import("../../src/config/games.js");

    const EMAIL_SLUGS = [
      "roblox",
      "battlenet-gift-card",
      "garena-shells",
      "google-play",
      "razer-gold",
      "tiktok-gift-card",
      "unipin-gift-card",
    ];
    for (const slug of EMAIL_SLUGS) {
      const game = GAME_SEED.find((g) => g.slug === slug);
      expect(game, `game ${slug} must exist`).toBeDefined();
      expect(game.inputFields.map((f) => f.key), `game ${slug}`).toContain("email");
    }
  });

  it("labels the Riot field as Riot ID, not username", async () => {
    // The provider's inquiry form for Riot's brands is a plain `text` field
    // labelled "Riot ID". Riot IDs carry a `#TAG`, which the `username` preset
    // forbids, so checkout rejected the very format the provider documents.
    const { GAME_SEED } = await import("../../src/config/games.js");

    const RIOT_SLUGS = [
      "valorant",
      "league-of-legends",
      "wild-rift",
      "legends-of-runeterra",
      "tft-mobile",
    ];
    for (const slug of RIOT_SLUGS) {
      const game = GAME_SEED.find((g) => g.slug === slug);
      expect(game, `game ${slug} must exist`).toBeDefined();
      expect(game.inputFields.map((f) => f.key), `game ${slug}`).toContain("riotId");
    }
  });
});
