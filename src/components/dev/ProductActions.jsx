"use client";

// ============================================================================
// ProductActions, the per-variant admin panel on /dev/products.
//
// THREE OPERATIONS, all POST /api/dev/products:
//   * ubah harga, set the selling price in absolute rupiah
//   * ganti SKU, re-point the variant at another provider SKU
//   * hapus, remove the variant (deactivated when it has order history)
//
// WHAT THIS COMPONENT IS DELIBERATELY DUMB ABOUT
//
// Money. It never computes a price the server trusts. The price field is an
// input the operator typed; the SKU list is rendered from what the server
// returned; the margin shown next to either is a *display*, and the row that
// matters is the one the API writes to the database. The checkout re-reads that
// row inside its transaction, nothing here can reach it.
//
// The same is true of availability: the SKU list is the provider's view AT THE
// MOMENT THE PANEL OPENED. It can go stale between loading and saving, which is
// why the server re-checks the chosen code against the live pricelist before
// writing. A "stale" error here is that check working, not a bug.
// ============================================================================
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Badge, Spinner } from "@/components/ui/primitives";
import { apiFetch, apiPost } from "@/lib/api-client";
import { formatIDR } from "@/lib/format";

/**
 * @param {{ variantId: string, variantName: string, sellingPrice: number,
 *   costPrice: number, isActive: boolean, linkedSku: string|null,
 *   linkedAvailable: boolean|null, hasOrders: boolean }} props
 */
export default function ProductActions({
  variantId,
  variantName,
  sellingPrice,
  costPrice,
  isActive,
  linkedSku,
  linkedAvailable,
  hasOrders,
}) {
  const router = useRouter();
  const [open, setOpen] = useState(null); // "price" | "sku" | "delete" | null
  const [candidates, setCandidates] = useState([]);
  const [loadingSku, setLoadingSku] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [priceInput, setPriceInput] = useState(String(sellingPrice));
  const [chosenSku, setChosenSku] = useState(null);

  const close = useCallback(() => {
    setOpen(null);
    setError(null);
  }, []);

  // Fetch the provider's live view of this nominal when the SKU panel opens.
  // This is the read that contacts the provider, so it runs on demand only.
  const loadCandidates = useCallback(async () => {
    setLoadingSku(true);
    setError(null);
    const result = await apiFetch(`/api/dev/products?variantId=${encodeURIComponent(variantId)}`);
    setLoadingSku(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setCandidates(result.data.candidates ?? []);
    setChosenSku(null);
  }, [variantId]);

  useEffect(() => {
    if (open === "sku") loadCandidates();
  }, [open, loadCandidates]);

  const handlePrice = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await apiPost("/api/dev/products", {
      action: "update_price",
      variantId,
      sellingPrice: Number(priceInput),
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    router.refresh();
    close();
  };

  const handleSku = async (event) => {
    event.preventDefault();
    if (!chosenSku) {
      setError("Pilih salah satu SKU yang tersedia.");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await apiPost("/api/dev/products", {
      action: "reassign_sku",
      variantId,
      providerCode: chosenSku,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    router.refresh();
    close();
  };

  const handleDelete = async () => {
    setBusy(true);
    setError(null);
    const result = await apiPost("/api/dev/products", {
      action: "delete",
      variantId,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    router.refresh();
    close();
  };

  const derived = Math.ceil((Number(costPrice) || 0) * 1.08 / 100) * 100;
  const belowCost = Number(priceInput) <= Number(costPrice);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => { setOpen("price"); setPriceInput(String(sellingPrice)); }} className="btn-ghost text-xs">
          Ubah harga
        </button>
        <button
          type="button"
          onClick={() => setOpen("sku")}
          className="btn-ghost text-xs"
          title="Ganti ke SKU lain untuk nominal yang sama"
        >
          Ganti SKU
        </button>
        {hasOrders ? (
          <button type="button" onClick={() => setOpen("delete")} className="btn-ghost text-xs text-warning-fg">
            Nonaktifkan
          </button>
        ) : (
          <button type="button" onClick={() => setOpen("delete")} className="btn-ghost text-xs text-danger-fg">
            Hapus
          </button>
        )}
      </div>

      {/* ── Price editor ──────────────────────────────────────────────── */}
      {open === "price" ? (
        <form onSubmit={handlePrice} className="card space-y-3 p-4">
          <div>
            <label htmlFor={`price-${variantId}`} className="label">
              Harga jual (rupiah)
            </label>
            <input
              id={`price-${variantId}`}
              type="number"
              min="100"
              step="100"
              value={priceInput}
              onChange={(e) => setPriceInput(e.target.value)}
              className="field"
            />
            <p className="mt-1 text-[11px] text-foreground-subtle">
              Harga pokok {formatIDR(costPrice)} · saran otomatis {formatIDR(derived)}
            </p>
          </div>
          {belowCost ? (
            <Alert tone="warning" title="Harga di bawah modal">
              Setiap penjualan varian ini akan rugi. Lanjutkan hanya jika ini memang disengaja.
            </Alert>
          ) : null}
          {error ? <Alert tone="danger" title="Gagal menyimpan">{error}</Alert> : null}
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="btn-primary text-xs">
              {busy ? "Menyimpan…" : "Simpan harga"}
            </button>
            <button type="button" onClick={close} className="btn-ghost text-xs">Batal</button>
          </div>
        </form>
      ) : null}

      {/* ── SKU picker ─────────────────────────────────────────────────── */}
      {open === "sku" ? (
        <form onSubmit={handleSku} className="card space-y-3 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">SKU provider untuk “{variantName}”</p>
              <p className="mt-0.5 text-[11px] text-foreground-subtle">
                Terhubung: <span className="font-mono">{linkedSku ?? "—"}</span>
                {linkedAvailable === false ? <Badge tone="danger" className="ml-2">out of stock</Badge> : null}
              </p>
            </div>
            <button type="button" onClick={loadCandidates} disabled={loadingSku} className="btn-ghost text-xs">
              {loadingSku ? "Memuat…" : "Muat ulang"}
            </button>
          </div>

          {loadingSku ? (
            <div className="flex items-center gap-2 text-xs text-foreground-muted">
              <Spinner /> Mengambil pricelist terbaru dari provider…
            </div>
          ) : candidates.length === 0 ? (
            <Alert tone="info" title="Tidak ada SKU lain">
              Provider tidak memiliki SKU lain untuk nominal ini saat ini.
            </Alert>
          ) : (
            <div className="max-h-72 space-y-2 overflow-y-auto">
              {candidates.map((c) => (
                <label
                  key={c.providerCode}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border p-2.5 text-xs ${
                    chosenSku === c.providerCode
                      ? "border-accent bg-accent/5"
                      : "border-border hover:border-accent/50"
                  } ${!c.available ? "opacity-60" : ""}`}
                >
                  <input
                    type="radio"
                    name={`sku-${variantId}`}
                    value={c.providerCode}
                    checked={chosenSku === c.providerCode}
                    onChange={(e) => setChosenSku(e.target.value)}
                    disabled={!c.available}
                    className="h-4 w-4 accent-accent"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-medium text-foreground">{c.providerCode}</span>
                      {c.available ? <Badge tone="success">active</Badge> : <Badge tone="danger">out of stock</Badge>}
                      {c.sameRegion ? null : <Badge tone="neutral">region lain</Badge>}
                    </div>
                    {c.serverName ? (
                      <p className="mt-0.5 text-[11px] text-foreground-subtle">{c.serverName}</p>
                    ) : null}
                  </div>
                  <span className="tabular-nums font-semibold text-foreground">{formatIDR(c.price)}</span>
                </label>
              ))}
            </div>
          )}

          {error ? <Alert tone="danger" title="Gagal menyimpan">{error}</Alert> : null}
          <div className="flex gap-2">
            <button type="submit" disabled={busy || !chosenSku} className="btn-primary text-xs">
              {busy ? "Menyimpan…" : "Gunakan SKU ini"}
            </button>
            <button type="button" onClick={close} className="btn-ghost text-xs">Batal</button>
          </div>
        </form>
      ) : null}

      {/* ── Delete confirm ────────────────────────────────────────────── */}
      {open === "delete" ? (
        <div className="card space-y-3 p-4">
          {hasOrders ? (
            <Alert tone="warning" title="Varian ini sudah pernah dipesan">
              Varian akan <strong>dinonaktifkan</strong>, bukan dihapus, supaya riwayat transaksi
              pelanggan tetap utuh. Varian tidak akan ditawarkan lagi.
            </Alert>
          ) : (
            <Alert tone="danger" title="Hapus varian?">
              <strong>{variantName}</strong> akan dihapus permanen beserta mapping SKU-nya.
              Tindakan ini tidak bisa dibatalkan.
            </Alert>
          )}
          {error ? <Alert tone="danger" title="Gagal">{error}</Alert> : null}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleDelete}
              disabled={busy}
              className={hasOrders ? "btn-primary text-xs" : "btn-danger text-xs"}
            >
              {busy ? "Memproses…" : hasOrders ? "Nonaktifkan" : "Ya, hapus"}
            </button>
            <button type="button" onClick={close} className="btn-ghost text-xs">Batal</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
