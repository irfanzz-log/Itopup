// ============================================================================
// Provider action panel.
//
// The dry run is listed FIRST and described as the safe option, because the
// destructive-ish action here is a real sync: it writes cost prices and can mark
// products unavailable. An operator should be able to see exactly what a sync
// would do before letting it touch the catalogue.
// ============================================================================
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Spinner } from "@/components/ui/primitives";
import { apiPost } from "@/lib/api-client";
import { formatIDR } from "@/lib/format";

export default function ProviderActions({ providerCode, providerName }) {
  const router = useRouter();

  const [busy, setBusy] = useState(null);
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);

  async function run(action) {
    setBusy(action);
    setReport(null);
    setError(null);

    const response = await apiPost(`/api/dev/providers/${providerCode}`, { action });

    setBusy(null);

    if (!response.ok) {
      setError(response.error?.message || "Aksi gagal.");
      return;
    }

    setReport({ action, data: response.data });
    if (action === "sync_catalog" || action === "reprice") router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-primary"
          disabled={busy !== null}
          onClick={() => run("sync_catalog")}
        >
          {busy === "sync_catalog" ? <Spinner /> : null}
          Sinkronkan katalog
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={busy !== null}
          onClick={() => run("dry_run")}
        >
          {busy === "dry_run" ? <Spinner /> : null}
          Uji coba (tanpa simpan)
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={busy !== null}
          onClick={() => run("sync_balance")}
        >
          {busy === "sync_balance" ? <Spinner /> : null}
          Ambil saldo
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={busy !== null}
          onClick={() => run("test")}
        >
          {busy === "test" ? <Spinner /> : null}
          Tes koneksi
        </button>
      </div>

      {/* ── Reprice from the pricing rule ────────────────────────────────
          A separate, clearly-labelled control because it is the ONLY action
          that applies a PRICING_MARKUP_MULTIPLIER change. "Sinkronkan katalog"
          does not do it: a sync only reprices the SKUs it fetched, so with an
          unchanged pricelist it changes nothing no matter how the markup
          moved. The dry run is offered first for the same reason as above. */}
      <div className="rounded-[var(--radius-control)] border border-border bg-surface-muted p-3">
        <p className="text-xs font-semibold text-foreground">Hitung ulang harga dari aturan markup</p>
        <p className="mt-1 text-xs text-foreground-muted">
          Menghitung ulang harga jual semua varian dari harga modal memakai aturan markup yang
          sedang aktif. Harga yang pernah Anda ubah manual tidak disentuh. Tidak perlu koneksi ke
          provider.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={busy !== null}
            onClick={() => run("reprice_dry_run")}
          >
            {busy === "reprice_dry_run" ? <Spinner /> : null}
            Lihat selisih (tanpa simpan)
          </button>
          <button
            type="button"
            className="btn-primary btn-sm"
            disabled={busy !== null}
            onClick={() => run("reprice")}
          >
            {busy === "reprice" ? <Spinner /> : null}
            Terapkan harga baru
          </button>
        </div>
      </div>

      <p className="text-xs text-foreground-subtle">
        Sinkronisasi mengambil daftar harga dari {providerName} dan menyimpannya ke database.
        Selalu jalankan uji coba dulu bila baru mengubah aturan pemetaan.
      </p>

      {error ? <Alert tone="danger" title="Gagal">{error}</Alert> : null}

      {report ? <Report report={report} /> : null}
    </div>
  );
}

function Report({ report }) {
  const { action, data } = report;

  if (action === "test") {
    return (
      <Alert
        tone={data.reachable ? "success" : "warning"}
        title={data.reachable ? "Koneksi berhasil" : "Koneksi gagal"}
      >
        {data.message ?? (data.configured ? "Tidak ada pesan." : "Provider belum dikonfigurasi.")}
        {data.missing?.length ? (
          <p className="mt-1 text-xs">Variabel belum diisi: {data.missing.join(", ")}</p>
        ) : null}
      </Alert>
    );
  }

  if (action === "sync_balance") {
    return (
      <Alert tone="success" title="Saldo diperbarui">
        Saldo prabayar: {formatIDR(data.balance)}
        {data.durationMs ? ` · ${data.durationMs} ms` : ""}
      </Alert>
    );
  }

  // reprice / reprice_dry_run
  if (action === "reprice" || action === "reprice_dry_run") {
    const nothing = data.changed === 0;
    return (
      <Alert
        tone={nothing ? "warning" : "success"}
        title={data.dryRun ? "Perkiraan harga baru (belum disimpan)" : "Harga diperbarui"}
      >
        <ul className="mt-1 space-y-0.5 text-sm">
          <li>Varian diperiksa: {data.scanned}</li>
          <li>Harga berubah: {data.changed}</li>
          <li>Sudah sesuai aturan: {data.unchanged}</li>
          <li>Dilewati (harga diubah manual): {data.skippedManual}</li>
        </ul>

        {/* Airtime is priced by a fixed rupiah spread, so it never moves with
            the markup multiplier. Saying so prevents "unchanged" from being
            read as a failure of the action. */}
        {data.unchangedPulsa > 0 ? (
          <p className="mt-1 text-xs">
            Termasuk {data.unchangedPulsa} nominal pulsa yang memang tidak terpengaruh markup
            persen — pulsa memakai margin tetap per nominal (PRICING_PULSA_FLAT).
          </p>
        ) : null}

        {nothing ? (
          <p className="mt-2 text-sm">
            Tidak ada harga yang berubah. Kalau Anda baru mengubah markup, pastikan variabel
            PRICING_MARKUP_MULTIPLIER sudah terpasang pada deployment ini — nilainya dibaca saat
            proses start, jadi perlu redeploy, bukan hanya restart.
          </p>
        ) : null}

        {data.samples?.length ? (
          <div className="mt-2">
            <p className="text-xs font-semibold">Contoh perubahan:</p>
            <ul className="mt-1 space-y-0.5 font-mono text-xs">
              {data.samples.slice(0, 8).map((row) => (
                <li key={`${row.game}-${row.name}`}>
                  {row.game} · {row.name}: {formatIDR(row.from)} → {formatIDR(row.to)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Alert>
    );
  }

  // sync_catalog / dry_run
  const nothingFound = data.fetched === 0;

  return (
    <Alert
      tone={nothingFound ? "warning" : data.unmatchedTotal > 0 ? "warning" : "success"}
      title={data.dryRun ? "Hasil uji coba (tidak ada yang disimpan)" : "Sinkronisasi selesai"}
    >
      <ul className="mt-1 space-y-0.5 text-sm">
        <li>Diambil dari provider: {data.fetched}</li>
        <li>Varian baru dibuat: {data.created}</li>
        <li>Sudah ter-link: {data.linked}</li>
        <li>Tidak berubah: {data.unchanged}</li>
        <li>Harga berubah: {data.priceChanged}</li>
        <li>Ditandai tidak tersedia: {data.unavailable}</li>
        <li>Durasi: {data.durationMs} ms</li>
      </ul>

      {nothingFound ? (
        <p className="mt-2 text-sm">
          Provider tidak mengembalikan produk apa pun. Periksa kredensial dan kategori yang
          diminta. Katalog kosong biasanya berarti kredensial salah, bukan katalog kosong.
        </p>
      ) : null}

      {data.unmatchedTotal > 0 ? (
        <div className="mt-2">
          <p className="text-sm font-semibold">
            {data.unmatchedTotal} SKU provider belum punya aturan pemetaan, tidak di-link:
          </p>
          <ul className="mt-1 space-y-0.5 font-mono text-xs">
            {data.unmatched.map((row) => (
              <li key={row.providerCode}>
                {row.providerCode} · {row.name}
                {row.brand ? ` · ${row.brand}` : ""}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs">
            Tambahkan aturan di <code>src/config/provider-mapping.js</code> lalu jalankan
            sinkronisasi lagi. SKU yang tidak dikenal sengaja TIDAK di-link otomatis: salah link
            berarti pelanggan membeli produk yang salah.
          </p>
        </div>
      ) : null}
    </Alert>
  );
}
