// ============================================================================
// /dev/dashboard, the operational front page.
//
// ORDER OF THE SECTIONS IS THE POINT: what needs a human comes first, the
// numbers come second. A dashboard that opens with revenue and buries "3
// payments waiting for verification" is a dashboard nobody acts on.
// ============================================================================
import Link from "next/link";
import { dashboardSnapshot } from "@/services/dev.service.js";
import { PageHeader, StatCard, StatGrid, Section, Money } from "@/components/dev/DevUI";
import StatusBadge from "@/components/ui/StatusBadge";
import { formatDateTime, formatRelative } from "@/lib/format";
import { ORDER_STATUS_LABEL } from "@/lib/constants";

export const dynamic = "force-dynamic";

export const metadata = { title: "Dashboard" };

export default async function DevDashboardPage() {
  const { statuses, revenue, members, queue, orders, providers } = await dashboardSnapshot();

  const needsAttention =
    queue.awaitingVerification + queue.stuckProcessing + queue.expiringSoon + queue.failedToday;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Ringkasan operasional ITOPUP. Angka diambil langsung dari database, bukan cache."
      />

      {/* ── 1. What needs a human ─────────────────────────────────────────── */}
      <Section
        title="Perlu tindakan"
        description="Antrian yang menunggu operator. Kosong berarti tidak ada yang tertahan."
        className="mb-6"
      >
        {needsAttention === 0 ? (
          <p className="text-sm text-success-fg">
            Tidak ada transaksi yang menunggu tindakan. Semua antrian bersih.
          </p>
        ) : (
          <StatGrid cols={3}>
            {/* "Menunggu verifikasi" is GONE: it counted payments sitting in the
                manual PROCESSING state, waiting for an operator to confirm a
                bank transfer. Midtrans settles every method we offer
                automatically (QRIS + VA), so that queue is permanently empty
                and its card was a box that could never light up. The manual
                confirm path still exists for an off-platform payment, but it is
                no longer a thing the dashboard tells the operator to wait on. */}
            <StatCard
              label="Kirim macet"
              value={queue.stuckProcessing}
              hint="Diproses > 10 menit, perlu rekonsiliasi"
              tone={queue.stuckProcessing > 0 ? "danger" : "neutral"}
              href="/dev/orders?status=PROCESSING"
            />
            <StatCard
              label="Menunggu Pembayaran"
              value={queue.expiringSoon}
              hint="Hangus dalam 30 menit"
              tone={queue.expiringSoon > 0 ? "warning" : "neutral"}
              href="/dev/orders?status=PENDING_PAYMENT"
            />
            <StatCard
              label="Gagal 24 jam"
              value={queue.failedToday}
              hint="Perlu dicek penyebabnya"
              tone={queue.failedToday > 0 ? "danger" : "neutral"}
              href="/dev/orders?status=FAILED"
            />
          </StatGrid>
        )}
      </Section>

      {/* ── 2. Money ──────────────────────────────────────────────────────── */}
      <Section
        title="Keuangan"
        description="Pendapatan hanya dihitung dari transaksi SUCCESS, barang yang benar-benar terkirim."
        className="mb-6"
      >
        <StatGrid cols={4}>
          <StatCard
            label="Pendapatan (selesai)"
            value={<Money value={revenue.completed.total} />}
            hint={`${revenue.completed.orders} transaksi berhasil`}
            tone="success"
          />
          <StatCard
            label="Margin (selesai)"
            value={<Money value={revenue.completed.margin} />}
            hint="Harga jual − harga pokok, tersimpan per transaksi"
            tone="brand"
          />
          <StatCard
            label="Dibayar, belum terkirim"
            value={<Money value={revenue.inFlight.total} />}
            hint={`${revenue.inFlight.orders} transaksi. Uang masuk, barang belum`}
            tone={revenue.inFlight.orders > 0 ? "warning" : "neutral"}
          />
          <StatCard
            label="Total diskon"
            value={<Money value={revenue.completed.discount} />}
            hint="Dari transaksi selesai"
          />
        </StatGrid>
      </Section>

      <div className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* ── 3. Status breakdown ────────────────────────────────────────── */}
        <Section title="Transaksi per status" description="Seluruh riwayat, tanpa filter tanggal.">
          <ul className="divide-y divide-border">
            {Object.entries(statuses).map(([status, count]) => (
              <li key={status} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                <StatusBadge status={status} />
                <span className="text-sm font-semibold tabular-nums text-foreground">
                  {count.toLocaleString("id-ID")}
                </span>
              </li>
            ))}
          </ul>
        </Section>

        {/* ── 4. Provider state ──────────────────────────────────────────── */}
        <Section
          title="Provider"
          description="Saldo prabayar dan status sinkronisasi terakhir."
          action={
            <Link href="/dev/providers" className="btn-secondary btn-sm">
              Kelola
            </Link>
          }
        >
          {providers.length === 0 ? (
            <p className="text-sm text-foreground-muted">
              Belum ada provider terdaftar. Jalankan seed atau tambahkan lewat /dev/providers.
            </p>
          ) : (
            <ul className="space-y-3">
              {providers.map((provider) => (
                <li key={provider.id} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">{provider.name}</p>
                      <p className="font-mono text-xs text-foreground-subtle">{provider.code}</p>
                    </div>
                    <StatusBadge status={provider.status} />
                  </div>
                  <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                    <div>
                      <dt className="text-foreground-subtle">Saldo prabayar</dt>
                      <dd className="font-semibold tabular-nums text-foreground">
                        {provider.balance === null ? "—" : <Money value={provider.balance} />}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-foreground-subtle">Sinkron terakhir</dt>
                      <dd className="text-foreground">
                        {provider.lastSyncAt ? formatRelative(provider.lastSyncAt) : "Belum pernah"}
                      </dd>
                    </div>
                  </dl>
                  {provider.balance === 0 ? (
                    <p className="mt-2 text-xs text-danger-fg">
                      Saldo nol atau belum pernah disinkronkan. Transaksi akan ditolak provider.
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {/* ── 5. Members ────────────────────────────────────────────────────── */}
      <Section
        title="Member"
        className="mb-6"
        action={
          <Link href="/dev/members" className="btn-secondary btn-sm">
            Lihat semua
          </Link>
        }
      >
        <StatGrid cols={5}>
          <StatCard label="Total" value={members.total} />
          <StatCard label="Aktif" value={members.active} tone="success" />
          <StatCard label="Diblokir" value={members.blocked} tone={members.blocked > 0 ? "danger" : "neutral"} />
          <StatCard label="Staf" value={members.staff} />
          <StatCard label="Baru 24 jam" value={members.newToday} tone="brand" />
        </StatGrid>
      </Section>

      {/* ── 6. Recent activity ────────────────────────────────────────────── */}
      <Section
        title="Transaksi terbaru"
        action={
          <Link href="/dev/orders" className="btn-secondary btn-sm">
            Semua transaksi
          </Link>
        }
      >
        {orders.length === 0 ? (
          <p className="text-sm text-foreground-muted">Belum ada transaksi.</p>
        ) : (
          <ul className="divide-y divide-border">
            {orders.map((order) => (
              <li key={order.id}>
                <Link
                  href={`/dev/orders/${order.id}`}
                  className="-mx-2 flex flex-wrap items-center justify-between gap-2 rounded-lg px-2 py-2.5 hover:bg-surface-muted"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {order.variantName}
                      <span className="text-foreground-subtle"> · {order.gameName}</span>
                    </p>
                    <p className="mt-0.5 truncate text-xs text-foreground-subtle">
                      <span className="font-mono">{order.invoice}</span>
                      {" · "}
                      {order.user?.email ?? "—"}
                      {" · "}
                      {formatDateTime(order.createdAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold tabular-nums text-foreground">
                      <Money value={order.total} />
                    </span>
                    <StatusBadge status={order.status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <p className="mt-6 text-xs text-foreground-subtle">
        Label status mengikuti sistem: {Object.values(ORDER_STATUS_LABEL).join(" · ")}
      </p>
    </>
  );
}
