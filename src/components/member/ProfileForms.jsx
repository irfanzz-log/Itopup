"use client";

// ============================================================================
// Profile forms.
//
// Three independent forms in one file because they share field primitives and
// error handling, and splitting them would duplicate that three times:
//
//   * ProfileForm      — name + phone
//   * PasswordForm     — current + new password
//   * SessionsForm     — revoke every other session
//
// SECURITY NOTE: the password form does NOT send the user id. The API derives it
// from the session, so a member cannot change somebody else's password by
// editing a hidden field.
// ============================================================================
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Spinner } from "@/components/ui/primitives";
import { apiFetch, apiPost } from "@/lib/api-client";

export function ProfileForm({ user }) {
  const router = useRouter();
  const [form, setForm] = useState({ name: user.name ?? "", phone: user.phone ?? "" });
  const [state, setState] = useState({ status: "idle", error: null, errors: {}, done: false });

  async function onSubmit(event) {
    event.preventDefault();
    if (state.status === "loading") return;
    setState({ status: "loading", error: null, errors: {}, done: false });

    const result = await apiFetch("/api/member/profile", { method: "PATCH", body: form });

    if (!result.ok) {
      setState({
        status: "error",
        error: result.error,
        errors: detailsToMap(result.error?.details),
        done: false,
      });
      return;
    }

    setState({ status: "idle", error: null, errors: {}, done: true });
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {state.done ? <Alert tone="success" title="Profil diperbarui">Perubahan Anda sudah disimpan.</Alert> : null}
      {state.error ? <Alert tone="danger">{state.error.message}</Alert> : null}

      <div>
        <label htmlFor="name" className="label">Nama</label>
        <input
          id="name" name="name" type="text" autoComplete="name" required maxLength={80}
          value={form.name}
          onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
          className={`field ${state.errors.name ? "field-error" : ""}`}
        />
        {state.errors.name ? <p className="mt-1 text-xs font-medium text-danger-fg">{state.errors.name}</p> : null}
      </div>

      <div>
        <label htmlFor="phone" className="label">Nomor telepon <span className="font-normal text-foreground-subtle">(opsional)</span></label>
        <input
          id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={20}
          placeholder="08xxxxxxxxxx"
          value={form.phone}
          onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
          className={`field ${state.errors.phone ? "field-error" : ""}`}
        />
        {state.errors.phone ? <p className="mt-1 text-xs font-medium text-danger-fg">{state.errors.phone}</p> : null}
      </div>

      <div>
        <label htmlFor="email-ro" className="label">Email</label>
        <input
          id="email-ro" type="email" value={user.email} readOnly disabled
          className="field bg-surface-muted text-foreground-muted"
        />
        <p className="hint">Email tidak dapat diubah sendiri. Hubungi dukungan bila perlu diubah.</p>
      </div>

      <button type="submit" disabled={state.status === "loading"} className="btn-primary">
        {state.status === "loading" ? <Spinner /> : null}
        Simpan Perubahan
      </button>
    </form>
  );
}

export function PasswordForm() {
  const router = useRouter();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [state, setState] = useState({ status: "idle", error: null, errors: {}, done: false });

  async function onSubmit(event) {
    event.preventDefault();
    if (state.status === "loading") return;

    // Client-side check is convenience only — the server re-validates both the
    // strength and the current password.
    if (form.newPassword !== form.confirm) {
      setState({
        status: "error",
        error: { message: "Konfirmasi password tidak sama." },
        errors: { confirm: "Konfirmasi password tidak sama." },
        done: false,
      });
      return;
    }

    setState({ status: "loading", error: null, errors: {}, done: false });

    const result = await apiFetch("/api/member/password", {
      method: "POST",
      body: { currentPassword: form.currentPassword, newPassword: form.newPassword },
    });

    if (!result.ok) {
      setState({
        status: "error",
        error: result.error,
        errors: detailsToMap(result.error?.details),
        done: false,
      });
      return;
    }

    setForm({ currentPassword: "", newPassword: "", confirm: "" });
    setState({ status: "idle", error: null, errors: {}, done: true });
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {state.done ? (
        <Alert tone="success" title="Password diperbarui">
          Semua sesi lain telah diakhiri. Sesi di perangkat ini tetap aktif.
        </Alert>
      ) : null}
      {state.error ? <Alert tone="danger">{state.error.message}</Alert> : null}

      <div>
        <label htmlFor="currentPassword" className="label">Password saat ini</label>
        <input
          id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required
          value={form.currentPassword}
          onChange={(e) => setForm((prev) => ({ ...prev, currentPassword: e.target.value }))}
          className={`field ${state.errors.currentPassword ? "field-error" : ""}`}
        />
        {state.errors.currentPassword ? <p className="mt-1 text-xs font-medium text-danger-fg">{state.errors.currentPassword}</p> : null}
      </div>

      <div>
        <label htmlFor="newPassword" className="label">Password baru</label>
        <input
          id="newPassword" name="newPassword" type="password" autoComplete="new-password" required
          value={form.newPassword}
          onChange={(e) => setForm((prev) => ({ ...prev, newPassword: e.target.value }))}
          className={`field ${state.errors.newPassword ? "field-error" : ""}`}
        />
        <p className="hint">Minimal 8 karakter, mengandung huruf besar, huruf kecil, dan angka.</p>
        {state.errors.newPassword ? <p className="mt-1 text-xs font-medium text-danger-fg">{state.errors.newPassword}</p> : null}
      </div>

      <div>
        <label htmlFor="confirm" className="label">Ulangi password baru</label>
        <input
          id="confirm" name="confirm" type="password" autoComplete="new-password" required
          value={form.confirm}
          onChange={(e) => setForm((prev) => ({ ...prev, confirm: e.target.value }))}
          className={`field ${state.errors.confirm ? "field-error" : ""}`}
        />
        {state.errors.confirm ? <p className="mt-1 text-xs font-medium text-danger-fg">{state.errors.confirm}</p> : null}
      </div>

      <button type="submit" disabled={state.status === "loading"} className="btn-primary">
        {state.status === "loading" ? <Spinner /> : null}
        Ubah Password
      </button>
    </form>
  );
}

export function SessionsForm() {
  const router = useRouter();
  const [state, setState] = useState({ status: "idle", error: null, done: false });

  async function onSubmit(event) {
    event.preventDefault();
    if (state.status === "loading") return;
    setState({ status: "loading", error: null, done: false });

    const result = await apiPost("/api/member/sessions/revoke", {});

    if (!result.ok) {
      setState({ status: "error", error: result.error, done: false });
      return;
    }
    setState({ status: "idle", error: null, done: true });
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {state.done ? (
        <Alert tone="success" title="Sesi diakhiri">
          Anda telah keluar dari semua perangkat lain.
        </Alert>
      ) : null}
      {state.error ? <Alert tone="danger">{state.error.message}</Alert> : null}

      <p className="text-sm text-foreground-muted">
        Keluar dari semua perangkat lain yang masih masuk ke akun ini. Gunakan bila Anda merasa
        akun diakses orang lain.
      </p>

      <button type="submit" disabled={state.status === "loading"} className="btn-secondary">
        {state.status === "loading" ? <Spinner /> : null}
        Akhiri Semua Sesi Lain
      </button>
    </form>
  );
}

function detailsToMap(details) {
  if (!Array.isArray(details)) return {};
  return Object.fromEntries(details.map((d) => [d.field, d.message]));
}
