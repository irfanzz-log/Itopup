# SEO

Teknis fondasi SEO di ITOPUP. Ditulis berdasarkan kode yang ada, bukan rencana.

## Domain

Satu sumber kebenaran untuk origin absolut: `NEXT_PUBLIC_APP_URL` di `src/lib/site-url.js`.

```
NEXT_PUBLIC_APP_URL=https://itopup.my.id
```

`metadataBase`, sitemap, robots, dan JSON-LD semuanya membaca dari sini, jadi
domain, skema, dan trailing slash tidak bisa saling tidak cocok satu sama lain.
Nilai fallback adalah `http://localhost:3200` — bukan domain tebakan.

**Wajib diisi sebelum deploy.** Tanpa variabel ini, sitemap dan canonical akan
menjadi URL `localhost`, yang akan membuat Google mengabaikannya.

## Yang Dirender Server

Semua halaman yang bisa diindeks adalah Server Components dengan `force-dynamic`:
server membaca Postgres dan mengirimkan HTML yang sudah jadi. H1, grid produk,
breadcrumb, dan JSON-LD semuanya ada di respons pertama. Form checkout
(`<TopupForm>`) adalah satu-satunya client component di rute publik, dan ia
dibungkus `<Suspense>`.

Googlebot mendapatkan markup yang sama seperti pelanggan. Tidak ada konten
utama yang muncul hanya setelah klik.

## Metadata

Global di `src/app/layout.jsx`:

```js
title: {
  default: "Itopup - Top Up Game & Pulsa",
  template: "%s | ITOPUP",
}
```

Per halaman: static `export const metadata` untuk halaman statis,
`generateMetadata()` untuk rute dinamis.

**Builder untuk halaman dinamis** ada di `src/lib/seo-meta.js`:

- `buildGameTitle(gameName, kind, productNames)` → `Top Up Mobile Legends (Diamonds, Weekly Pass)`
- `buildGameDescription(...)` → memakai deskripsi game jika ada, kalau tidak
  generate dari nama produk + harga termurah
- `buildOperatorDescription(...)` → sama untuk operator pulsa

Aturan builder:

- Harga hanya dari `sellingPrice` baris yang dirender halaman itu, dibulatkan
  ke bawah (`Rp 1.732` → `mulai dari Rp 1.700`). Harga promo TIDAK dipakai:
  meta description di-cache lebih lama dari masa berlaku promo.
- Tidak ada klaim "resmi", "termurah", persentase diskon.
- Nama produk hanya 2 pertama di title; sisanya akan jadi daftar, bukan kalimat.
- Return `undefined` kalau nama kosong, supaya pemanggil bisa `noindex`.

## Sitemap

`src/app/sitemap.js` → `/sitemap.xml`, dibangun dari database saat request.
Game ditambahkan dari panel admin langsung masuk tanpa deploy.

Isi:

- 7 halaman fixed (`/`, `/topup`, `/promo`, `/bantuan`, `/syarat`, `/login`, `/register`)
- `/topup/<category>` per kategori yang punya produk jualan
- `/topup/game/<slug>` per game aktif yang punya varian jualan
- `/topup/pulsa/<operator>` per operator yang punya varian jualan

`priority` dan `changeFrequency` sengaja tidak dikirim. Google mengabaikan
keduanya untuk ranking; mengirimnya hanya menambah byte dan menyiratkan sinyal
yang tidak ada. Yang dikirim adalah `lastmod` dari `updatedAt` tiap baris.

**Tidak masuk:** `/member`, `/dev`, `/api`, `/checkout`, URL dengan query
parameter, varian-level (tab di halaman game, bukan route), game/operator
tanpa varian aktif (tidak ada yang dijanjikan ke crawler).

Ukuran hari ini ~20 URL. Batas protokol 50.000 URL / 50MB per file. Saat
mendekati itu, pecah ke `app/sitemap/[id].js` + sitemap index, tetap pakai
`src/services/sitemap.service.js`.

## robots.txt

`src/app/robots.js` → `/robots.txt`.

```
User-Agent: *
Allow: /
Disallow: /member/
Disallow: /dev/
Disallow: /api/
Disallow: /checkout/
Disallow: /topup/pulsa/pulsa
```

CSS, JS, gambar tidak diblokir. `robots.txt` tidak dipakai untuk menghapus URL
yang sudah terindeks — tugasnya `X-Robots-Tag` (lihat bawah).

## noindex: tiga lapis, tidak saling bertentangan

1. **`next.config.js`** mengirim `X-Robots-Tag: noindex, nofollow` untuk
   `/(member|dev)/:path*` dan `/api/:path*`. Header HTTP, terbaca sebelum body.
2. **Layout metadata**: `src/app/(member)/layout.jsx` dan
   `src/app/(dev)/layout.jsx` punya `robots: { index: false, follow: false }`.
3. **Halaman yang tidak ada**: `generateMetadata` return
   `robots: { index: false }` saat slug tidak ditemukan, supaya 404 soft tidak
   diindeks.

Cek: `curl -sI http://localhost:3939/member | grep -i robots` →
`X-Robots-Tag: noindex, nofollow`.

## Canonical

`alternates: { canonical: "..." }` di setiap halaman publik. Path selalu
diturunkan dari category kind barisnya (`CATEGORY_KIND_PATH`), bukan dari
URL request — jadi game tidak bisa muncul di dua path. Kalau request datang
via segment yang salah, halaman tetap render (dengan breadcrumb yang benar)
tapi `robots: { index: false }`.

## JSON-LD

Satu komponen: `src/components/seo/JsonLd.jsx`. Builder di `src/lib/json-ld.js`.

| Halaman | Node |
|---|---|
| `/` | `Organization` + `WebSite` |
| `/topup/game/[game]` | `Product` + `Offer` + `BreadcrumbList` |
| `/topup/pulsa/[operator]` | `Product` + `Offer` + `BreadcrumbList` |
| `/bantuan` | `FAQPage` |

Aturan: skema hanya menggambarkan apa yang halaman tampilkan.

- Harga di `Offer` adalah `sellingPrice` termurah yang dirender, IDR.
- `availability` hanya `InStock` saat stok terbatas dan > 0; null stock
  (untracked) TIDAK diklaim InStock.
- Tidak ada `aggregateRating` — kita tidak kumpulkan review.
- `BreadcrumbList` diambil dari trail yang dirender `<nav>`, tidak ditulis
  manual.
- `FAQPage` dari array `FAQ` yang sama yang dirender halaman bantuan.

Cek: `curl -s http://localhost:3939/topup/game/mobile-legends | grep -o 'application/ld+json'`.

## Struktur URL

```
/                                   Beranda
/topup                              Hub: semua kategori
/topup/game                         Kategori Game
/topup/pulsa                        Kategori Pulsa
/topup/game/<game>                  Halaman top up game
/topup/pulsa/<operator>             Halaman top up operator
/promo                              Promo aktif
/bantuan                            Cara top up + FAQ
/syarat                             Syarat & ketentuan
/login, /register                   Autentikasi
/member/*                           Privat (noindex)
/dev/*                              Privat (noindex, staff only)
```

Navigasi: header (desktop + mobile), footer 3 kolom, breadcrumb di setiap
halaman dalam. Semua link HTML `<a>`/`<Link>`, tidak ada yang hanya muncul
via JS event.

## Google Search Console

Persiapan sudah ada; pengiriman butuh akunmu sendiri.

1. Set `NEXT_PUBLIC_APP_URL=https://itopup.my.id` di environment deploy.
2. Deploy. Pastikan `https://itopup.my.id/robots.txt` mengembalikan
   `Sitemap: https://itopup.my.id/sitemap.xml`.
3. Tambahkan property di Search Console (atau Domain untuk include www +
   non-www + subdomain sekaligus).
4. Verifikasi. Token verification jangan dimasukkan ke source code —
   Search Console menerima verifikasi via DNS record, yang tidak butuh
   perubahan repo.
5. Submit `https://itopup.my.id/sitemap.xml` di Sitemaps.

Validasi setelahnya:

- URL inspection: `https://itopup.my.id/topup/game/mobile-legends` → cek
  "Live test" render HTML termasuk H1 dan JSON-LD.
- Rich results: `/bantuan` (FAQPage) dan halaman produk (Product/Offer).
- Coverage: harusnya tidak ada URL `/member` atau `/dev` yang diindeks.

## Yang Masih Perlu Diperbaiki

Ini temuan audit yang belum bisa selesai karena butuh keputusan bisnis:

### Game duplikat CODM

`codm` (isPopular, 6 nominal) dan `call-of-duty-mobile` (21 nominal, 20 provider
mapping) sama-sama aktif. Dua halaman dengan konten hampir identik adalah
duplicate content yang bisa membuat Google pilih salah satu untuk diranking —
atau tidak keduanya. Tidak ada order historis di keduanya.

Solusi: nonaktifkan salah satu via panel admin. `call-of-duty-mobile` punya
provider mapping 4x lebih banyak.

### 23 game belum di-seed ke production

`.env.prod` (Supabase production) hanya punya 7 game aktif.
`.env.dev` (Supabase dev) punya 30. 23 game di dev belum ada di production,
termasuk `PUBG Mobile`, `Free Fire` sebenarnya ada tapi yang lain seperti
`Arena Breakout`, `Dragon Raja`, `Telegram Stars` tidak.

Sitemap hanya mengikuti data production, jadi URL itu sengaja tidak dibuat —
tidak ada halamannya. Seed production kalau game-game itu memang dijual.

### Migrasi production sekarang sudah sinkron

Audit menemukan production DB ketinggalan 5 migrasi
(`20260928170000` sampai `20261002060000`), termasuk `promos.scope` dan
`promos.visibility`. Akibatnya `promo.service` melempar `ColumnNotFound`
dan **seluruh halaman top-up gagal render** (hanya shell skeleton yang keluar).

Sudah dijalankan `prisma migrate deploy` ke `.env.prod` — 5 migrasi applied,
halaman top-up sekarang render penuh dengan JSON-LD.

Kedepannya: `prisma migrate deploy` harus jadi bagian deploy pipeline, bukan
dijalankan manual setelah deploy gagal.

### Halaman autentikasi

`/login` dan `/register` sengaja tidak punya canonical: keduanya
`robots: { index: false, follow: true }`, jadi canonical tidak relevan.
Konsisten dengan aturan "jangan canonical-kan halaman noindex".

Catatan: keduanya punya query `?next=...` untuk menyimpan tujuan redirect.
Itu tidak masuk sitemap (`absoluteUrl()` drop query), dan robots tidak
memblokirnya — aman, karena halamannya noindex.

### OG image

Belum ada `openGraph.images`. Saat ini card social pakai logo SVG saja.
Tambahkan PNG 1200×630 untuk preview yang baik saat link di-share — bisa
di-generate statik atau dari banner game.

### Title halaman operator

`Top Up Telkomsel` belum menyebutkan "pulsa" secara eksplisit. Google
kemungkinan akan tetap memahaminya dari konten, tapi
`Top Up Pulsa Telkomsel` lebih dekat dengan search intent. Trade-off-nya:
title jadi lebih panjang.

## Testing

```bash
npx vitest run              # 278 test (termasuk 17 untuk seo-meta)
npx eslint src/             # 4 error PRE-EXISTING (react-hooks/purity
                            #   Date.now() di render), 0 dari perubahan SEO
NODE_ENV=production npx next build
```

4 error `react-hooks/purity` itu `Date.now()` di body komponen React
(`PromoStrip.jsx:30`, `MyVouchers.jsx:172`,
`member/orders/[id]/page.jsx:212`). Sudah ada sebelum pekerjaan SEO ini,
diverifikasi via `git stash`. Bisa mengakibatkan hydration mismatch; pindahkan
ke `useEffect`/`useMemo` kalau dikerjakan.
