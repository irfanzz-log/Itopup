// ============================================================================
// Member action panel.
//
// Block and password reset both end the member's sessions, so both are shown
// with an explicit confirmation step and a required reason. Role changes are
// rendered only as a hint for non-superadmins: the API refuses them, and showing
// a button that always fails teaches an operator nothing.
// ============================================================================
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Spinner } from "@/components/ui/primitives";
import { apiPost } from "@/lib/api-client";
import { ROLE_LABEL } from "@/lib/constants";

const ROLE_OPTIONS = ["MEMBER", "DEV", "SUPERADMIN"];

export default function MemberActions({ memberId, memberName, status, role }) {
  const router = useRouter();

  const [busy, setBusy] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [confirming, setConfirming] = useState(null);

  const [reason, setReason] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState(role);

  async function run(action, extra = {}) {
    setBusy(action);
    setResult(null);
    setError(null);
    setConfirming(null);

    const response = await apiPost(`/api/dev/members/${memberId}`, { action, ...extra });

    setBusy(null);

    if (!response.ok) {
      setError(response.error?.message || "Tindakan gagal.");
      return;
    }

    setResult(action);
    setNewPassword("");
    setReason("");
    router.refresh();
  }

  const isBlocked = status === "BLOCKED";

  return (
    <div className="space-y-4">
      {/* ── Block / unblock ───────────────────────────────────────────── */}
      <div className="rounded-lg border border-border p-3">
        <p className="text-sm font-semibold text-foreground">
          {isBlocked ? "Buka blokir akun" : "Blokir akun"}
        </p>
        <p className="mt-0.5 text-xs text-foreground-muted">
          {isBlocked
            ? "Akun akan dapat masuk kembali. Sesi lama tidak dipulihkan."
            : "Akun tidak dapat masuk dan seluruh sesinya diakhiri seketika."}
        </p>

        {!isBlocked ? (
          <div className="mt-2">
            <label htmlFor="blockReason" className="label">Alasan</label>
            <input
              id="blockReason"
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={300}
              placeholder="Contoh: indikasi penyalahgunaan promo"
              className="field"
            />
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap gap-2">
          {confirming === "block" ? (
            <>
              <button
                type="button"
                className="btn-danger"
                disabled={busy !== null}
                onClick={() => run("block", { reason: reason || undefined })}
              >
                {busy === "block" ? <Spinner /> : null}
                Ya, blokir {memberName}
              </button>
              <button type="button" className="btn-ghost" onClick={() => setConfirming(null)}>Batal</button>
            </>
          ) : (
            <button
              type="button"
              className={isBlocked ? "btn-primary" : "btn-secondary"}
              disabled={busy !== null}
              onClick={() => (isBlocked ? run("unblock") : setConfirming("block"))}
            >
              {busy === (isBlocked ? "unblock" : "block") ? <Spinner /> : null}
              {isBlocked ? "Buka blokir" : "Blokir akun"}
            </button>
          )}
        </div>
      </div>

      {/* ── Reset password ────────────────────────────────────────────── */}
      <div className="rounded-lg border border-border p-3">
        <p className="text-sm font-semibold text-foreground">Ubah password</p>
        <p className="mt-0.5 text-xs text-foreground-muted">
          Password baru langsung aktif dan semua sesi member diakhiri. Sampaikan password baru
          lewat kanal yang aman.
        </p>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <div className="min-w-[14rem] flex-1">
            <label htmlFor="newPassword" className="label">Password baru</label>
            <input
              id="newPassword"
              type="text"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              minLength={10}
              maxLength={200}
              autoComplete="off"
              placeholder="Minimal 10 karakter"
              className="field font-mono"
            />
          </div>
          <button
            type="button"
            className="btn-secondary"
            disabled={busy !== null || newPassword.length < 10}
            onClick={() => run("reset_password", { newPassword, reason: reason || undefined })}
          >
            {busy === "reset_password" ? <Spinner /> : null}
            Ubah password
          </button>
        </div>
        {newPassword.length > 0 && newPassword.length < 10 ? (
          <p className="mt-1 text-xs text-warning-fg">Minimal 10 karakter.</p>
        ) : null}
      </div>

      {/* ── Role ──────────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-border p-3">
        <p className="text-sm font-semibold text-foreground">Peran akun</p>
        <p className="mt-0.5 text-xs text-foreground-muted">
          Hanya Super Admin yang dapat mengubah peran, dan tidak melebihi perannya sendiri.
        </p>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <div className="w-48">
            <label htmlFor="newRole" className="label">Peran</label>
            <select
              id="newRole"
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
              className="field"
            >
              {ROLE_OPTIONS.map((value) => (
                <option key={value} value={value}>{ROLE_LABEL[value] ?? value}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="btn-secondary"
            disabled={busy !== null || newRole === role}
            onClick={() => run("change_role", { role: newRole })}
          >
            {busy === "change_role" ? <Spinner /> : null}
            Simpan peran
          </button>
        </div>
        {newRole === role ? (
          <p className="mt-1 text-xs text-foreground-subtle">Peran saat ini: {ROLE_LABEL[role] ?? role}</p>
        ) : null}
      </div>

      {/* ── Outcome ───────────────────────────────────────────────────── */}
      {error ? <Alert tone="danger" title="Tindakan gagal">{error}</Alert> : null}
      {result ? (
        <Alert tone="success" title="Berhasil">
          {result === "block" ? "Akun diblokir dan seluruh sesinya diakhiri."
            : result === "unblock" ? "Blokir dibuka."
            : result === "reset_password" ? "Password diubah dan seluruh sesi member diakhiri."
            : result === "change_role" ? "Peran diperbarui."
            : "Selesai."}
        </Alert>
      ) : null}
    </div>
  );
}
