// ============================================================================
// Auth shell — shared chrome for /login and /register.
//
// A two-column layout on desktop (form + trust panel) and a single column on
// mobile. The panel is static marketing copy, so it costs nothing and gives the
// page a reason to exist beyond a bare form.
// ============================================================================
import Link from "next/link";
import Logo from "@/components/layout/Logo";

const POINTS = [
  "Proses otomatis 24 jam, termasuk di luar jam kerja.",
  "Riwayat transaksi tersimpan dan dapat dipantau kapan saja.",
  "Kami tidak pernah meminta password akun game Anda.",
];

export default function AuthShell({ title, subtitle, children, footer }) {
  return (
    <div className="container-page py-10 sm:py-14">
      <div className="mx-auto grid grid-cols-1 max-w-5xl gap-10 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-14">
        <div className="mx-auto w-full max-w-md lg:mx-0">
          <div className="mb-8">
            <Logo />
          </div>

          <h1 className="text-2xl font-extrabold tracking-tight text-foreground">{title}</h1>
          {subtitle ? (
            <p className="mt-2 text-sm leading-relaxed text-foreground-muted">{subtitle}</p>
          ) : null}

          <div className="mt-7">{children}</div>

          {footer ? (
            <div className="mt-6 text-sm text-foreground-muted">{footer}</div>
          ) : null}
        </div>

        <aside className="hidden lg:block">
          <div className="card sticky top-24 bg-brand-soft p-6">
            <h2 className="text-sm font-bold uppercase tracking-wide text-brand-700 dark:text-brand-300">
              Kenapa ITOPUP
            </h2>
            <ul className="mt-4 space-y-3">
              {POINTS.map((point) => (
                <li key={point} className="flex gap-2.5 text-sm leading-relaxed text-foreground-muted">
                  <svg className="mt-0.5 h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M20 6 9 17l-5-5" />
                  </svg>
                  {point}
                </li>
              ))}
            </ul>
            <p className="mt-6 border-t border-brand-200 pt-4 text-xs text-foreground-subtle dark:border-brand-900">
              Butuh bantuan?{" "}
              <Link href="/bantuan" className="font-semibold text-brand-600 hover:underline dark:text-brand-400">
                Lihat panduan
              </Link>
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
