import { Skeleton, SkeletonCard } from "@/components/ui/primitives";

/**
 * Root loading state.
 *
 * NOTE: this file makes Next stream the response, which means `notFound()`
 * renders the 404 UI while the HTTP status stays 200. A 200 on a missing record
 * poisons caches and SEO, so the 404 status matters more than a skeleton on the
 * root segment. Kept here anyway because the root layout renders the header
 * (which awaits a DB read) on EVERY route, without it, every first paint is a
 * blank screen while the nav resolves.
 *
 * Segment-level loading.jsx files (products, orders) do the fine-grained work.
 */
export default function Loading() {
  return (
    <div className="container-page py-12" aria-busy="true" aria-live="polite">
      <span className="sr-only">Memuat halaman…</span>
      <Skeleton className="h-8 w-56" />
      <Skeleton className="mt-3 h-4 w-80" />
      <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 10 }).map((_, index) => (
          <SkeletonCard key={index} />
        ))}
      </div>
    </div>
  );
}
