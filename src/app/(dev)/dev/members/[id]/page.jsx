// ============================================================================
// /dev/members/[id] — member detail.
//
// Shows the same information support needs: spend, order history, block
// history, and the actions an operator can take. Block/reset are
// irreversible to the member's access, so the UI requires a confirmation
// step and the audit trail records the operator who took the action.
// ============================================================================
import Link from "next/link";
import { notFound } from "next/navigation";
import { getMemberDetail } from "@/services/user.service.js";
import { PageHeader, Section, FieldList, Money } from "@/components/dev/DevUI";
import StatusBadge from "@/components/ui/StatusBadge";
import { formatDateTime } from "@/lib/format";
import { ROLE_LABEL, USER_STATUS_LABEL } from "@/lib/constants";
import MemberActions from "@/components/dev/MemberActions";

export const dynamic = "force-dynamic";

export const metadata = { title: "Detail Member" };

export default async function DevMemberDetailPage({ params }) {
  const { id } = await params;

  let detail;
  try {
    detail = await getMemberDetail(id);
  } catch {
    notFound();
  }

  const { user, stats, recentOrders, blocks } = detail;
  const isBlocked = user.status === "BLOCKED";

  return (
    <>
      <PageHeader
        title={user.name}
        description={
          <span>
            <span className="font-mono text-xs text-foreground-subtle">{user.email}</span>
            {" · "}
            {ROLE_LABEL[user.role] ?? user.role}
          </span>
        }
      >
        <Link href="/dev/members" className="btn-secondary btn-sm">Kembali</Link>
        <Link href={`/member/orders`} className="btn-ghost btn-sm">Lihat sebagai member</Link>
      </PageHeader>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <StatusBadge status={user.status} />
        <span className="text-xs text-foreground-subtle">
          Terdaftar {formatDateTime(user.createdAt)}
        </span>
        {isBlocked && user.blockedReason ? (
          <span className="chip">{user.blockedReason}</span>
        ) : null}
      </div>

      {/* ── Stats ──────────────────────────────────────────────────────── */}
      <Section title="Ringkasan" className="mb-6">
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
          {[
            { label: "Pesanan", value: stats.orderCount, tone: "neutral" },
            { label: "Berhasil", value: stats.successCount, tone: "success" },
            { label: "Total belanja", value: <Money value={stats.totalSpend} />, tone: "brand" },
            { label: "Peran", value: ROLE_LABEL[user.role] ?? user.role, tone: "neutral" },
            { label: "Status", value: USER_STATUS_LABEL[user.status] ?? user.status, tone: isBlocked ? "danger" : "success" },
          ].map((stat) => (
            <div key={stat.label} className="card p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
                {stat.label}
              </p>
              <p className={`mt-1 text-lg font-extrabold ${
                stat.tone === "brand" ? "text-brand-600 dark:text-brand-400"
                : stat.tone === "success" ? "text-success-fg"
                : stat.tone === "danger" ? "text-danger-fg"
                : "text-foreground"
              }`}>{stat.value}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Operator actions ──────────────────────────────────────────── */}
      <Section
        title="Tindakan"
        description="Setiap tindakan dicatat di audit log."
        className="mb-6"
      >
        <MemberActions
          memberId={user.id}
          memberName={user.name}
          status={user.status}
          role={user.role}
        />
      </Section>

      {/* ── Block history ─────────────────────────────────────────────── */}
      <Section title="Riwayat pemblokiran" className="mb-6">
        {blocks.length === 0 ? (
          <p className="text-sm text-foreground-muted">Belum ada pemblokiran.</p>
        ) : (
          <ol className="space-y-3">
            {blocks.map((block) => (
              <li key={block.id} className="flex gap-3">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-danger-fg" aria-hidden="true" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-mono text-xs font-semibold text-foreground">
                      {block.unblockedAt ? "Diblokir" : "Masih diblokir"}
                    </span>
                    <span className="text-[11px] text-foreground-subtle">
                      {block.blockedById ? `oleh ${block.blockedById.name ?? block.blockedById.email ?? "—"}` : "—"}
                    </span>
                  </div>
                  {block.blockedReason ? (
                    <p className="mt-0.5 text-sm text-foreground-muted">{block.blockedReason}</p>
                  ) : null}
                  <p className="mt-0.5 text-[11px] text-foreground-subtle">
                    {block.blockedAt ? formatDateTime(block.blockedAt) : "—"}
                    {block.unblockedAt ? ` — dibuka ${formatDateTime(block.unblockedAt)}` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Section>

      {/* ── Recent orders ─────────────────────────────────────────────── */}
      <Section title="Pesanan terbaru" className="mb-6">
        {recentOrders.length === 0 ? (
          <p className="text-sm text-foreground-muted">Belum ada pesanan.</p>
        ) : (
          <ul className="space-y-2">
            {recentOrders.map((order) => (
              <li key={order.id}>
                <Link
                  href={`/dev/orders/${order.id}`}
                  className="-mx-2 flex flex-wrap items-center justify-between gap-2 rounded-lg px-2 py-2 hover:bg-surface-muted"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {order.variantName}
                      <span className="text-foreground-subtle"> · {order.gameName}</span>
                    </p>
                    <p className="mt-0.5 truncate font-mono text-xs text-foreground-subtle">{order.invoice}</p>
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
    </>
  );
}
