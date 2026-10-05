// ============================================================================
// Melostore H2H: balance.
//
// Used by the admin dashboard and by a guard before dispatching an expensive
// order: dispatching with a known-insufficient balance just burns a provider
// call and leaves the customer waiting.
//
// IMPLEMENTED FROM THE OFFICIAL DOCUMENTATION (h2h.melostore.id/id/docs):
//
//   GET /api/v1/h2h/profile/balance
//   → { success: true, data: { h2h_balance, h2h_balance_usd, usd_idr_rate,
//                              is_sandbox_mode } }
//
// The docs also describe the money model, which matters for how this figure is
// presented to an operator:
//
//   "Melostore H2H menggunakan model B2B ... mitra menyetorkan deposit yang
//    dikreditkan sebagai Saldo Prabayar (API Credit / Advance Balance)"
//   "Non-Refundable (No-Cashout): Saldo yang sudah dikreditkan tidak dapat
//    ditarik ... Saldo hanya dapat dipakai untuk pembelian produk digital."
//
// So this is a PREPAID PURCHASE CREDIT, not cash. The admin UI must label it as
// saldo prabayar, never as a withdrawable balance.
// ============================================================================
import { PROVIDER_ERROR, providerErr } from "../contract.js";
import { call } from "./client.js";

export const BALANCE_PATH = "/api/v1/h2h/profile/balance";

/**
 * @param {{ log?: object }} [input]
 * @returns {Promise<import('../contract.js').ProviderResult<{
 *   balance: number, currency: string, balanceUsd: number|null,
 *   usdIdrRate: number|null, isSandbox: boolean, raw: unknown
 * }>>}
 */
export async function getBalance({ log } = {}) {
  const result = await call({
    path: BALANCE_PATH,
    method: "GET",
    idempotent: true,
    log,
    operation: "getBalance",
  });

  if (!result.ok) return result;

  try {
    const data = result.data?.data ?? result.data;

    // Documented field is `h2h_balance`. The unit is rupiah: the docs show
    // 15750000.0 for a balance worth 926.47 USD at a rate of 17000, i.e. IDR.
    const balance = Number(data?.h2h_balance);
    if (!Number.isFinite(balance)) {
      return providerErr(PROVIDER_ERROR.UNKNOWN, "Field h2h_balance tidak ditemukan pada response.", {
        retryable: false,
      });
    }

    return {
      ok: true,
      data: {
        balance,
        currency: "IDR",
        balanceUsd: Number.isFinite(Number(data?.h2h_balance_usd))
          ? Number(data.h2h_balance_usd)
          : null,
        usdIdrRate: Number.isFinite(Number(data?.usd_idr_rate)) ? Number(data.usd_idr_rate) : null,
        isSandbox: data?.is_sandbox_mode === true,
        raw: data,
      },
      meta: result.meta,
    };
  } catch (err) {
    return providerErr(PROVIDER_ERROR.UNKNOWN, String(err?.message || err), { retryable: false });
  }
}
