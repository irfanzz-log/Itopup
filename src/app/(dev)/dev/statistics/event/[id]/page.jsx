// ============================================================================
// /dev/statistics/event/[id] — full detail of one activity row.
//
// WHY A DETAIL PAGE AND NOT AN EXPANDING ROW
// The table has to stay scannable, and the detail here is a JSON object plus a
// user agent string: putting that inside a table cell makes every row tall and
// the list unreadable. A separate URL also means an operator can paste it into a
// support thread and the recipient sees exactly the same evidence.
//
// WHAT IS SHOWN IN FULL: the stored metadata, the verdict with the rule that
// produced it, and the correlation ids. What is NOT here: the request body. It
// was never stored — the schema forbids it — and this page cannot leak what does
// not exist.
// ============================================================================
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTrafficEvent } from "@/services/traffic.service.js";
import { PageHeader, Section, FieldList } from "@/components/dev/DevUI";
import VerdictBadge from "@/components/dev/VerdictBadge";
import { Badge } from "@/components/ui/primitives";
import { formatDateTime, formatRelative, formatDuration } from "@/lib/format";
import { KIND_LABEL, VERDICT, VERDICT_LABEL, SEVERITY } from "@/lib/traffic/classify.js";

export const dynamic = "force-dynamic";

export const metadata = { title: "Detail log" };

/** Human explanation of each rule, so the detail page teaches instead of judging. */
const RULE_EXPLANATION = {
  HOSTILE_USER_AGENT: "User agent cocok dengan alat serangan yang dikenal (sqlmap, nikto, wpscan, dan sejenisnya).",
  INJECTION_ATTEMPT: "URL memuat pola injeksi: path traversal, tag skrip, UNION SELECT, atau Log4Shell.",
  WEBHOOK_FORGERY: "Callback mengaku dari provider tetapi signature-nya tidak valid. Bisa serangan, bisa juga secret yang salah di sisi provider.",
  AUTH_BRUTE_FORCE: "Jumlah kegagalan login dari IP ini melewati ambang batas dalam jendela waktu yang dipantau.",
  REQUEST_FLOOD: "Jumlah permintaan dari IP ini melewati ambang batas dalam jendela waktu yang dipantau.",
  SCAN_PROBE: "Permintaan ke path yang tidak dimiliki aplikasi ini: scanner sedang menebak isi server.",
  AUTH_FAILURES: "Beberapa kegagalan login dari IP yang sama. Belum brute force, tapi perlu dilihat.",
  NOT_FOUND_ENUMERATION: "Banyak respons 404 dari IP ini: pola enumerasi path.",
  STAFF_API_UNAUTHENTICATED: "API staf dipanggil tanpa sesi. Bisa cookie kedaluwarsa, bisa juga percobaan masuk.",
  CRAWLER_ON_API: "Klien otomatis memanggil endpoint API, bukan halaman.",
  NO_USER_AGENT: "Permintaan tanpa User-Agent sama sekali, yang normal untuk skrip mentah.",
};

export default async function TrafficEventPage({ params }) {
  const { id } = await params;
  const event = await getTrafficEvent(id);
  if (!event) notFound();

  return (
    <>
      <PageHeader
        title="Detail log"
        description={`Satu event tercatat ${formatRelative(event.createdAt)}. Penilaian disimpan saat event ditulis, bukan dihitung ulang di sini.`}
      >
        <Link href="/dev/statistics?tab=activity" className="btn-secondary btn-sm">
          Kembali ke log
        </Link>
      </PageHeader>

      <Section
        title="Penilaian"
        description="Normal berarti wajar. Mencurigakan berarti perlu dilihat. Berbahaya berarti bentuk serangan."
        className="mb-6"
      >
        <div className="flex flex-wrap items-center gap-3">
          <VerdictBadge verdict={event.verdict} />
          <Badge tone={event.severity === SEVERITY.FATAL ? "danger" : event.severity === SEVERITY.ERROR ? "warning" : "neutral"}>
            {event.severity}
          </Badge>
          <span className="text-sm text-foreground-muted">{KIND_LABEL[event.kind] ?? event.kind}</span>
        </div>

        {event.verdict === VERDICT.NORMAL ? (
          <p className="mt-3 text-sm text-foreground-muted">
            Tidak ada aturan yang terpicu. Ini termasuk 4xx biasa seperti sesi kedaluwarsa atau validasi
            form: kesalahan pengguna bukan serangan.
          </p>
        ) : (
          <div className="mt-3 rounded-lg border border-border bg-surface-muted p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">Alasan</p>
            <p className="mt-1 text-sm text-foreground">{event.verdictReason ?? "—"}</p>
            {event.verdictRule ? (
              <>
                <p className="mt-2 font-mono text-[11px] text-foreground-subtle">aturan: {event.verdictRule}</p>
                <p className="mt-1 text-xs text-foreground-muted">
                  {RULE_EXPLANATION[event.verdictRule] ?? "Aturan ini tidak punya penjelasan tertulis; lihat kode di src/lib/traffic/classify.js."}
                </p>
              </>
            ) : null}
          </div>
        )}

        {event.verdict !== VERDICT.NORMAL ? (
          <p className="mt-3 text-xs text-foreground-subtle">
            Untuk menyelidiki lebih lanjut, buka log aktivitas dengan filter IP yang sama:{" "}
            {event.ip ? (
              <Link
                href={`/dev/statistics?tab=activity&ip=${encodeURIComponent(event.ip)}`}
                className="font-semibold text-brand-600 hover:underline dark:text-brand-400"
              >
                semua event dari {event.ip}
              </Link>
            ) : (
              "IP tidak tercatat untuk event ini."
            )}
          </p>
        ) : null}
      </Section>

      <div className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Section title="Permintaan" description="Path disimpan tanpa query string, jadi token atau email di URL tidak ikut tersimpan.">
          <FieldList
            items={[
              { label: "Waktu", value: `${formatDateTime(event.createdAt)} (${formatRelative(event.createdAt)})` },
              { label: "Metode", value: event.method ?? "—" },
              { label: "Path", value: <code className="break-all font-mono text-xs">{event.path}</code> },
              { label: "Status HTTP", value: event.status ?? "— (event sisi klien)" },
              { label: "Kode internal", value: event.code ? <code className="font-mono text-xs">{event.code}</code> : "—" },
              { label: "Durasi", value: event.durationMs !== null ? formatDuration(event.durationMs) : "—" },
            ]}
          />
        </Section>

        <Section title="Asal" description="Disimpan untuk forensik keamanan. Tidak pernah ditampilkan di area member.">
          <FieldList
            items={[
              { label: "IP", value: event.ip ? <code className="font-mono text-xs">{event.ip}</code> : "—" },
              { label: "Referrer", value: event.referrer ?? "—" },
              { label: "User ID", value: event.userId ? <code className="font-mono text-xs">{event.userId}</code> : "anonim" },
              { label: "Request ID", value: event.requestId ? <code className="font-mono text-xs">{event.requestId}</code> : "—" },
            ]}
          />
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">User agent</p>
            <p className="mt-1 break-all rounded-md bg-surface-muted px-2.5 py-2 font-mono text-[11px] text-foreground-muted">
              {event.userAgent ?? "— (tidak dikirim)"}
            </p>
          </div>
        </Section>
      </div>

      <Section title="Pesan" description="Ringkasan satu baris. Tidak pernah berisi stack trace atau isi payload." className="mb-6">
        <p className="text-sm text-foreground">{event.message ?? "—"}</p>
      </Section>

      <Section title="Metadata" description="Hanya field non-sensitif. Penulis log memfilter kunci rahasia sebelum menyimpan.">
        {event.metadata ? (
          <pre className="overflow-x-auto rounded-lg bg-surface-muted p-3 font-mono text-[11px] leading-relaxed text-foreground">
            {JSON.stringify(event.metadata, null, 2)}
          </pre>
        ) : (
          <p className="text-sm text-foreground-muted">Tidak ada metadata untuk event ini.</p>
        )}
      </Section>
    </>
  );
}
