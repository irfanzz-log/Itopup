// ============================================================================
// /member/orders — transaction history.
//
// Filters live in the QUERY STRING, so the list is server-rendered, shareable,
// and works without JavaScript. `page` and `status` are parsed defensively: an
// unknown status is ignored rather than passed to Prisma, where an invalid enum
// would raise a 500 instead of showing the unfiltered list.
// ============================================================================
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session.js";
import { listOrdersForUser } from "@/services/order.service.js";
import StatusBadge from "@/components/ui/StatusBadge";
import Pagination, { ResultCount } from "@/components/ui/Pagination";
import { EmptyState } from "@/components/ui/primitives";
import { formatIDR, formatDateTime } from "@/lib/format";
import { ORDER_STATUS, ORDER_STATUS_LABEL } from "@/lib/constants";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Transaksi Saya",
  robots: { index: false, follow: false },
};

/** Statuses offered as filters, in lifecycle order. */
const FILTERS = [
  ORDER_STATUS.PENDING_PAYMENT,
  ORDER_STATUS.PAID,
  ORDER_STATUS.PROCESSING,
  ORDER_STATUS.SUCCESS,
  ORDER_STATUS.FAILED,
  ORDER_STATUS.EXPIRED,
];

export default async function MemberOrdersPage({ searchParams }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/member/orders");

  const params = await searchParams;

  const page = Math.max(1, parseInt(params?.page ?? "1", 10) || 1);
  const status = FILTERS.includes(params?.status) ? params.status : null;

  const { items, pagination } = await listOrdersForUser({
    userId: user.id,
    page,
    limit: 10,
    status,
  });

  const buildHref = (nextPage) => {
    const query = new URLSearchParams();
    if (status) query.set("status", status);
    if (nextPage > 1) query.set("page", String(nextPage));
    const qs = query.toString();
    return `/member/orders${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="container-page py-8 sm:py-10">
      <header className="mb-6">
        <h1 className="text-xl font-extrabold tracking-tight text-foreground sm:text-2xl">
          Transaksi Saya
        </h1>
        <p className="mt-1 text-sm text-foreground-muted">
          Riwayat lengkap transaksi akun Anda, termasuk status pembayaran dan status pesanan.
        </p>
      </header>

      <nav aria-label="Filter status" className="mb-5 flex flex-wrap gap-2">
        <FilterChip href={buildHref(1)} active={!status} label="Semua" />
        {FILTERS.map((value) => (
          <FilterChip
            key={value}
            href={`/member/orders?status=${value}`}
            active={status === value}
            label={ORDER_STATUS_LABEL[value]}
          />
        ))}
      </nav>

      {items.length === 0 ? (
        <EmptyState
          icon="receipt"
          title={status ? "Tidak ada transaksi dengan status ini" : "Belum ada transaksi"}
          description={
            status
              ? "Coba pilih filter lain atau lihat seluruh riwayat transaksi Anda."
              : "Transaksi pertama Anda akan muncul di sini setelah checkout selesai."
          }
          action={<Link href="/topup" className="btn-primary">Mulai Top Up</Link>}
        />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <ResultCount page={pagination.page} limit={pagination.limit} total={pagination.total} noun="transaksi" />
          </div>

          {/* Desktop table. */}
          <div className="card hidden overflow-hidden lg:block">
            <table className="w-full text-sm">
              <caption className="sr-only">Daftar transaksi</caption>
              <thead>
                <tr className="border-b border-border bg-surface-muted text-left text-xs uppercase tracking-wide text-foreground-subtle">
                  <th scope="col" className="px-4 py-3 font-semibold">Invoice</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Produk</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Tanggal</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Total</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((order) => (
                  <tr key={order.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      <Link
                        href={`/member/orders/${order.id}`}
                        className="font-mono text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400"
                      >
                        {order.invoice}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className="block font-medium text-foreground">{order.variantName}</span>
                      <span className="mt-0.5 block text-xs text-foreground-subtle">{order.gameName}</span>
                    </td>
                    <td className="px-4 py-3 text-foreground-muted">{formatDateTime(order.createdAt)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-foreground">
                      {formatIDR(order.total)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={order.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards — the same data, because a horizontally scrolling table
              on a phone is where support tickets come from. */}
          <ul className="space-y-3 lg:hidden">
            {items.map((order) => (
              <li key={order.id}>
                <Link href={`/member/orders/${order.id}`} className="card-interactive block p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {order.variantName}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-foreground-subtle">{order.gameName}</p>
                    </div>
                    <StatusBadge status={order.status} />
                  </div>
                  <div className="mt-3 flex items-end justify-between gap-3">
                    <span className="font-mono text-xs text-foreground-subtle">{order.invoice}</span>
                    <span className="text-right">
                      <span className="block text-sm font-bold text-foreground">
                        {formatIDR(order.total)}
                      </span>
                      <span className="mt-0.5 block text-xs text-foreground-subtle">
                        {formatDateTime(order.createdAt)}
                      </span>
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          <Pagination
            className="mt-6"
            page={pagination.page}
            pages={pagination.pages}
            buildHref={buildHref}
          />
        </>
      )}
    </div>
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
