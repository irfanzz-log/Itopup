import "./globals.css";
import { ThemeProvider, themeInitScript } from "@/components/theme/ThemeProvider";
import SiteHeader from "@/components/layout/SiteHeader";
import Footer from "@/components/layout/Footer";
import AnnouncementBanner from "@/components/layout/AnnouncementBanner";
import RouteProgress from "@/components/layout/RouteProgress";
import WebAnalytics from "@/components/analytics/WebAnalytics";
import { readAnnouncement } from "@/services/announcement.service.js";
import { SITE_URL } from "@/lib/site-url.js";

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Itopup - Top Up Game & Pulsa",
    template: "%s | ITOPUP",
  },
  description:
    "Top up game, dan pulsa dengan proses otomatis 24 jam. Harga transparan, pembayaran aman, status transaksi real-time.",
  applicationName: "ITOPUP",
  keywords: [
    "top up game", "top up diamond", "top up pulsa",
    "top up mobile legends", "top up free fire", "top up pubg mobile", "top up genshin impact", "top up roblox", "top up codm",
    "pulsa telkomsel", "pulsa xl", "pulsa tri", "pulsa indosat",
    "voucher game", "saldo game",
  ],
  authors: [{ name: "ITOPUP" }],
  creator: "ITOPUP",
  publisher: "ITOPUP",
  formatDetection: { email: false, address: false, telephone: false },
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "id_ID",
    siteName: "ITOPUP",
    title: "Itopup - Top Up Game & Pulsa",
    description:
      "Top up game dan pulsa dengan proses otomatis 24 jam. Harga transparan dan pembayaran aman.",
    url: SITE_URL,
  },
  twitter: {
    card: "summary_large_image",
    title: "Itopup - Top Up Game & Pulsa",
    description: "Top up game dan pulsa dengan proses otomatis 24 jam.",
  },
  robots: {
    // Public pages are indexable; the /member and /dev groups override this.
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
  },
  category: "games",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f9fc" },
    { media: "(prefers-color-scheme: dark)", color: "#070d19" },
  ],
};

export default async function RootLayout({ children }) {
  // Request-time read so a flip in /dev/announcements applies on the next page
  // load, with no deploy. A failure here resolves to null, so the banner
  // degrades to absent rather than taking the whole page down.
  const announcement = await readAnnouncement();

  return (
    // suppressHydrationWarning: the inline script below sets `class` and
    // `data-theme` on <html> before React hydrates, so the server markup and the
    // DOM legitimately differ on those two attributes.
    <html lang="id" suppressHydrationWarning>
      <head>
        {/* Runs before first paint so the correct theme is applied with no flash. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="flex min-h-screen flex-col bg-background font-sans text-foreground antialiased">
        <ThemeProvider>
          <RouteProgress>
            <a href="#main" className="skip-link">Lewati ke konten utama</a>
            {/* ABOVE the header: the announcement is the first thing a customer
                sees on every page. Rendered server-side so it is present in the
                first paint and in the no-JS view. */}
            <AnnouncementBanner announcement={announcement} />
            {/* The progress bar is rendered INSIDE <header> (see NavBar), as its
                last child. It used to live here as a body-level sibling with
                `fixed top-16`, which pinned it 64px from the VIEWPORT — wrong
                whenever the announcement banner pushed the sticky header down,
                leaving the bar inside the banner instead of on the nav edge.
                Inside the header, `absolute top-16` follows the nav row in
                every state and needs no scroll listener. */}
            <SiteHeader />
            <main id="main" className="flex-1">{children}</main>
            <Footer />
          </RouteProgress>
          {/* Outside RouteProgress on purpose: analytics is not navigation UI,
              and must not be unmounted by anything that remounts the shell. */}
          <WebAnalytics />
        </ThemeProvider>
      </body>
    </html>
  );
}
