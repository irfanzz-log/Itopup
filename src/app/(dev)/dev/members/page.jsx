// ============================================================================
// /dev/members, member list.
//
// The columns answer the questions support actually gets: "how much has this
// person spent", "how many orders", "are they blocked". Spend is aggregated in
// the database by `listMembers`, never counted in the view.
// ============================================================================
import Link from "next/link";
import { listMembers } from "@/services/user.service.js";
import { PageHeader, Section, DataTable, Td, Money } from "@/components/dev/DevUI";
import StatusBadge from "@/components/ui/StatusBadge";
import Pagination, { ResultCount } from "@/components/ui/Pagination";
import { EmptyState } from "@/components/ui/primitives";
import MemberFilters from "@/components/dev/MemberFilters";
import { formatDateTime } from "@/lib/format";
import { ROLE_LABEL, USER_STATUS_LABEL } from "@/lib/constants";

export const dynamic = "force-dynamic";

export const metadata = { title: "Member" };

const ROLES = ["MEMBER", "DEV", "SUPERADMIN"];
const STATUSES = ["ACTIVE", "BLOCKED"];

export default async function DevMembersPage({ searchParams }) {
  const params = await searchParams;

  const page = Math.max(1, parseInt(params?.page ?? "1", 10) || 1);
  const search = typeof params?.q === "string" ? params.q.slice(0, 100) : "";
  const status = STATUSES.includes(params?.status) ? params.status : null;
  const role = ROLES.includes(params?.role) ? params.role : null;

  const { items, pagination } = await listMembers({ page, limit: 20, search, status, role });

  const buildHref = (nextPage) => {
    const query = new URLSearchParams();
    if (search) query.set("q", search);
    if (status) query.set("status", status);
    if (role) query.set("role", role);
    if (nextPage > 1) query.set("page", String(nextPage));
    const qs = query.toString();
    return `/dev/members${qs ? `?${qs}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title="Member"
        description="Daftar akun beserta total belanja. Data pribadi tidak ditampilkan lebih dari yang diperlukan."
      />

      {/* ── Search + filters ─────────────────────────────────────────────── */}
      <MemberFilters
        search={search}
        status={status}
        role={role}
        roles={ROLES}
        statuses={STATUSES}
        statusLabels={USER_STATUS_LABEL}
        roleLabels={ROLE_LABEL}
      />

      {items.length === 0 ? (
        <EmptyState
          icon="users"
          title="Tidak ada member"
          description={
            search || status || role
              ? "Tidak ada akun yang cocok dengan filter ini."
              : "Akun member akan muncul di sini setelah ada yang mendaftar."
          }
        />
      ) : (
        <Section
          title="Daftar akun"
          description={`Menampilkan ${items.length} dari ${pagination.total} akun.`}
        >
          <ResultCount page={pagination.page} limit={pagination.limit} total={pagination.total} noun="akun" />

          <div className="mt-3">
            <DataTable
              caption="Daftar akun member"
              columns={[
                { key: "nama", label: "Nama" },
                { key: "kontak", label: "Kontak" },
                { key: "peran", label: "Peran" },
                { key: "status", label: "Status" },
                { key: "pesanan", label: "Pesanan", align: "right" },
                { key: "belanja", label: "Total belanja", align: "right" },
                { key: "daftar", label: "Terdaftar" },
              ]}
              rows={items}
              renderRow={(user) => (
                <>
                  <Td>
                    <Link
                      href={`/dev/members/${user.id}`}
                      className="text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400"
                    >
                      {user.name}
                    </Link>
                  </Td>
                  <Td>
                    <span className="block text-xs text-foreground-muted">{user.email}</span>
                    {user.phone ? (
                      <span className="mt-0.5 block text-[11px] text-foreground-subtle">{user.phone}</span>
                    ) : null}
                  </Td>
                  <Td>
                    <span className="text-xs text-foreground-muted">
                      {ROLE_LABEL[user.role] ?? user.role}
                    </span>
                  </Td>
                  <Td><StatusBadge status={user.status} /></Td>
                  <Td align="right">
                    <span className="text-xs tabular-nums text-foreground">{user.orderCount}</span>
                    {user.successCount !== user.orderCount ? (
                      <span className="mt-0.5 block text-[11px] text-foreground-subtle">
                        {user.successCount} berhasil
                      </span>
                    ) : null}
                  </Td>
                  <Td align="right"><Money value={user.totalSpend} className="text-xs font-semibold" /></Td>
                  <Td>
                    <span className="text-xs text-foreground-muted">{formatDateTime(user.createdAt)}</span>
                  </Td>
                </>
              )}
              renderCard={(user) => (
                <Link href={`/dev/members/${user.id}`} className="card-interactive block p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{user.name}</p>
                      <p className="mt-0.5 truncate text-xs text-foreground-subtle">{user.email}</p>
                    </div>
                    <StatusBadge status={user.status} />
                  </div>
                  <div className="mt-2.5 flex items-center justify-between gap-2 text-xs">
                    <span className="text-foreground-muted">{user.orderCount} pesanan</span>
                    <Money value={user.totalSpend} className="font-semibold text-foreground" />
                  </div>
                </Link>
              )}
            />
          </div>

          <Pagination className="mt-5" page={pagination.page} pages={pagination.pages} buildHref={buildHref} />
        </Section>
      )}
    </>
  );
}
