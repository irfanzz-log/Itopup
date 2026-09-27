"use client";

// ============================================================================
// Payment instructions panel — how the customer actually pays.
//
// WHY THIS COMPONENT HAD TO EXIST
//
// The order page used to say "Instruksi pembayaran belum diterbitkan" and offer
// no way to produce them. The API route existed, the service existed, the
// adapter existed — and no screen called any of it. A customer could create an
// order and then have no way to pay for it.
//
// WHAT IT SHOWS
//
// Everything the customer needs to complete the transfer, in the order they need
// it: the exact amount, the destinations, the invoice number that identifies the
// payment, and the steps. Nothing else — no provider data, no internal ids.
//
// The amount is NEVER editable here. It comes from the server, and the server
// recomputes it from the order; a client-supplied amount would be a way to pay
// less than the order costs.
//
// The amount equals the order total EXACTLY. There is no "kode unik" added on
// top — see src/providers/payment/amount.js for why it was removed.
// ============================================================================
import { useState } from "react";
import { apiPost } from "@/lib/api-client";
import { Alert, Badge, Spinner } from "@/components/ui/primitives";
import { formatIDR } from "@/lib/format";
import { paymentIcon } from "@/config/icons.js";
import { paymentMethodLabel } from "@/config/payment.js";

/** One destination row: name, number, holder, and a copy button. */
function DestinationRow({ destination }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(destination.number);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard is unavailable over plain HTTP or without permission. The
      // number is on screen and selectable, so this is not worth an error.
    }
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] border border-border bg-surface p-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{destination.name}</p>
        <p className="mt-0.5 break-all font-mono text-base font-bold tracking-wide text-foreground">
          {destination.number}
        </p>
        <p className="mt-0.5 text-xs text-foreground-subtle">a.n. {destination.holder}</p>
      </div>
      <button type="button" onClick={copy} className="btn-secondary btn-sm shrink-0">
        {copied ? "Tersalin" : "Salin"}
      </button>
    </li>
  );
}

export default function PaymentInstructions({ orderId, payment, onIssued }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [instructions, setInstructions] = useState(payment?.instructions ?? null);
  const [reported, setReported] = useState(false);

  const hasInstructions = Boolean(instructions?.payableAmount);

  async function issue() {
    if (busy) return;
    setBusy(true);
    setError(null);

    const result = await apiPost("/api/payment/instructions", {
      orderId,
      // A method is always stored on the payment row by the time instructions
      // are issued. The fallback stays for payments so old their row predates
      // the column; it must be a key that still resolves, and `manual_transfer`
      // no longer does — see the legacy block in src/config/payment.js. It now
      // re-issues as QRIS, the lowest-friction channel, rather than failing.
      paymentMethod: payment?.method || "qris",
    });

    setBusy(false);

    if (!result.ok) {
      setError(result.error?.message || "Gagal menerbitkan instruksi pembayaran.");
      return;
    }

    setInstructions(result.data.instructions ?? null);
    onIssued?.(result.data.payment);
  }

  async function reportTransferred() {
    if (busy) return;
    setBusy(true);
    setError(null);

    const result = await apiPost("/api/payment/confirm", { orderId });

    setBusy(false);

    if (!result.ok) {
      setError(result.error?.message || "Gagal mengirim konfirmasi.");
      return;
    }
    setReported(true);
  }

  // ── Not yet issued: one clear action, not a dead end ─────────────────────
  if (!hasInstructions) {
    return (
      <div className="mt-4">
        <Alert tone="warning" title="Instruksi pembayaran belum tersedia">
          <p className="mb-3">
            Nominal dan tujuan pembayaran belum diterbitkan untuk transaksi ini.
          </p>
          <button type="button" onClick={issue} disabled={busy} className="btn-primary btn-sm">
            {busy ? <Spinner /> : null}
            {busy ? "Menerbitkan…" : "Terbitkan Instruksi Pembayaran"}
          </button>
          {error ? <p className="mt-2 text-xs font-medium text-danger-fg">{error}</p> : null}
        </Alert>
      </div>
    );
  }

  const isEwallet = instructions.channel === "ewallet";
  const verified = instructions.verifiedAccount;
  const isSnap = instructions.kind === "snap_redirect";
  const snapUrl = instructions.redirectUrl || null;

  // ── Gateway payment (Midtrans Snap): hand the customer to Snap ─────────
  // The gateway owns the whole payment screen — the VA number, the QR, the
  // card form. There is nothing to display here but the amount and a way in,
  // so this renders instead of the manual-transfer detail block below.
  if (isSnap) {
    return (
      <div className="mt-4 space-y-4">
        <div className="rounded-[var(--radius-control)] border border-brand-200 bg-brand-soft p-4">
          <div className="flex items-center gap-2">
            {paymentIcon(payment?.method) ? (
              <img
                src={paymentIcon(payment?.method)}
                alt=""
                className="h-9 w-16 rounded bg-white/70 object-contain dark:bg-white/10"
                loading="lazy"
                decoding="async"
              />
            ) : null}
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">
              {payment?.method ? paymentMethodLabel(payment.method) : "Pembayaran"}
            </p>
          </div>
          <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">
            Nominal yang harus dibayar
          </p>
          <p className="mt-1 text-2xl font-extrabold tracking-tight text-foreground">
            {formatIDR(instructions.payableAmount)}
          </p>
          <p className="mt-1.5 text-xs text-foreground-muted">
            Bayar melalui Midtrans. Verifikasi terjadi otomatis.
          </p>
        </div>

        <Alert tone="info" title="Selesaikan pembayaran di halaman Midtrans">
          <p className="mb-3">
            Klik tombol di bawah untuk membuka halaman pembayaran. Pilih metode
            (virtual account, QRIS, kartu, atau e-wallet) di sana — pembayaran
            kamu diverifikasi otomatis dan pesanan diproses begitu dana masuk.
          </p>
          <div className="flex flex-wrap gap-2">
            <a
              href={snapUrl || "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary btn-sm"
            >
              Bayar Sekarang
            </a>
            <button
              type="button"
              onClick={issue}
              disabled={busy}
              className="btn-secondary btn-sm"
            >
              {busy ? <Spinner /> : null}
              {busy ? "Memuat…" : "Muat ulang instruksi"}
            </button>
          </div>
          {error ? (
            <p className="mt-2 text-xs font-medium text-danger-fg">{error}</p>
          ) : null}
        </Alert>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-4">
      {/* ── The account that was verified, before the money ──────────────── */}
      {verified ? (
        <Alert tone="success" title="Akun tujuan terverifikasi">
          <dl className="mt-1 space-y-0.5 text-sm">
            {verified.nickname ? (
              <div className="flex gap-2">
                <dt className="text-foreground-muted">Nama:</dt>
                <dd className="font-semibold">{verified.nickname}</dd>
              </div>
            ) : null}
            {verified.server ? (
              <div className="flex gap-2">
                <dt className="text-foreground-muted">Server:</dt>
                <dd className="font-semibold">{verified.server}</dd>
              </div>
            ) : null}
          </dl>
          <p className="mt-1.5 text-xs text-foreground-muted">
            Pastikan nama di atas benar sebelum mengirim dana.
          </p>
        </Alert>
      ) : null}

      {/* ── The amount, first and unmissable ─────────────────────────────── */}
      <div className="rounded-[var(--radius-control)] border border-brand-200 bg-brand-soft p-4">
        <div className="flex items-center gap-2">
          {paymentIcon(payment?.method) ? (
            <img
              src={paymentIcon(payment?.method)}
              alt=""
              className="h-9 w-16 rounded bg-white/70 object-contain dark:bg-white/10"
              loading="lazy"
              decoding="async"
            />
          ) : null}
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">
            {payment?.method ? paymentMethodLabel(payment.method) : "Pembayaran"}
          </p>
        </div>
        <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">
          Nominal yang harus {isEwallet ? "dikirim" : "ditransfer"}
        </p>
        <p className="mt-1 text-2xl font-extrabold tracking-tight text-foreground">
          {formatIDR(instructions.payableAmount)}
        </p>
        <p className="mt-1.5 text-xs text-foreground-muted">
          Nominal harus tepat — tidak lebih dan tidak kurang.
        </p>
        {instructions.invoice ? (
          <p className="mt-2 text-xs text-foreground-muted">
            Sertakan nomor invoice{" "}
            <strong className="font-mono font-bold text-foreground">{instructions.invoice}</strong>
            {isEwallet ? " bila aplikasi Anda menyediakan kolom catatan." : " pada kolom berita/keterangan transfer."}
          </p>
        ) : null}
      </div>

      {/* ── Destinations ─────────────────────────────────────────────────── */}
      <div>
        <p className="mb-2 text-sm font-semibold text-foreground">
          {isEwallet ? "Kirim ke salah satu nomor berikut" : "Transfer ke salah satu rekening berikut"}
        </p>
        <ul className="space-y-2">
          {(instructions.destinations ?? []).map((destination) => (
            <DestinationRow key={`${destination.name}-${destination.number}`} destination={destination} />
          ))}
        </ul>
      </div>

      {/* ── Steps ────────────────────────────────────────────────────────── */}
      {instructions.steps?.length ? (
        <div>
          <p className="mb-2 text-sm font-semibold text-foreground">Langkah</p>
          <ol className="space-y-2">
            {instructions.steps.map((step, index) => (
              <li key={step} className="flex gap-2.5 text-sm text-foreground-muted">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-muted text-[11px] font-bold text-foreground-muted">
                  {index + 1}
                </span>
                <span className="min-w-0">{step}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {instructions.windowMinutes ? (
        <p className="text-xs text-foreground-subtle">
          Selesaikan dalam {instructions.windowMinutes} menit sejak instruksi diterbitkan.
        </p>
      ) : null}

      {/* ── Customer says "I have paid" ──────────────────────────────────── */}
      <div className="border-t border-border pt-4">
        {reported ? (
          <Alert tone="info" title="Menunggu verifikasi operator">
            <p>
              Konfirmasi Anda sudah diterima. Operator akan memverifikasi pembayaran, dan
              transaksi dilanjutkan ke penyedia layanan setelah dana terverifikasi.
            </p>
          </Alert>
        ) : (
          <>
            <button
              type="button"
              onClick={reportTransferred}
              disabled={busy}
              className="btn-primary w-full sm:w-auto"
            >
              {busy ? <Spinner /> : null}
              {busy ? "Mengirim…" : "Saya sudah transfer"}
            </button>
            <p className="mt-2 text-xs text-foreground-subtle">
              Ini hanya memberi tahu operator. Transaksi baru diproses setelah operator
              memverifikasi dana yang masuk.
            </p>
          </>
        )}
        {error ? <p className="mt-2 text-xs font-medium text-danger-fg">{error}</p> : null}
      </div>

      {instructions.channel ? (
        <Badge tone="neutral">
          {isEwallet ? "Transfer e-wallet" : "Transfer bank"} · diverifikasi manual
        </Badge>
      ) : null}
    </div>
  );
}
