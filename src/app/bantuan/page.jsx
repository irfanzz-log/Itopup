// ============================================================================
// /bantuan, help / FAQ.
//
// Static content by design: a help page that queries the database is a help page
// that is down when the database is. The anchor #kontak is referenced from the
// blocked-account screen, so it must keep existing.
// ============================================================================
import Link from "next/link";
import { SUPPORT_PHONE, SUPPORT_HOURS, supportWhatsAppUrl } from "@/config/site";
import JsonLd from "@/components/seo/JsonLd";
import { faqJsonLd } from "@/lib/json-ld.js";

export const metadata = {
  title: "Bantuan & Cara Top Up",
  description:
    "Panduan cara top up game dan pulsa di ITOPUP, plus jawaban untuk pertanyaan yang paling sering ditanyakan.",
  alternates: { canonical: "/bantuan" },
};

const STEPS = [
  { title: "Pilih layanan", body: "Buka menu Top Up, pilih kategori (Game atau Pulsa), lalu pilih layanan yang ingin diisi." },
  { title: "Masukkan ID", body: "Isi User ID, Zone ID, nomor, atau data lain yang diminta. Untuk beberapa game, data akun bisa dicek otomatis." },
  { title: "Pilih nominal", body: "Pilih nominal pada kartu produk. Harga yang tampil adalah harga final dari sistem ITOPUP." },
  { title: "Pilih pembayaran", body: "Pilih metode pembayaran yang tersedia, lalu lanjutkan ke halaman pembayaran." },
  { title: "Selesaikan pembayaran", body: "Bayar sesuai instruksi sebelum batas waktu. Transaksi kedaluwarsa otomatis jika tidak dibayar." },
  { title: "Top-up diproses", body: "Setelah pembayaran terkonfirmasi, pesanan dikirim ke penyedia dan statusnya dapat dipantau di menu Transaksi." },
];

const FAQ = [
  {
    q: "Berapa lama proses top up?",
    a: "Sebagian besar pesanan diproses otomatis dalam hitungan detik sampai beberapa menit setelah pembayaran terkonfirmasi. Jika layanan penyedia sedang ramai, proses bisa lebih lama dan status akan berubah menjadi “Diproses”.",
  },
  {
    q: "Salah memasukkan User ID, apakah bisa dibatalkan?",
    a: "Transaksi yang sudah dikirim ke penyedia tidak dapat dibatalkan. Karena itu periksa kembali User ID / Zone ID Anda sebelum menekan “Lanjut ke Pembayaran”. Data akun akan dicek otomatis ke penyedia, dan Anda tidak akan bisa lanjut jika akunnya tidak ditemukan.",
  },
  {
    q: "Sudah bayar tapi status masih menunggu pembayaran.",
    a: "Pembayaran biasanya terkonfirmasi otomatis. Bila status belum berubah setelah beberapa menit, jangan membayar ulang. Hubungi dukungan dengan menyertakan nomor invoice dan bukti pembayaran.",
  },
  {
    q: "Apakah saya perlu akun game untuk top up?",
    a: "Tidak. ITOPUP hanya membutuhkan User ID / Player ID yang tampil di profil akun game Anda. Kami tidak pernah meminta password akun game.",
  },
  {
    q: "Metode pembayaran apa saja yang tersedia?",
    a: "Daftar metode yang aktif ditampilkan langsung di halaman pembayaran. Metode yang belum aktif tidak akan muncul, jadi Anda selalu melihat pilihan yang benar-benar bisa dipakai.",
  },
  {
    q: "Apakah data saya aman?",
    a: "Password disimpan dalam bentuk hash, sesi menggunakan cookie yang tidak dapat dibaca JavaScript, dan seluruh komunikasi dengan penyedia layanan dilakukan dari server ITOPUP. Kredensial penyedia tidak pernah dikirim ke browser.",
  },
];

export default function BantuanPage() {
  return (
    <div className="container-page py-10 sm:py-12">
      {/* FAQPage mirrors the FAQ array rendered below. The schema and the
          visible section come from the same constant, so an answer edited in
          one is correct in the other. */}
      <JsonLd data={faqJsonLd(FAQ)} />
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-foreground-subtle">
        <Link href="/" className="hover:text-foreground">Beranda</Link>
        <span className="mx-1.5" aria-hidden="true">/</span>
        <span className="text-foreground">Bantuan</span>
      </nav>

      <header className="mb-8 max-w-2xl">
        <h1 className="text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
          Bantuan &amp; Cara Top Up
        </h1>
        <p className="mt-2 text-base leading-relaxed text-foreground-muted">
          Panduan singkat untuk menyelesaikan top up pertama Anda, plus jawaban untuk pertanyaan
          yang paling sering ditanyakan.
        </p>
      </header>

      <section aria-labelledby="cara-topup" className="mb-12">
        <h2 id="cara-topup" className="text-lg font-bold tracking-tight text-foreground sm:text-xl">
          Cara Top Up
        </h2>
        <ol className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className="card p-5">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-brand-soft text-sm font-bold text-brand-700 dark:text-brand-100">
                {String(index + 1).padStart(2, "0")}
              </span>
              <p className="mt-3 font-semibold text-foreground">{step.title}</p>
              <p className="mt-1 text-sm leading-relaxed text-foreground-muted">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="faq" className="mb-12">
        <h2 id="faq" className="text-lg font-bold tracking-tight text-foreground sm:text-xl">
          Pertanyaan Umum
        </h2>
        <div className="mt-5 space-y-3">
          {FAQ.map((item) => (
            <details key={item.q} className="card group p-5">
              <summary className="flex cursor-pointer items-center justify-between gap-4 text-sm font-semibold text-foreground marker:content-none">
                {item.q}
                <svg
                  className="h-4 w-4 shrink-0 text-foreground-subtle transition-transform group-open:rotate-180"
                  viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
                </svg>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-foreground-muted">{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section id="kontak" aria-labelledby="kontak-title" className="card p-6">
        <h2 id="kontak-title" className="text-lg font-bold tracking-tight text-foreground">
          Masih butuh bantuan?
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-foreground-muted">
          Siapkan nomor invoice (format <span className="font-mono text-foreground">ITP-YYYYMMDD-XXXXXXXX</span>)
          agar tim dukungan dapat menemukan transaksi Anda dengan cepat. Jangan pernah mengirim
          password atau kode verifikasi kepada siapa pun, termasuk yang mengaku dari ITOPUP.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <a
            href={supportWhatsAppUrl()}
            className="btn-primary"
            rel="noopener noreferrer"
            target="_blank"
          >
            WhatsApp {SUPPORT_PHONE.display}
          </a>
          <Link href="/member/orders" className="btn-secondary">Lihat Transaksi Saya</Link>
          <Link href="/topup" className="btn-secondary">Mulai Top Up</Link>
        </div>
        <p className="mt-3 text-xs text-foreground-subtle">Jam operasional: {SUPPORT_HOURS}.</p>
      </section>
    </div>
  );
}
