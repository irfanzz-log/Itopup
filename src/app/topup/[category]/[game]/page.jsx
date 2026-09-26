// ============================================================================
// /topup/[category]/[game] — the actual top-up page.
//
// One dynamic route serves every game. Nothing here branches on a game slug:
// the page renders whatever `game.inputFields` and `game.products` say, so
// adding a game is a seed change, not a code change.
//
// The page is a server component (catalog comes straight from the database, no
// self-fetch); all interactivity lives in the <TopupForm> client component.
// ============================================================================
import Link from "next/link";
import { notFound } from "next/navigation";
import TopupForm from "@/components/topup/TopupForm";
import { GameArtwork } from "@/components/catalog/CatalogCards";
import { productIcon } from "@/config/icons.js";
import { EmptyState } from "@/components/ui/primitives";
import { getGameDetail, resolveCategoryKind } from "@/services/catalog.service";
import { availablePaymentMethods } from "@/config/payment.server";
import { CATEGORY_KIND_LABEL, CATEGORY_KIND_PATH } from "@/lib/constants";

export const dynamic = "force-dynamic";

/** Categories that exist as URL segments. */
const VALID_SEGMENTS = ["game", "pulsa"];

export async function generateMetadata({ params }) {
  const { category, game: slug } = await params;
  if (!VALID_SEGMENTS.includes(category)) return {};

  const game = await getGameDetail(slug);
  if (!game) return { title: "Layanan tidak ditemukan", robots: { index: false } };

  const kind = resolveCategoryKind(category);
  const label = CATEGORY_KIND_LABEL[kind] ?? "Layanan";

  return {
    title: `Top Up ${game.name}`,
    description:
      game.description ||
      `Top up ${game.name} otomatis 24 jam. Proses cepat, harga transparan, pembayaran lengkap.`,
    alternates: { canonical: `/topup/${category}/${game.slug}` },
    openGraph: {
      title: `Top Up ${game.name} — ITOPUP`,
      description: game.description || `Top up ${game.name} otomatis 24 jam di ITOPUP.`,
      url: `/topup/${category}/${game.slug}`,
      type: "website",
    },
    // Only index a game that actually belongs to the category in its URL —
    // otherwise the same page is reachable under two paths.
    robots: game.category?.kind === kind ? undefined : { index: false, follow: true },
    other: { "product:category": label },
  };
}

export default async function GameTopupPage({ params }) {
  const { category, game: slug } = await params;

  if (!VALID_SEGMENTS.includes(category)) notFound();

  const game = await getGameDetail(slug);
  if (!game) notFound();

  const kind = resolveCategoryKind(category);

  // The canonical path for this game, derived from its real category. A request
  // that arrives under the wrong segment (e.g. /topup/game/dana) renders the
  // page under the correct breadcrumb but is marked noindex above, rather than
  // silently serving duplicate content.
  const canonicalCategory = CATEGORY_KIND_PATH[game.category?.kind] ?? category;
  const categoryLabel = CATEGORY_KIND_LABEL[game.category?.kind] ?? "Layanan";

  const products = (game.products ?? []).filter((product) => product.variants?.length > 0);
  const paymentMethods = await availablePaymentMethods();

  return (
    <div className="container-page py-8 sm:py-10">
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-foreground-subtle">
        <Link href="/" className="hover:text-foreground">Beranda</Link>
        <span className="mx-1.5" aria-hidden="true">/</span>
        <Link href="/topup" className="hover:text-foreground">Top Up</Link>
        <span className="mx-1.5" aria-hidden="true">/</span>
        <Link href={`/topup/${canonicalCategory}`} className="hover:text-foreground">
          {categoryLabel}
        </Link>
        <span className="mx-1.5" aria-hidden="true">/</span>
        <span className="text-foreground">{game.name}</span>
      </nav>

      <header className="card mb-6 flex items-start gap-4 p-5 sm:p-6">
        <GameArtwork game={game} className="h-16 w-16 text-xl" />
        <div className="min-w-0">
          <h1 className="text-xl font-extrabold tracking-tight text-foreground sm:text-2xl">
            Top Up {game.name}
          </h1>
          {game.publisher ? (
            <p className="mt-0.5 text-sm text-foreground-subtle">{game.publisher}</p>
          ) : null}
          {game.description ? (
            <p className="mt-2 text-sm leading-relaxed text-foreground-muted">{game.description}</p>
          ) : null}
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground-muted">
            <li className="inline-flex items-center gap-1.5">
              <Dot /> Proses otomatis
            </li>
            <li className="inline-flex items-center gap-1.5">
              <Dot /> Tanpa login akun game
            </li>
            <li className="inline-flex items-center gap-1.5">
              <Dot /> Bayar sesuai harga yang tampil
            </li>
          </ul>
        </div>
      </header>

      {products.length === 0 ? (
        <EmptyState
          icon="box"
          title="Produk sedang tidak tersedia"
          description={`Nominal untuk ${game.name} belum tersedia saat ini. Silakan pilih layanan lain atau coba beberapa saat lagi.`}
          action={<Link href={`/topup/${canonicalCategory}`} className="btn-secondary">Layanan lain</Link>}
        />
      ) : (
        <TopupForm
          game={{
            id: game.id,
            name: game.name,
            slug: game.slug,
            inputFields: Array.isArray(game.inputFields) ? game.inputFields : [],
            supportsValidation: Boolean(game.supportsValidation),
            categoryKind: game.category?.kind ?? null,
          }}
          products={products.map((product) => ({
            id: product.id,
            name: product.name,
            slug: product.slug,
            description: product.description ?? null,
            sortMode: product.sortMode,
            // A product's brand mark: for pulsa the product IS the operator, so
            // its logo comes from the product slug; for games it is the game's.
            icon: productIcon({ gameSlug: game.slug, productSlug: product.slug }),
            variants: (product.variants ?? []).map((variant) => ({
              id: variant.id,
              name: variant.name,
              slug: variant.slug,
              denomination: variant.denomination ?? null,
              unit: variant.unit ?? null,
              // sellingPrice is the public price. costPrice is deliberately NOT
              // sent: it is the provider's price and is never a client concern.
              sellingPrice: variant.sellingPrice,
              isActive: variant.isActive,
              stock: variant.stock ?? null,
            })),
          }))}
          paymentMethods={paymentMethods.map((method) => ({
            key: method.key,
            label: method.label,
            group: method.group,
            description: method.description ?? null,
            feeFlat: method.feeFlat ?? 0,
            feePercent: method.feePercent ?? 0,
            minAmount: method.minAmount ?? 0,
            maxAmount: method.maxAmount ?? null,
          }))}
        />
      )}
    </div>
  );
}

function Dot() {
  return (
    <svg className="h-3.5 w-3.5 text-success-fg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 6 9 17l-5-5" />
    </svg>
  );
}
