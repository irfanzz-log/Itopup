// ============================================================================
// /dev/promos — promo management.
//
// Promos are RULES, and the discount is recomputed server-side at checkout from
// the rule + the cart. So the numbers on this page are illustrative: they show
// what the rule would do, not what any order paid.
//
// Deactivation is offered instead of deletion, because a deleted promo would
// orphan the orders that used it.
// ============================================================================
import Link from "next/link";
import { listPromosForAdmin } from "@/services/promo.service.js";
import { PageHeader, Section, DataTable, Td, Money } from "@/components/dev/DevUI";
import { Badge, EmptyState } from "@/components/ui/primitives";
import Pagination, { ResultCount } from "@/components/ui/Pagination";
import PromoForm from "@/components/dev/PromoForm";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata = { title: "Promo" };

/** Human description of a discount rule. Never the money math. */
function describeDiscount(promo) {
  const value = promo.discountType === "PERCENT"
    ? `${promo.discountValue}%`
    : new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(promo.discountValue);

  if (promo.discountType === "PERCENT" && promo.maxDiscount) {
    return `${value} (maks ${new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(promo.maxDiscount)})`;
  }
  return value;
}

function promoState(promo) {
  const now = Date.now();
  if (!promo.isActive) return { label: "Nonaktif", tone: "neutral" };
  if (new Date(promo.startsAt).getTime() > now) return { label: "Terjadwal", tone: "info" };
  if (new Date(promo.endsAt).getTime() < now) return { label: "Berakhir", tone: "neutral" };
  return { label: "Aktif", tone: "success" };
}

export default async function DevPromosPage({ searchParams }) {
  const params = await searchParams;

  const page = Math.max(1, parseInt(params?.page ?? "1", 10) || 1);
  const search = typeof params?.q === "string" ? params.q.slice(0, 100) : "";
  const activeOnly = params?.active === "1";

  const { items, pagination } = await listPromosForAdmin({ page, limit: 20, search, activeOnly });

  const buildHref = (nextPage) => {
    const query = new URLSearchParams();
    if (search) query.set("q", search);
    if (activeOnly) query.set("active", "1");
    if (nextPage > 1) query.set("page", String(nextPage));
    const qs = query.toString();
    return `/dev/promos${qs ? `?${qs}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title="Promo"
        description="Diskon dihitung ulang di server saat checkout. Yang tersimpan di sini hanya aturannya."
      />

      {/* ── Create ────────────────────────────────────────────────────────── */}
      <Section
        title="Buat promo baru"
        description="Kode promo bersifat opsional — tanpa kode, promo berlaku otomatis pada rentang tanggalnya."
        className="mb-6"
      >
        <PromoForm mode="create" />
      </Section>

      {/* ── Filters ───────────────────────────────────────────────────────── */}
      <form method="get" className="card mb-4 flex flex-wrap items-end gap-3 p-4">
        {activeOnly ? <input type="hidden" name="active" value="1" /> : null}
        <div className="min-w-[16rem] flex-1">
          <label htmlFor="q" className="label">Cari</label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={search}
            placeholder="Judul, slug, atau kode promo"
            className="field"
          />
        </div>
        <label className="flex items-center gap-2 pb-2.5 text-sm text-foreground-muted">
          <input type="checkbox" name="active" value="1" defaultChecked={activeOnly} className="h-4 w-4" />
          Hanya yang sedang berjalan
        </label>
        <button type="submit" className="btn-primary">Terapkan</button>
        {search || activeOnly ? <Link href="/dev/promos" className="btn-ghost">Reset</Link> : null}
      </form>

      {items.length === 0 ? (
        <EmptyState
          icon="tag"
          title="Tidak ada promo"
          description={
            search || activeOnly
              ? "Tidak ada promo yang cocok dengan filter ini."
              : "Buat promo pertama dengan formulir di atas."
          }
        />
      ) : (
        <Section
          title="Daftar promo"
          description={`Menampilkan ${items.length} dari ${pagination.total} promo.`}
        >
          <ResultCount page={pagination.page} limit={pagination.limit} total={pagination.total} noun="promo" />

          <div className="mt-3">
            <DataTable
              caption="Daftar promo"
              columns={[
                { key: "promo", label: "Promo" },
                { key: "kode", label: "Kode" },
                { key: "diskon", label: "Diskon" },
                { key: "min", label: "Min. belanja", align: "right" },
                { key: "periode", label: "Periode" },
                { key: "pemakaian", label: "Pemakaian", align: "right" },
                { key: "status", label: "Status" },
              ]}
              rows={items}
              renderRow={(promo) => {
                const state = promoState(promo);
                const code = promo.codes?.[0] ?? null;

                return (
                  <>
                    <Td>
                      <span className="block text-xs font-semibold text-foreground">{promo.title}</span>
                      <span className="mt-0.5 block font-mono text-[11px] text-foreground-subtle">
                        {promo.slug}
                      </span>
                      {promo.description ? (
                        <span className="mt-0.5 block max-w-xs truncate text-[11px] text-foreground-muted">
                          {promo.description}
                        </span>
                      ) : null}
                    </Td>
                    <Td>
                      {code ? (
                        <>
                          <code className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
                            {code.code}
                          </code>
                          {!code.isActive ? (
                            <span className="mt-0.5 block text-[11px] text-danger-fg">kode nonaktif</span>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-xs text-foreground-subtle">otomatis</span>
                      )}
                    </Td>
                    <Td>
                      <span className="text-xs text-foreground">{describeDiscount(promo)}</span>
                    </Td>
                    <Td align="right">
                      {promo.minSpend > 0 ? (
                        <Money value={promo.minSpend} className="text-xs" />
                      ) : (
                        <span className="text-xs text-foreground-subtle">—</span>
                      )}
                    </Td>
                    <Td>
                      <span className="block text-[11px] text-foreground-muted">
                        {formatDateTime(promo.startsAt)}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-foreground-subtle">
                        s/d {formatDateTime(promo.endsAt)}
                      </span>
                    </Td>
                    <Td align="right">
                      {code ? (
                        <>
                          <span className="text-xs tabular-nums text-foreground">
                            {code.usageCount}
                            {code.usageLimit ? ` / ${code.usageLimit}` : ""}
                          </span>
                          {!code.usageLimit ? (
                            <span className="mt-0.5 block text-[11px] text-foreground-subtle">tanpa batas</span>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-xs text-foreground-subtle">—</span>
                      )}
                    </Td>
                    <Td>
                      <Badge tone={state.tone}>{state.label}</Badge>
                      {promo._count?.variants > 0 ? (
                        <span className="mt-0.5 block text-[11px] text-foreground-subtle">
                          {promo._count.variants} varian khusus
                        </span>
                      ) : null}
                    </Td>
                  </>
                );
              }}
              renderCard={(promo) => {
                const state = promoState(promo);
                return (
                  <div className="card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">{promo.title}</p>
                        <p className="mt-0.5 truncate font-mono text-xs text-foreground-subtle">
                          {promo.codes?.[0]?.code ?? "otomatis"}
                        </p>
                      </div>
                      <Badge tone={state.tone}>{state.label}</Badge>
                    </div>
                    <p className="mt-2 text-xs text-foreground-muted">
                      Diskon {describeDiscount(promo)}
                      {promo.minSpend > 0 ? ` · min ${new Intl.NumberFormat("id-ID").format(promo.minSpend)}` : ""}
                    </p>
                    <p className="mt-1 text-[11px] text-foreground-subtle">
                      {formatDateTime(promo.startsAt)} — {formatDateTime(promo.endsAt)}
                    </p>
                  </div>
                );
              }}
            />
          </div>

          <Pagination className="mt-5" page={pagination.page} pages={pagination.pages} buildHref={buildHref} />
        </Section>
      )}

      {/* ── Per-promo actions ─────────────────────────────────────────────── */}
      {items.length > 0 ? (
        <Section
          title="Kelola promo"
          description="Mengubah atau menonaktifkan promo yang sudah ada."
          className="mt-6"
        >
          <ul className="space-y-4">
            {items.map((promo) => (
              <li key={promo.id} className="rounded-lg border border-border p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-foreground">{promo.title}</span>
                  <PromoForm mode="deactivate" promo={promo} />
                </div>
                <PromoForm mode="update" promo={promo} />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </>
  );
}
