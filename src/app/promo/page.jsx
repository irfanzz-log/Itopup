// ============================================================================
// /promo — the promo index.
//
// Server component: the list comes straight from the database. Promo copy is
// rendered as TEXT (see src/components/promo/PromoStrip.jsx) — no promo field is
// ever passed to dangerouslySetInnerHTML, even though only admins can write it.
// ============================================================================
import Link from "next/link";
import { PromoCard } from "@/components/promo/PromoStrip";
import { EmptyState } from "@/components/ui/primitives";
import { listActivePromos } from "@/services/promo.service";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Promo & Voucher",
  description:
    "Kumpulan promo aktif ITOPUP: diskon top up game dan voucher pulsa. Klaim kode promonya sebelum berakhir.",
  alternates: { canonical: "/promo" },
  openGraph: {
    title: "Promo & Voucher — ITOPUP",
    description: "Diskon dan voucher aktif untuk top up game dan pulsa di ITOPUP.",
    url: "/promo",
    type: "website",
  },
};

export default async function PromoPage() {
  const promos = await listActivePromos({ limit: 30 });

  return (
    <div className="container-page py-10 sm:py-12">
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-foreground-subtle">
        <Link href="/" className="hover:text-foreground">Beranda</Link>
        <span className="mx-1.5" aria-hidden="true">/</span>
        <span className="text-foreground">Promo</span>
      </nav>

      <header className="mb-8 max-w-2xl">
        <h1 className="text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
          Promo &amp; Voucher
        </h1>
        <p className="mt-2 text-base leading-relaxed text-foreground-muted">
          Semua promo yang sedang berjalan. Masukkan kode promo di halaman pembayaran sebelum
          menyelesaikan transaksi.
        </p>
      </header>

      {promos.length === 0 ? (
        <EmptyState
          icon="tag"
          title="Belum ada promo aktif"
          description="Saat ini belum ada promo yang berjalan. Pantau halaman ini untuk penawaran berikutnya."
          action={<Link href="/topup" className="btn-primary">Mulai Top Up</Link>}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {promos.map((promo) => (
            <PromoCard key={promo.id} promo={promo} />
          ))}
        </div>
      )}

      <section className="card mt-8 p-5">
        <h2 className="text-base font-bold text-foreground">Cara memakai kode promo</h2>
        <ol className="mt-3 space-y-2 text-sm text-foreground-muted">
          <li>1. Pilih layanan dan nominal top up yang diinginkan.</li>
          <li>2. Isi data akun, lalu lanjut ke halaman pembayaran.</li>
          <li>3. Masukkan kode promo pada kolom “Kode promo”, lalu lanjutkan.</li>
          <li>4. Potongan dihitung ulang di server saat transaksi dibuat — pastikan totalnya sesuai.</li>
        </ol>
        <p className="mt-3 text-xs text-foreground-subtle">
          Kode promo tidak dapat digabung, dan hanya berlaku selama periode promo. Batas pemakaian
          mengikuti ketentuan masing-masing promo.
        </p>
      </section>
    </div>
  );
}
