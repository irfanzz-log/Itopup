// ============================================================================
// /dev/security — dokumentasi enkripsi data vital.
//
// Halaman ini menjelaskan BAGAIMANA data sensitif dilindungi, bukan
// menampilkannya. Tidak ada satu pun field di bawah yang memuat nilai rahasia;
// setiap baris adalah nama field, algoritma, dan lokasi kode. Itu yang membuat
// halaman ini aman dibuka oleh operator tanpa menjadi sumber bocoran.
// ============================================================================
import { envReport } from "@/lib/env.server.js";
import { PageHeader, Section, FieldList } from "@/components/dev/DevUI";
import { Badge, Alert } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export const metadata = { title: "Enkripsi Data Vital" };

const CIPHER = [
  {
    label: "Password akun member",
    algo: "Argon2id (hash, satu arah)",
    stored: "users.passwordHash",
    code: "src/services/auth.service.js",
    note: "Tidak pernah didekripsi. Verifikasi membandingkan hash, dan kolom ini tidak pernah dibaca oleh query lain.",
  },
  {
    label: "Session token",
    algo: "SHA-256 (hash, satu arah)",
    stored: "sessions.tokenHash",
    code: "src/services/auth.service.js",
    note: "Token acak di-hash sebelum disimpan. Yang tersimpan tidak bisa dipakai untuk login.",
  },
  {
    label: "Password / rahasia game member",
    algo: "AES-256-GCM (enkripsi, dua arah)",
    stored: "game_credentials.secretCipher + secretIv",
    code: "src/lib/crypto.js",
    note: "Satu-satunya data yang benar-benar terenkripsi. Didekripsi hanya untuk pemanggilan provider, di dalam memori.",
  },
  {
    label: "Signature webhook Midtrans & Melostore",
    algo: "HMAC-SHA256",
    stored: "tidak disimpan (diverifikasi per request)",
    code: "src/providers/melostore/signature.js · src/providers/payment/midtrans",
    note: "Dihitung ulang dari raw body setiap callback, lalu dibandingkan. Signature tidak disimpan.",
  },
  {
    label: "Idempotency key checkout",
    algo: "SHA-256 (hash)",
    stored: "payments.requestHash",
    code: "src/services/order.service.js",
    note: "Mencegah double-charge. Bukan rahasia, hanya harus unik per percobaan checkout.",
  },
];

const PROTECTED_FIELDS = [
  { label: "TransactionLog.metadata", value: "Tidak pernah berisi secret/token/data kartu (kontrak di schema.prisma)" },
  { label: "AuditLog.diff", value: "Hanya field non-sensitif. Password hash tidak pernah masuk." },
  { label: "WebhookEvent.payloadHash", value: "Hash dari body, bukan body itu sendiri" },
  { label: "Provider API key", value: "Hanya di env (MELOSTORE_API_KEY / MIDTRANS_*), tidak pernah di DB atau response" },
];

export default async function DevSecurityPage() {
  const env = envReport();
  const authSecret = env.find((row) => row.name === "AUTH_SECRET");

  return (
    <>
      <PageHeader
        title="Enkripsi Data Vital"
        description="Apa yang dienkripsi, dengan algoritma apa, dan di mana kodenya. Halaman ini tidak menampilkan nilai rahasia apa pun."
      />

      <div className="space-y-6">
        <Section
          title="Ringkasan"
          description="Dua kategori data sensitif: kredensial yang harus bisa diverifikasi (hash satu arah) dan kredensial yang harus bisa dikirim ke provider (enkripsi dua arah)."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="card p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
                Hash satu arah
              </p>
              <p className="mt-2 text-sm text-foreground">
                Password member dan session token di-hash dengan Argon2id / SHA-256. Tidak ada cara
                untuk mendapatkan plaintext-nya kembali, bahkan dengan akses DB penuh.
              </p>
            </div>
            <div className="card p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
                Enkripsi dua arah
              </p>
              <p className="mt-2 text-sm text-foreground">
                Password game member (untuk game dengan <code className="text-xs">needsGameLogin</code>)
                dienkripsi AES-256-GCM. Plaintext hanya ada di memori, untuk satu pemanggilan provider.
              </p>
            </div>
          </div>
        </Section>

        <Section
          title="Kunci Enkripsi"
          description="Kunci AES-256 diturunkan dari AUTH_SECRET lewat HKDF. Karena itu AUTH_SECRET adalah satu-satunya rahasia yang harus dijaga."
        >
          <Alert tone={authSecret?.configured ? "success" : "error"} title="AUTH_SECRET">
            {authSecret?.configured
              ? "Ter konfigurasi. Rotasi AUTH_SECRET akan membuat semua kredensial game tidak bisa didekripsi dan harus dimasukkan ulang oleh member, yang memang efek yang diinginkan."
              : "BELUM dikonfigurasi. Kredensial game tidak bisa dienkripsi sampai diisi (minimal 32 karakter)."}
          </Alert>
          <FieldList
            items={[
              { label: "Algoritma", value: "AES-256-GCM" },
              { label: "Panjang IV", value: "12 byte, acak per enkripsi" },
              { label: "Kunci", value: "HKDF(AUTH_SECRET, info=itopup:game-credential:v1)" },
              { label: "Rotasi", value: "Ganti AUTH_SECRET, semua ciphertext lama gagal didekripsi" },
              { label: "Lokasi", value: "src/lib/crypto.js (satu-satunya tempat encrypt/decrypt)" },
            ]}
          />
        </Section>

        <Section
          title="Field Terenkripsi / Terhash"
          description="Lokasi penyimpanan setiap data vital dan algoritma yang dipakai."
        >
          <div className="card overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-surface-muted text-xs uppercase tracking-wide text-foreground-subtle">
                <tr>
                  <th className="px-4 py-3 font-semibold">Data</th>
                  <th className="px-4 py-3 font-semibold">Algoritma</th>
                  <th className="px-4 py-3 font-semibold">Disimpan di</th>
                  <th className="px-4 py-3 font-semibold">Kode</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {CIPHER.map((row) => (
                  <tr key={row.label} className="align-top">
                    <td className="px-4 py-3 font-medium text-foreground">
                      {row.label}
                      <p className="mt-1 text-xs font-normal text-foreground-subtle">{row.note}</p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={row.algo.includes("AES") ? "warning" : "neutral"}>{row.algo}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <code className="text-xs text-foreground">{row.stored}</code>
                    </td>
                    <td className="px-4 py-3">
                      <code className="text-xs text-foreground-subtle">{row.code}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section
          title="Field yang Sengaja Tidak Menyimpan Secret"
          description="Lapisan kedua: tabel-tabel yang isinya dilarang menyimpan rahasia, dengan alasannya."
        >
          <FieldList items={PROTECTED_FIELDS} cols={2} />
        </Section>

        <Section
          title="Aturan yang Tidak Boleh Dilanggar"
          description="Kontrak keamanan yang berlaku untuk setiap perubahan kode di masa depan."
        >
          <div className="space-y-3">
            {[
              "Plaintext kredensial game hanya boleh ada di memori, untuk satu pemanggilan provider. Tidak pernah ditulis ke DB, log, TransactionLog.metadata, atau response API.",
              "src/lib/crypto.js adalah satu-satunya tempat encrypt/decrypt kredensial. Jangan implementasi ulang di tempat lain.",
              "import \"server-only\" di crypto.js mencegahnya masuk ke client bundle. Jangan pernah menghapus import itu.",
              "GCM dengan IV yang dipakai ulang di bawah satu kunci membocorkan plaintext kedua pesan. IV harus selalu acak.",
              "AuditLog hanya boleh menyimpan diff field non-sensitif. Password hash tidak boleh masuk.",
              "Halaman /dev (termasuk halaman ini) tidak pernah mencetak nilai secret, hanya nama variabel dan status configured.",
            ].map((rule, i) => (
              <div key={i} className="flex gap-3 card p-3">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded bg-brand-600 text-[10px] font-bold text-white">
                  {i + 1}
                </span>
                <p className="text-sm text-foreground">{rule}</p>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </>
  );
}
