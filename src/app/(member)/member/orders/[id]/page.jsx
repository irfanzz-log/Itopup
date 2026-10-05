// ============================================================================
// /member/orders/[id], order detail.
//
// OWNERSHIP IS ENFORCED BY THE QUERY, not by a comparison after the fetch:
// getOrderForUser() filters on `{ id, userId }`, so somebody else's order is
// indistinguishable from a nonexistent one (both 404). That is the IDOR
// boundary, and it is why this page calls the service rather than Prisma
// directly.
//
// `customerInput` is the customer's OWN data (their player id), so showing it
// back to them is correct. Nothing provider-internal is selected: no provider
// SKU, no cost price, no raw provider payload.
// ============================================================================
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session.js";
import { getOrderForUser, expireStaleOrders } from "@/services/order.service.js";
import StatusBadge from "@/components/ui/StatusBadge";
import { Alert } from "@/components/ui/primitives";
import PaymentInstructions from "@/components/payment/PaymentInstructions";
import DeadlineNote from "@/components/member/DeadlineNote";
import { paymentMethodLabel } from "@/config/payment.js";
import { formatIDR, formatDateTime } from "@/lib/format";
import { ORDER_STATUS, PAYMENT_STATUS, PAYMENT_STATUS_LABEL } from "@/lib/constants";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Detail Transaksi",
  robots: { index: false, follow: false },
};

/**
 * Ask the gateway whether this order was paid, BEFORE the expiry sweep runs.
 *
 * This is the single gateway call the page makes. It runs first because it is
 * the only path that can discover a settlement the webhook has not delivered
 * yet, and because a settled order must not be cancelled by the expiry sweep
 * that follows it in `getOrderForUser`.
 *
 * Ownership is part of the lookup (the payment is fetched through the user's
 * own order), so a stranger's order id answers "nothing to reconcile" rather
 * than revealing that it exists.
 *
 * Every failure mode degrades to "render the row as-is": the webhook and the
 * customer's own "Sudah dibayar?" button still cover it, and a gateway that is
 * slow must not be a reason to make the customer wait or the page break.
 *
 * @returns {Promise<{settled: boolean}|null>} null when there was nothing to ask.
 */
async function reconcileOrderOnPageLoad({ orderId, userId }) {
  const { prisma } = await import("@/lib/db.js");

  // Look the order up THROUGH the user, so this is also the ownership check.
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId },
    select: { id: true, status: true, providerRef: true, providerOrderId: true,
      provider: { select: { code: true } },
      payment: { select: { id: true, status: true } } },
  });
  if (!order) return null;

  // THE TWO QUESTIONS THIS PAGE MUST ASK.
  //
  // A pending PAYMENT asks Midtrans "did the money arrive?". A PROCESSING order
  // asks the top-up provider "did the delivery succeed?". Both are reconcile
  // calls, and previously only the first was made: once the gateway said PAID,
  // this function returned null and the page rendered "Sedang diproses" while
  // never polling the provider. The webhook was the ONLY remaining source of
  // truth, and on localhost (or any host the provider cannot reach) it never
  // fires, so the order sat in PROCESSING with providerStatus UNKNOWN until the
  // 2-minute scheduler happened to run. The customer staring at the page saw a
  // spinner that nothing was driving.
  const askPayment = order.status === ORDER_STATUS.PENDING_PAYMENT ||
    order.status === ORDER_STATUS.PAYMENT_PROCESSING;
  const askProvider = order.status === ORDER_STATUS.PROCESSING && Boolean(order.providerRef);

  if (!askPayment && !askProvider) return null;

  // ── 1. Ask Midtrans whether the money arrived. ───────────────────────────
  if (askPayment) {
    // The broken-order case: the charge failed at checkout and no payment row was
    // ever created. There is nothing to reconcile, and asking would throw.
    if (!order.payment?.id) {
      // No payment row, but the order may still be waiting on the provider,
      // fall through to step 2 rather than abandoning the reconcile entirely.
    } else if (order.payment.status !== PAYMENT_STATUS.PENDING) {
      // A payment already at a terminal state is reconciled by definition; skip
      // the gateway call but still fall through to step 2, because a PAID order
      // is exactly the one whose top-up status we need. Returning here used to
      // silence the provider poll entirely once the money landed.
    } else {
      try {
        const { reconcilePayment } = await import("@/services/payment.service.js");
        const result = await reconcilePayment({
          paymentId: order.payment.id,
          source: "PAGE_LOAD",
          request: null,
        });
        if (result?.settled) return { settled: true };
      } catch (err) {
        console.error("order.page_reconcile_failed", {
          orderId: order.id,
          message: String(err?.message ?? err).slice(0, 200),
        });
      }
    }
  }

  // ── 2. Ask the top-up provider whether the delivery arrived. ─────────────
  // This is a real GET /transaction/{ref} call, then the result is handed to
  // applyProviderStatus, the same sink the webhook writes through, so a
  // poll-driven update and a genuine callback are indistinguishable to the
  // state machine. A provider that still says "pending" changes nothing and
  // costs one cheap call, which is what makes this safe to run on every load.
  try {
    const { getTopupProvider } = await import("@/providers/index.js");
    const provider = getTopupProvider(order.provider?.code);
    if (!provider.isConfigured()) return null;

    const result = await provider.getOrderStatus({
      providerRef: order.providerRef,
      providerOrderId: order.providerOrderId,
    });
    if (!result.ok) return { settled: false, providerChecked: true, applied: false };

    const { applyProviderStatus } = await import("@/services/order.service.js");
    const applied = await applyProviderStatus({
      providerRef: order.providerRef,
      providerOrderId: order.providerOrderId,
      providerStatus: result.data?.status,
      providerMessage: result.data?.message ?? null,
      source: "PAGE_LOAD",
    });
    return { settled: false, providerChecked: true, applied: Boolean(applied?.applied) };
  } catch (err) {
    console.error("order.page_provider_reconcile_failed", {
      orderId: order.id,
      message: String(err?.message ?? err).slice(0, 200),
    });
    return null;
  }
}

export default async function OrderDetailPage({ params }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/member/orders");

  const { id } = await params;

  // ── Ask Midtrans for the truth ONCE, before expiry and read. ───────────────
  //
  // THE POOL BUG THIS FIXES: this page used to make TWO serial gateway round
  // trips, `getOrderForUser()` cancelled the charge at Midtrans, then this
  // block asked Midtrans whether the money had arrived. Each call can take up to
  // 20s under a sandbox stall, and both hold a Postgres connection from a pool
  // of 10. Two open tabs exhausted it, and every other request died with
  // "Connection terminated due to connection timeout", including the admin
  // list, which never touches Midtrans at all.
  //
  // Reconciling FIRST means a paid order is settled before expiry is even
  // considered, so the cancel path is skipped for the order the customer just
  // paid. One call, and the settlement it records is what the render reads.
  const reconciled = await reconcileOrderOnPageLoad({ orderId: id, userId: user.id });

  // The customer's page should not show a payment window that already closed.
  // This page used to rely entirely on the customer's own checkout path to
  // expire their orders, so an abandoned order stayed open in the member area
  // until the customer tried to buy something again. The sweep here is scoped
  // to nothing customer-specific (it expires by deadline, not by user), and it
  // is the same call /dev/orders makes, so what the customer sees and what the
  // operator sees can never disagree.
  await expireStaleOrders({ limit: 100 }).catch(() => {});

  let order;
  try {
    order = await getOrderForUser({ orderId: id, userId: user.id });
  } catch {
    // A malformed id and someone else's id both land here, and both render the
    // same 404. Distinguishing them would turn this page into an existence
    // oracle for other people's orders.
    notFound();
  }

  if (reconciled?.settled || reconciled?.applied) {
    // Re-read: the reconcile changed the row this page is about to render, and
    // the optimistic lock in the apply path means the row below is now
    // consistent. This covers BOTH outcomes: a Midtrans settlement (settled)
    // and a top-up provider status change (applied), e.g. PROCESSING → SUCCESS
    // driven by the poll instead of the webhook.
    try {
      order = await getOrderForUser({ orderId: id, userId: user.id });
    } catch {
      notFound();
    }
  }

  const inputEntries = Object.entries(order.customerInput ?? {});

  // The deadline the customer must actually beat.
  //
  // Midtrans's per-channel expiry is shorter than our order window (QRIS is
  // ~15 minutes against a 60-minute order), and it is the binding one: a QR
  // stops being payable the moment Midtrans expires it, no matter what our own
  // window says. The payment row carries the reconciled deadline (earliest of
  // the two), so it is shown when present; the order window is only the
  // fallback for a payment whose instrument was never issued.
  const deadline = order.payment?.expiresAt ?? order.expiresAt ?? null;

  return (
    <div className="container-page py-8 sm:py-10">
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-foreground-subtle">
        <Link href="/member" className="hover:text-foreground">Akun Saya</Link>
        <span className="mx-1.5" aria-hidden="true">/</span>
        <Link href="/member/orders" className="hover:text-foreground">Transaksi</Link>
        <span className="mx-1.5" aria-hidden="true">/</span>
        <span className="text-foreground">{order.invoice}</span>
      </nav>

      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-extrabold tracking-tight text-foreground sm:text-2xl">
            {order.variantName}
          </h1>
          <p className="mt-1 text-sm text-foreground-muted">
            {order.gameName} · {order.productName}
          </p>
          <p className="mt-1 font-mono text-xs text-foreground-subtle">{order.invoice}</p>
        </div>
        <StatusBadge status={order.status} className="text-sm" />
      </header>

      {order.status === ORDER_STATUS.PENDING_PAYMENT ? (
        <div className="mb-6">
          <Alert tone="warning" title="Menunggu pembayaran">
            <p>
              Selesaikan pembayaran sebelum{" "}
              <strong>{deadline ? formatDateTime(deadline) : "batas waktu"}</strong>.
              Transaksi akan otomatis dibatalkan jika melewati batas waktu tersebut.
            </p>
          </Alert>
        </div>
      ) : null}

      {order.status === ORDER_STATUS.CANCELLED || order.status === ORDER_STATUS.EXPIRED ? (
        <div className="mb-6">
          <Alert tone="neutral" title="Transaksi dibatalkan">
            <p>
              Batas waktu pembayaran untuk transaksi ini sudah berakhir. Transaksi ini sudah
              tertutup dan tidak bisa diperpanjang. Silakan{" "}
              <Link href="/topup" className="font-medium underline">pesan ulang</Link>{" "}
              bila Anda masih ingin top-up yang sama.
            </p>
          </Alert>
        </div>
      ) : null}

      {order.status === ORDER_STATUS.PROCESSING ? (
        <div className="mb-6">
          <Alert tone="info" title="Sedang diproses">
            <p>
              Pesanan sudah dikirim ke penyedia layanan. Status akan diperbarui otomatis begitu
              hasilnya diterima. Anda tidak perlu melakukan apa pun.
            </p>
          </Alert>
        </div>
      ) : null}

      {order.status === ORDER_STATUS.FAILED ? (
        <div className="mb-6">
          <Alert tone="danger" title="Transaksi gagal">
            <p>
              Pesanan tidak dapat dipenuhi. Bila Anda sudah melakukan pembayaran, dana akan
              dikembalikan sesuai kebijakan penyedia pembayaran. Hubungi dukungan dengan menyertakan
              nomor invoice di atas bila dana belum kembali.
            </p>
          </Alert>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <section className="card p-5">
            <h2 className="text-base font-bold text-foreground">Data Tujuan</h2>
            <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              {inputEntries.length === 0 ? (
                <p className="text-sm text-foreground-muted">Tidak ada data tujuan.</p>
              ) : (
                inputEntries.map(([key, value]) => (
                  <div key={key} className="min-w-0">
                    <dt className="text-xs font-medium uppercase tracking-wide text-foreground-subtle">
                      {humanise(key)}
                    </dt>
                    <dd className="mt-0.5 break-all font-mono text-sm font-semibold text-foreground">
                      {String(value)}
                    </dd>
                  </div>
                ))
              )}
            </dl>
            <p className="mt-4 text-xs text-foreground-subtle">
              Pastikan data di atas benar. Top up yang sudah diproses tidak dapat dibatalkan.
            </p>
          </section>

          <section className="card p-5">
            <h2 className="text-base font-bold text-foreground">Rincian Pembayaran</h2>
            <dl className="mt-3 space-y-2.5 text-sm">
              <Row label="Harga satuan" value={formatIDR(order.subtotal)} />
              {order.discount > 0 ? (
                <Row label="Diskon promo" value={`− ${formatIDR(order.discount)}`} tone="success" />
              ) : null}
              {order.fee > 0 ? <Row label="Biaya layanan" value={formatIDR(order.fee)} /> : null}
              <div className="border-t border-border pt-2.5">
                <Row label="Total" value={formatIDR(order.total)} strong />
              </div>
            </dl>

            {order.payment ? (
              <div className="mt-4 rounded-[var(--radius-control)] border border-border bg-surface-muted p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-foreground">
                    {paymentMethodLabel(order.payment.method)}
                  </span>
                  <span className="text-xs font-medium text-foreground-muted">
                    {PAYMENT_STATUS_LABEL[order.payment.status] ?? order.payment.status}
                  </span>
                </div>
                {order.payment.reference ? (
                  <p className="mt-1 font-mono text-xs text-foreground-subtle">
                    Ref: {order.payment.reference}
                  </p>
                ) : null}
                {order.payment.paidAt ? (
                  <p className="mt-1 text-xs text-foreground-subtle">
                    Dibayar: {formatDateTime(order.payment.paidAt)}
                  </p>
                ) : null}
              </div>
            ) : null}

            {/* Only an UNPAID order needs paying. Showing the panel on a paid or
                cancelled order would invite a second transfer. */}
            {order.payment?.status === "PENDING" || !order.payment ? (
              <PaymentInstructions
                orderId={order.id}
                payment={order.payment}
                orderStatus={order.status}
              />
            ) : null}
          </section>

          <section className="card p-5">
            <h2 className="text-base font-bold text-foreground">Riwayat Transaksi</h2>
            {order.logs?.length ? (
              <ol className="mt-3 space-y-3">
                {order.logs.map((entry) => (
                  <li key={`${entry.createdAt}-${entry.event}`} className="flex gap-3">
                    <span
                      className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500"
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">
                        {entry.message || humanise(entry.event)}
                      </p>
                      <p className="mt-0.5 text-xs text-foreground-subtle">
                        {formatDateTime(entry.createdAt)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-3 text-sm text-foreground-muted">Belum ada riwayat untuk transaksi ini.</p>
            )}
          </section>
        </div>

        <aside className="lg:sticky lg:top-20 lg:self-start">
          <div className="card p-5">
            <h2 className="text-base font-bold text-foreground">Informasi</h2>
            <dl className="mt-3 space-y-2.5 text-sm">
              <Row label="Dibuat" value={formatDateTime(order.createdAt)} />
              <Row label="Diperbarui" value={formatDateTime(order.updatedAt)} />
              {order.completedAt ? (
                <Row label="Selesai" value={formatDateTime(order.completedAt)} />
              ) : null}
              <Row label="Jumlah" value={`${order.quantity}×`} />
            </dl>

            {order.status === ORDER_STATUS.PENDING_PAYMENT && deadline ? (
              <DeadlineNote deadline={deadline} expiresAt={order.expiresAt} />
            ) : null}

            <div className="mt-5 flex flex-col gap-2">
              <Link href="/member/orders" className="btn-secondary w-full">Kembali ke Daftar</Link>
              <Link href="/topup" className="btn-primary w-full">Top Up Lagi</Link>
              <Link href="/bantuan#kontak" className="btn-ghost w-full">Butuh Bantuan?</Link>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Row({ label, value, strong = false, tone = null }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-foreground-muted">{label}</dt>
      <dd
        className={`min-w-0 break-words text-right ${
          strong ? "text-base font-extrabold text-foreground" : "font-medium text-foreground"
        } ${tone === "success" ? "text-success-fg" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}

/** `zoneId` → `Zone Id`. Input keys are config-defined, so this is cosmetic. */
function humanise(key) {
  return String(key)
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase())
    .trim();
}
