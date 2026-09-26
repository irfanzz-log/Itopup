// ============================================================================
// /member/orders/[id] — order detail.
//
// OWNERSHIP IS ENFORCED BY THE QUERY, not by a comparison after the fetch:
// getOrderForUser() filters on `{ id, userId }`, so somebody else's order is
// indistinguishable from a nonexistent one (both 404). That is the IDOR
// boundary — and it is why this page calls the service rather than Prisma
// directly.
//
// `customerInput` is the customer's OWN data (their player id), so showing it
// back to them is correct. Nothing provider-internal is selected: no provider
// SKU, no cost price, no raw provider payload.
// ============================================================================
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session.js";
import { getOrderForUser } from "@/services/order.service.js";
import StatusBadge from "@/components/ui/StatusBadge";
import { Alert } from "@/components/ui/primitives";
import PaymentInstructions from "@/components/payment/PaymentInstructions";
import { paymentMethodLabel } from "@/config/payment.js";
import { formatIDR, formatDateTime } from "@/lib/format";
import { ORDER_STATUS, PAYMENT_STATUS_LABEL } from "@/lib/constants";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Detail Transaksi",
  robots: { index: false, follow: false },
};

export default async function OrderDetailPage({ params }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/member/orders");

  const { id } = await params;

  let order;
  try {
    order = await getOrderForUser({ orderId: id, userId: user.id });
  } catch {
    // A malformed id and someone else's id both land here, and both render the
    // same 404. Distinguishing them would turn this page into an existence
    // oracle for other people's orders.
    notFound();
  }

  const inputEntries = Object.entries(order.customerInput ?? {});
  const expiresSoon =
    order.status === ORDER_STATUS.PENDING_PAYMENT &&
    order.expiresAt &&
    new Date(order.expiresAt).getTime() > Date.now();

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
              <strong>{order.expiresAt ? formatDateTime(order.expiresAt) : "batas waktu"}</strong>.
              Transaksi akan otomatis dibatalkan jika melewati batas waktu tersebut.
            </p>
          </Alert>
        </div>
      ) : null}

      {order.status === ORDER_STATUS.PROCESSING ? (
        <div className="mb-6">
          <Alert tone="info" title="Sedang diproses">
            <p>
              Pesanan sudah dikirim ke penyedia layanan. Status akan diperbarui otomatis begitu
              hasilnya diterima — Anda tidak perlu melakukan apa pun.
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

            {expiresSoon ? (
              <p className="mt-4 text-xs text-foreground-subtle">
                Batas pembayaran: {formatDateTime(order.expiresAt)}
              </p>
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
