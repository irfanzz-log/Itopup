// ============================================================================
// /topup/pulsa/[operator], the top-up page for ONE operator.
//
// WHY THIS ROUTE EXISTS (and why /topup/pulsa/pulsa is gone)
//
// Pulsa is a single Game whose operators are products. The old URL was
// /topup/pulsa/pulsa?operator=xl, i.e. ALL operators on one page with the
// chosen one pre-selected via a query string. Two things were wrong with it:
//
//   1. The path was ambiguous, "pulsa/pulsa" names the category twice and the
//      operator not at all. It said nothing about what the customer was buying.
//
//   2. The operator could not actually be changed. The deep-link effect in
//      TopupForm keyed on the operator it found in the URL, and its dependency
//      array included productId. Clicking a different operator tab set
//      productId → the effect re-ran → it re-read `?operator=xl` from the URL
//      and snapped the selection back to XL. The choice looked live but was
//      not.
//
// This route fixes both by putting the operator in the PATH and by rendering
// exactly one product: there is nothing to switch between and no query param to
// re-sync from. The landing cards (listEntriesForCategory, listGamesGrouped)
// now link here per operator.
//
// WHAT THIS ROUTE DELIBERATELY IS NOT
//
// It is not a generic /topup/[category]/[game]/[product] route. A game's
// product tabs (MLBB: Diamonds / Twilight Pass / Weekly Pass) are alternatives
// on ONE page and are legitimately switchable, so games keep the old page and
// its tabs. Pulsa operators are separate cards from the landing page and the
// customer picked one before arriving, giving them the tab strip here would
// re-introduce the ambiguity under a new URL.
// ============================================================================
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import TopupForm from "@/components/topup/TopupForm";
import { GameArtwork } from "@/components/catalog/CatalogCards";
import { productIcon } from "@/config/icons.js";
import { EmptyState } from "@/components/ui/primitives";
import { getGameDetail } from "@/services/catalog.service";
import { resolveAutoDiscountBatch } from "@/services/promo.service";
import { availablePaymentMethods } from "@/config/payment.server";
import { CATEGORY_KIND_PATH } from "@/lib/constants";
import JsonLd from "@/components/seo/JsonLd";
import { productJsonLd } from "@/lib/json-ld.js";
import { buildOperatorDescription } from "@/lib/seo-meta.js";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }) {
  const { operator: operatorSlug } = await params;

  const game = await getGameDetail(PULSA_GAME_SLUG);
  if (!game) return { title: "Layanan tidak ditemukan", robots: { index: false } };

  const operator = game.products.find((p) => p.slug === operatorSlug);
  if (!operator) return { title: "Operator tidak ditemukan", robots: { index: false } };

  // Nominal prices straight from the grid this page renders, so the description
  // can only ever name a price the customer sees. Promo prices are excluded for
  // the same reason as the game page: a meta description outlives a promo.
  const prices = (operator.variants ?? [])
    .map((variant) => variant.sellingPrice)
    .filter((price) => Number.isFinite(price));
  const minPrice = prices.length > 0 ? Math.min(...prices) : null;

  const description = buildOperatorDescription({
    operatorName: operator.name,
    description: operator.description,
    minPrice,
  });

  return {
    title: `Top Up ${operator.name}`,
    description,
    alternates: { canonical: `/topup/pulsa/${operator.slug}` },
    openGraph: {
      title: `Top Up ${operator.name} | ITOPUP`,
      description,
      url: `/topup/pulsa/${operator.slug}`,
      type: "website",
    },
    other: { "product:category": "Pulsa" },
  };
}

/** The single Game that holds every pulsa operator. */
const PULSA_GAME_SLUG = "pulsa";

export default async function OperatorTopupPage({ params, searchParams }) {
  const { operator: operatorSlug } = await params;

  // The customer is on /topup/pulsa/[operator]. The old URL
  // /topup/pulsa/pulsa?operator=xl lands here with operator === "pulsa", which
  // is the GAME slug, not an operator's, that is the ambiguous path this route
  // replaced. Redirect it to the operator's own path when the query string
  // still names one, so an old bookmark or a stale search link lands the
  // customer on the same operator they came for. Without the query it can only
  // be the bare ambiguous path, and the landing page is the honest destination.
  if (operatorSlug === PULSA_GAME_SLUG) {
    const wanted = await searchParams;
    const legacy = typeof wanted?.operator === "string" ? wanted.operator : null;
    redirect(
      legacy
        ? `/topup/${CATEGORY_KIND_PATH.PULSA}/${legacy}`
        : `/topup/${CATEGORY_KIND_PATH.PULSA}`
    );
  }

  const game = await getGameDetail(PULSA_GAME_SLUG);
  if (!game) notFound();

  const operator = game.products.find((p) => p.slug === operatorSlug);
  if (!operator) notFound();

  // Render ONLY this operator's variants. A visitor who typed the URL or came
  // from a search result lands on exactly one operator; the grid is its
  // nominals and nothing else.
  const product = operator;

  const paymentMethods = await availablePaymentMethods();

  // Resolve every nominal's promo price BEFORE render so the grid's first paint
  // is already correct, the same reason the game page does this in one query
  // rather than one request per tile.
  const variantIds = (product.variants ?? []).map((v) => v.id);
  const priceMap = await resolveAutoDiscountBatch(variantIds);
  const initialPrices = Object.fromEntries(
    [...priceMap.entries()].map(([variantId, { promo, discount }]) => [
      variantId,
      {
        hasDiscount: discount > 0,
        discount,
        promoTitle: promo?.title ?? null,
      },
    ])
  );

  return (
    <div className="container-page py-8 sm:py-10">
      <JsonLd
        data={productJsonLd({
          name: `Top Up ${product.name}`,
          description: product.description || undefined,
          path: `/topup/pulsa/${product.slug}`,
          breadcrumbTrail: [
            { name: "Beranda", path: "/" },
            { name: "Top Up", path: "/topup" },
            { name: "Pulsa", path: `/topup/${CATEGORY_KIND_PATH.PULSA}` },
            { name: product.name },
          ],
          offers: (product.variants ?? []).map((variant) => {
            const priced = initialPrices[variant.id];
            const price = priced?.hasDiscount
              ? Math.round(variant.sellingPrice * (1 - priced.discount / 100))
              : variant.sellingPrice;
            return {
              price,
              availability:
                variant.stock !== null && variant.stock <= 0
                  ? "https://schema.org/OutOfStock"
                  : "https://schema.org/InStock",
            };
          }),
        })}
      />
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-foreground-subtle">
        <Link href="/" className="hover:text-foreground">Beranda</Link>
        <span className="mx-1.5" aria-hidden="true">/</span>
        <Link href="/topup" className="hover:text-foreground">Top Up</Link>
        <span className="mx-1.5" aria-hidden="true">/</span>
        <Link href={`/topup/${CATEGORY_KIND_PATH.PULSA}`} className="hover:text-foreground">
          Pulsa
        </Link>
        <span className="mx-1.5" aria-hidden="true">/</span>
        <span className="text-foreground">{product.name}</span>
      </nav>

      <header className="card mb-6 flex items-start gap-4 p-5 sm:p-6">
        <GameArtwork
          game={{ ...game, name: product.name, logo: productIcon({ gameSlug: game.slug, productSlug: product.slug }) }}
          className="h-16 w-16 text-xl"
        />
        <div className="min-w-0">
          <h1 className="text-xl font-extrabold tracking-tight text-foreground sm:text-2xl">
            Top Up {product.name}
          </h1>
          {product.description ? (
            <p className="mt-2 text-sm leading-relaxed text-foreground-muted">{product.description}</p>
          ) : null}
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground-muted">
            <li className="inline-flex items-center gap-1.5">
              <Dot /> Proses otomatis
            </li>
            <li className="inline-flex items-center gap-1.5">
              <Dot /> Pembayaran lengkap
            </li>
            <li className="inline-flex items-center gap-1.5">
              <Dot /> Bayar sesuai harga yang tampil
            </li>
          </ul>
        </div>
      </header>

      {(product.variants ?? []).length === 0 ? (
        <EmptyState
          icon="box"
          title="Produk sedang tidak tersedia"
          description={`Nominal untuk ${product.name} belum tersedia saat ini. Silakan pilih operator lain atau coba beberapa saat lagi.`}
          action={<Link href={`/topup/${CATEGORY_KIND_PATH.PULSA}`} className="btn-secondary">Operator lain</Link>}
        />
      ) : (
        // Suspense is retained because TopupForm is a client component that
        // reads the router (and MyVouchers may fetch); without a boundary the
        // whole route would deopt to client-side rendering. Keeping the
        // boundary costs nothing and matches the game page.
        <Suspense fallback={null}>
          <TopupForm
            game={{
              id: game.id,
              name: `${game.name} ${product.name}`,
              slug: game.slug,
              inputFields: Array.isArray(game.inputFields) ? game.inputFields : [],
              supportsValidation: Boolean(game.supportsValidation),
              categoryKind: game.category?.kind ?? null,
            }}
            // Exactly ONE product: there are no operator tabs to switch between
            // on this page, so the tablist never renders and there is no query
            // param for a stale effect to re-sync from.
            products={[
              {
                id: product.id,
                name: product.name,
                slug: product.slug,
                description: product.description ?? null,
                sortMode: product.sortMode,
                icon: productIcon({ gameSlug: game.slug, productSlug: product.slug }),
                variants: (product.variants ?? []).map((variant) => ({
                  id: variant.id,
                  name: variant.name,
                  slug: variant.slug,
                  denomination: variant.denomination ?? null,
                  unit: variant.unit ?? null,
                  sellingPrice: variant.sellingPrice,
                  isActive: variant.isActive,
                  stock: variant.stock ?? null,
                })),
              },
            ]}
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
            initialPrices={initialPrices}
          />
        </Suspense>
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
