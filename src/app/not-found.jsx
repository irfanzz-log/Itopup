import Link from "next/link";

export const metadata = {
  title: "Halaman tidak ditemukan",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <div className="container-page flex min-h-[60vh] flex-col items-center justify-center py-16 text-center">
      <p className="text-6xl font-extrabold tracking-tight text-brand-600 dark:text-brand-400">404</p>
      <h1 className="mt-3 text-xl font-bold text-foreground sm:text-2xl">
        Halaman tidak ditemukan
      </h1>
      <p className="mt-2 max-w-md text-sm text-foreground-muted">
        Halaman yang Anda cari tidak tersedia atau sudah dipindahkan. Coba mulai dari
        daftar layanan kami.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Link href="/topup" className="btn-primary">Lihat Layanan</Link>
        <Link href="/" className="btn-secondary">Ke Beranda</Link>
      </div>
    </div>
  );
}
