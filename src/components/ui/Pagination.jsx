// ============================================================================
// Pagination.
//
// Server-rendered links (not client state) so that:
//   * the URL is shareable and back/forward works,
//   * no JS is required,
//   * crawlers can follow the sequence.
//
// `buildHref` receives a page number and returns a href — the caller keeps
// ownership of the query string, so this component never has to know which
// filters a given list uses.
// ============================================================================
import Link from "next/link";

/** Compact page number list with ellipses: 1 … 4 5 [6] 7 8 … 20 */
function pageWindow(current, total, span = 2) {
  const pages = new Set([1, total]);
  for (let i = current - span; i <= current + span; i++) {
    if (i >= 1 && i <= total) pages.add(i);
  }
  const sorted = [...pages].sort((a, b) => a - b);

  const out = [];
  let previous = 0;
  for (const page of sorted) {
    if (previous && page - previous > 1) out.push("gap");
    out.push(page);
    previous = page;
  }
  return out;
}

export default function Pagination({ page, pages, buildHref, className = "" }) {
  if (!pages || pages <= 1) return null;

  const items = pageWindow(page, pages);
  const linkBase =
    "inline-flex h-9 min-w-9 items-center justify-center rounded-[var(--radius-control)] border px-3 text-sm font-medium transition-colors";

  return (
    <nav aria-label="Navigasi halaman" className={`flex flex-wrap items-center justify-center gap-1.5 ${className}`}>
      {page > 1 ? (
        <Link href={buildHref(page - 1)} rel="prev" className={`${linkBase} border-border bg-surface text-foreground hover:bg-surface-muted`}>
          Sebelumnya
        </Link>
      ) : (
        <span aria-disabled="true" className={`${linkBase} border-border bg-surface-muted text-foreground-subtle opacity-60`}>
          Sebelumnya
        </span>
      )}

      {items.map((item, index) =>
        item === "gap" ? (
          <span key={`gap-${index}`} aria-hidden="true" className="px-1 text-foreground-subtle">
            …
          </span>
        ) : item === page ? (
          <span
            key={item}
            aria-current="page"
            className={`${linkBase} border-brand-600 bg-brand-600 text-white`}
          >
            {item}
          </span>
        ) : (
          <Link
            key={item}
            href={buildHref(item)}
            className={`${linkBase} border-border bg-surface text-foreground hover:bg-surface-muted`}
          >
            {item}
          </Link>
        )
      )}

      {page < pages ? (
        <Link href={buildHref(page + 1)} rel="next" className={`${linkBase} border-border bg-surface text-foreground hover:bg-surface-muted`}>
          Berikutnya
        </Link>
      ) : (
        <span aria-disabled="true" className={`${linkBase} border-border bg-surface-muted text-foreground-subtle opacity-60`}>
          Berikutnya
        </span>
      )}
    </nav>
  );
}

/** "Menampilkan 1–20 dari 137" helper, kept next to Pagination for reuse. */
export function ResultCount({ page, limit, total, noun = "data" }) {
  if (!total) return null;
  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
  return (
    <p className="text-sm text-foreground-muted">
      Menampilkan <span className="font-semibold text-foreground">{from}</span>–
      <span className="font-semibold text-foreground">{to}</span> dari{" "}
      <span className="font-semibold text-foreground">{total}</span> {noun}
    </p>
  );
}
