// ============================================================================
// MyVouchers, the customer's voucher wallet, inline in the checkout rail.
//
// Shows the ACTIVE claims the customer is holding, lets them pick one, and
// shows which vouchers they are still allowed to claim (with a Claim button).
//
// The discount is never computed here. Selecting a voucher only tells the
// checkout which claim to spend; the server recomputes the discount from the
// promo rule at order time.
// ============================================================================
"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api-client";
import { Spinner } from "@/components/ui/primitives";
import { formatIDR } from "@/lib/format";

/** Short human label for a discount rule. Pure presentation. */
function describeDiscount(promo) {
  if (!promo) return "";
  if (promo.discountType === "PERCENT") {
    const max = promo.maxDiscount ? ` (maks ${formatIDR(promo.maxDiscount)})` : "";
    return `${promo.discountValue}%${max}`;
  }
  return formatIDR(promo.discountValue);
}

/** Which nominal/service does this voucher cover? */
function describeScope(promo) {
  if (!promo) return "Semua layanan";
  switch (promo.scope) {
    case "ALL": return "Semua layanan";
    case "CATEGORY": return "Kategori tertentu";
    case "GAME": return "Game tertentu";
    case "PRODUCT": return "Layanan tertentu";
    case "VARIANT": return "Nominal tertentu";
    default: return "Semua layanan";
  }
}

function describeAudience(promo) {
  switch (promo.audience) {
    case "NEW_CUSTOMER": return "Pelanggan baru";
    case "LOYAL_CUSTOMER": return `Min. ${promo.minCompletedOrders || 0} transaksi`;
    default: return "Semua member";
  }
}

export default function MyVouchers({ selectedClaimId, onSelect, onCodeResolved }) {
  const [state, setState] = useState("loading"); // loading | ready | error
  const [mine, setMine] = useState([]);
  const [claimable, setClaimable] = useState([]);
  const [claimingId, setClaimingId] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
    const result = await apiGet("/api/vouchers");
    if (!result.ok) {
      // A logged-out customer has no wallet; that is not an error worth showing.
      if (result.error?.code === "ITP_UNAUTHORIZED" || result.status === 401) {
        setState("ready");
        setMine([]);
        setClaimable([]);
        return;
      }
      setState("error");
      setError(result.error?.message ?? "Gagal memuat voucher.");
      return;
    }
    setMine(result.data.mine ?? []);
    setClaimable(result.data.claimable ?? []);
    setState("ready");
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function claim(promoId) {
    setClaimingId(promoId);
    setError(null);
    const result = await apiPost("/api/vouchers", { action: "claim", promoId });
    setClaimingId(null);
    if (!result.ok) {
      setError(result.error?.message ?? "Gagal mengklaim voucher.");
      return;
    }
    // Reload both lists: the claimed voucher moves from claimable to mine.
    await load();
    // Auto-select the freshly claimed voucher, the customer claimed it to use it.
    const claimId = result.data?.claim?.id ?? null;
    if (claimId && onSelect) {
      onSelect(claimId);
      const promo = result.data?.claim?.promo;
      if (promo?.codes?.[0]?.code && onCodeResolved) {
        onCodeResolved(promo.codes[0].code);
      }
    }
  }

  if (state === "loading") {
    return (
      <div className="mt-4 flex items-center gap-2 text-xs text-foreground-subtle">
        <Spinner /> Memuat voucher…
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="mt-4">
        <p className="text-xs text-foreground-subtle">Voucher tidak dapat dimuat.</p>
        {error ? <p className="mt-1 text-xs text-danger-fg">{error}</p> : null}
        <button type="button" onClick={load} className="btn-ghost btn-sm mt-2">
          Coba lagi
        </button>
      </div>
    );
  }

  const hasAnything = mine.length > 0 || claimable.length > 0;

  return (
    <div className="mt-4">
      <h3 className="text-sm font-semibold text-foreground">Voucher Saya</h3>

      {!hasAnything ? (
        <p className="mt-1.5 text-xs text-foreground-subtle">
          Belum ada voucher. Voucher promo akan muncul di sini saat tersedia.
        </p>
      ) : null}

      {/* ── Vouchers the customer is holding ───────────────────────────── */}
      {mine.length > 0 ? (
        <ul className="mt-2 space-y-2">
          {mine.map((claim) => {
            const selected = claim.id === selectedClaimId;
            return (
              <li key={claim.id}>
                <button
                  type="button"
                  onClick={() => onSelect(selected ? null : claim.id)}
                  className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                    selected
                      ? "border-brand-500 bg-brand-soft"
                      : "border-border hover:border-foreground-subtle"
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                      selected ? "border-brand-500 bg-brand-500" : "border-border"
                    }`}
                    aria-hidden="true"
                  >
                    {selected ? (
                      <svg className="h-3 w-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-foreground">
                      {claim.promo?.title ?? "Voucher"}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-foreground-muted">
                      {describeDiscount(claim.promo)} · {describeScope(claim.promo)}
                    </span>
                  </span>
                  <span className="shrink-0 text-[11px] text-foreground-subtle">
                    <EndsAtBadge endsAt={claim.promo?.endsAt ?? null} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {/* ── Vouchers available to claim ─────────────────────────────────── */}
      {claimable.length > 0 ? (
        <div className="mt-4 border-t border-border pt-3">
          <p className="text-xs font-medium text-foreground-muted">Voucher yang bisa diklaim</p>
          <ul className="mt-2 space-y-2">
            {claimable.map((promo) => (
              <li
                key={promo.id}
                className="flex items-center gap-3 rounded-lg border border-dashed border-border p-3"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-foreground">
                    {promo.title}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-foreground-muted">
                    {describeDiscount(promo)} · {describeAudience(promo)}
                  </span>
                  {promo.claimLimit ? (
                    <span className="mt-0.5 block text-[11px] text-foreground-subtle">
                      {promo.claimCount} dari {promo.claimLimit} klaim dipakai
                    </span>
                  ) : null}
                </span>
                <button
                  type="button"
                  onClick={() => claim(promo.id)}
                  disabled={claimingId === promo.id}
                  className="btn-primary btn-sm shrink-0"
                >
                  {claimingId === promo.id ? <Spinner /> : "Klaim"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? <p className="mt-2 text-xs text-danger-fg">{error}</p> : null}
    </div>
  );
}

// "berakhir <date>" badge for a voucher that expires within 7 days.
//
// The comparison is done in an effect, not during render, because it reads the
// clock: a pure render must not depend on Date.now(), and doing it in render
// also makes the badge's appearance depend on exactly when the component
// mounted rather than on the voucher's own end date.
function EndsAtBadge({ endsAt }) {
  const [label, setLabel] = useState(null);

  useEffect(() => {
    if (!endsAt) return;
    const withinWeek = new Date(endsAt).getTime() < Date.now() + 7 * 24 * 60 * 60 * 1000;
    if (!withinWeek) return;
    setLabel(`berakhir ${new Date(endsAt).toLocaleDateString("id-ID", { day: "numeric", month: "short" })}`);
  }, [endsAt]);

  return label;
}
