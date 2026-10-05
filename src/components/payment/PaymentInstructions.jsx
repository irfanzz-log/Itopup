"use client";

// ============================================================================
// Payment instructions panel, how the customer actually pays.
//
// WHY THIS COMPONENT HAD TO EXIST
//
// The order page used to say "Instruksi pembayaran belum diterbitkan" and offer
// no way to produce them. The API route existed, the service existed, the
// adapter existed, and no screen called any of it. A customer could create an
// order and then have no way to pay for it.
//
// WHAT IT SHOWS
//
// Everything the customer needs to complete the transfer, in the order they need
// it: the exact amount, the destinations, the invoice number that identifies the
// payment, and the steps. Nothing else, no provider data, no internal ids.
//
// The amount is NEVER editable here. It comes from the server, and the server
// recomputes it from the order; a client-supplied amount would be a way to pay
// less than the order costs.
//
// The amount equals the order total EXACTLY. There is no "kode unik" added on
// top, see src/providers/payment/amount.js for why it was removed.
// ============================================================================
import { useState, useEffect, useRef } from "react";
import { apiPost } from "@/lib/api-client";
import { Alert, Badge, Spinner } from "@/components/ui/primitives";
import { formatIDR, formatDateTime } from "@/lib/format";
import { paymentIcon } from "@/config/payment-icons.js";
import { paymentMethodLabel } from "@/config/payment.js";
import { TERMINAL_ORDER_STATUSES } from "@/lib/constants";

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

export default function PaymentInstructions({ orderId, payment, orderStatus }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [instructions] = useState(payment?.instructions ?? null);
  const [reported, setReported] = useState(false);
  const [qrCopied, setQrCopied] = useState(false);
  // A cancel is two steps (gateway, then our row) and the page's poll can fire
  // while it is in flight, so its own busy flag keeps it from racing itself.
  const [cancelling, setCancelling] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const hasInstructions = Boolean(instructions?.payableAmount);

  // ── The wall clock, for detecting a stale QR ─────────────────────────────
  //
  // Hooks must run unconditionally, so this sits above every early return.
  // `now` is seeded once and refreshed by an effect; computing it inline in the
  // render body is an impure call, and would make the visible countdown depend
  // on when React happened to re-render rather than on real time.
  const [now, setNow] = useState(() => Date.now());
  const expiryMs = instructions?.expiryTime ? new Date(instructions.expiryTime).getTime() : null;
  const hasExpiry = expiryMs !== null && !Number.isNaN(expiryMs);

  useEffect(() => {
    if (!hasExpiry) return undefined;
    const tick = () => setNow(Date.now());
    tick();
    // 30s is fine-grained enough for a 15-minute window and cheap to leave
    // running while the tab is in the background.
    const handle = setInterval(tick, 30_000);
    return () => clearInterval(handle);
  }, [hasExpiry, expiryMs]);

  // ── Auto-poll the gateway so the customer never has to refresh. ──────────
  //
  // The webhook is the primary channel, but it can be delayed or (in sandbox)
  // never fire. Before this, the customer had to hit "Sudah dibayar?" or press
  // F5 to see that the money arrived, which is how a paid order looks
  // abandoned.
  //
  // WHY 45s, not faster: `/api/payment/check` shares a rate-limit bucket of
  // RL_PAYMENT (default 20) per minute with the manual button and the confirm
  // endpoint, and each call costs a Midtrans request. A 15s interval would blow
  // through that bucket inside the QRIS window and turn the poll into a stream
  // of "Gagal mengecek status" errors. 45s is under a minute to a settlement
  // that takes minutes anyway, and leaves the bucket for the customer's own
  // button.
  const autoPollRef = useRef(null);

  useEffect(() => {
    // Only an order still waiting for money needs polling.
    if (TERMINAL_ORDER_STATUSES.includes(orderStatus)) return undefined;

    const handle = setInterval(() => {
      // `checkStatus` is defined below this effect but ABOVE the first render
      // commit, so calling it from a timer is safe, the function exists by the
      // time the interval ever fires.
      autoPollRef.current?.(false);
    }, 45_000);
    return () => clearInterval(handle);
    // orderStatus is the stop condition; orderId is stable per page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderStatus]);

  /**
   * Ask the gateway whether the money arrived.
   *
   * @param {boolean} showErrors, false for the automatic poll, so a rate-limited
   *   or unreachable gateway does not surface a banner to a customer who never
   *   asked for anything. The manual button passes nothing (true), because a
   *   customer who pressed it deserves to know why nothing happened.
   */
  async function checkStatus(showErrors = true) {
    if (busy) return;
    setBusy(true);
    setError(null);

    const result = await apiPost("/api/payment/check", { orderId });

    setBusy(false);

    if (!result.ok) {
      // The auto-poll passes false: a customer who never pressed anything
      // should not get a banner just because the gateway is slow or the bucket
      // is full. The manual button keeps the error, because a customer who
      // pressed it deserves to know why nothing happened.
      if (showErrors) {
        setError(result.error?.message || "Gagal mengecek status pembayaran.");
      }
      return;
    }

    // A settlement (or a terminal failure) changes what the whole page should
    // show, so a reload is the simplest correct reaction: the server component
    // re-reads the payment row and re-renders the panel, the status badge, and
    // the log trail together. Partial state updates here would drift from it.
    if (result.data?.settled || result.data?.status === "PAID") {
      window.location.reload();
      return;
    }

    // The order reached a terminal state with NO payment row, the charge failed
    // mid-checkout and this endpoint answered `terminal: true` instead of a 404.
    // Reload once so the customer reads the cancelled status and the "pesan
    // ulang" path, and stop polling: there is no payment to wait on, and a loop
    // here would re-render the same dead page every 45s.
    if (result.data?.terminal) {
      if (showErrors && result.data?.message) setError(result.data.message);
      window.location.reload();
      return;
    }

    if (result.data?.message) {
      setError(result.data.message);
    }
  }
  // Keep the auto-poll pointed at the current closure. This assignment runs on
  // every render, so the interval always calls the version of `checkStatus`
  // that sees the latest state, not a stale one from the render that set it up.
  autoPollRef.current = checkStatus;

  /** Clipboard write that degrades to nothing instead of throwing. */
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      setQrCopied(true);
      setTimeout(() => setQrCopied(false), 2000);
    } catch {
      // Clipboard is unavailable over plain HTTP or without permission. The
      // text stays on screen and selectable, so this is not worth an error.
    }
  }

  // Midtrans's ISO expiry is UTC. It is formatted with formatDateTime(), which
  // pins Asia/Jakarta, a local toLocaleString() here would use the BROWSER's
  // timezone instead, and a customer on a UTC device would see the deadline
  // seven hours off from the one Midtrans will actually honour.
  //
  // RE-ISSUE IS INTENTIONALLY ABSENT. An expired QR used to be replaceable from
  // this page, which fought the order lifecycle: the charge at Midtrans is dead,
  // and the deadline the customer sees belongs to it. An expired transaction is
  // closed; the customer orders again, which `createOrder` handles by replacing
  // the abandoned order wholesale.

  /**
   * Save the QR image so it can be scanned from another device. A customer on
   * desktop otherwise has to photograph their own screen, which often fails.
   *
   * The image was already fetched to render the <img>, so this reuses that
   * response rather than hitting Midtrans a second time. A blob URL (not the
   * remote URL) is what makes the browser treat it as a download with a real
   * filename instead of navigating to the image.
   */
  async function downloadQr(url, filename) {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      // Revoke on the next tick so the download has started first.
      setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    } catch {
      // The image already shows on the page; failing to save it is not worth a
      // banner. The customer can still scan from the screen or copy the payload.
      setError("Kode QR gagal diunduh. Tetap scan dari layar atau salin payload.");
    }
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

  // ── The customer gives up. ────────────────────────────────────────────────
  //
  // This is a DIFFERENT outcome from letting the timer run out: the customer is
  // telling us they changed their mind, which is recorded as CANCELLED (with the
  // customer as the actor) instead of waiting for the sweep to record EXPIRED.
  // It also voids the charge at Midtrans so the QR/VA cannot be paid into after
  // the customer has left, without that, a stray transfer lands on a
  // transaction nobody is watching anymore.
  async function cancelOrder() {
    if (cancelling || busy) return;
    setCancelling(true);
    setError(null);

    const result = await apiPost("/api/payment/cancel", { orderId });

    setCancelling(false);

    if (!result.ok) {
      setConfirmingCancel(false);
      setError(result.error?.message || "Gagal membatalkan transaksi.");
      return;
    }

    // The page is server-rendered and the row has moved, so a reload is what
    // shows the truth. Same reason as the deadline-refresh path above.
    window.location.reload();
  }

  // ── A cancelled/expired order is closed for business: detail view only. ────
  //
  // The re-issue button used to be offered on every QR that had gone stale,
  // including one whose ORDER had already been closed by the customer checking
  // out again or by the expiry sweep. Issuing under a cancelled order fails at
  // `issuePaymentInstructions` (ITP_ORDER_NOT_PAYABLE), but the customer should
  // never reach an error at all: a closed order shows its instructions as
  // reference and no action.
  const closed = TERMINAL_ORDER_STATUSES.includes(orderStatus);

  // The cancel affordance. Offered on every OPEN payment, gateway or manual,
  // because a customer who has decided not to pay should not have to wait out
  // the clock to be rid of the QR. It is suppressed once the order is closed,
  // where a cancel button would be a no-op that implies the order is still live.
  const cancelButton = closed ? null : (
    <div className="mt-3 border-t border-border pt-3">
      {confirmingCancel ? (
        <div className="rounded-lg border border-danger-border bg-danger-subtle p-3">
          <p className="text-sm font-semibold text-danger-fg">Batalkan transaksi?</p>
          <p className="mt-1 text-xs text-danger-fg/80">
            Kode QR/VA akan dinonaktifkan dan tidak bisa dibayar lagi. Kamu harus
            membuat transaksi baru jika ingin top-up.
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={cancelOrder}
              disabled={cancelling}
              className="btn-danger btn-sm"
            >
              {cancelling ? <Spinner /> : null}
              {cancelling ? "Membatalkan…" : "Ya, batalkan"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingCancel(false)}
              disabled={cancelling}
              className="btn-ghost btn-sm"
            >
              Tidak
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmingCancel(true)}
          disabled={cancelling}
          className="btn-ghost btn-sm text-danger-fg hover:text-danger-fg"
        >
          Batalkan transaksi
        </button>
      )}
    </div>
  );

  // ── Not yet issued: nothing for the customer to act on. ──────────────────
  // issue failed at checkout. The order is still payable, but the customer
  // cannot fix it from this page, the fix is to order again, which is what
  // the expired/closed path below tells them too.

  // ── Force-refresh when the deadline passes. ──────────────────────────────
  //
  // The countdown reaching zero does NOT mean the order is expired in the
  // database: a webhook can settle it in the same second, or the customer can
  // pay into the QR window right at the wire. So the client never decides the
  // order's fate, it asks the gateway once, lets that settle-or-expire, and
  // reloads. Without this the customer sits on a page that says "Berlaku hingga
  // …" in the past and must press F5 to learn the truth.
  const refreshedAtDeadline = useRef(false);

  useEffect(() => {
    // Only meaningful while the order is still open and we actually know the
    // deadline. `hasExpiry` is derived from the instructions, so this is also
    // false for a closed order, which is exactly the set we skip.
    if (!hasExpiry || closed || !now) return undefined;

    const deadline = Date.parse(instructions.expiryTime);
    if (!Number.isFinite(deadline) || now < deadline) return undefined;

    // Fire exactly once per mount. A reload unmounts this component anyway, and
    // guarding here keeps a slow gateway from turning a single expiry into a
    // retry loop.
    if (refreshedAtDeadline.current) return undefined;
    refreshedAtDeadline.current = true;

    const fire = async () => {
      // Ask the gateway, not the row: the row only changes if THIS call moves
      // it. `false` = silent, a failure here falls back to the reload below,
      // and the server re-reads the row on the way back either way.
      await checkStatus(false);
      window.location.reload();
    };
    fire();
    // `now` is the trigger; `instructions.expiryTime` and `orderId` are stable
    // per page. `closed` re-evaluates on each render and is handled by the guard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasExpiry, closed, now]);

  // ── Not yet issued: nothing for the customer to act on. ──────────────────
  // issue failed at checkout. The order is still payable, but the customer
  // cannot fix it from this page, the fix is to order again, which is what
  // the expired/closed path below tells them too.
  if (!hasInstructions) {
    return (
      <div className="mt-4">
        <Alert tone="neutral" title="Instruksi pembayaran belum tersedia">
          <p>
            Nominal dan tujuan pembayaran belum diterbitkan untuk transaksi ini.
            Silakan pesan ulang untuk top-up yang sama.
          </p>
        </Alert>
      </div>
    );
  }

  const isEwallet = instructions.channel === "ewallet";
  const verified = instructions.verifiedAccount;
  const isQr = instructions.kind === "qr";
  const isDeeplink = instructions.kind === "deeplink";
  const isCstore = instructions.kind === "cstore";
  const isGatewayPending = instructions.kind === "gateway_pending";

  // The QR has gone stale once the wall clock passes Midtrans's deadline.
  const isExpired = hasExpiry && now >= expiryMs;

  // ── QRIS / e-wallet: scan from our own page ─────────────────────────────
  // Midtrans returns the QR payload (qr_string) or a URL to the QR image. We
  // render the image directly; qr_string is kept as a copyable fallback.
  if (isQr) {
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
            Scan kode QR dengan aplikasi e-wallet atau m-banking kamu. Nominal harus tepat.
          </p>
        </div>

        <Alert tone="info" title="Scan kode QR">
          <div className="mb-3 flex flex-col items-center gap-3">
            {instructions.qrImageUrl ? (
              // Midtrans hosts the QR image; loading it here does not expose
              // any credential, only the scannable code for this one charge.
              <img
                src={instructions.qrImageUrl}
                alt="Kode QR pembayaran"
                className="h-56 w-56 rounded-lg border border-border bg-white object-contain p-2"
                loading="eager"
                decoding="async"
              />
            ) : null}
            {instructions.qrString ? (
              <button
                type="button"
                onClick={() => copyText(instructions.qrString)}
                className="btn-secondary btn-sm"
              >
                {qrCopied ? "Payload tersalin" : "Salin payload QRIS"}
              </button>
            ) : null}
            {instructions.qrImageUrl ? (
              // Download the QR so the customer can scan it from another device
              // This matters on desktop: the customer would otherwise have to
              // The image is already fetched for the <img> above, so this is a
              // blob copy with no second network round trip.
              <button
                type="button"
                onClick={() => downloadQr(instructions.qrImageUrl, `QR-${instructions.invoice ?? "pembayaran"}.png`)}
                className="btn-ghost btn-sm"
              >
                Unduh kode QR
              </button>
            ) : null}
          </div>
          {(instructions.steps ?? []).map((step, index) => (
            <p key={step} className="mb-1 text-xs text-foreground-muted">
              {index + 1}. {step}
            </p>
          ))}
          {isExpired ? (
            <div className="mt-3 rounded-lg border border-danger-200 bg-danger-subtle p-3">
              <p className="text-sm font-semibold text-danger-fg">Kode QR sudah kedaluwarsa</p>
              <p className="mt-1 text-xs text-danger-fg/80">
                Batas waktu pembayaran untuk transaksi ini sudah berakhir. QR ini
                sudah tidak bisa dipakai dan tidak bisa diperpanjang. Silakan
                pesan ulang untuk top-up yang sama.
              </p>
            </div>
          ) : (
            <p className="mt-2 text-xs text-foreground-subtle">
              Berlaku hingga {formatDateTime(instructions.expiryTime)}.
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={checkStatus}
              disabled={busy}
              className="btn-ghost btn-sm"
            >
              {busy ? <Spinner /> : null}
              {busy ? "Mengecek…" : "Sudah dibayar?"}
            </button>
            {payment?.reference ? (
              <span className="font-mono text-[10px] text-foreground-subtle">
                Ref: {payment.reference}
              </span>
            ) : null}
          </div>
          {error ? (
            <p className="mt-2 text-xs font-medium text-danger-fg">{error}</p>
          ) : null}
          {cancelButton}
        </Alert>
      </div>
    );
  }

  // ── ShopeePay: a redirect to the wallet app, not a scannable code. ──────
  //
  // Midtrans answers ShopeePay with a deeplink and no QR at all. Rendering this
  // as an empty QR panel is what made a ShopeePay order look like a broken
  // payment page: the charge was live at the gateway and the customer had
  // nothing to tap.
  if (isDeeplink) {
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
        </div>

        <Alert tone="info" title="Bayar dengan ShopeePay">
          <div className="mb-3 flex flex-col items-center gap-3">
            <a
              href={instructions.deeplinkUrl}
              className="btn-primary w-full text-center"
              // Shopee's simulator/ app is a different origin; opening it in a
              // tab the customer can return from is the whole point of this link.
              target="_blank"
              rel="noopener noreferrer"
            >
              Bayar dengan ShopeePay
            </a>
          </div>
          {(instructions.steps ?? []).map((step, index) => (
            <p key={step} className="mb-1 text-xs text-foreground-muted">
              {index + 1}. {step}
            </p>
          ))}
          {isExpired ? (
            <div className="mt-3 rounded-lg border border-danger-200 bg-danger-subtle p-3">
              <p className="text-sm font-semibold text-danger-fg">Waktu pembayaran sudah habis</p>
              <p className="mt-1 text-xs text-danger-fg/80">
                Batas waktu pembayaran untuk transaksi ini sudah berakhir dan
                tidak bisa diperpanjang. Silakan pesan ulang untuk top-up yang
                sama.
              </p>
            </div>
          ) : (
            <p className="mt-2 text-xs text-foreground-subtle">
              Berlaku hingga {formatDateTime(instructions.expiryTime)}.
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={checkStatus}
              disabled={busy}
              className="btn-ghost btn-sm"
            >
              {busy ? <Spinner /> : null}
              {busy ? "Mengecek…" : "Sudah dibayar?"}
            </button>
            {payment?.reference ? (
              <span className="font-mono text-[10px] text-foreground-subtle">
                Ref: {payment.reference}
              </span>
            ) : null}
          </div>
          {error ? (
            <p className="mt-2 text-xs font-medium text-danger-fg">{error}</p>
          ) : null}
          {cancelButton}
        </Alert>
      </div>
    );
  }

  // ── Charge accepted, but no instrument we can render ────────────────────
  // Midtrans created the transaction and did not hand back a VA/QR/code. The
  // status field carries the truth about the money, so this says "menunggu
  // pembayaran" instead of inventing an instruction that does not exist.
  //
  // There is deliberately NO "muat ulang instruksi" button here. Re-issuing
  // charges the SAME invoice a second time, which Midtrans answers 406, the
  // button only ever produced a 502. When an instrument really is missing, the
  // customer polls with "Sudah dibayar?" or reloads the page; both read the
  // live state instead of blindly charging again.
  if (isGatewayPending) {
    return (
      <div className="mt-4">
        <Alert tone="info" title="Menunggu pembayaran">
          <p className="mb-3">
            Transaksi sudah dibuat di Midtrans
            {instructions.transactionStatus ? ` (status: ${instructions.transactionStatus})` : ""}.
            Instruksi pembayaran belum tersedia untuk channel ini. Muat ulang
            halaman dalam beberapa saat.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={checkStatus}
              disabled={busy}
              className="btn-ghost btn-sm"
            >
              {busy ? <Spinner /> : null}
              {busy ? "Mengecek…" : "Sudah dibayar?"}
            </button>
          </div>
          {error ? <p className="mt-2 text-xs font-medium text-danger-fg">{error}</p> : null}
          {cancelButton}
        </Alert>
      </div>
    );
  }

  // ── Retail / convenience store: a code read out at the counter ─────────
  // Same shape as the transfer block below (destinations + steps), so it
  // reuses that rendering; only the heading copy differs. No "saya sudah
  // transfer" button for a cash channel, Midtrans reconciles the code.
  if (isCstore) {
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
            Bayar tunai di gerai. Sebutkan kode pembayaran ke kasir.
          </p>
          {instructions.expiryTime ? (
            <p className="mt-2 text-xs text-foreground-subtle">
              Berlaku hingga {formatDateTime(instructions.expiryTime)}.
            </p>
          ) : null}
        </div>

        <div>
          <p className="mb-2 text-sm font-semibold text-foreground">Kode pembayaran</p>
          <ul className="space-y-2">
            {(instructions.destinations ?? []).map((destination) => (
              <DestinationRow key={`${destination.name}-${destination.number}`} destination={destination} />
            ))}
          </ul>
        </div>

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

        <div className="border-t border-border pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={checkStatus}
              disabled={busy}
              className="btn-ghost btn-sm"
            >
              {busy ? <Spinner /> : null}
              {busy ? "Mengecek…" : "Sudah dibayar?"}
            </button>
            {payment?.reference ? (
              <span className="font-mono text-[10px] text-foreground-subtle">
                Ref: {payment.reference}
              </span>
            ) : null}
          </div>
          {error ? <p className="mt-2 text-xs font-medium text-danger-fg">{error}</p> : null}
        </div>
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
          Nominal harus tepat, tidak lebih dan tidak kurang.
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

      {cancelButton}

      {instructions.channel ? (
        <Badge tone="neutral">
          {isEwallet ? "Transfer e-wallet" : "Transfer bank"} · diverifikasi manual
        </Badge>
      ) : null}
    </div>
  );
}
