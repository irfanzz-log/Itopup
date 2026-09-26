// ============================================================================
// /topup/[category] — one category (game / pulsa).
//
// A dynamic segment rather than two near-identical files: the layout, the
// breadcrumb, and the metadata are identical, and only the label differs. The
// category is resolved from the DB by `kind`, so adding a category later does
// not require a new route.
//
// generateStaticParams is intentionally NOT exported: this page is
// `force-dynamic` because it renders the session-aware header through the root
// layout.
// ============================================================================
import Link from "next/link";
import { notFound } from "next/navigation";
import { GameCard, SectionHeading } from "@/components/catalog/CatalogCards";
import { EmptyState } from "@/components/ui/primitives";
import { listGamesByCategory, resolveCategoryKind } from "@/services/catalog.service";
import { CATEGORY_KIND_LABEL } from "@/lib/constants";

export const dynamic = "force-dynamic";

/** Categories that exist as routes. Anything else is a 404, not a redirect. */
const VALID_SEGMENTS = ["game", "pulsa"];

export async function generateMetadata({ params }) {
  const { category } = await params;
  if (!VALID_SEGMENTS.includes(category)) return {};

  const kind = resolveCategoryKind(category);
  const label = CATEGORY_KIND_LABEL[kind] ?? "Layanan";

  const titles = {
    GAME: "Top Up Game",
    PULSA: "Top Up Pulsa",
  };

  const descriptions = {
    GAME: "Top up diamond, UC, CP, Robux, dan item game lainnya dengan proses otomatis 24 jam.",
    PULSA: "Beli pulsa semua operator Indonesia dengan proses otomatis dan harga bersaing.",
  };

  return {
    title: titles[kind] ?? `Top Up ${label}`,
    description: descriptions[kind] ?? `Layanan top up ${label} dengan proses otomatis.`,
    alternates: { canonical: `/topup/${category}` },
  };
}

export default async function CategoryPage({ params }) {
  const { category } = await params;

  if (!VALID_SEGMENTS.includes(category)) notFound();

  const { category: dbCategory, games } = await listGamesByCategory(category);

  if (!dbCategory) notFound();

  const label = CATEGORY_KIND_LABEL[dbCategory.kind] ?? dbCategory.name;

  return (
    <div className="container-page py-10 sm:py-12">
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-foreground-subtle">
        <Link href="/" className="hover:text-foreground">Beranda</Link>
        <span className="mx-1.5" aria-hidden="true">/</span>
        <Link href="/topup" className="hover:text-foreground">Top Up</Link>
        <span className="mx-1.5" aria-hidden="true">/</span>
        <span className="text-foreground">{label}</span>
      </nav>

      <header className="mb-8 max-w-2xl">
        <h1 className="text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
          Top Up {label}
        </h1>
        {dbCategory.description ? (
          <p className="mt-2 text-base leading-relaxed text-foreground-muted">
            {dbCategory.description}
          </p>
        ) : null}
      </header>

      {games.length === 0 ? (
        <EmptyState
          icon="box"
          title="Produk sedang tidak tersedia"
          description={`Belum ada layanan ${label.toLowerCase()} yang aktif saat ini. Silakan cek kategori lain.`}
          action={<Link href="/topup" className="btn-secondary">Lihat kategori lain</Link>}
        />
      ) : (
        <section>
          <SectionHeading title={`Semua layanan ${label}`} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {games.map((game) => (
              <GameCard key={game.id} game={game} categoryPath={category} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
