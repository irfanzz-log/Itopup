// ============================================================================
// Small presentational primitives, shared by server and client components.
// Nothing here holds state or fetches data, so it is all server-safe.
// ============================================================================

const TONES = {
  success: "bg-success-bg text-success-fg border-success-border",
  warning: "bg-warning-bg text-warning-fg border-warning-border",
  danger: "bg-danger-bg text-danger-fg border-danger-border",
  info: "bg-info-bg text-info-fg border-info-border",
  neutral: "bg-neutral-bg text-neutral-fg border-neutral-border",
};

/**
 * Inline alert.
 *
 * `role="alert"` only for danger/warning: announcing every informational box
 * interrupts screen-reader users mid-sentence.
 */
export function Alert({ tone = "info", title, children, className = "", icon = true }) {
  const role = tone === "danger" || tone === "warning" ? "alert" : "status";
  return (
    <div
      role={role}
      className={`flex items-start gap-3 rounded-[var(--radius-control)] border px-4 py-3 text-sm ${TONES[tone] ?? TONES.info} ${className}`}
    >
      {icon ? <AlertIcon tone={tone} /> : null}
      <div className="min-w-0 flex-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={title ? "mt-0.5 opacity-90" : ""}>{children}</div> : null}
      </div>
    </div>
  );
}

function AlertIcon({ tone }) {
  const path =
    tone === "success"
      ? "M20 6 9 17l-5-5"
      : tone === "warning" || tone === "danger"
        ? "M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
        : "M12 16v-4m0-4h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z";
  return (
    <svg className="mt-0.5 h-4.5 w-4.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d={path} />
    </svg>
  );
}

/** Empty state — every list in the app renders one instead of a blank region. */
export function EmptyState({ title, description, action = null, icon = "box" }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-border bg-surface px-6 py-14 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-surface-muted text-foreground-subtle">
        <EmptyIcon name={icon} />
      </div>
      <p className="text-base font-semibold text-foreground">{title}</p>
      {description ? (
        <p className="mt-1.5 max-w-md text-sm text-foreground-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

function EmptyIcon({ name }) {
  const paths = {
    box: "M21 8 12 3 3 8m18 0-9 5m9-5v8l-9 5m0-13L3 8m9 5v8m0-8L3 8m0 0v8l9 5",
    search: "M21 21l-4.35-4.35M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z",
    receipt: "M9 12h6m-6 4h6M8 2h8a2 2 0 0 1 2 2v18l-3-2-3 2-3-2-3 2V4a2 2 0 0 1 2-2Z",
    tag: "M20.6 13.4 12 22l-9-9V4h9l8.6 8.6a2 2 0 0 1 0 2.8ZM7.5 7.5h.01",
  };
  return (
    <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d={paths[name] ?? paths.box} />
    </svg>
  );
}

/** Spinner with an accessible label. */
export function Spinner({ className = "h-4 w-4", label = "Memuat" }) {
  return (
    <span role="status" aria-live="polite" className="inline-flex items-center gap-2">
      <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4Z" />
      </svg>
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** Skeleton block for loading.jsx files. */
export function Skeleton({ className = "h-4 w-full" }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

/** Card-shaped skeleton, for product grids. */
export function SkeletonCard() {
  return (
    <div className="card p-4">
      <Skeleton className="h-10 w-10 rounded-full" />
      <Skeleton className="mt-3 h-4 w-2/3" />
      <Skeleton className="mt-2 h-3 w-1/3" />
    </div>
  );
}

export function Badge({ tone = "neutral", children, className = "" }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${TONES[tone] ?? TONES.neutral} ${className}`}
    >
      {children}
    </span>
  );
}

/** Simple horizontal rule with an optional label. */
export function Divider({ label }) {
  if (!label) return <hr className="border-border" />;
  return (
    <div className="flex items-center gap-3">
      <hr className="flex-1 border-border" />
      <span className="text-xs font-medium uppercase tracking-wide text-foreground-subtle">{label}</span>
      <hr className="flex-1 border-border" />
    </div>
  );
}
