// ============================================================================
// /member — member overview.
//
// The layout at src/app/(member)/layout.jsx has already verified the session
// against the database and refused blocked accounts, so this page can assume a
// real, usable user. It still re-reads the user through getCurrentUser() rather
// than trusting a prop: layouts and pages render concurrently, and a page must
// never depend on its layout having run first.
// ============================================================================
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session.js";
import { redirect } from "next/navigation";
import { listOrdersForUser } from "@/services/order.service.js";
import StatusBadge from "@/components/ui/StatusBadge";
import { EmptyState, Alert } from "@/components/ui/primitives";
import { formatIDR, formatDateTime, initials } from "@/lib/format";
import { ROLE_LABEL } from "@/lib/constants";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Akun Saya",
  robots: { index: false, follow: false },
};

export default async function MemberHomePage() {
  const user = await getCurrentUser();
  // Defensive: the layout already redirects, but a page reached through a
  // different parent (a future route group) must not render without a session.
  if (!user) redirect("/login?next=/member");

  const { items: recentOrders, pagination } = await listOrdersForUser({
    userId: user.id,
    page: 1,
    limit: 5,
  });

  return (
    <div className="container-page py-8 sm:py-10">
      <header className="mb-6 flex items-center gap-4">
        <span
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-600 text-lg font-bold text-white"
          aria-hidden="true"
        >
          {initials(user.name)}
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-extrabold tracking-tight text-foreground sm:text-2xl">
            Halo, {user.name}
          </h1>
          <p className="mt-0.5 truncate text-sm text-foreground-muted">
            {user.email} · {ROLE_LABEL[user.role] ?? user.role}
          </p>
        </div>
      </header>

      {user.status === "BLOCKED" ? (
        <div className="mb-6">
          <Alert tone="danger" title="Akun Anda diblokir">
            Akses transaksi ditangguhkan. Hubungi dukungan ITOPUP untuk informasi lebih lanjut.
          </Alert>
        </div>
      ) : null}

      <nav aria-label="Menu akun" className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MenuCard
          href="/topup"
          title="Mulai Top Up"
          description="Pilih game atau pulsa."
        />
        <MenuCard
          href="/member/orders"
          title="Transaksi Saya"
          description={`${pagination.total} transaksi tercatat.`}
        />
        <MenuCard
          href="/member/profile"
          title="Profil & Keamanan"
          description="Ubah nama, nomor telepon, dan password."
        />
      </nav>

      <section>
        <div className="mb-4 flex items-end justify-between gap-4">
          <h2 className="text-lg font-bold tracking-tight text-foreground">Transaksi Terakhir</h2>
          {pagination.total > 0 ? (
            <Link
              href="/member/orders"
              className="shrink-0 text-sm font-semibold text-brand-600 hover:underline dark:text-brand-400"
            >
              Lihat semua
            </Link>
          ) : null}
        </div>

        {recentOrders.length === 0 ? (
          <EmptyState
            icon="receipt"
            title="Belum ada transaksi"
            description="Transaksi pertama Anda akan muncul di sini setelah checkout selesai."
            action={<Link href="/topup" className="btn-primary">Mulai Top Up</Link>}
          />
        ) : (
          <ul className="space-y-3">
            {recentOrders.map((order) => (
              <li key={order.id}>
                <Link
                  href={`/member/orders/${order.id}`}
                  className="card-interactive flex flex-wrap items-center gap-x-4 gap-y-2 p-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {order.variantName} · {order.gameName}
                    </p>
                    <p className="mt-0.5 font-mono text-xs text-foreground-subtle">{order.invoice}</p>
                  </div>
                  <StatusBadge status={order.status} />
                  <div className="text-right">
                    <p className="text-sm font-bold text-foreground">{formatIDR(order.total)}</p>
                    <p className="mt-0.5 text-xs text-foreground-subtle">
                      {formatDateTime(order.createdAt)}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function MenuCard({ href, title, description }) {
  return (
    <Link href={href} className="card-interactive flex items-start gap-3 p-4">
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-foreground">{title}</span>
        <span className="mt-0.5 block text-xs text-foreground-muted">{description}</span>
      </span>
      <svg
        className="ml-auto h-4 w-4 shrink-0 text-foreground-subtle"
        viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" />
      </svg>
    </Link>
  );
}
