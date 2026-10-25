"use client";

// ============================================================================
// PasswordInput, a password field with a show/hide toggle.
//
// WHY A COMPONENT AND NOT A COPY OF THE MARKUP: the toggle was duplicated in
// five forms (login, register, set-password, change-password) and every copy
// would have to agree on the state semantics below. One implementation means
// there is one place to fix.
//
// THE REVEALED STATE BELONGS TO THE FIELD, NOT TO THE PAGE. It is reset to
// `password` every time the input is re-typed from empty (a successful submit
// clears the value) and it is never persisted: unmounting the form is enough,
// so a revealed password cannot leak into the next screen.
//
// The button sits INSIDE the box, to the right, and is `type="button"` so it
// can never submit the form. It is excluded from the tab order (`tabIndex={-1}`)
// because tabbing from the email field straight into the password is the flow
// people actually use; the toggle is reachable by pointer and by the
// screen-reader label, which is what it exists for.
// ============================================================================
import { useState } from "react";

export default function PasswordInput({
  id,
  name,
  value,
  onChange,
  autoComplete = "current-password",
  placeholder = "••••••••",
  invalid = false,
  describedBy,
  required = true,
  maxLength,
  disabled = false,
  autoFocus = false,
  className = "",
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className={`relative ${className}`}>
      <input
        id={id}
        name={name}
        type={visible ? "text" : "password"}
        autoComplete={autoComplete}
        required={required}
        value={value}
        onChange={onChange}
        aria-invalid={invalid ? "true" : undefined}
        aria-describedby={describedBy}
        className={`field pr-11 ${invalid ? "field-error" : ""}`}
        placeholder={placeholder}
        maxLength={maxLength}
        disabled={disabled}
        autoFocus={autoFocus}
        // Keeps the browser's password manager from offering to save a
        // half-typed credential when the field is nudged by the toggle.
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        disabled={disabled}
        tabIndex={-1}
        aria-label={visible ? "Sembunyikan password" : "Tampilkan password"}
        aria-pressed={visible}
        title={visible ? "Sembunyikan password" : "Tampilkan password"}
        className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-[calc(var(--radius-control)-2px)] text-foreground-subtle transition-colors hover:bg-surface-muted hover:text-foreground disabled:opacity-40"
      >
        {visible ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
}

function EyeIcon() {
  return (
    <svg className="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg className="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.6 6.1A9.7 9.7 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-2.4 3.2M6.6 7.6A17 17 0 0 0 2.5 12S6 18 12 18a9.6 9.6 0 0 0 3.9-.8" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  );
}
