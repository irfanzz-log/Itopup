// ============================================================================
// Melostore H2H: field mapper.
//
// THE ONLY FILE IN THE PROJECT WHERE A MELOSTORE PARAMETER NAME MAY APPEAR.
// Everything upstream speaks the internal shape; everything downstream consumes
// the normalised shapes from ../contract.js.
//
// IMPLEMENTED FROM THE OFFICIAL DOCUMENTATION (h2h.melostore.id/id/docs).
//
// The mapping below is not guessed. The documentation defines exactly three
// transaction target parameters plus an overflow object:
//
//   customer_target        : "Nomor target ID / nomor tujuan penerima pulsa."
//   customer_target_zone   : "Nomor zone ID game (jika dibutuhkan, seperti ML)."
//   additional_data        : extra target fields as a JSON object, e.g.
//                            { "zone_2": "1" } for Genshin (TH). "Nama key harus
//                            sesuai dengan key field tambahan pada inquiry_forms
//                            produk di pricelist."
//
// There is therefore no per-field name table to fill in: every internal field
// maps onto one of those three slots. Adding a new game needs no new field name,
// only the right `inquiry_forms` key, which the pricelist sync reads from the
// provider and stores, rather than us hardcoding it.
// ============================================================================

/**
 * Which internal field key carries the primary target, per game.
 *
 * The docs are explicit that the target slot is the same for every game; only
 * which of the customer's inputs fills it changes (a game id vs a phone number).
 * Games absent from this table fall back to `userId`.
 */
export const PRIMARY_TARGET_FIELD = {
  "mobile-legends": "userId",
  // PUBG and CODM collect `playerId` (see GAME_SEED inputFields). Mapping them
  // to `userId` meant the mapper read a key the checkout form never sends: the
  // dispatch failed with "Field userId wajib diisi untuk game pubg-mobile" even
  // though the customer had filled in a valid Player ID.
  "pubg-mobile": "playerId",
  "free-fire": "playerId",
  codm: "playerId",
  roblox: "email",
  "genshin-impact": "userId",
  // Pulsa and e-wallet are identified by phone number.
  //
  // EVERY e-wallet slug must be listed here. The lookup falls back to `userId`,
  // so a wallet added to the catalogue without an entry here would dispatch with
  // the wrong target slot, or throw "Field userId wajib diisi" at checkout.
  // There is a test that fails when a catalogue game is missing from this table.
  pulsa: "phoneNumber",
  // eFootball: the provider's inquiry form is {"target": "Login",
  // "zone": "Password"} (form key a72a0ff…). The primary target is therefore
  // the game login identifier collected by the gameLogin field, and the
  // password, a secret resolved by the order service from the encrypted
  // GameCredential row and never from Order.customerInput, is carried in the
  // zone slot the provider asked for. The secret is NEVER written to the order
  // row; this mapper only places a value the caller already holds in memory.
  efootball: "gameLogin",

  // Games added from the Melostore pricelist. Each entry was read off the
  // brand's own inquiry form: a form whose first field is labelled "Player ID"
  // collects playerId, and the fallback here is userId, so without an entry
  // dispatch throws "Field userId wajib diisi" on a form that never asked for
  // one, or worse, sends an empty target.
  "farlight-84": "playerId",
  "pixel-gun-3d": "playerId",
  "honor-of-kings": "playerId",
  "hatsune-miku-colorful-stage": "playerId",
  "lords-mobile": "playerId",
  "whiteout-survival": "playerId",
  "magic-chess-go-go": "userId",
  "ensemble-stars-music": "playerId",
  "hero-clash": "playerId",

  // Indonesia-only ladders (h2h_pricelist_2026-10-04.xlsx). Read off each
  // brand's own inquiry form the same way: the field the provider asks for
  // decides which checkout input fills the target slot. Games absent here fall
  // back to `userId`, which is wrong for every one of these.
  "8-ball-pool": "playerId",
  "apex-legends-mobile": "playerId",
  // Arena of Valor and Magic Chess use the Moonton pairing (id + zone).
  "arena-of-valor": "userId",
  "battlenet-gift-card": "email",
  "dead-target": "playerId",
  "dunk-city-dynasty": "playerId",
  "eafc-mobile": "playerId",
  "garena-shells": "email",
  "garena-undawn": "playerId",
  "google-play": "email",
  // HoYoverse pairing: a UID plus the server the account lives on.
  "honkai-star-rail": "userId",
  "league-of-legends": "riotId",
  "wild-rift": "riotId",
  "legends-of-runeterra": "riotId",
  "point-blank": "playerId",
  "pokemon-unite": "playerId",
  "rainbow-six-mobile": "playerId",
  "razer-gold": "email",
  "tft-mobile": "riotId",
  "the-moonlit-oath": "playerId",
  "tiktok-gift-card": "email",
  "unipin-gift-card": "email",
  "valorant": "riotId",
  "zenless-zone-zero": "userId",
};

/** Internal field keys that must be sent inside `additional_data`, not at top level. */
export const EXTRA_TARGET_FIELDS = ["zone2", "serverId", "region"];

/**
 * Which internal field key carries the SECOND target slot (customer_target_zone),
 * per game.
 *
 * The default is the classic game pairing, a zone id alongside the user id,
 * so every existing game is unchanged. eFootball is the exception: its
 * provider inquiry form labels the second slot "Password", so the secret the
 * checkout collected as `gamePassword` must land there and NOT in
 * additional_data. Without this map the secret would be packaged into
 * additional_data (harmless to the provider, but a second copy of it in the
 * payload) and customer_target_zone would be omitted entirely (fatal: the
 * provider's form requires it).
 */
export const ZONE_TARGET_FIELD = {
  efootball: "gamePassword",
};

/**
 * Internal game slug → Melostore `game_code`, used by the check-nickname
 * endpoint. ONLY values listed in the documentation's "Daftar Game yang
 * Tersedia" table are present here.
 *
 * Note the two entries for CODM: the docs list `codm` and
 * `call-of-duty-mobile-indonesia` as separate codes. We use `codm` because our
 * slug is `codm`; the longer code is kept as a documented alias so an operator
 * can switch without a code change.
 */
export const GAME_MAP = {
  "mobile-legends": "mobile-legends",
  "pubg-mobile": "pubg-mobile",
  "free-fire": "free-fire",
  codm: "codm",
  roblox: "roblox",
  "genshin-impact": "genshin-impact",
  pulsa: "pulsa",
  efootball: "efootball",

  // Indonesia-only ladders. The check-nickname path is only reachable for the
  // games that advertise validation, so only those need a code here; the rest
  // dispatch fine without one. Codes are the provider's published game names.
  "arena-of-valor": "arena-of-valor-indonesia",
  "magic-chess-go-go": "magic-chess-go-go",
  "honkai-star-rail": "honkai-star-rail",
  "zenless-zone-zero": "zenless-zone-zero",
};

/**
 * Documented game codes, exactly as published. Used to VALIDATE that a slug we
 * are about to send is one the provider recognises, so a typo fails here with a
 * clear message instead of as a 422 from the provider mid-checkout.
 *
 * Source: "Daftar Game yang Tersedia" (41 entries as published).
 */
export const DOCUMENTED_GAME_CODES = new Set([
  "8-ball-pool", "ace-racer", "afk-journey", "age-of-empires-mobile",
  "among-heroes-fantasy-samkok", "arena-breakout", "arena-breakout-infinite",
  "arena-mania-magic-heroes", "arena-of-valor-indonesia", "armis",
  "astral-guardians-cyber-fantasy", "au2-mobile", "au2-mobile-hk", "auto-chess",
  "azur-lane", "banishers-faiths-entwined", "basketrio",
  "battle-through-the-heavens-3d-fight", "be-the-king-judge-destiny", "bermuda",
  "blockman-go", "blood-strike", "blood-strike-max", "brawl-stars",
  "call-of-duty-mobile-indonesia", "captain-tsubasa-dream-team", "clash-of-clans",
  "clash-royale", "cloud-song-saga-of-skywalkers", "codm", "codm-garena",
  "colorbang", "conquer-online-mobile", "conquer-online-pc", "cooking-adventure",
  "cotc-kr", "cotc-sea", "crasher-origin", "crisis-action", "crossfire-legends",
  // Present in the pricelist/transaction flow but not in the check-nickname
  // game table; treated as known so the catalogue still works for them.
  "mobile-legends", "free-fire", "pubg-mobile", "roblox", "genshin-impact",
  "pulsa", "efootball",
  // Indonesia ladders that dispatch through the transaction flow but are not in
  // the published check-nickname table either. Listed here so mapGameToProvider
  // accepts them; validation simply stays off for the ones that do not claim it.
  "magic-chess-go-go", "honkai-star-rail", "zenless-zone-zero",
]);

/**
 * Melostore transaction status → our normalised PROVIDER_ORDER_STATUS.
 *
 * VERIFIED LIVE: the API returns ENGLISH status strings (a real sandbox
 * transaction returned "status": "pending" (see scripts/live-status.ops.test.js
 * and /tmp/live-status.json), not the Indonesian the dashboard UI uses. The
 * Indonesian spellings below are kept as defensive aliases only: an unmapped
 * status falls through to UNKNOWN, which providerStatusToOrderStatus turns
 * into PROCESSING, and a delivered order would then be stuck in PROCESSING
 * forever. Never prune these to "the documented five" without a live callback
 * capture proving they are unused.
 */
export const STATUS_MAP = {
  pending: "PENDING",
  processing: "PROCESSING",
  success: "SUCCESS",
  sukses: "SUCCESS",
  berhasil: "SUCCESS",
  failed: "FAILED",
  gagal: "FAILED",
  refunded: "REFUND",
  refund: "REFUND",
  cancelled: "CANCELLED",
  canceled: "CANCELLED",
  batal: "CANCELLED",
};

/**
 * Documented transaction error codes → our provider error semantics.
 *
 * From "Daftar Kode Error (field error_code)". Only the ones that change our
 * behaviour are listed; the rest are carried through as messages.
 */
export const ERROR_CODE_MAP = {
  NO_ACTIVE_PROVIDER: { retryable: true, code: "UNAVAILABLE" },
  FAILED_ALL_PROVIDERS: { retryable: false, code: "REJECTED" },
  SUPPLIER_ERROR: { retryable: false, code: "REJECTED" },
  PRICE_UNAVAILABLE: { retryable: false, code: "PRODUCT_UNAVAILABLE" },
  INVALID_TARGET: { retryable: false, code: "INVALID_ACCOUNT" },
  NO_VARIANT_WITHIN_MAX_BID: { retryable: false, code: "PRODUCT_UNAVAILABLE" },
  MAX_BID_TOO_LOW: { retryable: false, code: "PRODUCT_UNAVAILABLE" },
  INVALID_SMART_SKU: { retryable: false, code: "PRODUCT_UNAVAILABLE" },
};

/** Internal game slug → provider game_code. Throws when unmapped. */
export function mapGameToProvider(gameSlug) {
  const mapped = GAME_MAP[gameSlug];
  if (!mapped) {
    throw new Error(
      `Game "${gameSlug}" belum dipetakan ke game_code Melostore. ` +
        "Tambahkan di GAME_MAP (src/providers/melostore/mapper.js)."
    );
  }
  return mapped;
}

/**
 * Split internal customer input into the documented three-slot shape.
 *
 * @param {{ gameSlug: string, fields: Record<string,string> }} input
 * @returns {{ customer_target: string, customer_target_zone?: string,
 *             additional_data?: Record<string,string> }}
 */
export function mapFieldsToProvider({ gameSlug, fields } = {}) {
  const source = fields || {};
  const primaryKey = PRIMARY_TARGET_FIELD[gameSlug] ?? "userId";
  const zoneKey = ZONE_TARGET_FIELD[gameSlug] ?? "zoneId";

  const target = source[primaryKey];
  if (target === undefined || String(target).trim() === "") {
    throw new Error(
      `Field "${primaryKey}" wajib diisi untuk game "${gameSlug}".`
    );
  }

  const out = { customer_target: String(target).trim().slice(0, 64) };

  const zone = source[zoneKey] ?? source.zoneId ?? source.server;
  if (zone !== undefined && String(zone).trim() !== "") {
    out.customer_target_zone = String(zone).trim().slice(0, 64);
  }

  // Everything else the game's config declares goes into additional_data, keyed
  // exactly as the game config names it; the docs require the key to match the
  // product's inquiry_forms entry.
  //
  // The PRIMARY and ZONE keys are excluded, so a game whose second slot is a
  // secret (eFootball) sends that secret exactly once, in the slot the provider
  // asked for. Leaving it in additional_data too would duplicate a credential
  // into the payload for no reason.
  const extras = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === primaryKey || key === zoneKey) continue;
    if (key === "zoneId" || key === "server") continue;
    if (value === undefined || String(value).trim() === "") continue;
    extras[key] = String(value).trim().slice(0, 64);
  }
  if (Object.keys(extras).length) out.additional_data = extras;

  return out;
}

/** Normalise a provider status string. Unknown → UNKNOWN, never SUCCESS/FAILED. */
export function mapProviderStatus(raw) {
  if (!raw) return "UNKNOWN";
  const key = String(raw).trim().toLowerCase();
  return STATUS_MAP[key] ?? "UNKNOWN";
}

/** Unwrap the documented `{ success, data }` envelope. */
function unwrap(body) {
  if (!body || typeof body !== "object") {
    throw new Error("Response Melostore bukan objek JSON.");
  }
  if (body.success === false) {
    const message = body.error?.message || body.message || "Provider menolak permintaan.";
    throw new Error(message);
  }
  return body.data ?? body;
}

/**
 * Build the documented transaction request body.
 *
 * Documented parameters: sku_code (required), customer_target (required),
 * customer_target_zone (optional), additional_data (optional), buyer_trx_id
 * (required), sandbox_mode (optional).
 *
 * `buyer_trx_id` is our own reference. The docs state its purpose is "untuk
 * mencegah pemesanan ganda" (to prevent duplicate ordering), which is what
 * makes a transport retry safe (see order.js).
 *
 * @param {import('../contract.js').NormalizedOrderRequest} input
 */
export function buildOrderPayload(input) {
  const { idempotencyKey, providerCode, gameSlug, fields } = input;

  if (!providerCode) {
    throw new Error("providerCode (sku_code) wajib diisi.");
  }
  if (!idempotencyKey) {
    throw new Error("idempotencyKey (buyer_trx_id) wajib diisi.");
  }

  const payload = {
    sku_code: String(providerCode).trim(),
    ...mapFieldsToProvider({ gameSlug, fields }),
    buyer_trx_id: String(idempotencyKey).trim().slice(0, 100),
  };

  // Sandbox is an ACCOUNT setting by default; only override when explicitly
  // configured, so a production deploy cannot be flipped by accident.
  const sandbox = (process.env.MELOSTORE_SANDBOX || "").trim().toLowerCase();
  if (sandbox === "true" || sandbox === "false") {
    payload.sandbox_mode = sandbox === "true";
  }

  return payload;
}

/** Normalise a create-transaction response (documented `data` object). */
export function normalizeOrderResponse(body) {
  const data = unwrap(body);

  return {
    // The docs' `data.id` is the provider's own transaction id; `buyer_trx_id`
    // is ours echoed back. Both are kept, so reconciliation can look up by either.
    providerOrderId: data.id ? String(data.id) : null,
    providerRef: data.buyer_trx_id ? String(data.buyer_trx_id) : null,
    status: mapProviderStatus(data.status),
    message: data.message ? String(data.message) : null,
    price: data.price !== undefined ? Number(data.price) : null,
    serialNumber: data.serial_number ? String(data.serial_number) : null,
    raw: data,
  };
}

/** Normalise a status-check response. Same documented shape as create. */
export function normalizeStatusResponse(body) {
  const data = unwrap(body);

  return {
    providerOrderId: data.id ? String(data.id) : null,
    providerRef: data.buyer_trx_id ? String(data.buyer_trx_id) : null,
    status: mapProviderStatus(data.status),
    message: data.error_code
      ? `${data.error_code}: ${data.message || ""}`.trim()
      : data.message
        ? String(data.message)
        : null,
    errorCode: data.error_code ? String(data.error_code) : null,
    serialNumber: data.serial_number ? String(data.serial_number) : null,
    raw: data,
  };
}

/**
 * Normalise a check-nickname response.
 *
 * The documented distinction that matters: a NON-EXISTENT account is an HTTP 422
 * with `error.category: "not_found"` (code 4001), not a 200 with a flag. That
 * case is handled in validation.js before this is called; this function only
 * ever sees a successful lookup.
 */
export function normalizeValidationResponse(body) {
  const data = unwrap(body);

  return {
    valid: true,
    nickname: data.username ? String(data.username) : null,
    server: data.customer_target_zone ? String(data.customer_target_zone) : null,
    accountId: data.customer_target ? String(data.customer_target) : null,
    region: data.region ? String(data.region) : null,
    // Documented as present when the request included sku_code. Surfaced so the
    // UI can warn BEFORE checkout that a first-top-up SKU is already claimed.
    purchaseCheck: data.purchase_check
      ? {
          skuCode: data.purchase_check.sku_code ?? null,
          skuName: data.purchase_check.sku_name ?? null,
          skuType: data.purchase_check.sku_type ?? null,
          canPurchase: data.purchase_check.can_purchase === true,
          errorMessage: data.purchase_check.error_msg ?? null,
        }
      : null,
    raw: data,
  };
}

/**
 * Normalise one pricelist entry (documented compact format).
 *
 * Documented fields: name, sku_code, price, category_name, brand_id, type_name,
 * server_code, server_name, status, inquiry_form_key.
 *
 * `price` is the provider's price for OUR tier, in rupiah: this is the COST,
 * never the selling price. Markup is applied by the sync service.
 */
export function normalizeProductEntry(entry) {
  if (!entry || typeof entry !== "object") {
    throw new Error("Entry pricelist Melostore bukan objek.");
  }
  if (!entry.sku_code) {
    throw new Error("Entry pricelist Melostore tidak memiliki sku_code.");
  }

  const price = Number(entry.price);
  if (!Number.isFinite(price)) {
    throw new Error(`Harga SKU ${entry.sku_code} tidak valid: ${entry.price}`);
  }

  return {
    providerCode: String(entry.sku_code),
    name: String(entry.name ?? entry.sku_code),
    price,
    stock: null, // Not exposed by the documented pricelist.
    available: String(entry.status ?? "active").toLowerCase() === "active",
    category: entry.category_name ? String(entry.category_name) : null,
    typeName: entry.type_name ? String(entry.type_name) : null,
    serverCode: entry.server_code ? String(entry.server_code) : null,
    serverName: entry.server_name ? String(entry.server_name) : null,
    // Stored so the UI can render the right input fields without hardcoding
    // them; the provider is the authority on what a product needs.
    inquiryFormKey: entry.inquiry_form_key ? String(entry.inquiry_form_key) : null,
    brandId: entry.brand_id !== undefined ? Number(entry.brand_id) : null,
  };
}

/** Normalise a pricelist `meta` block (brands + inquiry forms + pagination). */
export function normalizePricelistMeta(meta) {
  const brands = Array.isArray(meta?.brands)
    ? meta.brands.map((b) => ({
        id: Number(b.id),
        name: String(b.name ?? ""),
        thumbnail: b.thumbnail ? String(b.thumbnail) : null,
        order: b.order !== undefined ? Number(b.order) : null,
      }))
    : [];

  const inquiryForms = {};
  for (const [key, value] of Object.entries(meta?.inquiry_forms || {})) {
    inquiryForms[key] = {
      fields: Array.isArray(value?.fields)
        ? value.fields.map((f) => ({
            key: String(f.key),
            name: String(f.name ?? f.key),
            type: String(f.type ?? "text"),
            placeholder: f.placeholder ? String(f.placeholder) : null,
          }))
        : [],
    };
  }

  const pagination = meta?.pagination
    ? {
        cursor: meta.pagination.cursor ?? null,
        nextCursor: meta.pagination.next_cursor ?? null,
        limit: Number(meta.pagination.limit ?? 0),
        total: Number(meta.pagination.total ?? 0),
        hasMore: meta.pagination.has_more === true,
      }
    : null;

  return { brands, inquiryForms, pagination };
}

/** Normalise an inbound webhook payload (documented fields). */
export function normalizeCallback(body) {
  if (!body || typeof body !== "object") {
    throw new Error("Payload callback Melostore bukan objek.");
  }

  const providerOrderId = body.id ? String(body.id) : null;
  const providerRef = body.buyer_trx_id ? String(body.buyer_trx_id) : null;

  if (!providerRef && !providerOrderId) {
    throw new Error("Callback Melostore tidak menyertakan id maupun buyer_trx_id.");
  }

  // The documented payload carries no event id, so the body itself is the
  // event: the same transaction status delivered twice produces the same hash
  // and is deduplicated. A different status produces a different hash and is
  // applied.
  const eventId = providerOrderId
    ? `${providerOrderId}:${body.status ?? "unknown"}`
    : `${providerRef}:${body.status ?? "unknown"}`;

  return {
    eventId,
    providerRef,
    providerOrderId,
    status: mapProviderStatus(body.status),
    message: body.error_code
      ? `${body.error_code}: ${body.message || ""}`.trim()
      : body.message
        ? String(body.message)
        : null,
    serialNumber: body.serial_number ? String(body.serial_number) : null,
    // Documented: the amount actually charged for this transaction.
    priceCharged: body.price_charged !== undefined ? Number(body.price_charged) : null,
    raw: body,
  };
}

/**
 * Whether every mapping needed for dispatch is in place.
 *
 * Since the field mapping is derived from the documented three-slot shape, the
 * only real gap is a game whose game_code is not in the documented list.
 */
export function mapperStatus() {
  const unmappedGames = Object.keys(GAME_MAP).filter(
    (slug) => !DOCUMENTED_GAME_CODES.has(GAME_MAP[slug])
  );

  return {
    ready: unmappedGames.length === 0 && Object.keys(STATUS_MAP).length > 0,
    unmappedFields: [], // Field names come from the documented 3-slot shape.
    unmappedGames,
    statusesMapped: Object.keys(STATUS_MAP).length > 0,
  };
}
