// ============================================================================
// Home page.
//
// A server component: it reads the catalogue directly (no fetch to its own API,
// which would add a round trip and an auth surface for public data).
//
// Every section degrades: if the catalogue is empty or the database is
// unreachable, the page still renders the hero, the how-to steps, and the CTA,
// with an empty state where the grid would be. A homepage that 500s because a
// product query failed is worse than one with a "products coming soon" note.
// ============================================================================
import Link from "next/link";
import {
  CategoryCard, EntryCard, GameCard, SectionHeading,
} from "@/components/catalog/CatalogCards";
import { EmptyState } from "@/components/ui/primitives";
import {
  listCategories, listGamesGrouped, listPopularGames,
} from "@/services/catalog.service";
import { listActivePromos } from "@/services/promo.service";
import PromoStrip from "@/components/promo/PromoStrip";
import JsonLd from "@/components/seo/JsonLd";
import { websiteJsonLd } from "@/lib/json-ld.js";

// Catalog prices and availability change; the header reads the session. Both
// make this page request-time, not build-time.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Itopup - Top Up Game & Pulsa",
  description:
    "Top up Mobile Legends, Free Fire, PUBG Mobile, Genshin Impact, Roblox, CODM, dan pulsa semua operator Indonesia. Proses otomatis 24 jam dengan harga transparan.",
  alternates: { canonical: "/" },
};

const HOW_TO_STEPS = [
  { title: "Pilih produk", body: "Tentukan game atau operator pulsa yang ingin diisi." },
  { title: "Masukkan ID", body: "Isi User ID, Zone ID, atau nomor tujuan sesuai layanan." },
  { title: "Pilih nominal", body: "Pilih nominal yang tersedia. Harga yang tampil adalah harga final." },
  { title: "Pilih pembayaran", body: "Bayar lewat virtual account, QRIS, e-wallet, atau gerai retail." },
  { title: "Selesaikan pembayaran", body: "Selesaikan pembayaran sebelum batas waktu berakhir." },
  { title: "Top-up diproses", body: "Pesanan otomatis diproses dan statusnya dapat dipantau." },
];

const ADVANTAGES = [
  {
    title: "Proses otomatis 24 jam",
    body: "Pesanan diteruskan ke provider secara otomatis, termasuk di luar jam kerja.",
    icon: "M13 2 4 13.2h6.2L9.8 22 20 10.6h-6.4L13.5 2Z",
  },
  {
    title: "Harga transparan",
    body: "Harga yang tampil di halaman produk adalah harga yang dibayar, tanpa biaya tersembunyi.",
    icon: "M12 2v20m5-16H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
  },
  {
    title: "Tanpa login akun game",
    body: "Cukup User ID dan Zone ID. Kami tidak pernah meminta password akun game Anda.",
    icon: "M12 15v2m-6 4h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2Zm10-10V7a4 4 0 0 0-8 0v4",
  },
  {
    title: "Status transaksi jelas",
    body: "Setiap transaksi punya invoice dan riwayat status yang dapat Anda lihat kapan saja.",
    icon: "M9 12h6m-6 4h6M8 2h8a2 2 0 0 1 2 2v18l-3-2-3 2-3-2-3 2V4a2 2 0 0 1 2-2Z",
  },
];

export default async function HomePage() {
  const [categories, grouped, popular, promos] = await Promise.all([
    listCategories().catch(() => []),
    listGamesGrouped().catch(() => []),
    listPopularGames(6).catch(() => []),
    listActivePromos({ limit: 3 }).catch(() => []),
  ]);

  const gamesByCategory = new Map(grouped.map((c) => [c.kind, c]));

  return (
    <>
      <JsonLd
        data={websiteJsonLd({
          name: "ITOPUP",
          description: "Platform top up game dan pulsa dengan proses otomatis 24 jam.",
        })}
      />
      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-border bg-surface">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-brand-soft-strong opacity-60 blur-3xl"
        />
        <div className="container-page relative py-14 sm:py-20">
          <div className="max-w-2xl">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-muted px-3 py-1 text-xs font-semibold text-foreground-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-success-fg" aria-hidden="true" />
              Proses otomatis 24 jam
            </span>
            <h1 className="mt-5 text-3xl font-extrabold leading-tight tracking-tight text-foreground text-balance sm:text-4xl lg:text-5xl">
              Top up game dan pulsa dalam satu tempat
            </h1>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-foreground-muted sm:text-lg">
              ITOPUP memproses pesanan Anda secara otomatis. Masukkan User ID atau nomor
              tujuan, pilih nominal, lalu bayar. Pesanan langsung diproses tanpa perlu
              login akun game.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link href="/topup" className="btn-primary px-6 py-3 text-base">
                Mulai Top Up
              </Link>
              <Link href="/bantuan" className="btn-secondary px-6 py-3 text-base">
                Cara Top Up
              </Link>
            </div>
            <dl className="mt-9 grid max-w-lg grid-cols-3 gap-4">
              <Stat label="Layanan" value={grouped.reduce((sum, c) => sum + (c.entries ?? c.games ?? []).length, 0)} />
              <Stat label="Kategori" value={categories.length} />
              <Stat label="Biaya layanan" value="Rp 0" plain />
            </dl>
          </div>
        </div>
      </section>

      <div className="container-page">
        {/* ── Popular services ───────────────────────────────────────────── */}
        <section className="section">
          <SectionHeading
            title="Layanan Terlaris"
            description="Paling sering dipesan pengguna ITOPUP."
            href="/topup"
          />
          {popular.length ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {popular.map((game) => (
                <GameCard
                  key={game.id}
                  game={game}
                  categoryPath={categoryPathFor(game.category?.kind)}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              icon="box"
              title="Produk sedang tidak tersedia"
              description="Katalog sedang dimuat atau belum disinkronkan. Silakan coba lagi sebentar lagi."
              action={<Link href="/topup" className="btn-primary">Lihat semua layanan</Link>}
            />
          )}
        </section>

        {/* ── Categories ─────────────────────────────────────────────────── */}
        <section className="section pt-0">
          <SectionHeading title="Kategori" description="Pilih jenis layanan yang Anda butuhkan." />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {categories.length ? (
              categories.map((category) => (
                <CategoryCard
                  key={category.id}
                  category={{ ...category, path: `/topup/${category.slug}` }}
                  count={category.entryCount ?? category._count?.games ?? 0}
                />
              ))
            ) : (
              <div className="sm:col-span-3">
                <EmptyState
                  icon="box"
                  title="Kategori belum tersedia"
                  description="Jalankan seed database untuk memuat kategori awal."
                />
              </div>
            )}
          </div>
        </section>

        {/* ── Services, by category ──────────────────────────────────────── */}
        {grouped
          .filter((category) => (category.entries ?? []).length > 0)
          .map((category) => (
            <section key={category.kind} className="section pt-0">
              <SectionHeading
                title={category.name}
                description={category.description}
                href={category.path}
              />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {category.entries.slice(0, 6).map((entry) => (
                  <EntryCard key={entry.id} entry={entry} />
                ))}
              </div>
            </section>
          ))}

        {/* ── Promo ──────────────────────────────────────────────────────── */}
        {promos.length ? (
          <section className="section pt-0">
            <SectionHeading
              title="Promo Aktif"
              description="Hemat lebih banyak dengan promo yang sedang berjalan."
              href="/promo"
            />
            <PromoStrip promos={promos} />
          </section>
        ) : null}

        {/* ── How to ─────────────────────────────────────────────────────── */}
        <section className="section pt-0">
          <SectionHeading title="Cara Top Up" description="Enam langkah, kurang dari dua menit." />
          <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {HOW_TO_STEPS.map((step, index) => (
              <li key={step.title} className="card flex gap-4 p-5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-foreground">{step.title}</span>
                  <span className="mt-1 block text-sm leading-relaxed text-foreground-muted">
                    {step.body}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </section>

        {/* ── Advantages ─────────────────────────────────────────────────── */}
        <section className="section pt-0">
          <SectionHeading title="Kenapa ITOPUP" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {ADVANTAGES.map((item) => (
              <div key={item.title} className="card p-5">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-soft text-brand-600 dark:text-brand-400">
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                  </svg>
                </span>
                <h3 className="mt-3.5 text-sm font-semibold text-foreground">{item.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-foreground-muted">{item.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── CTA ────────────────────────────────────────────────────────── */}
        <section className="section pt-0">
          <div className="card flex flex-col items-center gap-4 bg-brand-soft px-6 py-10 text-center">
            <h2 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              Siap melakukan top up?
            </h2>
            <p className="max-w-lg text-sm text-foreground-muted">
              Pilih layanan, masukkan ID, dan selesaikan pembayaran. Pesanan Anda diproses
              otomatis begitu pembayaran terkonfirmasi.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Link href="/topup" className="btn-primary px-6 py-3">Mulai Top Up</Link>
              <Link href="/register" className="btn-secondary px-6 py-3">Daftar Gratis</Link>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

function Stat({ label, value, plain = false }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-foreground-subtle">{label}</dt>
      <dd className="mt-0.5 text-lg font-bold text-foreground">{plain ? value : `${value}+`}</dd>
    </div>
  );
}

/** Category kind → URL segment. Mirrors src/config/categories.js without importing
 *  the whole config into the render path. */
function categoryPathFor(kind) {
  if (kind === "PULSA") return "pulsa";
  return "game";
}
