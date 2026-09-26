"use client";

// ============================================================================
// Login form.
//
// After a successful login the page does a FULL navigation to the `?next=`
// target. A router.push would keep the already-rendered RSC payload in the
// router cache, so the header would still show "Masuk" until a manual refresh.
//
// `next` is validated with safeNextPath() before use — see that function for
// why `startsWith("/")` alone is not enough.
// ============================================================================
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { apiFetch, safeNextPath } from "@/lib/api-client";
import { Alert, Spinner } from "@/components/ui/primitives";

export default function LoginForm() {
  const searchParams = useSearchParams();
  const nextPath = safeNextPath(searchParams.get("next"));

  const [values, setValues] = useState({ email: "", password: "" });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);

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

  async function onSubmit(event) {
    event.preventDefault();
    setPending(true);
    setFormError(null);
    setErrors({});

    const result = await apiFetch("/api/auth/login", {
      method: "POST",
      body: { email: values.email, password: values.password },
    });

    if (!result.ok) {
      setPending(false);
      setFormError(result.error.message);
      applyServerErrors(result.error.details);
      return;
    }

    window.location.assign(nextPath);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {formError ? <Alert tone="danger">{formError}</Alert> : null}

      <div>
        <label htmlFor="email" className="label">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={values.email}
          onChange={update("email")}
          aria-invalid={Boolean(errors.email)}
          aria-describedby={errors.email ? "email-error" : undefined}
          className={`field ${errors.email ? "field-error" : ""}`}
          placeholder="nama@email.com"
        />
        {errors.email ? (
          <p id="email-error" className="mt-1 text-xs text-danger-fg">{errors.email}</p>
        ) : null}
      </div>

      <div>
        <div className="flex items-baseline justify-between">
          <label htmlFor="password" className="label">Password</label>
        </div>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={values.password}
          onChange={update("password")}
          aria-invalid={Boolean(errors.password)}
          aria-describedby={errors.password ? "password-error" : undefined}
          className={`field ${errors.password ? "field-error" : ""}`}
          placeholder="••••••••"
        />
        {errors.password ? (
          <p id="password-error" className="mt-1 text-xs text-danger-fg">{errors.password}</p>
        ) : null}
      </div>

      <button type="submit" disabled={pending} className="btn-primary w-full py-3">
        {pending ? (
          <>
            <Spinner className="h-4 w-4" label="Memproses" />
            Memproses…
          </>
        ) : (
          "Masuk"
        )}
      </button>

      <p className="text-center text-sm text-foreground-muted">
        Belum punya akun?{" "}
        <Link
          href={`/register${nextPath !== "/member" ? `?next=${encodeURIComponent(nextPath)}` : ""}`}
          className="font-semibold text-brand-600 hover:underline dark:text-brand-400"
        >
          Daftar sekarang
        </Link>
      </p>
    </form>
  );
}
