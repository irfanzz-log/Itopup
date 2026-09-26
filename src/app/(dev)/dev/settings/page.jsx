// ============================================================================
// /dev/settings — environment and integration status, plus the audit log.
//
// WHAT THIS PAGE MUST NEVER DO: print a secret. `envReport()` returns
// `{ name, configured: boolean }` — the NAME of each variable and whether it is
// set, never its value. That distinction is the whole reason the helper exists,
// and it is why this page can be useful to an operator without being a
// credential leak.
//
// The audit log lives here rather than its own route because it is the tool an
// operator reaches for while looking at configuration ("who changed this?").
// ============================================================================
import Link from "next/link";
import { envReport, isProduction } from "@/lib/env.server.js";
import { providerDiagnostics, activeProviderCode } from "@/services/provider.service.js";
import { paymentDiagnostics } from "@/providers/payment/index.js";
import { listAuditLogs } from "@/services/audit.service.js";
import { PageHeader, Section, FieldList } from "@/components/dev/DevUI";
import { Badge, EmptyState } from "@/components/ui/primitives";
import Pagination from "@/components/ui/Pagination";
import { formatDateTime, formatRelative } from "@/lib/format";
import { ROLES } from "@/lib/constants";

export const dynamic = "force-dynamic";

export const metadata = { title: "Pengaturan" };

export default async function DevSettingsPage({ searchParams }) {
  const params = await searchParams;

  const page = Math.max(1, parseInt(params?.page ?? "1", 10) || 1);
  const action = typeof params?.action === "string" ? params.action.slice(0, 60) : null;

  const env = envReport();
  const providers = providerDiagnostics();
  const payment = paymentDiagnostics();

  const { items: logs, pagination } = await listAuditLogs({ page, limit: 30, action });

  const missing = env.filter((row) => !row.configured);
  const buildHref = (nextPage) => {
    const query = new URLSearchParams();
    if (action) query.set("action", action);
    if (nextPage > 1) query.set("page", String(nextPage));
    const qs = query.toString();
    return `/dev/settings${qs ? `?${qs}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title="Pengaturan"
        description="Status konfigurasi environment dan integrasi. Nilai rahasia tidak pernah ditampilkan — hanya nama variabel dan status terisi atau tidak."
      >
        <Badge tone={isProduction() ? "success" : "warning"}>
          {isProduction() ? "Produksi" : "Non-produksi"}
        </Badge>
      </PageHeader>

      {/* ── Missing config ────────────────────────────────────────────────── */}
      <Section
        title="Variabel belum terisi"
        description="Diisi lewat environment server, bukan lewat halaman ini."
        className="mb-6"
      >
        {missing.length === 0 ? (
          <p className="text-sm text-success-fg">
            Semua variabel yang dikenal sudah terisi.
          </p>
        ) : (
          <>
            <ul className="flex flex-wrap gap-2">
              {missing.map((row) => (
                <li key={row.name}>
                  <code className="rounded bg-danger-bg px-2 py-1 font-mono text-xs text-danger-fg">
                    {row.name}
                  </code>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-foreground-subtle">
              Variabel bertanda merah membuat fitur terkait menolak beroperasi, bukan gagal diam-diam.
            </p>
          </>
        )}
      </Section>

      <div className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* ── Top-up provider ────────────────────────────────────────────── */}
        <Section
          title="Provider top-up"
          description={`Adapter aktif: ${activeProviderCode()}`}
          action={
            <Link href="/dev/providers" className="btn-secondary btn-sm">Kelola</Link>
          }
        >
          {providers.length === 0 ? (
            <p className="text-sm text-foreground-muted">Tidak ada adapter terdaftar.</p>
          ) : (
            <ul className="space-y-3">
              {providers.map((provider) => (
                <li key={provider.code} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-foreground">{provider.code}</span>
                    {provider.configured ? (
                      <Badge tone="success">Siap</Badge>
                    ) : (
                      <Badge tone="danger">Belum siap</Badge>
                    )}
                  </div>
                  {!provider.configured && provider.missing?.length ? (
                    <p className="mt-2 text-xs text-danger-fg">
                      Belum diisi: {provider.missing.join(", ")}
                    </p>
                  ) : null}
                  {provider.mapper ? (
                    <p className="mt-1 text-[11px] text-foreground-subtle">
                      Pemetaan field: {provider.mapper.ready ? "siap" : "belum lengkap"}
                      {typeof provider.supportsClientReference === "boolean"
                        ? ` · idempotency ke provider: ${provider.supportsClientReference ? "didukung" : "tidak"}`
                        : ""}
                    </p>
                  ) : null}
                  {provider.callbacksSupported === false ? (
                    <p className="mt-1 text-[11px] text-warning-fg">
                      Callback tidak didukung; status hanya lewat rekonsiliasi berkala.
                    </p>
                  ) : null}
                  {provider.configured && provider.webhookConfigured === false ? (
                    <p className="mt-1 text-[11px] text-warning-fg">
                      Secret webhook belum diisi — callback akan ditolak.
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* ── Payment ─────────────────────────────────────────────────────── */}
        <Section
          title="Pembayaran"
          description="Adapter pembayaran yang terdaftar dan statusnya."
        >
          <FieldList
            items={[
              { label: "Adapter dipilih", value: payment.selected ?? "(belum dipilih)" },
              {
                label: "Terdaftar",
                value: payment.registered ? <Badge tone="success">Ya</Badge> : <Badge tone="danger">Tidak</Badge>,
              },
              {
                label: "Terkonfigurasi",
                value: payment.configured ? <Badge tone="success">Ya</Badge> : <Badge tone="warning">Belum</Badge>,
              },
              {
                label: "Adapter tersedia",
                value: payment.registeredCodes.length
                  ? <span className="font-mono text-xs">{payment.registeredCodes.join(", ")}</span>
                  : "—",
              },
              {
                label: "Variabel kurang",
                value: payment.missing.length ? (
                  <span className="font-mono text-xs text-danger-fg">{payment.missing.join(", ")}</span>
                ) : "—",
              },
            ]}
          />
          <p className="mt-3 text-xs text-foreground-subtle">
            Transfer bank manual berjalan tanpa gateway: instruksi diterbitkan server, lalu
            operator mengonfirmasi di halaman transaksi.
          </p>
        </Section>
      </div>

      {/* ── Full env report ───────────────────────────────────────────────── */}
      <Section
        title="Seluruh variabel environment"
        description="Nama dan status saja. Nilai tidak pernah dikirim ke browser."
        className="mb-6"
      >
        <ul className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {env.map((row) => (
            <li key={row.name} className="flex items-center justify-between gap-3 border-b border-border py-1.5">
              <code className="truncate font-mono text-xs text-foreground-muted">{row.name}</code>
              <span className={`shrink-0 text-xs font-semibold ${row.configured ? "text-success-fg" : "text-foreground-subtle"}`}>
                {row.configured ? "terisi" : "kosong"}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      {/* ── Audit log ─────────────────────────────────────────────────────── */}
      <Section
        title="Audit log"
        description="Setiap tindakan sensitif tercatat: siapa, kapan, dari mana. Tidak ada yang dapat dihapus dari sini."
        action={action ? <Link href="/dev/settings" className="btn-ghost btn-sm">Hapus filter</Link> : null}
      >
        {logs.length === 0 ? (
          <EmptyState
            icon="shield"
            title="Belum ada catatan audit"
            description={
              action
                ? "Tidak ada catatan dengan aksi ini."
                : "Catatan akan muncul setelah ada tindakan sensitif seperti login, perubahan harga, atau konfirmasi pembayaran."
            }
          />
        ) : (
          <>
            <ul className="divide-y divide-border">
              {logs.map((log) => (
                <li key={log.id} className="py-2.5 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <code className="font-mono text-xs font-semibold text-foreground">{log.action}</code>
                      {log.actorRole ? (
                        <span className="text-[11px] text-foreground-subtle">
                          {log.actor ? `${log.actor.name} · ` : ""}
                          {log.actorRole}
                        </span>
                      ) : (
                        <span className="text-[11px] text-foreground-subtle">sistem</span>
                      )}
                    </div>
                    <span className="text-[11px] text-foreground-subtle">
                      {formatDateTime(log.createdAt)} · {formatRelative(log.createdAt)}
                    </span>
                  </div>

                  {log.targetType ? (
                    <p className="mt-0.5 text-xs text-foreground-muted">
                      {log.targetType}
                      {log.targetId ? <span className="font-mono"> · {log.targetId.slice(0, 12)}…</span> : null}
                      {log.ip ? <span className="ml-2 text-foreground-subtle">dari {log.ip}</span> : null}
                    </p>
                  ) : null}

                  {log.metadata && Object.keys(log.metadata).length > 0 ? (
                    <pre className="mt-1 overflow-x-auto rounded-lg bg-surface-muted p-2 text-[11px] text-foreground-muted">
                      {JSON.stringify(log.metadata)}
                    </pre>
                  ) : null}
                </li>
              ))}
            </ul>

            <Pagination className="mt-5" page={pagination.page} pages={pagination.pages} buildHref={buildHref} />
          </>
        )}
      </Section>

      <p className="mt-6 text-xs text-foreground-subtle">
        Peran yang dikenal: {Object.values(ROLES).join(" · ")}
      </p>
    </>
  );
}
