// ============================================================================
// Shared dev UI pieces.
//
// The dev area renders a lot of tabular, numeric data. These primitives exist so
// a stat card, a table shell and a section heading look identical everywhere,
// and so a number is never formatted by hand in a page (that is where thousand
// separators go missing on the admin screen finance reads).
// ============================================================================
import Link from "next/link";
import { formatIDR, formatNumber } from "@/lib/format";

/** Page heading with an optional description and right-aligned actions. */
export function PageHeader({ title, description = null, children = null }) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-extrabold tracking-tight text-foreground sm:text-2xl">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-3xl text-sm text-foreground-muted">{description}</p>
        ) : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </header>
  );
}

/**
 * A single headline number.
 *
 * `tone` colours the value only, never the whole card, so a grid of stats does
 * not turn into a wall of colour where the eye cannot find the outlier.
 */
export function StatCard({ label, value, hint = null, tone = "neutral", href = null }) {
  const toneClass = {
    neutral: "text-foreground",
    brand: "text-brand-600 dark:text-brand-400",
    success: "text-success-fg",
    warning: "text-warning-fg",
    danger: "text-danger-fg",
  }[tone];

  const body = (
    <>
      <p className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">{label}</p>
      <p className={`mt-1.5 text-2xl font-extrabold tabular-nums ${toneClass}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-foreground-subtle">{hint}</p> : null}
    </>
  );

  if (href) {
    return <Link href={href} className="card-interactive block p-4">{body}</Link>;
  }
  return <div className="card p-4">{body}</div>;
}

/** Responsive grid for StatCards. */
export function StatGrid({ children, cols = 4 }) {
  const colsClass = {
    2: "sm:grid-cols-2",
    3: "sm:grid-cols-2 lg:grid-cols-3",
    4: "sm:grid-cols-2 lg:grid-cols-4",
    5: "sm:grid-cols-2 lg:grid-cols-5",
  }[cols] ?? "sm:grid-cols-2 lg:grid-cols-4";

  return <div className={`grid grid-cols-1 gap-3 ${colsClass}`}>{children}</div>;
}

/** A titled block with an optional description and action. */
export function Section({ title, description = null, action = null, children, className = "" }) {
  return (
    <section className={`card overflow-hidden ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-surface-muted px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-foreground">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-xs text-foreground-muted">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

/**
 * Table shell. `columns` is a list of `{ key, label, align }`.
 *
 * On a phone a horizontally scrolling admin table is unusable, so the shell
 * renders the same rows as a definition list below `lg`.
 */
export function DataTable({ columns, rows, renderRow, renderCard, caption, empty = "Tidak ada data." }) {
  if (!rows.length) {
    return <p className="py-6 text-center text-sm text-foreground-muted">{empty}</p>;
  }

  return (
    <>
      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-foreground-subtle">
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className={`whitespace-nowrap px-3 py-2.5 font-semibold ${
                    col.align === "right" ? "text-right" : ""
                  }`}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-border last:border-0 align-top">
                {renderRow(row)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="space-y-3 lg:hidden">
        {rows.map((row) => (
          <li key={row.id}>{renderCard(row)}</li>
        ))}
      </ul>
    </>
  );
}

/** A table cell with the app's standard padding. */
export function Td({ children, align = "left", className = "" }) {
  return (
    <td className={`px-3 py-2.5 ${align === "right" ? "text-right" : ""} ${className}`}>
      {children}
    </td>
  );
}

/** Rupiah cell, tabular numerals so columns line up. */
export function Money({ value, className = "" }) {
  return <span className={`tabular-nums ${className}`}>{formatIDR(value)}</span>;
}

/** Count cell. */
export function Count({ value, className = "" }) {
  return <span className={`tabular-nums ${className}`}>{formatNumber(value)}</span>;
}

/** Key/value list for detail panels. */
export function FieldList({ items, cols = 2 }) {
  const colsClass = cols === 3 ? "sm:grid-cols-3" : cols === 1 ? "" : "sm:grid-cols-2";
  return (
    <dl className={`grid grid-cols-1 gap-x-6 gap-y-3 ${colsClass}`}>
      {items.filter(Boolean).map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
            {item.label}
          </dt>
          <dd className="mt-0.5 break-words text-sm text-foreground">{item.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
