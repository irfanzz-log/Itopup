// ============================================================================
// Announcement form (client part of /dev/announcements).
//
// "use client" only because it needs local state for the fields and the save
// spinner; the page itself stays a server component so the current banner is
// rendered from the database on load, not fetched in the browser.
// ============================================================================
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Spinner } from "@/components/ui/primitives";

const TONES = [
  { value: "info", label: "Info", hint: "Pengumuman biasa, biru." },
  { value: "warning", label: "Peringatan", hint: "Gangguan ringan atau maintenance, kuning." },
  { value: "error", label: "Kritis", hint: "Gangguan total / transaksi dimatikan, merah." },
];

/**
 * @param {{ announcement: { tone: string, title: string, body: string|null, pauseCheckout: boolean } | null }} props
 */
export default function AnnouncementForm({ announcement }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(announcement?.enabled ?? false);
  const [tone, setTone] = useState(announcement?.tone ?? "warning");
  const [title, setTitle] = useState(announcement?.title ?? "");
  const [body, setBody] = useState(announcement?.body ?? "");
  const [pauseCheckout, setPauseCheckout] = useState(Boolean(announcement?.pauseCheckout));

  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);

    const response = await fetch("/api/dev/announcements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled,
        tone,
        title,
        body: body.trim() || null,
        pauseCheckout,
      }),
    });

    setBusy(false);

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setError(payload?.error?.message || "Gagal menyimpan pengumuman.");
      return;
    }

    setSaved(true);
    // The public layout reads the DB at request time, so a refresh picks up the
    // new banner without a deploy.
    router.refresh();
  }

  async function remove(event) {
    event.preventDefault();
    const confirmed = window.confirm(
      "Hapus pengumuman sepenuhnya? Ini juga mematikan pemblokiran transaksi jika sedang aktif.",
    );
    if (!confirmed) return;

    setDeleting(true);
    setError(null);
    setSaved(false);

    const response = await fetch("/api/dev/announcements", { method: "DELETE" });

    setDeleting(false);

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setError(payload?.error?.message || "Gagal menghapus pengumuman.");
      return;
    }

    setEnabled(false);
    setTitle("");
    setBody("");
    setPauseCheckout(false);
    setTone("warning");
    router.refresh();
  }

  return (
    <form onSubmit={save} className="space-y-5">
      {error ? <Alert tone="danger" title="Gagal menyimpan">{error}</Alert> : null}
      {saved ? (
        <Alert tone="success" title="Tersimpan">
          Pengumuman sudah diperbarui. Halaman publik akan menampilkannya pada pemuatan berikutnya.
        </Alert>
      ) : null}

      <label className="flex cursor-pointer items-start gap-3 rounded-[var(--radius-control)] border border-border bg-surface px-4 py-3">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 accent-brand-600"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        <span>
          <span className="block text-sm font-semibold text-foreground">Tampilkan pengumuman</span>
          <span className="mt-0.5 block text-xs text-foreground-muted">
            Saat tidak dicentang, pengumuman disembunyikan tanpa menghapus teksnya.
          </span>
        </span>
      </label>

      <div className="space-y-2">
        <label htmlFor="tone" className="block text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
          Tingkat peringatan
        </label>
        <select
          id="tone"
          className="input"
          value={tone}
          onChange={(e) => setTone(e.target.value)}
        >
          {TONES.map((t) => (
            <option key={t.value} value={t.value}>{t.label} — {t.hint}</option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <label htmlFor="title" className="block text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
          Judul <span className="text-danger-fg">*</span>
        </label>
        <input
          id="title"
          type="text"
          className="input"
          maxLength={200}
          placeholder="Contoh: Transaksi untuk sementara dinonaktifkan"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <p className="text-xs text-foreground-muted">{title.length}/200 karakter</p>
      </div>

      <div className="space-y-2">
        <label htmlFor="body" className="block text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
          Keterangan (opsional)
        </label>
        <textarea
          id="body"
          className="input min-h-[72px] resize-y"
          maxLength={500}
          placeholder="Contoh: Sedang ada gangguan dari provider. Estimasi normal pukul 23:00 WIB."
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <p className="text-xs text-foreground-muted">{body.length}/500 karakter</p>
      </div>

      <label className="flex cursor-pointer items-start gap-3 rounded-[var(--radius-control)] border border-border bg-surface px-4 py-3">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 accent-brand-600"
          checked={pauseCheckout}
          onChange={(e) => setPauseCheckout(e.target.checked)}
        />
        <span>
          <span className="block text-sm font-semibold text-foreground">
            Nonaktifkan semua transaksi untuk sementara
          </span>
          <span className="mt-0.5 block text-xs text-foreground-muted">
            Selain menampilkan banner, opsi ini juga menolak pesanan baru di checkout. Gunakan saat ada gangguan yang membuat pesanan tidak bisa diproses.
          </span>
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn-primary" disabled={busy || deleting}>
          {busy ? <Spinner /> : null}
          Simpan pengumuman
        </button>

        {announcement ? (
          <button
            type="button"
            className="btn-danger"
            disabled={busy || deleting}
            onClick={remove}
          >
            {deleting ? <Spinner /> : null}
            Hapus pengumuman
          </button>
        ) : null}

        <div className="ml-auto">
          {enabled ? (
            <span className="text-xs font-semibold text-foreground-muted">
              Pengumuman ini sedang tampil di seluruh halaman publik
            </span>
          ) : (
            <span className="text-xs text-foreground-muted">Pengumuman tidak tampil</span>
          )}
        </div>
      </div>
    </form>
  );
}
