// ============================================================================
// /topup — the service hub.
//
// One page that answers "what can I top up here", grouped by category. Each
// category links to its own landing page; this page does not try to be a
// catalogue of every nominal.
// ============================================================================
import Link from "next/link";
import { CategoryCard, GameCard, SectionHeading } from "@/components/catalog/CatalogCards";
import { EmptyState } from "@/components/ui/primitives";
import { listCategories, listGamesGrouped } from "@/services/catalog.service";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Top Up Game & Pulsa",
  description:
    "Pilih layanan top up: game (Mobile Legends, Free Fire, PUBG Mobile, Genshin Impact, Roblox, CODM) dan pulsa semua operator Indonesia.",
  alternates: { canonical: "/topup" },
};

export default async function TopupHubPage() {
  const [categories, grouped] = await Promise.all([
    listCategories().catch(() => []),
    listGamesGrouped().catch(() => []),
  ]);

  const countByKind = new Map(grouped.map((c) => [c.kind, c.games.length]));
  const withGames = grouped.filter((category) => category.games.length > 0);

  return (
    <div className="container-page py-10 sm:py-12">
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-foreground-subtle">
        <Link href="/" className="hover:text-foreground">Beranda</Link>
        <span className="mx-1.5" aria-hidden="true">/</span>
        <span className="text-foreground">Top Up</span>
      </nav>

      <header className="mb-9 max-w-2xl">
        <h1 className="text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
          Pilih layanan top up
        </h1>
        <p className="mt-2 text-base leading-relaxed text-foreground-muted">
          Tiga kategori, satu alur checkout. Pilih kategori untuk melihat semua layanan
          yang tersedia.
        </p>
      </header>

      {categories.length === 0 ? (
        <EmptyState
          icon="box"
          title="Produk sedang tidak tersedia"
          description="Katalog belum dimuat. Jalankan seed database atau hubungi administrator."
          action={<Link href="/" className="btn-secondary">Kembali ke beranda</Link>}
        />
      ) : (
        <>
          <section className="mb-12">
            <SectionHeading title="Kategori" />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {categories.map((category) => (
                <CategoryCard
                  key={category.id}
                  category={{ ...category, path: `/topup/${category.slug}` }}
                  count={countByKind.get(category.kind) ?? 0}
                />
              ))}
            </div>
          </section>

          {withGames.map((category) => (
            <section key={category.kind} className="mb-12 last:mb-0">
              <SectionHeading
                title={category.name}
                description={category.description}
                href={category.path}
              />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {category.games.map((game) => (
                  <GameCard key={game.id} game={game} categoryPath={category.slug} />
                ))}
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
