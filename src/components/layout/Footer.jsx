// ============================================================================
// Site footer.
//
// Static content only, no data fetching, so it can render in every error and
// loading state without a database.
// ============================================================================
import Link from "next/link";
import Logo from "./Logo";
import { SUPPORT_PHONE, SUPPORT_HOURS, supportWhatsAppUrl } from "@/config/site";

const COLUMNS = [
  {
    title: "Layanan",
    links: [
      { href: "/topup", label: "Semua Layanan" },
      { href: "/topup/game", label: "Top Up Game" },
      { href: "/topup/pulsa", label: "Pulsa" },
    ],
  },
  {
    title: "Informasi",
    links: [
      { href: "/promo", label: "Promo" },
      { href: "/bantuan", label: "Cara Top Up" },
      { href: "/bantuan#faq", label: "FAQ" },
      { href: "/bantuan#kontak", label: "Hubungi Kami" },
    ],
  },
  {
    title: "Akun",
    links: [
      { href: "/login", label: "Masuk" },
      { href: "/register", label: "Daftar" },
      { href: "/member/orders", label: "Riwayat Transaksi" },
      { href: "/member/profile", label: "Profil" },
    ],
  },
];

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="mt-auto border-t border-border bg-surface">
      <div className="container-page py-12">
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <Logo />
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-foreground-muted">
              ITOPUP adalah platform top up game dan pulsa dengan proses otomatis
              24 jam. Harga transparan, pembayaran aman, dan status transaksi dapat dipantau
              secara real-time.
            </p>
            <ul className="mt-5 space-y-2 text-sm text-foreground-muted">
              <li className="flex items-center gap-2">
                <CheckDot />
                Proses otomatis, tanpa perlu login akun game
              </li>
              <li className="flex items-center gap-2">
                <CheckDot />
                Status transaksi transparan
              </li>
              <li className="flex items-center gap-2">
                <CheckDot />
                Dukungan pelanggan setiap hari
              </li>
            </ul>
            <div className="mt-5 space-y-1 text-sm">
              <a
                href={supportWhatsAppUrl()}
                className="inline-flex items-center gap-2 font-semibold text-brand-600 hover:underline dark:text-brand-400"
                rel="noopener noreferrer"
                target="_blank"
              >
                <WhatsAppIcon />
                {SUPPORT_PHONE.display}
              </a>
              <p className="text-xs text-foreground-subtle">{SUPPORT_HOURS}</p>
            </div>
          </div>

          {COLUMNS.map((column) => (
            <nav key={column.title} aria-label={column.title}>
              <h2 className="text-sm font-semibold text-foreground">{column.title}</h2>
              <ul className="mt-4 space-y-2.5">
                {column.links.map((link) => (
                  <li key={`${link.href}-${link.label}`}>
                    <Link
                      href={link.href}
                      className="text-sm text-foreground-muted transition-colors hover:text-brand-600 dark:hover:text-brand-400"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-foreground-subtle">
            © {year} ITOPUP. Seluruh hak cipta dilindungi.
          </p>
          <p className="text-xs text-foreground-subtle">
            ITOPUP bukan afiliasi resmi penerbit game. Nama produk dan merek dagang
            milik pemiliknya masing-masing.
          </p>
        </div>
      </div>
    </footer>
  );
}

function CheckDot() {
  return (
    <svg className="h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/** WhatsApp icon inline, kept here so the footer stays self-contained
 * and no extra asset is fetched for a single link. */
function WhatsAppIcon() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  );
}
