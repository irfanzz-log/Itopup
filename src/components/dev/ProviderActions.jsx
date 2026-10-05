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
    if (action === "sync_catalog") router.refresh();
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
          className="btn-ghost"
          disabled={busy !== null}
          onClick={() => run("test")}
        >
          {busy === "test" ? <Spinner /> : null}
          Tes koneksi
        </button>
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
