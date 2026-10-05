// ============================================================================
// /syarat, terms of service.
//
// Linked from the checkout form, so it must exist and must not be a stub: a
// checkout that links to a 404 is worse than one that links nowhere.
//
// This is a plain-language operational summary, NOT legal advice. A real launch
// needs a lawyer's review; the text below states the rules the CODE actually
// enforces (no cancellation after dispatch, server-side pricing, expiry window)
// so the document cannot drift from the implementation.
// ============================================================================
import Link from "next/link";

export const metadata = {
  title: "Syarat & Ketentuan",
  description:
    "Syarat dan ketentuan layanan ITOPUP: ketentuan transaksi, pembayaran, pembatalan, dan tanggung jawab pengguna.",
  alternates: { canonical: "/syarat" },
};

const SECTIONS = [
  {
    title: "1. Layanan",
    body: [
      "ITOPUP adalah platform yang memproses pembelian produk digital (top up game, saldo dompet digital, dan pulsa) melalui penyedia pihak ketiga.",
      "Produk yang tersedia, harganya, dan status ketersediaannya ditentukan oleh sistem ITOPUP dan penyedia. Harga yang ditampilkan pada halaman pembayaran adalah harga yang berlaku saat transaksi dibuat.",
    ],
  },
  {
    title: "2. Akun Pengguna",
    body: [
      "Akun diperlukan untuk melakukan transaksi dan memantau status pesanan. Anda bertanggung jawab menjaga kerahasiaan password akun Anda.",
      "Satu akun tidak boleh digunakan untuk aktivitas yang melanggar hukum, termasuk penipuan pembayaran atau pencucian uang. ITOPUP dapat memblokir akun yang terindikasi melakukan hal tersebut.",
    ],
  },
  {
    title: "3. Data Tujuan",
    body: [
      "Anda bertanggung jawab memastikan User ID, Zone ID, nomor telepon, atau data tujuan lain yang Anda masukkan sudah benar.",
      "Top up yang sudah berhasil dikirim ke penyedia tidak dapat dibatalkan atau dikembalikan, termasuk jika data tujuan ternyata milik orang lain akibat kesalahan penginputan.",
    ],
  },
  {
    title: "4. Pembayaran",
    body: [
      "Pembayaran diproses oleh penyedia pembayaran pihak ketiga. ITOPUP tidak menyimpan data kartu Anda.",
      "Transaksi yang belum dibayar akan kedaluwarsa secara otomatis sesuai batas waktu yang ditampilkan. Pesanan yang sudah kedaluwarsa tidak dapat dibayar lagi.",
      "Bila terjadi pembayaran ganda untuk satu transaksi yang sama, kelebihan pembayaran akan dikembalikan melalui proses pengembalian dana.",
    ],
  },
  {
    title: "5. Pembatalan & Pengembalian Dana",
    body: [
      "Pembatalan hanya dimungkinkan sebelum pesanan dikirim ke penyedia. Setelah pesanan berstatus Diproses, pembatalan tidak dapat dilakukan.",
      "Pengembalian dana diberikan apabila pesanan gagal dipenuhi oleh penyedia. Prosesnya mengikuti kebijakan penyedia pembayaran yang Anda gunakan.",
    ],
  },
  {
    title: "6. Gangguan Layanan",
    body: [
      "ITOPUP dapat mengalami gangguan, pemeliharaan, atau keterbatasan stok dari penyedia. Dalam kondisi tersebut status transaksi Anda akan diperbarui dan diperiksa ulang secara otomatis.",
      "ITOPUP tidak bertanggung jawab atas kerugian tidak langsung yang timbul dari gangguan layanan pihak ketiga.",
    ],
  },
  {
    title: "7. Privasi & Keamanan",
    body: [
      "Password disimpan dalam bentuk hash dan tidak pernah dapat dibaca kembali, termasuk oleh administrator ITOPUP.",
      "Kredensial penyedia layanan dan penyedia pembayaran hanya digunakan di sisi server dan tidak pernah dikirim ke browser Anda.",
      "Data transaksi disimpan untuk keperluan operasional, dukungan pelanggan, dan kewajiban audit.",
    ],
  },
  {
    title: "8. Perubahan Ketentuan",
    body: [
      "Ketentuan ini dapat diperbarui sewaktu-waktu. Versi yang berlaku adalah yang ditampilkan pada halaman ini saat Anda melakukan transaksi.",
    ],
  },
];

export default function SyaratPage() {
  return (
    <div className="container-page py-10 sm:py-12">
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-foreground-subtle">
        <Link href="/" className="hover:text-foreground">Beranda</Link>
        <span className="mx-1.5" aria-hidden="true">/</span>
        <span className="text-foreground">Syarat &amp; Ketentuan</span>
      </nav>

      <header className="mb-8 max-w-2xl">
        <h1 className="text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
          Syarat &amp; Ketentuan
        </h1>
        <p className="mt-2 text-base leading-relaxed text-foreground-muted">
          Ketentuan yang berlaku saat Anda menggunakan layanan ITOPUP.
        </p>
      </header>

      <div className="max-w-3xl space-y-6">
        {SECTIONS.map((section) => (
          <section key={section.title} className="card p-6">
            <h2 className="text-base font-bold text-foreground">{section.title}</h2>
            <div className="mt-2 space-y-2">
              {section.body.map((paragraph) => (
                <p key={paragraph} className="text-sm leading-relaxed text-foreground-muted">
                  {paragraph}
                </p>
              ))}
            </div>
          </section>
        ))}

        <p className="text-xs text-foreground-subtle">
          Terakhir diperbarui: September 2026. Dokumen ini adalah ringkasan operasional dan bukan
          nasihat hukum.
        </p>
      </div>
    </div>
  );
}
