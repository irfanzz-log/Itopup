// ============================================================================
// Melostore H2H: product catalogue (pricelist).
//
// Called by the SYNC JOB only, never from a request path: the frontend reads the
// database, the sync writes the database. A page that fetched the provider live
// would leak timing, burn provider quota, and break the moment the provider is
// slow.
//
// IMPLEMENTED FROM THE OFFICIAL DOCUMENTATION (h2h.melostore.id/id/docs):
//
//   GET /api/v1/h2h/pricelists/categories   : list of { name, slug }
//   GET /api/v1/h2h/pricelists              : full pricelist
//   GET /api/v1/h2h/pricelists/{category}   : pricelist for one category
//
//   Query params: server, format, limit (max 1000), cursor.
//
//   ⚠️  DEPRECATION NOTICE FROM THE DOCS: "Respons penuh tanpa parameter limit
//   akan dihentikan pada 28 Agustus 2026. Mulai tanggal tersebut, parameter
//   limit menjadi wajib." We therefore ALWAYS send limit and paginate with the
//   documented cursor. The adapter is written for the post-deprecation API
//   rather than for the soon-to-break behaviour.
//
//   Rate limit: 20 calls/minute per partner profile, HTTP 429 + Retry-After.
//
//   MEASURED against the live API: the limit is charged per REQUEST, not per
//   row. `limit=1000` returns 1000 rows and decrements `x-ratelimit-remaining`
//   by exactly 1, identical to `limit=5`. That is why DEFAULT_LIMIT is 1000:
//   the full 20.887-SKU catalogue costs 21 requests instead of 42.
// ============================================================================
import { PROVIDER_ERROR, providerErr } from "../contract.js";
import { call } from "./client.js";
import { normalizeProductEntry, normalizePricelistMeta } from "./mapper.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Delay between pagination requests.
 *
 * The pricelist sub-bucket allows 20 requests/minute, i.e. one every 3s. A full
 * sync is ~21 pages; without pacing the last page reliably 429s and the whole
 * sync fails after having already fetched everything. 3.2s leaves headroom for
 * the clock skew between our timer and the provider's window.
 */
const PAGE_PACING_MS = Number(process.env.MELOSTORE_PAGE_PACING_MS || 3200);

/** Documented paths. The only place these strings appear. */
export const CATEGORIES_PATH = "/api/v1/h2h/pricelists/categories";
export const PRODUCTS_PATH = "/api/v1/h2h/pricelists";

/**
 * Documented maximum page size.
 *
 * MEASURED, not assumed: the rate limit is charged per REQUEST, not per row.
 * A raw probe against the live API showed `limit=1000` returning 1000 rows and
 * decrementing `x-ratelimit-remaining` by exactly 1, the same cost as
 * `limit=5`. Using 1000 therefore fetches the whole 20.887-SKU catalogue in 21
 * requests instead of 42, which matters because the pricelist sub-bucket is
 * only 20 requests/minute.
 */
const MAX_LIMIT = 1000;
const DEFAULT_LIMIT = 1000;

/**
 * Safety ceiling on pagination.
 *
 * The docs report ~10,234 products at limit=500, i.e. ~21 pages. The cap exists
 * so a provider bug (a cursor that never terminates) cannot spin forever; it is
 * a bound on a runaway loop, not a business limit.
 */
const MAX_PAGES = 60;

/** Fetch the documented category list. */
export async function getCategories({ log } = {}) {
  const result = await call({
    path: CATEGORIES_PATH,
    method: "GET",
    idempotent: true,
    log,
    operation: "getCategories",
  });

  if (!result.ok) return result;

  const entries = result.data?.data ?? result.data;
  if (!Array.isArray(entries)) {
    return providerErr(PROVIDER_ERROR.UNKNOWN, "Struktur response kategori tidak dikenali.", {
      retryable: false,
    });
  }

  return {
    ok: true,
    data: entries.map((entry) => ({
      slug: String(entry.slug),
      name: String(entry.name ?? entry.slug),
    })),
    meta: result.meta,
  };
}

/**
 * Fetch the full pricelist, following the documented cursor pagination.
 *
 * @param {{ category?: string, log?: object, limit?: number }} [input]
 * @returns {Promise<import('../contract.js').ProviderResult<{
 *   products: object[], brands: object[], inquiryForms: object, pages: number
 * }>>}
 */
export async function getProducts({ category, log, limit } = {}) {
  const pageSize = Math.min(MAX_LIMIT, Math.max(1, Number(limit) || DEFAULT_LIMIT));

  const basePath = category
    ? `${PRODUCTS_PATH}/${encodeURIComponent(category)}`
    : PRODUCTS_PATH;

  const products = [];
  let brands = [];
  let inquiryForms = {};
  let cursor = null;
  let pages = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({ limit: String(pageSize) });
    if (cursor) params.set("cursor", cursor);

    // Pace the pagination. The pricelist sub-bucket is 20 requests/minute and a
    // full sync is ~21 pages, so firing them back-to-back guarantees a 429 on
    // the last page. The sync would then fail *after* doing all the work. The
    // delay is skipped on the first page so a small catalogue stays fast.
    if (page > 0) await sleep(PAGE_PACING_MS);

    const result = await call({
      path: `${basePath}?${params.toString()}`,
      method: "GET",
      // A read has no side effects, so a transport retry is safe.
      idempotent: true,
      log,
      operation: "getProducts",
    });

    if (!result.ok) return result;
    pages++;

    const entries = result.data?.data ?? result.data;
    if (!Array.isArray(entries)) {
      return providerErr(PROVIDER_ERROR.UNKNOWN, "Struktur response pricelist tidak dikenali.", {
        retryable: false,
      });
    }

    // A malformed entry throws inside normalizeProductEntry. That is deliberate:
    // silently skipping it would mean a product the customer can see but not
    // buy, which is worse than a sync that fails loudly.
    for (const entry of entries) products.push(normalizeProductEntry(entry));

    const meta = normalizePricelistMeta(result.data?.meta);
    // Brands and inquiry forms are reference data repeated per page; the last
    // page wins, and they are identical across pages.
    if (meta.brands.length) brands = meta.brands;
    if (Object.keys(meta.inquiryForms).length) inquiryForms = meta.inquiryForms;

    if (!meta.pagination?.hasMore || !meta.pagination.nextCursor) break;
    cursor = meta.pagination.nextCursor;
  }

  return { ok: true, data: { products, brands, inquiryForms, pages } };
}

export { MAX_LIMIT, MAX_PAGES };
