// ============================================================================
// Promo cards for the homepage strip and the /promo page.
//
// `description` is rendered as TEXT, never as HTML. Promo copy is admin-authored,
// and an admin account can be phished or a lower-privileged operator can be
// social-engineered — so no promo field is ever passed to
// dangerouslySetInnerHTML. If rich content is needed later, sanitise on WRITE
// and render through a vetted sanitiser, not by trusting the column.
// ============================================================================
import Link from "next/link";
import { formatDate, formatNumber } from "@/lib/format";

function discountLabel(promo) {
  if (promo.discountType === "PERCENT") return `${promo.discountValue}%`;
  return `Rp ${formatNumber(promo.discountValue)}`;
}

/** Compact horizontal strip for the homepage. */
export default function PromoStrip({ promos }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {promos.map((promo) => (
        <PromoCard key={promo.id} promo={promo} compact />
      ))}
    </div>
  );
}

export function PromoCard({ promo, compact = false }) {
  const expired = new Date(promo.endsAt).getTime() < Date.now();

  return (
    <article className={`card flex flex-col overflow-hidden ${compact ? "" : "h-full"}`}>
      {promo.banner || promo.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={promo.banner || promo.image}
          alt=""
          className="h-32 w-full object-cover"
          loading="lazy"
          decoding="async"
        />
      ) : (
        <div className="flex h-24 items-center justify-center bg-brand-soft">
          <span className="text-2xl font-extrabold text-brand-600 dark:text-brand-400">
            {discountLabel(promo)}
          </span>
        </div>
      )}

      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-sm font-semibold text-foreground">{promo.title}</h3>
          <span className="shrink-0 rounded-full border border-brand-400 px-2 py-0.5 text-xs font-bold text-brand-600 dark:text-brand-400">
            {discountLabel(promo)}
          </span>
        </div>

        {promo.description ? (
          <p className={`mt-2 text-sm leading-relaxed text-foreground-muted ${compact ? "line-clamp-2" : ""}`}>
            {promo.description}
          </p>
        ) : null}

        <dl className="mt-3 space-y-1 text-xs text-foreground-subtle">
          {promo.minSpend > 0 ? (
            <div className="flex gap-1.5">
              <dt>Min. transaksi:</dt>
              <dd className="font-medium text-foreground-muted">
                Rp {formatNumber(promo.minSpend)}
              </dd>
            </div>
          ) : null}
          <div className="flex gap-1.5">
            <dt>Berlaku sampai:</dt>
            <dd className="font-medium text-foreground-muted">{formatDate(promo.endsAt)}</dd>
          </div>
        </dl>

        <div className="mt-auto pt-4">
          <Link href="/topup" className="btn-secondary btn-sm w-full">
            Pakai Promo
          </Link>
        </div>
      </div>
    </article>
  );
}

export { discountLabel };
