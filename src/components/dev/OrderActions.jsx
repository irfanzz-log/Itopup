// ============================================================================
// Operator action panel for a single order.
//
// A client component because each action is a request whose result must be shown
// in place, an operator confirming a transfer needs to see "dispatched" or
// "provider rejected it", not a page reload that looks identical either way.
//
// Destructive and irreversible actions (reject, cancel) require a confirmation
// step. Confirming a payment is NOT confirmed twice: the money either arrived or
// it did not, and making the operator click through a dialog every time is how
// they learn to click through dialogs.
// ============================================================================
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Spinner } from "@/components/ui/primitives";
import { apiPost } from "@/lib/api-client";
import { formatIDR } from "@/lib/format";

export default function OrderActions({
  orderId,
  invoice,
  expectedAmount,
  canConfirmPayment,
  canRejectPayment,
  canReconcile,
  canRetryDispatch,
  canCancel,
  canRefund,
}) {
  const router = useRouter();

  const [busy, setBusy] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [paidAmount, setPaidAmount] = useState(String(expectedAmount ?? ""));
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(null);

  async function run(action, extra = {}) {
    setBusy(action);
    setResult(null);
    setError(null);
    setConfirming(null);

    const response = await apiPost(`/api/dev/orders/${orderId}`, { action, ...extra });

    setBusy(null);

    if (!response.ok) {
      setError(response.error?.message || "Tindakan gagal.");
      return;
    }

    setResult({ action, data: response.data });
    // Re-read the server-rendered page so the status badges reflect the new
    // state. The action result is a summary, not the source of truth.
    router.refresh();
  }

  const statusText = (() => {
    if (!result) return null;
    switch (result.action) {
      case "confirm_payment":
        if (result.data.alreadySettled) return "Pembayaran ini sudah dikonfirmasi sebelumnya. Tidak ada pengiriman ulang.";
        if (result.data.dispatch?.dispatched) {
          return `Pembayaran dikonfirmasi dan transaksi dikirim ke provider (status: ${result.data.dispatch.status}).`;
        }
        if (result.data.dispatch) {
          return `Pembayaran dikonfirmasi, tetapi pengiriman ke provider belum berhasil (status: ${result.data.dispatch.status}). Coba "Kirim ulang" setelah provider siap.`;
        }
        return "Pembayaran dikonfirmasi.";
      case "reject_payment":
        return "Pembayaran ditolak.";
      case "reconcile":
        return result.data.resolved
          ? `Status provider: ${result.data.providerStatus}. Status transaksi diperbarui.`
          : `Status belum dapat dipastikan: ${result.data.message}`;
      case "cancel":
        return "Transaksi dibatalkan.";
      case "refund":
        return "Transaksi ditandai sudah dikembalikan. Pastikan transfer baliknya benar-benar terkirim.";
      case "retry_dispatch":
        return result.data.dispatched
          ? `Transaksi dikirim ulang (status: ${result.data.status}).`
          : `Pengiriman belum berhasil (status: ${result.data.status}).`;
      default:
        return "Selesai.";
    }
  })();

  return (
    <div className="space-y-4">
      {/* ── Confirm payment ───────────────────────────────────────────────── */}
      {canConfirmPayment ? (
        <div className="rounded-lg border border-border p-3">
          <p className="text-sm font-semibold text-foreground">Konfirmasi pembayaran diterima</p>
          <p className="mt-0.5 text-xs text-foreground-muted">
            Pastikan dana sudah masuk ke rekening. Tindakan ini menandai transaksi lunas dan
            mengirimkannya ke provider.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div className="w-full sm:w-44">
              <label htmlFor="paidAmount" className="label">Nominal diterima</label>
              <input
                id="paidAmount"
                type="number"
                inputMode="numeric"
                min="0"
                step="1"
                value={paidAmount}
                onChange={(e) => setPaidAmount(e.target.value)}
                className="field tabular-nums"
              />
            </div>
            <button
              type="button"
              className="btn-primary"
              disabled={busy !== null}
              onClick={() => run("confirm_payment", { paidAmount: Number(paidAmount) })}
            >
              {busy === "confirm_payment" ? <Spinner /> : null}
              Konfirmasi &amp; kirim
            </button>
            <span className="text-xs text-foreground-subtle">
              Tagihan: {formatIDR(expectedAmount ?? 0)}
            </span>
          </div>
        </div>
      ) : null}

      {/* ── Reconcile / retry ─────────────────────────────────────────────── */}
      {canReconcile || canRetryDispatch ? (
        <div className="flex flex-wrap gap-2">
          {canReconcile ? (
            <button
              type="button"
              className="btn-secondary"
              disabled={busy !== null}
              onClick={() => run("reconcile")}
            >
              {busy === "reconcile" ? <Spinner /> : null}
              Cek status ke provider
            </button>
          ) : null}
          {canRetryDispatch ? (
            <button
              type="button"
              className="btn-secondary"
              disabled={busy !== null}
              onClick={() => run("retry_dispatch")}
            >
              {busy === "retry_dispatch" ? <Spinner /> : null}
              Kirim ulang ke provider
            </button>
          ) : null}
        </div>
      ) : null}

      {/* ── Destructive ───────────────────────────────────────────────────── */}
      {canRejectPayment || canCancel ? (
        <div className="rounded-lg border border-danger-border p-3">
          <p className="text-sm font-semibold text-danger-fg">Tindakan yang tidak dapat dibatalkan</p>
          <div className="mt-2">
            <label htmlFor="reason" className="label">Alasan (opsional)</label>
            <input
              id="reason"
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={300}
              placeholder="Contoh: dana tidak ditemukan di mutasi"
              className="field"
            />
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {canRejectPayment ? (
              confirming === "reject_payment" ? (
                <>
                  <button
                    type="button"
                    className="btn-danger"
                    disabled={busy !== null}
                    onClick={() => run("reject_payment", { reason: reason || undefined })}
                  >
                    {busy === "reject_payment" ? <Spinner /> : null}
                    Ya, tolak pembayaran
                  </button>
                  <button type="button" className="btn-ghost" onClick={() => setConfirming(null)}>
                    Batal
                  </button>
                </>
              ) : (
                <button type="button" className="btn-secondary" onClick={() => setConfirming("reject_payment")}>
                  Tolak pembayaran
                </button>
              )
            ) : null}

            {canCancel ? (
              confirming === "cancel" ? (
                <>
                  <button
                    type="button"
                    className="btn-danger"
                    disabled={busy !== null}
                    onClick={() => run("cancel", { reason: reason || undefined })}
                  >
                    {busy === "cancel" ? <Spinner /> : null}
                    Ya, batalkan transaksi
                  </button>
                  <button type="button" className="btn-ghost" onClick={() => setConfirming(null)}>
                    Batal
                  </button>
                </>
              ) : (
                <button type="button" className="btn-secondary" onClick={() => setConfirming("cancel")}>
                  Batalkan transaksi
                </button>
              )
            ) : null}
          </div>
        </div>
      ) : null}

      {/* ── Outcome ───────────────────────────────────────────────────────── */}
      {canRefund ? (
        <div className="rounded-lg border border-danger-border p-3">
          <p className="text-sm font-semibold text-danger-fg">Pengembalian dana</p>
          <p className="mt-1 text-xs text-foreground-subtle">
            Ini hanya mencatat status. Transfer baliknya kamu lakukan manual: kirim uangnya, baru
            klik tombol ini agar transaksi sesuai dengan rekening.
          </p>
          <div className="mt-2">
            <label htmlFor="refundReason" className="label">
              Alasan pengembalian <span className="text-danger-fg">*</span>
            </label>
            <input
              id="refundReason"
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={300}
              placeholder="Contoh: transfer gagal, dikembalikan via QRIS"
              className="field"
            />
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {confirming === "refund" ? (
              <>
                <button
                  type="button"
                  className="btn-danger"
                  disabled={busy !== null || !reason.trim()}
                  onClick={() => run("refund", { reason: reason.trim() })}
                >
                  {busy === "refund" ? <Spinner /> : null}
                  Ya, tandai sudah dikembalikan
                </button>
                <button type="button" className="btn-ghost" onClick={() => setConfirming(null)}>
                  Batal
                </button>
              </>
            ) : (
              <button type="button" className="btn-secondary" onClick={() => setConfirming("refund")}>
                Tandai dikembalikan
              </button>
            )}
          </div>
        </div>
      ) : null}

      {/* ── Outcome ───────────────────────────────────────────────────────── */}
      {error ? <Alert tone="danger" title="Tindakan gagal">{error}</Alert> : null}
      {statusText ? (
        <Alert tone={result?.data?.resolved === false ? "warning" : "success"} title={`Invoice ${invoice}`}>
          {statusText}
        </Alert>
      ) : null}
    </div>
  );
}
