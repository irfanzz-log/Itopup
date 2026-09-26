// ============================================================================
// /dev/orders/[id] — order detail with the operator action panel.
//
// The actions shown depend on the CURRENT status, because an operator staring at
// a screen of disabled buttons learns nothing. Each button appears only when its
// precondition holds, and each posts an explicit action to
// /api/dev/orders/[id] — never a raw status write.
// ============================================================================
import Link from "next/link";
import { notFound } from "next/navigation";
import { getOrderForAdmin } from "@/services/order.service.js";
import { PageHeader, Section, FieldList, Money } from "@/components/dev/DevUI";
import OrderActions from "@/components/dev/OrderActions";
import StatusBadge from "@/components/ui/StatusBadge";
import { formatDateTime, formatRelative } from "@/lib/format";
import { ORDER_STATUS } from "@/lib/constants";

export const dynamic = "force-dynamic";

export const metadata = { title: "Detail Transaksi" };

export default async function DevOrderDetailPage({ params }) {
  const { id } = await params;

  let order;
  try {
    order = await getOrderForAdmin(id);
  } catch {
    notFound();
  }

  const canConfirmPayment =
    order.payment &&
    order.payment.status !== "PAID" &&
    (order.status === ORDER_STATUS.PENDING_PAYMENT || order.status === ORDER_STATUS.PAYMENT_PROCESSING);

  const canRejectPayment = Boolean(order.payment) && order.payment.status !== "PAID";
  const canReconcile = order.status === ORDER_STATUS.PROCESSING;
  const canRetryDispatch = order.status === ORDER_STATUS.PAID;
  const canCancel =
    order.status === ORDER_STATUS.PENDING_PAYMENT || order.status === ORDER_STATUS.PAYMENT_PROCESSING;

  const hasActions = canConfirmPayment || canRejectPayment || canReconcile || canRetryDispatch || canCancel;

  return (
    <>
      <PageHeader
        title={order.invoice}
        description={`${order.gameName} · ${order.productName} · ${order.variantName}`}
      >
        <Link href="/dev/orders" className="btn-secondary btn-sm">Kembali</Link>
        <Link href={`/member/orders/${order.id}`} className="btn-ghost btn-sm">
          Lihat sebagai member
        </Link>
      </PageHeader>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <StatusBadge status={order.status} />
        {order.payment ? <StatusBadge status={order.payment.status} kind="payment" /> : null}
        <span className="text-xs text-foreground-subtle">
          Dibuat {formatDateTime(order.createdAt)} ({formatRelative(order.createdAt)})
        </span>
      </div>

      {/* ── Operator actions ──────────────────────────────────────────────── */}
      {hasActions ? (
        <Section
          title="Tindakan operator"
          description="Setiap tindakan dicatat di audit log. Konfirmasi pembayaran otomatis mengirim transaksi ke provider."
          className="mb-6"
        >
          <OrderActions
            orderId={order.id}
            invoice={order.invoice}
            expectedAmount={order.payment?.amount ?? order.total}
            canConfirmPayment={canConfirmPayment}
            canRejectPayment={canRejectPayment}
            canReconcile={canReconcile}
            canRetryDispatch={canRetryDispatch}
            canCancel={canCancel}
          />
        </Section>
      ) : null}

      <div className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* ── Money ──────────────────────────────────────────────────────── */}
        <Section title="Rincian harga" description="Harga pokok dan margin hanya terlihat di panel ini.">
          <FieldList
            items={[
              { label: "Harga jual satuan", value: <Money value={order.unitSellingPrice} /> },
              { label: "Harga pokok satuan", value: <Money value={order.unitCostPrice} /> },
              { label: "Jumlah", value: order.quantity },
              { label: "Subtotal", value: <Money value={order.subtotal} /> },
              { label: "Diskon", value: <Money value={order.discount} /> },
              { label: "Biaya", value: <Money value={order.fee} /> },
              { label: "Total dibayar", value: <Money value={order.total} /> },
              { label: "Margin", value: <Money value={order.margin} /> },
            ]}
          />
        </Section>

        {/* ── Customer input ─────────────────────────────────────────────── */}
        <Section
          title="Data akun tujuan"
          description="Input pelanggan, apa adanya. Ini yang dikirim ke provider."
        >
          {order.customerInput && Object.keys(order.customerInput).length > 0 ? (
            <FieldList
              items={Object.entries(order.customerInput).map(([key, value]) => ({
                label: key,
                value: String(value),
              }))}
            />
          ) : (
            <p className="text-sm text-foreground-muted">Tidak ada data input.</p>
          )}
        </Section>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* ── Payment ────────────────────────────────────────────────────── */}
        <Section title="Pembayaran">
          {order.payment ? (
            <FieldList
              items={[
                { label: "Status", value: <StatusBadge status={order.payment.status} kind="payment" /> },
                { label: "Metode", value: order.payment.method ?? "—" },
                { label: "Provider", value: order.payment.providerCode ?? "—" },
                { label: "Referensi", value: order.payment.reference ?? "—" },
                { label: "Nominal tagihan", value: <Money value={order.payment.amount} /> },
                { label: "Nominal diterima", value: order.payment.paidAmount === null ? "—" : <Money value={order.payment.paidAmount} /> },
                { label: "Dibayar pada", value: order.payment.paidAt ? formatDateTime(order.payment.paidAt) : "—" },
                { label: "Kedaluwarsa", value: order.payment.expiresAt ? formatDateTime(order.payment.expiresAt) : "—" },
              ]}
            />
          ) : (
            <p className="text-sm text-foreground-muted">
              Belum ada instruksi pembayaran. Pelanggan belum memilih metode pembayaran.
            </p>
          )}
        </Section>

        {/* ── Provider ───────────────────────────────────────────────────── */}
        <Section title="Provider">
          <FieldList
            items={[
              { label: "Provider", value: order.provider ? `${order.provider.name} (${order.provider.code})` : "—" },
              { label: "Referensi kami", value: order.providerRef ?? "—" },
              { label: "ID di provider", value: order.providerOrderId ?? "—" },
              { label: "Status provider", value: order.providerStatus ?? "—" },
              { label: "Pesan provider", value: order.providerMessage ?? "—" },
              { label: "Percobaan kirim", value: order.providerAttempts },
              { label: "Dikirim pada", value: order.dispatchedAt ? formatDateTime(order.dispatchedAt) : "—" },
              { label: "Selesai pada", value: order.completedAt ? formatDateTime(order.completedAt) : "—" },
            ]}
          />
        </Section>
      </div>

      {/* ── Member ────────────────────────────────────────────────────────── */}
      <Section title="Member" className="mb-6">
        <FieldList
          items={[
            {
              label: "Nama",
              value: order.user ? (
                <Link href={`/dev/members/${order.user.id}`} className="text-brand-600 hover:underline dark:text-brand-400">
                  {order.user.name}
                </Link>
              ) : "—",
            },
            { label: "Email", value: order.user?.email ?? "—" },
            { label: "Status akun", value: <StatusBadge status={order.user?.status} /> },
            { label: "Peran", value: order.user?.role ?? "—" },
          ]}
        />
      </Section>

      {/* ── Audit trail ───────────────────────────────────────────────────── */}
      <Section
        title="Riwayat transaksi"
        description="Urut dari yang paling awal. Ini sumber kebenaran saat ada sengketa."
        className="mb-6"
      >
        {order.logs.length === 0 ? (
          <p className="text-sm text-foreground-muted">Belum ada catatan.</p>
        ) : (
          <ol className="space-y-3">
            {order.logs.map((entry) => (
              <li key={entry.id} className="flex gap-3">
                <span
                  className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500"
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-mono text-xs font-semibold text-foreground">{entry.event}</span>
                    {entry.durationMs !== null && entry.durationMs !== undefined ? (
                      <span className="text-[11px] text-foreground-subtle">{entry.durationMs} ms</span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-sm text-foreground-muted">{entry.message}</p>
                  <p className="mt-0.5 text-[11px] text-foreground-subtle">
                    {formatDateTime(entry.createdAt)}
                  </p>
                  {entry.metadata ? (
                    <pre className="mt-1.5 overflow-x-auto rounded-lg bg-surface-muted p-2 text-[11px] text-foreground-muted">
                      {JSON.stringify(entry.metadata, null, 2)}
                    </pre>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Section>

      {/* ── Technical ─────────────────────────────────────────────────────── */}
      <Section
        title="Data teknis"
        description="Untuk investigasi. Jangan dibagikan ke pelanggan."
      >
        <FieldList
          cols={3}
          items={[
            { label: "Order ID", value: <span className="font-mono text-xs">{order.id}</span> },
            { label: "Idempotency key", value: <span className="font-mono text-xs">{order.idempotencyKey}</span> },
            { label: "Kedaluwarsa", value: order.expiresAt ? formatDateTime(order.expiresAt) : "—" },
            { label: "IP", value: <span className="font-mono text-xs">{order.ip ?? "—"}</span> },
            { label: "User agent", value: <span className="text-xs">{order.userAgent ?? "—"}</span> },
            { label: "Diperbarui", value: formatDateTime(order.updatedAt) },
          ]}
        />
      </Section>
    </>
  );
}
