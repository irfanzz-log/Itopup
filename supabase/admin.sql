-- ============================================================================
-- Akun operator untuk Supabase.
--
-- JALANKAN DI: Supabase → SQL Editor → New query → tempel seluruh isi file → Run
-- PRASYARAT  : supabase/setup.sql sudah dijalankan (tabel `users` harus ada).
--
-- KENAPA FILE INI ADA
--
-- `seed.sql` sengaja TIDAK memuat baris `users`: file itu dibagikan dan
-- di-commit, dan hash password operator tidak boleh ikut ke dalamnya. Akibatnya
-- database Supabase yang baru di-setup tidak punya akun operator sama sekali —
-- halaman /login tidak bisa dilewati dan panel /dev/* tidak bisa dibuka.
-- File ini menutup celah itu secara terpisah.
--
-- CARA KERJA
--
-- `crypt(<password>, gen_salt('bf', 12))` dari pgcrypto menghasilkan hash
-- bcrypt dengan format `$2a$12$...`, yaitu format yang persis dibaca
-- `bcryptjs.compare()` di src/lib/auth/password.js. Tidak ada pepper dan tidak
-- ada HMAC tambahan pada password (sudah diperiksa di kode), jadi hash yang
-- dibuat Postgres bisa diverifikasi aplikasi tanpa perubahan apa pun.
--
-- ⚠️  GANTI PASSWORD DI BAWAH SEBELUM MENJALANKAN.
--     Password di file ini terlihat oleh siapa pun yang membaca file. Setelah
--     login pertama, segera ganti lewat halaman profil, dan jangan commit
--     password asli ke git.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Di Supabase, pgcrypto dipasang di schema `extensions`, bukan `public`. Kalau
-- search_path tidak menyertakannya, `crypt()` dan `gen_salt()` gagal resolve
-- dengan "function does not exist" — padahal ekstensinya ada. Baris ini membuat
-- skrip bekerja baik di Supabase maupun di Postgres lokal (di mana pgcrypto
-- biasanya ada di `public`).
SET search_path = public, extensions;

INSERT INTO public.users (
  id,
  name,
  email,
  "passwordHash",
  role,
  status,
  "sessionVersion",
  "createdAt",
  "updatedAt"
)
VALUES (
  -- Kolom `id` bertipe TEXT TANPA DEFAULT (Prisma yang men-generate UUID di sisi
  -- client), jadi di SQL mentah nilainya wajib diisi sendiri.
  gen_random_uuid()::text,
  'ITOPUP Admin',
  'admin@itopup.local',
  crypt('GANTI-PASSWORD-INI', gen_salt('bf', 12)),
  -- DEV atau SUPERADMIN — keduanya boleh membuka /dev/*.
  -- SUPERADMIN dipakai di sini supaya akun ini juga bisa mengelola operator lain.
  'SUPERADMIN',
  -- WAJIB 'ACTIVE'. loginUser() menolak akun 'BLOCKED' setelah password benar,
  -- dengan pesan ITP_ACCOUNT_BLOCKED — bukan pesan password salah.
  'ACTIVE',
  0,
  now(),
  now()
)
ON CONFLICT (email) DO UPDATE
  SET "passwordHash"   = EXCLUDED."passwordHash",
      role             = EXCLUDED.role,
      status           = EXCLUDED.status,
      -- Menaikkan versi sesi memaksa semua sesi lama keluar. Ini yang benar
      -- setelah reset password: kalau password bocor dan diganti, sesi penyerang
      -- harus ikut mati, bukan tetap hidup.
      "sessionVersion" = public.users."sessionVersion" + 1,
      "updatedAt"      = now();

-- Verifikasi: baris ini harus mengembalikan tepat 1 baris dengan role
-- SUPERADMIN dan status ACTIVE.
SELECT email, role, status, "sessionVersion", "createdAt"
FROM public.users
WHERE email = 'admin@itopup.local';
