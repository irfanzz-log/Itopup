// ============================================================================
// /dev/orders, transaction list with the operator's action queue.
//
// Filters live in the QUERY STRING so the list is server-rendered and
// shareable: "look at /dev/orders?status=PAYMENT_PROCESSING" in a support thread
// is a working instruction, not a description of clicks.
//
// Cost and margin are shown here and NOWHERE in the member area. This is the
// only screen where the provider's price is a legitimate concern.
// ============================================================================
import Link from "next/link";
import { listOrdersForAdmin, expireStaleOrders } from "@/services/order.service.js";
import { PageHeader, Section, DataTable, Td, Money } from "@/components/dev/DevUI";
import StatusBadge from "@/components/ui/StatusBadge";
import Pagination, { ResultCount } from "@/components/ui/Pagination";
import { EmptyState } from "@/components/ui/primitives";
import { formatDateTime, formatRelative } from "@/lib/format";
import { ORDER_STATUS, ORDER_STATUS_LABEL } from "@/lib/constants";

export const dynamic = "force-dynamic";

export const metadata = { title: "Transaksi" };

/** Filters in lifecycle order, the order an operator thinks in. */
const FILTERS = [
  ORDER_STATUS.PENDING_PAYMENT,
  // PAYMENT_PROCESSING is deliberately NOT offered. Midtrans settles every
  // method automatically, so the status exists in the state machine but an
  // order never rests there: it is the sub-second hop between charge and PAID.
  // A filter that can never match a row is a promise the page breaks.
  ORDER_STATUS.PAID,
  ORDER_STATUS.PROCESSING,
  ORDER_STATUS.SUCCESS,
  ORDER_STATUS.FAILED,
  ORDER_STATUS.EXPIRED,
  ORDER_STATUS.CANCELLED,
  ORDER_STATUS.REFUND,
];

export default async function DevOrdersPage({ searchParams }) {
  const params = await searchParams;

  const page = Math.max(1, parseInt(params?.page ?? "1", 10) || 1);
  const status = FILTERS.includes(params?.status) ? params.status : null;
  const search = typeof params?.q === "string" ? params.q.slice(0, 100) : "";

  // Expiry must be true when an operator reads it, not when the customer who
  // abandoned the order happens to come back. Without this sweep the list shows
  // "Menunggu Pembayaran" on orders whose window closed days ago, the exact
  // failure this page exists to prevent. Swallowing errors is deliberate: a
  // sweep that cannot run must not stop an operator from seeing orders.
  await expireStaleOrders({ limit: 100 }).catch(() => {});

  const { items, pagination } = await listOrdersForAdmin({ page, limit: 20, status, search });

  const buildHref = (nextPage) => {
    const query = new URLSearchParams();
    if (status) query.set("status", status);
    if (search) query.set("q", search);
    if (nextPage > 1) query.set("page", String(nextPage));
    const qs = query.toString();
    return `/dev/orders${qs ? `?${qs}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title="Transaksi"
        description="Seluruh transaksi beserta harga pokok, margin, dan status provider. Hanya staf yang dapat melihat halaman ini."
      />

      {/* ── Search ───────────────────────────────────────────────────────── */}
      <form method="get" className="card mb-4 flex flex-col gap-3 p-4 sm:flex-wrap sm:flex-row sm:items-end">
        {status ? <input type="hidden" name="status" value={status} /> : null}
        <div className="min-w-0 flex-1 sm:min-w-[16rem]">
          <label htmlFor="q" className="label">Cari</label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={search}
            placeholder="Invoice, email, atau nama produk"
            className="field"
          />
        </div>
        <div className="flex flex-wrap gap-2 sm:contents">
          <button type="submit" className="btn-primary">Cari</button>
          {search || status ? (
            <Link href="/dev/orders" className="btn-ghost">Reset</Link>
          ) : null}
        </div>
      </form>

      {/* ── Status filters ───────────────────────────────────────────────── */}
      <nav aria-label="Filter status" className="mb-5 flex flex-wrap gap-2">
        <FilterChip href={search ? `/dev/orders?q=${encodeURIComponent(search)}` : "/dev/orders"} active={!status} label="Semua" />
        {FILTERS.map((value) => {
          const query = new URLSearchParams({ status: value });
          if (search) query.set("q", search);
          return (
            <FilterChip
              key={value}
              href={`/dev/orders?${query.toString()}`}
              active={status === value}
              label={ORDER_STATUS_LABEL[value]}
            />
          );
        })}
      </nav>

      {items.length === 0 ? (
        <EmptyState
          icon="receipt"
          title="Tidak ada transaksi"
          description={
            search || status
              ? "Tidak ada transaksi yang cocok dengan filter ini."
              : "Transaksi akan muncul di sini setelah ada member yang checkout."
          }
        />
      ) : (
        <Section
          title="Daftar transaksi"
          description={`Menampilkan ${items.length} dari ${pagination.total} transaksi.`}
        >
          <ResultCount page={pagination.page} limit={pagination.limit} total={pagination.total} noun="transaksi" />

          <div className="mt-3">
            <DataTable
              caption="Daftar seluruh transaksi"
              columns={[
                { key: "invoice", label: "Invoice" },
                { key: "member", label: "Member" },
                { key: "produk", label: "Produk" },
                { key: "total", label: "Total", align: "right" },
                { key: "margin", label: "Margin", align: "right" },
                { key: "bayar", label: "Pembayaran" },
                { key: "status", label: "Status" },
                { key: "waktu", label: "Dibuat" },
              ]}
              rows={items}
              renderRow={(order) => (
                <>
                  <Td>
                    <Link
                      href={`/dev/orders/${order.id}`}
                      className="font-mono text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400"
                    >
                      {order.invoice}
                    </Link>
                    {order.providerRef && order.providerRef !== order.invoice ? (
                      <span className="mt-0.5 block font-mono text-[11px] text-foreground-subtle">
                        ref: {order.providerRef}
                      </span>
                    ) : null}
                  </Td>
                  <Td>
                    <span className="block text-xs text-foreground">{order.user?.name ?? "—"}</span>
                    <span className="mt-0.5 block text-[11px] text-foreground-subtle">
                      {order.user?.email ?? "—"}
                    </span>
                  </Td>
                  <Td>
                    <span className="block text-xs text-foreground">{order.variantName}</span>
                    <span className="mt-0.5 block text-[11px] text-foreground-subtle">{order.gameName}</span>
                  </Td>
                  <Td align="right">
                    <Money value={order.total} className="text-xs font-semibold" />
                    {order.discount > 0 ? (
                      <span className="mt-0.5 block text-[11px] text-success-fg">
                        −<Money value={order.discount} />
                      </span>
                    ) : null}
                  </Td>
                  <Td align="right">
                    <Money value={order.margin} className="text-xs" />
                  </Td>
                  <Td>
                    {order.payment ? (
                      <>
                        <StatusBadge status={order.payment.status} kind="payment" />
                        <span className="mt-0.5 block text-[11px] text-foreground-subtle">
                          {order.payment.method ?? "—"}
                        </span>
                      </>
                    ) : (
                      <span className="text-xs text-foreground-subtle">Belum ada</span>
                    )}
                  </Td>
                  <Td>
                    <StatusBadge status={order.status} />
                    {order.providerStatus ? (
                      <span className="mt-0.5 block font-mono text-[11px] text-foreground-subtle">
                        {order.providerStatus}
                      </span>
                    ) : null}
                  </Td>
                  <Td>
                    <span className="block text-xs text-foreground-muted">{formatDateTime(order.createdAt)}</span>
                    <span className="mt-0.5 block text-[11px] text-foreground-subtle">
                      {formatRelative(order.createdAt)}
                    </span>
                  </Td>
                </>
              )}
              renderCard={(order) => (
                <Link href={`/dev/orders/${order.id}`} className="card-interactive block p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{order.variantName}</p>
                      <p className="mt-0.5 truncate font-mono text-xs text-foreground-subtle">{order.invoice}</p>
                    </div>
                    <StatusBadge status={order.status} />
                  </div>
                  <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="truncate text-foreground-muted">{order.user?.email ?? "—"}</span>
                    <Money value={order.total} className="font-semibold text-foreground" />
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-foreground-subtle">
                    <span>{formatDateTime(order.createdAt)}</span>
                    {order.payment ? <StatusBadge status={order.payment.status} kind="payment" /> : null}
                  </div>
                </Link>
              )}
            />
          </div>

          <Pagination
            className="mt-5"
            page={pagination.page}
            pages={pagination.pages}
            buildHref={buildHref}
          />
        </Section>
      )}
    </>
  );
}

function FilterChip({ href, active, label }) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
        active
          ? "border-brand-500 bg-brand-soft text-brand-700 dark:text-brand-100"
          : "border-border text-foreground-muted hover:border-brand-300 hover:text-foreground"
      }`}
    >
      {label}
    </Link>
  );
}
