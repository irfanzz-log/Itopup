# Deployment & Rollback

Operasional untuk ITOPUP. Dokumen ini menjelaskan cara merilis, cara memverifikasi
setelah rilis, dan cara kembali. Angka dan nama variabel di sini nyata; nilainya
tidak pernah ditulis di dokumen ini.

---

## 0. Fakta yang menentukan prosedur ini

Empat sifat aplikasi ini yang membentuk seluruh isi dokumen:

1. **State hidup di Postgres (Supabase), bukan di proses.** Instance bisa dibuang
   kapan saja tanpa kehilangan data. Yang tidak bisa dibatalkan semudah itu adalah
   **migrasi**.
2. **Migrasi dan aplikasi dirilis terpisah.** Migrasi bersifat *forward-only* dan
   harus kompatibel dengan versi aplikasi **sebelum** dan **sesudah** deploy
   (expand → migrate → contract). Rollback aplikasi tidak boleh memerlukan
   rollback migrasi.
3. **Tidak ada health check sebelum perubahan ini.** Sekarang ada:
   `GET /api/health`. Itu satu-satunya sinyal yang boleh dipakai otomatis.
4. **Webhook adalah jalur uang.** Midtrans dan Melostore memanggil masuk. Selama
   deploy, callback bisa datang ke instance lama atau baru — keduanya harus
   memprosesnya dengan benar.

---

## 1. Sebelum deploy (gate)

Semua harus lulus. Jangan melompati salah satu.

```bash
npm ci                                  # reproducible, dari lockfile
npm run lint                            # 0 error
npx vitest run                          # unit + integration
E2E_PORT=3200 npx playwright test       # alur kritis di browser
npm audit --omit=dev                    # 0 high pada dependency RUNTIME
env -u NODE_ENV npm run build           # build produksi
```

Catatan penting:

- `npx tsc --noEmit` **tidak membuktikan apa pun di repo ini** — tidak ada file
  `.ts/.tsx`, dan `tsconfig.include` hanya menyertakan `*.ts/*.tsx`. Jangan
  memasukkannya ke gate sebagai bukti type safety.
- `npm audit` tanpa `--omit=dev` masih melaporkan temuan pada rantai
  `eslint-config-next → fast-glob → micromatch → braces`. Itu devDependency dan
  `braces@3.0.3` adalah rilis terakhir yang ada; tidak masuk bundle runtime.
  Yang wajib nol adalah `--omit=dev`.
- Build **wajib** dijalankan dengan `NODE_ENV` bersih. Kalau shell sudah
  mengekspor `NODE_ENV=development` (mis. setelah `set -a; . ./.env.dev`), build
  gagal dengan error menyesatkan di `/_global-error`.

## 2. Verifikasi migrasi (sebelum menyentuh database mana pun)

```bash
# Apa yang AKAN dijalankan? (tidak mengubah apa pun)
npx prisma migrate status

# Apakah skema DB sudah sama dengan schema.prisma? (0 = selaras)
npx prisma migrate diff --from-config-datasource \
  --to-schema prisma/schema.prisma --exit-code
```

Untuk setiap migrasi baru, buktikan **aditif** sebelum deploy:

```bash
grep -inE "\b(drop|truncate|delete from)\b" prisma/migrations/<baru>/migration.sql
```

Setiap hasil yang bukan komentar adalah operasi destruktif. Dua migrasi di repo
ini memang mengandung `DELETE`/`DROP`:

| Migrasi | Operasi | Kenapa ada | Aman karena |
|---|---|---|---|
| `20261002060000_order_credential_relation` | `DELETE FROM "orders"` | membersihkan `credentialId` yatim sebelum FK dipasang | hanya menghapus baris yang FK-nya **tidak akan pernah valid** |
| `20260930000000_voucher_claim_uniq` | `DELETE FROM voucher_claims` | dedupe sebelum unique index | menghapus duplikat, bukan data unik |
| `20260925081131_app_setting_table_name` | `DROP TABLE "AppSetting"` | tabel diganti nama | sudah diterapkan; hanya relevan untuk DB kosong |

Ketiganya **sudah diterapkan** di dev dan di test. Untuk DB baru, urutannya aman.

## 3. Urutan deploy

```bash
# 1. Migrasi DULU, dengan koneksi DIRECT (port 5432), bukan pooler.
#    DDL lewat transaction pooler gagal.
DIRECT_URL="$DIRECT_URL" DATABASE_URL="$DIRECT_URL" npx prisma migrate deploy

# 2. Baru aplikasi.
#    Vercel: git push ke branch produksi (platform build & promote).
#    Self-host: build, lalu tukar symlink `current` -> rilis baru, restart PM2.
```

Mengapa migrasi lebih dulu: skema harus sudah menerima bentuk data yang ditulis
kode **baru**, dan masih menerima yang ditulis kode **lama**. Itu sebabnya
migrasi wajib aditif — supaya urutan ini bisa dibalik saat rollback.

## 4. Verifikasi setelah deploy (wajib, berurutan)

```bash
# a. Health: 200 dan database.ok=true
curl -s https://<host>/api/health | jq '.status, .checks'

# b. Detail konfigurasi (butuh INTERNAL_KEY)
curl -s -H "x-internal-key: $INTERNAL_KEY" https://<host>/api/health | jq '.integrations'

# c. Halaman publik merender (bukan 500)
for p in / /topup /promo /login; do
  printf "%s -> " "$p"; curl -s -o /dev/null -w "%{http_code}\n" "https://<host>$p"
done

# d. Guard masih menolak
curl -s -o /dev/null -w "member tanpa sesi: %{http_code}\n" https://<host>/member   # 307
curl -s -o /dev/null -w "cron tanpa key:    %{http_code}\n" -X POST https://<host>/api/internal/expire  # 401

# e. Cron benar-benar jalan (ini yang paling mudah terlupakan)
curl -s -X POST -H "x-internal-key: $INTERNAL_KEY" https://<host>/api/internal/reconcile | jq
```

`/api/health` mengembalikan **503** ketika database tidak terjangkau atau
`DATABASE_URL`/`AUTH_SECRET` hilang. Itu harus diperlakukan sebagai gagal
deploy, bukan sebagai peringatan.

## 5. Rollback

### 5a. Rollback aplikasi (kasus umum — bug di kode)

Tidak menyentuh database. Aman selama migrasi bersifat aditif.

**Vercel:** Deployments → pilih deployment terakhir yang sehat → **Promote to
Production**. Instan, tanpa build.

**Self-host:**

```bash
ls -l /srv/itopup/releases            # rilis sebelumnya ada di sini
ln -sfn /srv/itopup/releases/<sebelumnya> /srv/itopup/current
pm2 restart itopup --update-env
curl -s https://<host>/api/health     # harus 200
```

**Kapan rollback aplikasi TIDAK menyelesaikan masalah:** kalau penyebabnya
migrasi. Rollback kode tidak mengembalikan skema, dan kode lama yang membaca
skema baru bisa salah. Lihat 5b.

### 5b. Rollback migrasi (kasus jarang — migrasi itu sendiri salah)

Ini **tidak** otomatis. Prisma tidak punya `migrate down`.

1. **Hentikan trafik tulis** (maintenance mode) — jangan biarkan dua versi kode
   menulis bersamaan ke skema yang sedang diubah.
2. **Backup dulu**, dan buktikan bisa direstore (lihat §6).
3. Tulis migrasi **baru** yang membalikkan perubahan (`<timestamp>_revert_<nama>`),
   lalu `migrate deploy`. Jangan mengedit atau menghapus migrasi yang sudah
   diterapkan — riwayat migrasi adalah catatan, bukan draf.
4. Deploy ulang aplikasi versi sebelumnya.
5. Verifikasi dengan §4.

### 5c. Rollback data

Kalau ada data yang rusak/hilang: **restore dari backup**, bukan menambal manual.
Menambal manual di produksi membuat keadaan yang tidak bisa direproduksi di
staging, dan tidak ada yang bisa membuktikan hasilnya benar.

## 6. Backup & restore

Backup yang belum pernah direstore **bukan backup**, itu asumsi. Prosedur minimum:

```bash
# Ambil (pakai DIRECT_URL, bukan pooler)
pg_dump "$DIRECT_URL" --format=custom --no-owner --file=itopup-$(date +%F).dump

# Buktikan bisa dipulihkan — ke database TERPISAH, jangan pernah ke produksi
createdb itopup_restore_check
pg_restore --dbname=itopup_restore_check --no-owner itopup-YYYY-MM-DD.dump
psql itopup_restore_check -c "select count(*) from orders; select count(*) from users;"
dropdb itopup_restore_check
```

Simpan hasil hitungan baris dari restore itu. Angka itulah yang dipakai saat
insiden: "backup ini berisi N order" adalah fakta yang bisa diperiksa, "backup
aman" bukan.

Untuk Supabase: aktifkan Point-in-Time Recovery pada paket yang mendukungnya, dan
tetap lakukan satu uji restore manual per kuartal.

## 7. Insiden: urutan yang dipakai

1. **Cek `/api/health`.** `503` + `database.ok=false` → masalah DB. `200` tapi
   pengguna melaporkan gagal → masalah aplikasi/logic, bukan konektivitas.
2. **Baca log.** Semua log satu baris JSON dengan `requestId`. Minta `requestId`
   dari pengguna (ditampilkan di setiap error) lalu grep.
3. **Tentukan: rollback atau perbaiki maju.** Kalau bug jelas dan perbaikannya
   kecil → perbaiki maju. Kalau tidak jelas atau menyentuh uang → rollback dulu,
   diagnosa setelah layanan pulih.
4. **Webhook saat insiden.** Jangan matikan endpoint webhook. Kalau pemrosesan
   gagal, provider akan retry, dan `/api/internal/reconcile` menyelesaikan order
   yang tertinggal. Mematikan webhook berarti kehilangan retry.
5. **Setelah pulih:** catat order yang terdampak, jalankan
   `POST /api/internal/reconcile`, lalu cocokkan dengan mutasi Midtrans.

## 8. Yang belum ada (jangan diasumsikan ada)

- **Belum ada staging terpisah.** Migrasi sejauh ini diverifikasi pada Postgres
  lokal kosong dan pada DB dev. Verifikasi di staging yang menyerupai produksi
  masih hutang.
- **Belum ada load test.** Tidak ada angka throughput/latency untuk dijadikan
  baseline, jadi tidak ada ambang untuk alarm performa.
- **Belum ada monitoring/alerting eksternal.** `/api/health` sudah tersedia untuk
  dipasang, tapi belum ada yang memanggilnya secara berkala.
- **Rate limiter in-memory** kecuali `RATE_LIMIT_URL` + `RATE_LIMIT_TOKEN` diisi.
  Dengan lebih dari satu instance tanpa itu, batas per-IP menjadi per-instance.
