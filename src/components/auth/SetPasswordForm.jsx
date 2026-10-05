"use client";

// ============================================================================
// Set-password form — the last step of a Google sign-up.
//
// The identity is already proven server-side and rides in the signed
// itp_oauth_ticket cookie; the client only sends the password. It never puts
// the ticket in a URL or a form field, so it cannot be tampered with here.
// ============================================================================
import { useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-client";
import { Alert, Spinner } from "@/components/ui/primitives";

const MIN_LENGTH = 8;

function strengthHint(password) {
  if (!password) return null;
  if (password.length < MIN_LENGTH) return { tone: "danger", text: `Minimal ${MIN_LENGTH} karakter.` };
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (classes < 2) return { tone: "warning", text: "Tambahkan angka atau huruf besar." };
  if (password.length >= 12) return { tone: "success", text: "Kuat." };
  return { tone: "success", text: "Cukup kuat." };
}

export default function SetPasswordForm({ name = "", email = "", nextPath = "/member" }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState(null);
  const [fieldError, setFieldError] = useState(null);
  const [pending, setPending] = useState(false);

  const hint = strengthHint(password);
  const showMismatch = confirm.length > 0 && password !== confirm;

  async function onSubmit(event) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFieldError(null);

    if (password !== confirm) {
      setPending(false);
      setFieldError("Konfirmasi password tidak cocok.");
      return;
    }

    const result = await apiFetch("/api/auth/set-password", {
      method: "POST",
      body: { password },
    });

    setPending(false);

    if (!result.ok) {
      setError(result.error.message);
      setFieldError(result.error.details?.[0]?.message ?? null);
      return;
    }

    // A session was issued by the API, so go to the destination directly.
    window.location.assign(nextPath);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <div className="rounded-lg border border-border bg-surface-subtle p-4 text-sm">
        <p className="font-semibold text-foreground">{name || "Tanpa nama"}</p>
        <p className="text-foreground-muted">{email}</p>
        <p className="mt-2 text-foreground-subtle">
          Email ini sudah diverifikasi melalui Google. Buat password untuk menyelesaikan pendaftaran.
        </p>
      </div>

      <div>
        <label htmlFor="password" className="label">Password</label>
        <input
          id="password" name="password" type="password" autoComplete="new-password" required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-invalid={Boolean(fieldError)}
          aria-describedby="password-hint"
          className={`field ${fieldError ? "field-error" : ""}`}
          placeholder={`Minimal ${MIN_LENGTH} karakter`}
          autoFocus
        />
        {fieldError ? (
          <p className="mt-1 text-xs text-danger-fg">{fieldError}</p>
        ) : hint ? (
          <p
            id="password-hint"
            className={`mt-1 text-xs ${
              hint.tone === "danger" ? "text-danger-fg"
                : hint.tone === "warning" ? "text-warning-fg"
                  : "text-success-fg"
            }`}
          >
            {hint.text}
          </p>
        ) : (
          <p id="password-hint" className="hint">
            Gabungkan huruf dan angka. Minimal {MIN_LENGTH} karakter.
          </p>
        )}
      </div>

      <div>
        <label htmlFor="confirm" className="label">Ulangi password</label>
        <input
          id="confirm" name="confirm" type="password" autoComplete="new-password" required
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          aria-invalid={Boolean(showMismatch)}
          className={`field ${showMismatch ? "field-error" : ""}`}
          placeholder="Ketik ulang password"
        />
        {showMismatch ? <p className="mt-1 text-xs text-danger-fg">Konfirmasi password tidak cocok.</p> : null}
      </div>

      <button type="submit" disabled={pending} className="btn-primary w-full py-3">
        {pending ? (
          <>
            <Spinner className="h-4 w-4" label="Menyimpan" />
            Menyimpan…
          </>
        ) : (
          "Selesaikan pendaftaran"
        )}
      </button>

      <p className="text-center text-sm text-foreground-muted">
        Akun ini juga bisa Anda masuki dengan{" "}
        <Link href="/login" className="font-semibold text-brand-600 hover:underline dark:text-brand-400">
          Google
        </Link>{" "}
        kapan saja.
      </p>
    </form>
  );
}
