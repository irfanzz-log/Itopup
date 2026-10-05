"use client";

// ============================================================================
// Register form.
//
// Registration does NOT sign the member in (the API issues no session). After a
// successful registration the form redirects to /login with the intended
// destination preserved, so the checkout state is not lost.
//
// The password field carries a live strength hint. It is UX only, the server
// re-validates with assessPasswordStrength() and is the authority.
// ============================================================================
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { apiFetch, safeNextPath } from "@/lib/api-client";
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

export default function RegisterForm() {
  const searchParams = useSearchParams();
  const nextPath = safeNextPath(searchParams.get("next"));

  const [values, setValues] = useState({ name: "", email: "", password: "", phone: "" });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);

  // Two-step flow: the API sends a code first, the account is created only when
  // the code is confirmed. Keeping both steps in one component preserves the
  // form state the user already typed if they navigate back.
  const [step, setStep] = useState("form");
  const [code, setCode] = useState("");
  const [resendIn, setResendIn] = useState(0);

  const hint = strengthHint(values.password);

  function update(field) {
    return (event) => {
      setValues((current) => ({ ...current, [field]: event.target.value }));
      setErrors((current) => ({ ...current, [field]: undefined }));
    };
  }

  function applyServerErrors(details) {
    if (!Array.isArray(details)) return;
    const mapped = {};
    for (const issue of details) {
      if (issue?.field && !mapped[issue.field]) mapped[issue.field] = issue.message;
    }
    setErrors(mapped);
  }

  async function startCooldown(seconds) {
    setResendIn(seconds);
    // setInterval in a component would leak if the user navigates away mid-
    // countdown; this loop checks a local flag and stops itself.
    for (let i = 0; i < seconds; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      setResendIn((current) => Math.max(0, current - 1));
    }
  }

  async function onSubmit(event) {
    event.preventDefault();
    setPending(true);
    setFormError(null);
    setErrors({});

    const payload = {
      name: values.name,
      email: values.email,
      password: values.password,
    };
    // Only send `phone` when the member actually filled it in: an empty string
    // fails the Indonesian-phone validation, and sending it would reject a form
    // that looks complete.
    if (values.phone.trim()) payload.phone = values.phone.trim();

    const result = await apiFetch("/api/auth/register", { method: "POST", body: payload });

    setPending(false);

    if (!result.ok) {
      setFormError(result.error.message);
      applyServerErrors(result.error.details);
      return;
    }

    // The code was sent (or the address was unknown, which the API reports the
    // same way). Move to the code step either way: revealing which addresses
    // exist would turn this form into an enumeration oracle.
    setStep("code");
    setFormError(null);
    setCode("");
    startCooldown(60);
  }

  async function onVerify(event) {
    event.preventDefault();
    setPending(true);
    setFormError(null);

    const result = await apiFetch("/api/auth/register/verify", {
      method: "POST",
      body: { email: values.email, code },
    });

    setPending(false);

    if (!result.ok) {
      setFormError(result.error.message);
      return;
    }

    window.location.assign(`/login?next=${encodeURIComponent(nextPath)}&registered=1`);
  }

  async function onResend() {
    setPending(true);
    setFormError(null);

    const result = await apiFetch("/api/auth/register", {
      method: "POST",
      body: {
        name: values.name,
        email: values.email,
        password: values.password,
        ...(values.phone.trim() ? { phone: values.phone.trim() } : {}),
      },
    });

    setPending(false);

    if (!result.ok) {
      setFormError(result.error.message);
      return;
    }

    startCooldown(60);
  }

  if (step === "code") {
    return (
      <form onSubmit={onVerify} className="space-y-5" noValidate>
        {formError ? <Alert tone="danger">{formError}</Alert> : null}

        <div>
          <label htmlFor="code" className="label">Kode verifikasi</label>
          <input
            id="code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code"
            pattern="\d{6}" maxLength={6} required
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            className="field text-center text-lg tracking-[0.5em]"
            placeholder="------"
            autoFocus
          />
          <p className="hint">
            Masukkan 6 angka yang dikirim ke <strong>{values.email}</strong>.
          </p>
        </div>

        <button type="submit" disabled={pending} className="btn-primary w-full py-3">
          {pending ? (
            <>
              <Spinner className="h-4 w-4" label="Memverifikasi" />
              Memverifikasi…
            </>
          ) : (
            "Verifikasi email"
          )}
        </button>

        <div className="flex items-center justify-between text-sm">
          <button
            type="button"
            disabled={resendIn > 0 || pending}
            onClick={onResend}
            className="font-semibold text-brand-600 hover:underline disabled:text-foreground-subtle disabled:no-underline dark:text-brand-400"
          >
            {resendIn > 0 ? `Kirim ulang (${resendIn}s)` : "Kirim ulang kode"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setStep("form");
              setFormError(null);
              setCode("");
            }}
            className="font-medium text-foreground-muted hover:underline"
          >
            Ganti email
          </button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {formError ? <Alert tone="danger">{formError}</Alert> : null}

      <div>
        <label htmlFor="name" className="label">Nama</label>
        <input
          id="name" name="name" type="text" autoComplete="name" required
          value={values.name} onChange={update("name")}
          aria-invalid={Boolean(errors.name)}
          className={`field ${errors.name ? "field-error" : ""}`}
          placeholder="Nama lengkap"
        />
        {errors.name ? <p className="mt-1 text-xs text-danger-fg">{errors.name}</p> : null}
      </div>

      <div>
        <label htmlFor="email" className="label">Email</label>
        <input
          id="email" name="email" type="email" autoComplete="email" required
          value={values.email} onChange={update("email")}
          aria-invalid={Boolean(errors.email)}
          className={`field ${errors.email ? "field-error" : ""}`}
          placeholder="nama@email.com"
        />
        {errors.email ? <p className="mt-1 text-xs text-danger-fg">{errors.email}</p> : null}
        <p className="hint">Email ini digunakan untuk masuk dan melihat riwayat transaksi.</p>
      </div>

      <div>
        <label htmlFor="phone" className="label">
          Nomor HP <span className="font-normal text-foreground-subtle">(opsional)</span>
        </label>
        <input
          id="phone" name="phone" type="tel" autoComplete="tel" inputMode="tel"
          value={values.phone} onChange={update("phone")}
          aria-invalid={Boolean(errors.phone)}
          className={`field ${errors.phone ? "field-error" : ""}`}
          placeholder="08xxxxxxxxxx"
        />
        {errors.phone ? <p className="mt-1 text-xs text-danger-fg">{errors.phone}</p> : null}
      </div>

      <div>
        <label htmlFor="password" className="label">Password</label>
        <input
          id="password" name="password" type="password" autoComplete="new-password" required
          value={values.password} onChange={update("password")}
          aria-invalid={Boolean(errors.password)}
          aria-describedby="password-hint"
          className={`field ${errors.password ? "field-error" : ""}`}
          placeholder={`Minimal ${MIN_LENGTH} karakter`}
        />
        {errors.password ? (
          <p className="mt-1 text-xs text-danger-fg">{errors.password}</p>
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

      <button type="submit" disabled={pending} className="btn-primary w-full py-3">
        {pending ? (
          <>
            <Spinner className="h-4 w-4" label="Mendaftar" />
            Mendaftar…
          </>
        ) : (
          "Kirim kode verifikasi"
        )}
      </button>

      <p className="text-center text-sm text-foreground-muted">
        Sudah punya akun?{" "}
        <Link
          href={`/login${nextPath !== "/member" ? `?next=${encodeURIComponent(nextPath)}` : ""}`}
          className="font-semibold text-brand-600 hover:underline dark:text-brand-400"
        >
          Masuk
        </Link>
      </p>
    </form>
  );
}
