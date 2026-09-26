// ============================================================================
// Promo create / update / deactivate form.
//
// One component, three modes, because the fields are identical — three separate
// forms would drift and one would end up missing a field the schema requires.
//
// The API returns field-level validation details; they are mapped onto the
// inputs so an operator sees WHICH field is wrong, not just "invalid input".
// ============================================================================
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Spinner } from "@/components/ui/primitives";
import { apiPost } from "@/lib/api-client";

/** Format a Date (or ISO string) for a datetime-local input. */
function toLocalInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function emptyForm() {
  const now = new Date();
  const later = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  return {
    title: "",
    slug: "",
    description: "",
    discountType: "PERCENT",
    discountValue: "10",
    maxDiscount: "",
    minSpend: "0",
    startsAt: toLocalInput(now),
    endsAt: toLocalInput(later),
    code: "",
    usageLimit: "",
    perUserLimit: "1",
    isActive: true,
  };
}

function fromPromo(promo) {
  const code = promo.codes?.[0] ?? null;
  return {
    title: promo.title ?? "",
    slug: promo.slug ?? "",
    description: promo.description ?? "",
    discountType: promo.discountType ?? "PERCENT",
    discountValue: String(promo.discountValue ?? ""),
    maxDiscount: promo.maxDiscount ? String(promo.maxDiscount) : "",
    minSpend: String(promo.minSpend ?? 0),
    startsAt: toLocalInput(promo.startsAt),
    endsAt: toLocalInput(promo.endsAt),
    code: code?.code ?? "",
    usageLimit: code?.usageLimit ? String(code.usageLimit) : "",
    perUserLimit: code?.perUserLimit ? String(code.perUserLimit) : "1",
    isActive: Boolean(promo.isActive),
  };
}

/** Build the payload the service's schema expects — numbers, not strings. */
function toPayload(form) {
  const payload = {
    title: form.title.trim(),
    slug: form.slug.trim(),
    discountType: form.discountType,
    discountValue: Number(form.discountValue),
    minSpend: form.minSpend === "" ? 0 : Number(form.minSpend),
    // A datetime-local value has no timezone; treat it as local time and let
    // Date convert it, rather than sending the raw string and hoping.
    startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : undefined,
    endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : undefined,
    isActive: Boolean(form.isActive),
  };

  if (form.description.trim()) payload.description = form.description.trim();
  if (form.maxDiscount !== "") payload.maxDiscount = Number(form.maxDiscount);
  if (form.code.trim()) payload.code = form.code.trim().toUpperCase();
  if (form.usageLimit !== "") payload.usageLimit = Number(form.usageLimit);
  if (form.perUserLimit !== "") payload.perUserLimit = Number(form.perUserLimit);

  // Strip undefined so a partial update does not send empty fields.
  return Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined));
}

export default function PromoForm({ mode, promo = null }) {
  const router = useRouter();

  const [form, setForm] = useState(mode === "create" ? emptyForm() : fromPromo(promo));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [done, setDone] = useState(null);

  const set = (key) => (event) => {
    const value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    setDone(null);

    const body =
      mode === "create"
        ? { action: "create", promo: toPayload(form) }
        : { action: "update", promoId: promo.id, promo: toPayload(form) };

    const response = await apiPost("/api/dev/promos", body);

    setBusy(false);

    if (!response.ok) {
      setError(response.error?.message || "Gagal menyimpan promo.");
      // Map server-side field errors onto the inputs.
      const details = response.error?.details ?? [];
      const mapped = {};
      for (const detail of details) {
        if (detail?.field) mapped[detail.field] = detail.message;
      }
      setFieldErrors(mapped);
      return;
    }

    setDone(mode === "create" ? "Promo dibuat." : "Promo diperbarui.");
    if (mode === "create") setForm(emptyForm());
    router.refresh();
  }

  async function deactivate() {
    setBusy(true);
    setError(null);
    setDone(null);

    const response = await apiPost("/api/dev/promos", { action: "deactivate", promoId: promo.id });

    setBusy(false);

    if (!response.ok) {
      setError(response.error?.message || "Gagal menonaktifkan promo.");
      return;
    }

    setDone("Promo dinonaktifkan.");
    router.refresh();
  }

  // ── Deactivate-only mode: a single button. ──────────────────────────────
  if (mode === "deactivate") {
    if (!promo.isActive) {
      return <span className="text-xs text-foreground-subtle">Sudah nonaktif</span>;
    }
    return (
      <div className="flex items-center gap-2">
        <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={deactivate}>
          {busy ? <Spinner /> : null}
          Nonaktifkan
        </button>
        {error ? <span className="text-xs text-danger-fg">{error}</span> : null}
      </div>
    );
  }

  const isCreate = mode === "create";

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${mode}-title`} className="label">Judul</label>
          <input
            id={`${mode}-title`}
            type="text"
            value={form.title}
            onChange={set("title")}
            required
            maxLength={200}
            placeholder="Diskon Akhir Bulan"
            className={`field ${fieldErrors.title ? "field-error" : ""}`}
          />
          {fieldErrors.title ? <p className="hint text-danger-fg">{fieldErrors.title}</p> : null}
        </div>

        <div>
          <label htmlFor={`${mode}-slug`} className="label">Slug</label>
          <input
            id={`${mode}-slug`}
            type="text"
            value={form.slug}
            onChange={set("slug")}
            required
            maxLength={200}
            placeholder="diskon-akhir-bulan"
            className={`field font-mono ${fieldErrors.slug ? "field-error" : ""}`}
          />
          {fieldErrors.slug ? <p className="hint text-danger-fg">{fieldErrors.slug}</p> : null}
        </div>
      </div>

      <div>
        <label htmlFor={`${mode}-description`} className="label">Deskripsi (opsional)</label>
        <textarea
          id={`${mode}-description`}
          value={form.description}
          onChange={set("description")}
          rows={2}
          maxLength={2000}
          placeholder="Potongan 10% untuk semua top up game."
          className="field"
        />
        <p className="hint">
          Ditampilkan sebagai teks biasa, bukan HTML.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor={`${mode}-type`} className="label">Jenis diskon</label>
          <select id={`${mode}-type`} value={form.discountType} onChange={set("discountType")} className="field">
            <option value="PERCENT">Persen (%)</option>
            <option value="FIXED">Nominal (Rp)</option>
          </select>
        </div>

        <div>
          <label htmlFor={`${mode}-value`} className="label">
            {form.discountType === "PERCENT" ? "Persen" : "Nominal"}
          </label>
          <input
            id={`${mode}-value`}
            type="number"
            min="1"
            step="1"
            value={form.discountValue}
            onChange={set("discountValue")}
            required
            className={`field tabular-nums ${fieldErrors.discountValue ? "field-error" : ""}`}
          />
          {fieldErrors.discountValue ? <p className="hint text-danger-fg">{fieldErrors.discountValue}</p> : null}
        </div>

        <div>
          <label htmlFor={`${mode}-max`} className="label">Maks. diskon (opsional)</label>
          <input
            id={`${mode}-max`}
            type="number"
            min="0"
            step="1"
            value={form.maxDiscount}
            onChange={set("maxDiscount")}
            placeholder={form.discountType === "PERCENT" ? "50000" : ""}
            className="field tabular-nums"
          />
          <p className="hint">Hanya berarti untuk diskon persen.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor={`${mode}-min`} className="label">Min. belanja</label>
          <input
            id={`${mode}-min`}
            type="number"
            min="0"
            step="1"
            value={form.minSpend}
            onChange={set("minSpend")}
            className="field tabular-nums"
          />
        </div>

        <div>
          <label htmlFor={`${mode}-start`} className="label">Mulai</label>
          <input
            id={`${mode}-start`}
            type="datetime-local"
            value={form.startsAt}
            onChange={set("startsAt")}
            required
            className={`field ${fieldErrors.startsAt ? "field-error" : ""}`}
          />
        </div>

        <div>
          <label htmlFor={`${mode}-end`} className="label">Berakhir</label>
          <input
            id={`${mode}-end`}
            type="datetime-local"
            value={form.endsAt}
            onChange={set("endsAt")}
            required
            className={`field ${fieldErrors.endsAt ? "field-error" : ""}`}
          />
          {fieldErrors.endsAt ? <p className="hint text-danger-fg">{fieldErrors.endsAt}</p> : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor={`${mode}-code`} className="label">Kode promo (opsional)</label>
          <input
            id={`${mode}-code`}
            type="text"
            value={form.code}
            onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value.toUpperCase() }))}
            maxLength={40}
            placeholder="ITOPUP10"
            className={`field font-mono ${fieldErrors.code ? "field-error" : ""}`}
          />
          {fieldErrors.code ? <p className="hint text-danger-fg">{fieldErrors.code}</p> : null}
        </div>

        <div>
          <label htmlFor={`${mode}-usage`} className="label">Batas pemakaian</label>
          <input
            id={`${mode}-usage`}
            type="number"
            min="1"
            step="1"
            value={form.usageLimit}
            onChange={set("usageLimit")}
            placeholder="tanpa batas"
            className="field tabular-nums"
          />
        </div>

        <div>
          <label htmlFor={`${mode}-peruser`} className="label">Batas per member</label>
          <input
            id={`${mode}-peruser`}
            type="number"
            min="1"
            step="1"
            value={form.perUserLimit}
            onChange={set("perUserLimit")}
            className="field tabular-nums"
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-foreground-muted">
        <input type="checkbox" checked={form.isActive} onChange={set("isActive")} className="h-4 w-4" />
        Aktifkan promo
      </label>

      {error ? <Alert tone="danger" title="Gagal menyimpan">{error}</Alert> : null}
      {done ? <Alert tone="success">{done}</Alert> : null}

      <button type="submit" className="btn-primary" disabled={busy}>
        {busy ? <Spinner /> : null}
        {isCreate ? "Buat promo" : "Simpan perubahan"}
      </button>
    </form>
  );
}
