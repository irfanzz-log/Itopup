// ============================================================================
// /dev/statistics — total pengunjung, log aktivitas, verdict keamanan, log fatal.
//
// TABS, NOT ONE LONG PAGE. Four different questions, answered by one route:
//
//   ?tab=overview  (default) total pengunjung + sparkline + apa yang diakses
//   ?tab=activity             log aktivitas, dengan filter dan verdict
//   ?tab=fatal                log fatal, kronologis terbaru dulu
//
// The tab lives in the query string so a link is a working instruction
// ("/dev/statistics?tab=fatal" in a support thread), same convention as
// /dev/orders. Everything is server-rendered; the only client code is the
// verdict badge hover, which is CSS.
//
// WHAT "TOTAL PENGUNJUNG" MEANS HERE, STATED ON THE PAGE:
// every number on this page comes from OUR OWN engine (traffic_events). Vercel
// Web Analytics is a separate product with its own dashboard: it keeps
// collecting in the background, and this page never reads or shows its figures.
// That separation is deliberate — mixing a cookieless third-party visitor count
// with our per-event trail would put two incompatible definitions of "visitor"
// side by side, and neither number would be trustworthy afterwards.
// ============================================================================
import Link from "next/link";
import {
  statisticsSnapshot,
  listTraffic,
  listFatal,
  getTrafficEvent,
  resolveRange,
  RANGES,
  DEFAULT_RANGE,
} from "@/services/traffic.service.js";
import { PageHeader, Section, StatCard, StatGrid, DataTable, Td, FieldList, Count } from "@/components/dev/DevUI";
import { Badge, Alert, EmptyState } from "@/components/ui/primitives";
import Pagination, { ResultCount } from "@/components/ui/Pagination";
import VerdictBadge from "@/components/dev/VerdictBadge";
import Sparkline from "@/components/dev/Sparkline";
import TerminalLog from "@/components/dev/TerminalLog";
import { formatDateTime, formatRelative, formatNumber, formatDuration } from "@/lib/format";
import { VERDICT, VERDICT_LABEL, KIND, KIND_LABEL, SEVERITY } from "@/lib/traffic/classify.js";

export const dynamic = "force-dynamic";

export const metadata = { title: "Statistik" };

const TABS = [
  { key: "overview", label: "Ringkasan" },
  { key: "activity", label: "Log aktivitas" },
  { key: "terminal", label: "Log terminal" },
  { key: "fatal", label: "Log fatal" },
];

/** Range chips, in the order an operator thinks: now, today, this week. */
function rangeChips(tab, current, extra = {}) {
  return Object.entries(RANGES).map(([key, preset]) => {
    const query = new URLSearchParams({ tab, range: key, ...extra });
    return { key, label: preset.label, href: `/dev/statistics?${query.toString()}`, active: key === current };
  });
}

export default async function DevStatisticsPage({ searchParams }) {
  const params = await searchParams;

  const tab = TABS.some((t) => t.key === params?.tab) ? params.tab : "overview";
  const rangeKey = RANGES[params?.range] ? params.range : DEFAULT_RANGE;

  return (
    <>
      <PageHeader
        title="Statistik"
        description="Total pengunjung, log aktivitas dengan penilaian normal atau mencurigakan, dan log fatal. Semua angka diambil langsung dari sumbernya, tanpa cache halaman."
      />

      <nav aria-label="Bagian statistik" className="mb-5 flex flex-wrap gap-2">
        {TABS.map((item) => (
          <Link
            key={item.key}
            href={`/dev/statistics?tab=${item.key}${item.key === "fatal" ? "" : `&range=${rangeKey}`}`}
            aria-current={tab === item.key ? "page" : undefined}
            className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              tab === item.key
                ? "border-brand-500 bg-brand-soft text-brand-700 dark:text-brand-100"
                : "border-border text-foreground-muted hover:border-brand-300 hover:text-foreground"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {tab === "overview" ? <Overview rangeKey={rangeKey} /> : null}
      {tab === "activity" ? <Activity params={params} rangeKey={rangeKey} /> : null}
      {tab === "terminal" ? <Terminal params={params} rangeKey={rangeKey} /> : null}
      {tab === "fatal" ? <FatalLog params={params} /> : null}
    </>
  );
}

// ── Overview ────────────────────────────────────────────────────────────────

async function Overview({ rangeKey }) {
  const snapshot = await statisticsSnapshot({ rangeKey });
  const { trail, range, bucket } = snapshot;
  const { totals } = trail;

  // Every number on this page comes from our own engine. Vercel Web Analytics
  // is a separate product with a separate dashboard; showing its figures here
  // would put two incompatible definitions of "visitor" side by side.
  const flagged = totals.verdicts.SUSPICIOUS + totals.verdicts.HOSTILE;

  // How much of the visitor count rests on a real cookie identity vs an IP
  // fallback. Surfaced rather than hidden: a number you cannot qualify is a
  // number you cannot trust.
  const cookieBacked = totals.visitors > 0 ? Math.round((totals.visitorsFromCookie / totals.visitors) * 100) : 0;

  return (
    <>
      {/* ── Range ─────────────────────────────────────────────────────────── */}
      <nav aria-label="Rentang waktu" className="mb-5 flex flex-wrap gap-2">
        {rangeChips("overview", rangeKey).map((chip) => (
          <Link
            key={chip.key}
            href={chip.href}
            aria-current={chip.active ? "true" : undefined}
            className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              chip.active
                ? "border-brand-500 bg-brand-soft text-brand-700 dark:text-brand-100"
                : "border-border text-foreground-muted hover:border-brand-300 hover:text-foreground"
            }`}
          >
            {chip.label}
          </Link>
        ))}
      </nav>

      {/* ── Headline ──────────────────────────────────────────────────────── */}
      <Section
        title="Pengunjung"
        description={`Rentang ${range.label}. Dihitung oleh engine sendiri dari log aplikasi: satu pengunjung = satu identitas, bukan satu permintaan.`}
        className="mb-6"
      >
        <StatGrid cols={4}>
          <StatCard
            label="Pengunjung unik"
            value={formatNumber(totals.visitors)}
            hint={`Identitas cookie ${cookieBacked}% · sisanya perkiraan dari IP`}
            tone="brand"
          />
          <StatCard
            label="Page view"
            value={formatNumber(totals.pageViews)}
            hint="Kunjungan halaman yang terkirim beacon"
          />
          <StatCard
            label="Total event"
            value={formatNumber(totals.events)}
            hint="Semua baris log: kunjungan, API, webhook, fatal"
          />
          <StatCard
            label="Perlu diperiksa"
            value={formatNumber(flagged)}
            hint={`${totals.verdicts.SUSPICIOUS} mencurigakan · ${totals.verdicts.HOSTILE} berbahaya`}
            tone={totals.verdicts.HOSTILE > 0 ? "danger" : flagged > 0 ? "warning" : "success"}
            href="/dev/statistics?tab=activity&verdict=SUSPICIOUS"
          />
        </StatGrid>

        <div className="mt-5">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
            Aktivitas per {bucket === "day" ? "hari" : "jam"} · {range.label}
          </p>
          <Sparkline points={trail.series} unit={bucket} />
          <p className="mt-1.5 text-[11px] text-foreground-subtle">
            Garis biru = event, area terang = page view. Semua angka dari log aplikasi sendiri.
          </p>
        </div>
      </Section>

      {/* ── Verdict breakdown ─────────────────────────────────────────────── */}
      <div className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Section
          title="Penilaian keamanan"
          description="Setiap event dinilai saat ditulis, bukan saat dibaca, sehingga hasilnya tidak berubah kalau aturan diubah nanti."
        >
          <ul className="divide-y divide-border">
            {[VERDICT.NORMAL, VERDICT.SUSPICIOUS, VERDICT.HOSTILE].map((verdict) => (
              <li key={verdict} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <VerdictBadge verdict={verdict} />
                  <p className="mt-1 text-xs text-foreground-subtle">
                    {verdict === VERDICT.NORMAL
                      ? "Permintaan yang wajar, termasuk 4xx biasa seperti sesi kedaluwarsa."
                      : verdict === VERDICT.SUSPICIOUS
                        ? "Perlu dilihat: pemindaian path, kegagalan login berulang, API staf tanpa sesi."
                        : "Bentuk serangan: brute force, signature webhook palsu, injeksi URL, scanner."}
                  </p>
                </div>
                <Link
                  href={`/dev/statistics?tab=activity&range=${rangeKey}&verdict=${verdict}`}
                  className="shrink-0 text-sm font-semibold tabular-nums text-brand-600 hover:underline dark:text-brand-400"
                >
                  {formatNumber(totals.verdicts[verdict] ?? 0)}
                </Link>
              </li>
            ))}
          </ul>
        </Section>

        <Section
          title="Jenis event"
          description="Klasifikasi kasar supaya dashboard bisa mengelompokkan tanpa membaca path satu per satu."
        >
          {Object.keys(totals.kinds).length === 0 ? (
            <p className="text-sm text-foreground-muted">Belum ada event pada rentang ini.</p>
          ) : (
            <ul className="divide-y divide-border">
              {Object.entries(totals.kinds)
                .sort((a, b) => b[1] - a[1])
                .map(([kind, count]) => (
                  <li key={kind} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                    <span className="text-sm text-foreground">{KIND_LABEL[kind] ?? kind}</span>
                    <span className="text-sm font-semibold tabular-nums text-foreground">{formatNumber(count)}</span>
                  </li>
                ))}
            </ul>
          )}
        </Section>
      </div>

      {/* ── What people hit ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Section title="Path paling sering diakses" description="Dari log aplikasi. Query string dibuang sebelum disimpan.">
          {trail.paths.length === 0 ? (
            <p className="text-sm text-foreground-muted">Belum ada data.</p>
          ) : (
            <ul className="divide-y divide-border">
              {trail.paths.map((row) => (
                <li key={row.path} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                  <code className="min-w-0 truncate font-mono text-xs text-foreground">{row.path}</code>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{formatNumber(row.count)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="IP paling aktif" description="Dengan penilaian terburuk yang pernah tercatat untuk IP tersebut.">
          {trail.ips.length === 0 ? (
            <p className="text-sm text-foreground-muted">Belum ada data.</p>
          ) : (
            <ul className="divide-y divide-border">
              {trail.ips.map((row) => (
                <li key={row.ip} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <code className="font-mono text-xs text-foreground">{row.ip}</code>
                    <span className="ml-2 text-[11px] text-foreground-subtle">
                      {row.flagged > 0 ? `${row.flagged} ditandai` : "tidak ada yang ditandai"}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <VerdictBadge verdict={row.verdict} />
                    <Link
                      href={`/dev/statistics?tab=activity&range=${rangeKey}&ip=${encodeURIComponent(row.ip)}`}
                      className="text-sm font-semibold tabular-nums text-brand-600 hover:underline dark:text-brand-400"
                    >
                      {formatNumber(row.count)}
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}

// ── Terminal log ────────────────────────────────────────────────────────────

/**
 * The same rows as the activity tab, printed as a stream.
 *
 * Deliberately shares `listTraffic` with the table view: two read paths would
 * drift, and an operator comparing "the log" against "the table" must see the
 * same events in the same order. The difference is presentation only.
 *
 * The limit is higher here (100 vs 25) because a log view is scrolled, not
 * paginated in the head. Pagination still exists for older pages.
 */
async function Terminal({ params, rangeKey }) {
  const page = Math.max(1, parseInt(params?.page ?? "1", 10) || 1);
  const verdict = [VERDICT.NORMAL, VERDICT.SUSPICIOUS, VERDICT.HOSTILE].includes(params?.verdict) ? params.verdict : null;
  const kind = Object.values(KIND).includes(params?.kind) ? params.kind : null;
  const ip = typeof params?.ip === "string" ? params.ip.slice(0, 64) : null;
  const q = typeof params?.q === "string" ? params.q.slice(0, 100) : "";
  const range = resolveRange(rangeKey);

  const { items, pagination } = await listTraffic({
    page,
    limit: 100,
    verdict,
    kind,
    ip,
    q,
    since: range.since,
    until: range.until,
  });

  const buildHref = (nextPage) => {
    const query = new URLSearchParams({ tab: "terminal", range: rangeKey });
    if (verdict) query.set("verdict", verdict);
    if (kind) query.set("kind", kind);
    if (ip) query.set("ip", ip);
    if (q) query.set("q", q);
    if (nextPage > 1) query.set("page", String(nextPage));
    return `/dev/statistics?${query.toString()}`;
  };

  return (
    <>
      <nav aria-label="Rentang waktu" className="mb-4 flex flex-wrap gap-2">
        {rangeChips("terminal", rangeKey, { ...(verdict ? { verdict } : {}), ...(kind ? { kind } : {}) }).map((chip) => (
          <Link
            key={chip.key}
            href={chip.href}
            aria-current={chip.active ? "true" : undefined}
            className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              chip.active
                ? "border-brand-500 bg-brand-soft text-brand-700 dark:text-brand-100"
                : "border-border text-foreground-muted hover:border-brand-300 hover:text-foreground"
            }`}
          >
            {chip.label}
          </Link>
        ))}
      </nav>

      {/* Same filters as the table, so switching tabs keeps the investigation. */}
      <form method="get" className="card mb-4 flex flex-col gap-3 p-4 sm:flex-wrap sm:flex-row sm:items-end">
        <input type="hidden" name="tab" value="terminal" />
        <input type="hidden" name="range" value={rangeKey} />
        {kind ? <input type="hidden" name="kind" value={kind} /> : null}
        <div className="min-w-0 flex-1 sm:min-w-[14rem]">
          <label htmlFor="q" className="label">Cari</label>
          <input id="q" name="q" type="search" defaultValue={q} placeholder="Pesan, kode error, atau path" className="field" />
        </div>
        <div className="min-w-0 sm:w-44">
          <label htmlFor="verdict" className="label">Penilaian</label>
          <select id="verdict" name="verdict" defaultValue={verdict ?? ""} className="field">
            <option value="">Semua</option>
            {Object.values(VERDICT).map((value) => (
              <option key={value} value={value}>{VERDICT_LABEL[value]}</option>
            ))}
          </select>
        </div>
        <div className="min-w-0 sm:w-44">
          <label htmlFor="ip" className="label">IP</label>
          <input id="ip" name="ip" type="text" defaultValue={ip ?? ""} placeholder="10.0.0.1" className="field" />
        </div>
        <div className="flex flex-wrap gap-2 sm:contents">
          <button type="submit" className="btn-primary">Terapkan</button>
          <Link href={`/dev/statistics?tab=terminal&range=${rangeKey}`} className="btn-ghost">Reset</Link>
        </div>
      </form>

      <Section
        title="Log terminal"
        description="Baris log seperti yang dicetak server: jam (WIB, presisi milidetik), IP, penilaian, metode, path, status, jenis, pesan. Urut terbaru dulu."
      >
        <TerminalLog
          events={items}
          total={pagination.total}
          rangeLabel={range.label}
          emptyNote={
            verdict || kind || q || ip
              ? "Tidak ada log yang cocok dengan filter ini."
              : "Belum ada log pada rentang ini. Log terisi saat ada kunjungan atau panggilan API."
          }
        />

        <Pagination className="mt-5" page={pagination.page} pages={pagination.pages} buildHref={buildHref} />
      </Section>
    </>
  );
}

// ── Activity log ────────────────────────────────────────────────────────────

async function Activity({ params, rangeKey }) {
  const page = Math.max(1, parseInt(params?.page ?? "1", 10) || 1);
  const verdict = [VERDICT.NORMAL, VERDICT.SUSPICIOUS, VERDICT.HOSTILE].includes(params?.verdict) ? params.verdict : null;
  const kind = Object.values(KIND).includes(params?.kind) ? params.kind : null;
  const ip = typeof params?.ip === "string" ? params.ip.slice(0, 64) : null;
  const q = typeof params?.q === "string" ? params.q.slice(0, 100) : "";
  const range = resolveRange(rangeKey);

  const { items, pagination } = await listTraffic({
    page,
    limit: 25,
    verdict,
    kind,
    ip,
    q,
    since: range.since,
    until: range.until,
  });

  const buildHref = (nextPage) => {
    const query = new URLSearchParams({ tab: "activity", range: rangeKey });
    if (verdict) query.set("verdict", verdict);
    if (kind) query.set("kind", kind);
    if (ip) query.set("ip", ip);
    if (q) query.set("q", q);
    if (nextPage > 1) query.set("page", String(nextPage));
    return `/dev/statistics?${query.toString()}`;
  };

  return (
    <>
      <nav aria-label="Rentang waktu" className="mb-4 flex flex-wrap gap-2">
        {rangeChips("activity", rangeKey, { ...(verdict ? { verdict } : {}), ...(kind ? { kind } : {}) }).map((chip) => (
          <Link
            key={chip.key}
            href={chip.href}
            aria-current={chip.active ? "true" : undefined}
            className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              chip.active
                ? "border-brand-500 bg-brand-soft text-brand-700 dark:text-brand-100"
                : "border-border text-foreground-muted hover:border-brand-300 hover:text-foreground"
            }`}
          >
            {chip.label}
          </Link>
        ))}
      </nav>

      {/* ── Filters ───────────────────────────────────────────────────────── */}
      <form method="get" className="card mb-4 flex flex-col gap-3 p-4 sm:flex-wrap sm:flex-row sm:items-end">
        <input type="hidden" name="tab" value="activity" />
        <input type="hidden" name="range" value={rangeKey} />
        {kind ? <input type="hidden" name="kind" value={kind} /> : null}
        <div className="min-w-0 flex-1 sm:min-w-[14rem]">
          <label htmlFor="q" className="label">Cari</label>
          <input id="q" name="q" type="search" defaultValue={q} placeholder="Pesan, kode error, atau path" className="field" />
        </div>
        <div className="min-w-0 sm:w-44">
          <label htmlFor="verdict" className="label">Penilaian</label>
          <select id="verdict" name="verdict" defaultValue={verdict ?? ""} className="field">
            <option value="">Semua</option>
            {Object.values(VERDICT).map((value) => (
              <option key={value} value={value}>{VERDICT_LABEL[value]}</option>
            ))}
          </select>
        </div>
        <div className="min-w-0 sm:w-44">
          <label htmlFor="ip" className="label">IP</label>
          <input id="ip" name="ip" type="text" defaultValue={ip ?? ""} placeholder="10.0.0.1" className="field" />
        </div>
        <div className="flex flex-wrap gap-2 sm:contents">
          <button type="submit" className="btn-primary">Terapkan</button>
          <Link href={`/dev/statistics?tab=activity&range=${rangeKey}`} className="btn-ghost">Reset</Link>
        </div>
      </form>

      {/* ── Kind chips ────────────────────────────────────────────────────── */}
      <nav aria-label="Filter jenis" className="mb-5 flex flex-wrap gap-2">
        <Link
          href={`/dev/statistics?tab=activity&range=${rangeKey}${verdict ? `&verdict=${verdict}` : ""}`}
          aria-current={!kind ? "true" : undefined}
          className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
            !kind ? "border-brand-500 bg-brand-soft text-brand-700 dark:text-brand-100" : "border-border text-foreground-muted hover:text-foreground"
          }`}
        >
          Semua jenis
        </Link>
        {Object.values(KIND).map((value) => {
          const query = new URLSearchParams({ tab: "activity", range: rangeKey, kind: value });
          if (verdict) query.set("verdict", verdict);
          return (
            <Link
              key={value}
              href={`/dev/statistics?${query.toString()}`}
              aria-current={kind === value ? "true" : undefined}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                kind === value
                  ? "border-brand-500 bg-brand-soft text-brand-700 dark:text-brand-100"
                  : "border-border text-foreground-muted hover:text-foreground"
              }`}
            >
              {KIND_LABEL[value]}
            </Link>
          );
        })}
      </nav>

      {items.length === 0 ? (
        <EmptyState
          icon="search"
          title="Tidak ada event"
          description={
            verdict || kind || q || ip
              ? "Tidak ada event yang cocok dengan filter ini."
              : "Belum ada aktivitas terekam pada rentang ini. Log terisi saat ada kunjungan atau panggilan API."
          }
        />
      ) : (
        <Section title="Log aktivitas" description={`${pagination.total} event pada rentang ${range.label}. Klik satu baris untuk detail.`}>
          <ResultCount page={pagination.page} limit={pagination.limit} total={pagination.total} noun="event" />

          <div className="mt-3">
            <DataTable
              caption="Log aktivitas"
              columns={[
                { key: "waktu", label: "Waktu" },
                { key: "jenis", label: "Jenis" },
                { key: "path", label: "Path" },
                { key: "status", label: "Status", align: "right" },
                { key: "ip", label: "IP" },
                { key: "verdict", label: "Penilaian" },
              ]}
              rows={items}
              renderRow={(event) => (
                <>
                  <Td>
                    <Link href={`/dev/statistics/event/${event.id}`} className="block text-xs text-foreground hover:underline">
                      {formatDateTime(event.createdAt)}
                    </Link>
                    <span className="mt-0.5 block text-[11px] text-foreground-subtle">{formatRelative(event.createdAt)}</span>
                  </Td>
                  <Td>
                    <span className="text-xs text-foreground">{KIND_LABEL[event.kind] ?? event.kind}</span>
                  </Td>
                  <Td>
                    <Link href={`/dev/statistics/event/${event.id}`} className="block max-w-[22rem] truncate font-mono text-xs text-foreground hover:underline">
                      {event.method ? `${event.method} ` : ""}
                      {event.path}
                    </Link>
                    {event.code ? (
                      <span className="mt-0.5 block font-mono text-[11px] text-foreground-subtle">{event.code}</span>
                    ) : null}
                  </Td>
                  <Td align="right">
                    <span className="text-xs tabular-nums text-foreground">{event.status ?? "—"}</span>
                    {event.durationMs !== null ? (
                      <span className="mt-0.5 block text-[11px] text-foreground-subtle">{formatDuration(event.durationMs)}</span>
                    ) : null}
                  </Td>
                  <Td>
                    <span className="font-mono text-[11px] text-foreground-muted">{event.ip ?? "—"}</span>
                  </Td>
                  <Td>
                    <VerdictBadge verdict={event.verdict} reason={event.verdictReason} />
                  </Td>
                </>
              )}
              renderCard={(event) => (
                <Link href={`/dev/statistics/event/${event.id}`} className="card-interactive block p-4">
                  <div className="flex items-start justify-between gap-3">
                    <code className="min-w-0 truncate font-mono text-xs text-foreground">{event.path}</code>
                    <VerdictBadge verdict={event.verdict} />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-foreground-subtle">
                    <span>{formatDateTime(event.createdAt)}</span>
                    <span className="font-mono">{event.ip ?? "—"}</span>
                    <span>{event.status ?? "—"}</span>
                  </div>
                </Link>
              )}
            />
          </div>

          <Pagination className="mt-5" page={pagination.page} pages={pagination.pages} buildHref={buildHref} />
        </Section>
      )}
    </>
  );
}

// ── Fatal log ───────────────────────────────────────────────────────────────

async function FatalLog({ params }) {
  const page = Math.max(1, parseInt(params?.page ?? "1", 10) || 1);
  const { items, pagination } = await listFatal({ page, limit: 25 });

  const buildHref = (nextPage) => {
    const query = new URLSearchParams({ tab: "fatal" });
    if (nextPage > 1) query.set("page", String(nextPage));
    return `/dev/statistics?${query.toString()}`;
  };

  return (
    <>
      <Alert tone={items.length > 0 ? "danger" : "success"} title={items.length > 0 ? "Ada kejadian yang perlu ditindaklanjuti" : "Tidak ada error fatal"} className="mb-5">
        {items.length > 0
          ? "Log ini berisi exception yang tidak tertangani (severity FATAL) dan error server (severity ERROR). Keduanya berasal dari jalur error aplikasi, bukan dari penilaian keamanan."
          : "Belum ada exception yang tidak tertangani. Halaman ini akan terisi otomatis saat ada error server."}
      </Alert>

      {items.length === 0 ? (
        <EmptyState icon="receipt" title="Log fatal kosong" description="Tidak ada error server yang tercatat. Ini kondisi yang diharapkan." />
      ) : (
        <Section title="Log fatal" description="Terbaru dulu, tanpa filter tanggal: satu error yang tersembunyi di balik filter adalah error yang tidak pernah diperbaiki.">
          <ResultCount page={pagination.page} limit={pagination.limit} total={pagination.total} noun="kejadian" />

          <div className="mt-3">
            <DataTable
              caption="Log fatal"
              columns={[
                { key: "waktu", label: "Waktu" },
                { key: "severity", label: "Severity" },
                { key: "path", label: "Path" },
                { key: "pesan", label: "Pesan" },
                { key: "requestId", label: "Request ID" },
              ]}
              rows={items}
              renderRow={(event) => (
                <>
                  <Td>
                    <Link href={`/dev/statistics/event/${event.id}`} className="text-xs text-foreground hover:underline">
                      {formatDateTime(event.createdAt)}
                    </Link>
                  </Td>
                  <Td>
                    <Badge tone={event.severity === SEVERITY.FATAL ? "danger" : "warning"}>{event.severity}</Badge>
                  </Td>
                  <Td>
                    <code className="block max-w-[18rem] truncate font-mono text-xs text-foreground">
                      {event.method ? `${event.method} ` : ""}
                      {event.path}
                    </code>
                    {event.status ? (
                      <span className="mt-0.5 block text-[11px] text-foreground-subtle">HTTP {event.status}</span>
                    ) : null}
                  </Td>
                  <Td>
                    <Link href={`/dev/statistics/event/${event.id}`} className="block max-w-[26rem] truncate text-xs text-foreground hover:underline">
                      {event.message ?? event.code ?? "—"}
                    </Link>
                  </Td>
                  <Td>
                    <code className="font-mono text-[11px] text-foreground-subtle">{event.requestId ?? "—"}</code>
                  </Td>
                </>
              )}
              renderCard={(event) => (
                <Link href={`/dev/statistics/event/${event.id}`} className="card-interactive block p-4">
                  <div className="flex items-start justify-between gap-3">
                    <code className="min-w-0 truncate font-mono text-xs text-foreground">{event.path}</code>
                    <Badge tone={event.severity === SEVERITY.FATAL ? "danger" : "warning"}>{event.severity}</Badge>
                  </div>
                  <p className="mt-2 line-clamp-2 text-xs text-foreground-muted">{event.message ?? event.code ?? "—"}</p>
                  <p className="mt-1.5 text-[11px] text-foreground-subtle">{formatDateTime(event.createdAt)}</p>
                </Link>
              )}
            />
          </div>

          <Pagination className="mt-5" page={pagination.page} pages={pagination.pages} buildHref={buildHref} />
        </Section>
      )}
    </>
  );
}
