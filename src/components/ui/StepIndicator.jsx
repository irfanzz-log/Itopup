// ============================================================================
// Checkout step indicator.
//
// Four steps: Produk → Data → Pembayaran → Selesai.
//
// Rendered as an ordered list because that is what it is. The current step gets
// `aria-current="step"`; completed steps are links back (a customer who picked
// the wrong nominal must be able to go back without losing their input, so the
// caller decides which steps are navigable).
// ============================================================================
import Link from "next/link";

export const CHECKOUT_STEPS = [
  { key: "produk", label: "Produk" },
  { key: "data", label: "Data" },
  { key: "pembayaran", label: "Pembayaran" },
  { key: "selesai", label: "Selesai" },
];

export default function StepIndicator({ current = "produk", hrefs = {}, className = "" }) {
  const currentIndex = Math.max(0, CHECKOUT_STEPS.findIndex((s) => s.key === current));

  return (
    <ol
      className={`flex items-center gap-2 overflow-x-auto pb-1 ${className}`}
      aria-label="Langkah checkout"
    >
      {CHECKOUT_STEPS.map((step, index) => {
        const state = index < currentIndex ? "done" : index === currentIndex ? "current" : "todo";
        const href = state === "done" ? hrefs[step.key] : undefined;

        const content = (
          <>
            <span
              className={[
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                state === "done"
                  ? "bg-brand-600 text-white"
                  : state === "current"
                    ? "bg-brand-100 text-brand-700 dark:bg-brand-900 dark:text-brand-100"
                    : "bg-surface-muted text-foreground-subtle",
              ].join(" ")}
            >
              {state === "done" ? (
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20 6 9 17l-5-5" />
                </svg>
              ) : (
                String(index + 1).padStart(2, "0")
              )}
            </span>
            <span
              className={[
                "whitespace-nowrap text-sm",
                state === "todo" ? "text-foreground-subtle" : "font-semibold text-foreground",
              ].join(" ")}
            >
              {step.label}
            </span>
          </>
        );

        return (
          <li key={step.key} className="flex items-center gap-2">
            {href ? (
              <Link
                href={href}
                className="flex items-center gap-2 rounded-full px-1.5 py-1 hover:bg-surface-muted"
                aria-current={state === "current" ? "step" : undefined}
              >
                {content}
              </Link>
            ) : (
              <span
                className="flex items-center gap-2 px-1.5 py-1"
                aria-current={state === "current" ? "step" : undefined}
              >
                {content}
              </span>
            )}
            {index < CHECKOUT_STEPS.length - 1 ? (
              <span
                aria-hidden="true"
                className={`h-px w-5 shrink-0 sm:w-8 ${state === "done" ? "bg-brand-400" : "bg-border"}`}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
