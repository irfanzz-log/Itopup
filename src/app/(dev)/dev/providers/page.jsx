// ============================================================================
// /dev/providers, provider status, balance and catalogue synchronisation.
//
// This is the page that answers "why can't I sell anything": an unconfigured
// provider, an expired balance, a stale sync, or products with no mapping. Each
// is shown as a distinct, actionable state instead of a generic error.
//
// Balance is labelled SALDO PRABAYAR (prepaid credit). The Melostore docs are
// explicit that it is non-refundable and cannot be cashed out, so calling it a
// "balance" without that word would mislead whoever reads it.
// ============================================================================
import Link from "next/link";
import { prisma } from "@/lib/db.js";
import { providerDiagnostics, activeProviderCode } from "@/services/provider.service.js";
import { PageHeader, Section, FieldList, Money } from "@/components/dev/DevUI";
import { Badge } from "@/components/ui/primitives";
import ProviderActions from "@/components/dev/ProviderActions";
import { formatDateTime, formatRelative } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata = { title: "Provider" };

export default async function DevProvidersPage() {
  const [rows, diagnostics, activeCode] = await Promise.all([
    prisma.provider.findMany({
      orderBy: [{ priority: "desc" }, { code: "asc" }],
      select: {
        id: true, code: true, name: true, kind: true, status: true,
        baseUrl: true, priority: true,
        lastSyncAt: true, lastSyncStatus: true,
        balance: true, balanceUpdatedAt: true,
        catalogMeta: true,
        _count: { select: { providerProducts: true, orders: true } },
      },
    }),
    providerDiagnostics(),
    activeProviderCode(),
  ]);

  const diagnosticByCode = new Map(diagnostics.map((d) => [d.code, d]));

  return (
    <>
      <PageHeader
        title="Provider"
        description="Status koneksi, saldo prabayar, dan sinkronisasi katalog. Kredensial hanya ada di environment server dan tidak pernah ditampilkan di sini."
      >
        <Link href="/dev/products" className="btn-secondary btn-sm">Lihat produk</Link>
      </PageHeader>

      {/* ── Active adapter ────────────────────────────────────────────────── */}
      <Section
        title="Adapter aktif"
        description="Adapter yang dipilih oleh konfigurasi. Semua transaksi diarahkan ke sini."
        className="mb-6"
      >
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone="info">{activeCode}</Badge>
          {diagnosticByCode.get(activeCode)?.configured ? (
            <Badge tone="success">Terkonfigurasi</Badge>
          ) : (
            <Badge tone="danger">Belum terkonfigurasi</Badge>
          )}
        </div>

        {(() => {
          const diag = diagnosticByCode.get(activeCode);
          if (!diag) {
            return (
              <p className="mt-3 text-sm text-warning-fg">
                Adapter &quot;{activeCode}&quot; tidak terdaftar di registry. Transaksi akan gagal
                sampai diperbaiki.
              </p>
            );
          }
          if (diag.configured) {
            return (
              <p className="mt-3 text-sm text-success-fg">
                Kredensial lengkap. Provider siap menerima transaksi.
              </p>
            );
          }
          return (
            <div className="mt-3">
              <p className="text-sm text-danger-fg">
                Transaksi akan DITOLAK sampai variabel berikut diisi di environment server:
              </p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {(diag.missing ?? []).map((name) => (
                  <li key={name}>
                    <code className="rounded bg-surface-muted px-2 py-1 font-mono text-xs text-foreground">
                      {name}
                    </code>
                  </li>
                ))}
              </ul>
            </div>
          );
        })()}
      </Section>

      {/* ── Provider rows ─────────────────────────────────────────────────── */}
      {rows.length === 0 ? (
        <Section title="Provider terdaftar">
          <p className="text-sm text-foreground-muted">
            Belum ada provider di database. Jalankan seed untuk membuat baris provider awal.
          </p>
        </Section>
      ) : (
        <div className="space-y-6">
          {rows.map((provider) => {
            const diag = diagnosticByCode.get(provider.code) ?? null;
            const meta = provider.catalogMeta ?? null;

            return (
              <Section
                key={provider.id}
                title={provider.name}
                description={`Kode adapter: ${provider.code} · prioritas ${provider.priority}`}
                action={<Badge tone={provider.status === "ACTIVE" ? "success" : "neutral"}>{provider.status}</Badge>}
              >
                <FieldList
                  items={[
                    {
                      label: "Saldo prabayar",
                      value:
                        provider.balance === null ? (
                          <span className="text-foreground-subtle">
                            Belum pernah disinkronkan
                          </span>
                        ) : (
                          <span>
                            <Money value={provider.balance} />
                            <span className="ml-2 text-xs text-foreground-subtle">
                              {provider.balanceUpdatedAt ? formatRelative(provider.balanceUpdatedAt) : ""}
                            </span>
                          </span>
                        ),
                    },
                    {
                      label: "Sinkron katalog terakhir",
                      value: provider.lastSyncAt ? (
                        <span>
                          {formatDateTime(provider.lastSyncAt)}
                          <span className="ml-2 text-xs text-foreground-subtle">
                            {provider.lastSyncStatus ?? ""}
                          </span>
                        </span>
                      ) : (
                        <span className="text-foreground-subtle">Belum pernah</span>
                      ),
                    },
                    { label: "Produk ter-link", value: provider._count.providerProducts },
                    { label: "Transaksi", value: provider._count.orders },
                    {
                      label: "Kredensial",
                      value: diag?.configured ? (
                        <Badge tone="success">Lengkap</Badge>
                      ) : (
                        <Badge tone="danger">
                          Kurang: {(diag?.missing ?? []).join(", ") || "tidak diketahui"}
                        </Badge>
                      ),
                    },
                  ]}
                />

                {/* Balance is prepaid credit, not cash. */}
                {provider.balance !== null ? (
                  <p className="mt-3 text-xs text-foreground-subtle">
                    Saldo prabayar bersifat non-refundable dan tidak dapat dicairkan. Angka ini
                    diambil dari provider, bukan dihitung sistem.
                  </p>
                ) : null}

                {/* Reference data from the last sync: proof the field contract is live. */}
                {meta?.brands?.length ? (
                  <p className="mt-2 text-xs text-foreground-subtle">
                    Referensi terakhir: {meta.brands.length} brand,{" "}
                    {Object.keys(meta.inquiryForms ?? {}).length} form inquiry.
                  </p>
                ) : null}

                <div className="mt-4 border-t border-border pt-4">
                  <ProviderActions providerCode={provider.code} providerName={provider.name} />
                </div>
              </Section>
            );
          })}
        </div>
      )}
    </>
  );
}
