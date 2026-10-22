// ============================================================================
// TerminalLog — the activity trail rendered the way a terminal prints it.
//
// WHY THIS EXISTS NEXT TO THE TABLE
//
// The table on the activity tab answers "what happened, filterable". It does not
// answer "what did the log actually look like" — an operator debugging a request
// reads a stream: time, source, status, message, in the order it happened, with
// nothing wrapped in a cell. That stream is what this component renders, and it
// is the view a developer reaches for first.
//
// THE LINE FORMAT, AND WHY IT IS FIXED-WIDTH
//
//   HH:MM:SS.mmm  IP  METHOD PATH  STATUS  MESSAGE  [CODE]
//
// Columns are padded so 40 consecutive lines can be scanned vertically instead
// of read one at a time. That is the whole value of a log view; a ragged stream
// is worse than a table. The padding is done in JS with a monospace font, so it
// aligns identically on every platform (no tab stops, no `ch` unit guessing).
//
// HONEST ABOUT WHAT IT IS NOT
//
// This is NOT a live tail. It is a page of rows fetched at request time, and it
// says so in the header. A fake "streaming" UI that silently polls would make an
// operator think they are watching live traffic when they are looking at a
// snapshot, which is the kind of lie that costs an incident.
//
// NO CLIENT JAVASCRIPT: server component, no state. The only interactivity is a
// plain anchor per line to the detail page.
// ============================================================================
import Link from "next/link";
import { formatDateTime, formatRelative } from "@/lib/format";
import { KIND_LABEL, VERDICT, SEVERITY } from "@/lib/traffic/classify.js";

/** Terminal colours per verdict. Deliberately muted: a wall of red is unreadable. */
const VERDICT_CLASS = {
  [VERDICT.NORMAL]: "text-foreground-muted",
  [VERDICT.SUSPICIOUS]: "text-warning-fg",
  [VERDICT.HOSTILE]: "text-danger-fg",
};

/** Status colour: 5xx red, 4xx amber, 2xx/3xx dim. */
function statusClass(status) {
  if (status === null || status === undefined) return "text-foreground-subtle";
  if (status >= 500) return "text-danger-fg font-semibold";
  if (status >= 400) return "text-warning-fg";
  return "text-foreground-subtle";
}

/**
 * Pad or truncate to an exact width.
 *
 * Truncation keeps the START of a path, because "/api/auth/login" truncated at
 * the end is still identifiable while a tail-truncated one ("...ogin") is not.
 */
function fit(value, width) {
  const text = String(value ?? "");
  if (text.length === width) return text;
  if (text.length > width) return `${text.slice(0, Math.max(0, width - 1))}…`;
  return text.padEnd(width, " ");
}

/** HH:MM:SS.mmm in Jakarta time, the same zone as every other timestamp in /dev. */
function clock(value) {
  if (!value) return "00:00:00.000";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "00:00:00.000";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(d);
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${parts}.${ms}`;
}

export default function TerminalLog({ events = [], total = 0, rangeLabel = null, emptyNote = null }) {
  if (!events.length) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-surface px-4 py-8 text-center">
        <p className="text-sm text-foreground-muted">{emptyNote ?? "Tidak ada log pada rentang ini."}</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-[#0b1120]">
      {/* Chrome: tells the operator exactly what they are looking at. */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
        <div className="flex items-center gap-1.5" aria-hidden="true">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        </div>
        <p className="font-mono text-[11px] text-white/50">
          traffic_events · {events.length} dari {total} baris
          {rangeLabel ? ` · ${rangeLabel}` : ""}
          {" · snapshot, bukan live tail"}
        </p>
      </div>

      {/* The stream. `overflow-x-auto` keeps long paths from wrapping the layout;
          the lines themselves never wrap, which is what makes the columns align. */}
      <div className="overflow-x-auto">
        <ol className="m-0 list-none divide-y divide-white/5 p-0 font-mono text-[11px] leading-relaxed">
          {events.map((event) => (
            <li key={event.id} className="group">
              <Link
                href={`/dev/statistics/event/${event.id}`}
                className="flex items-baseline gap-0 whitespace-pre px-3 py-1 hover:bg-white/5 focus-visible:bg-white/10 focus-visible:outline-none"
                title={event.verdictReason ?? undefined}
              >
                {/* 1. Clock — millisecond precision, because two events in the
                       same second are the normal case in a burst. */}
                <span className="shrink-0 text-white/35" title={formatDateTime(event.createdAt)}>
                  {clock(event.createdAt)}
                </span>

                {/* 2. Source IP, fixed width so the next column never shifts. */}
                <span className="shrink-0 pl-2 text-sky-300/80" title={event.ip ?? "IP tidak tercatat"}>
                  {fit(event.ip ?? "-", 15)}
                </span>

                {/* 3. Verdict marker: one character, colour carries the meaning,
                       and it is the FIRST thing after the address so a hostile
                       line is findable while scrolling fast. */}
                <span
                  className={`shrink-0 pl-1 ${VERDICT_CLASS[event.verdict] ?? "text-foreground-muted"}`}
                  title={`${event.verdict}${event.verdictRule ? ` · ${event.verdictRule}` : ""}`}
                >
                  {event.verdict === VERDICT.HOSTILE ? "!!" : event.verdict === VERDICT.SUSPICIOUS ? "! " : "  "}
                </span>

                {/* 4. Method + path. */}
                <span className="shrink-0 pl-2 text-white/40">{fit(event.method ?? "-", 6)}</span>
                <span className="shrink-0 text-white/90">{fit(event.path, 38)}</span>

                {/* 5. Status. */}
                <span className={`shrink-0 pl-2 ${statusClass(event.status)}`}>{fit(event.status ?? "---", 4)}</span>

                {/* 6. Kind, as a short token. */}
                <span className="shrink-0 pl-2 text-violet-300/70">{fit(shortKind(event.kind), 12)}</span>

                {/* 7. The human line: message, else code, else nothing. */}
                <span className={`pl-2 ${event.severity === SEVERITY.FATAL ? "text-danger-fg" : "text-white/60"}`}>
                  {event.message ?? event.code ?? ""}
                </span>

                {event.durationMs !== null && event.durationMs !== undefined ? (
                  <span className="shrink-0 pl-2 text-white/30">{event.durationMs}ms</span>
                ) : null}
              </Link>
            </li>
          ))}
        </ol>
      </div>

      <div className="border-t border-white/10 px-3 py-2">
        <p className="font-mono text-[11px] text-white/35">
          waktu WIB · IP · penilaian · metode · path · status · jenis · pesan
          <span className="pl-2 text-white/25">klik satu baris untuk detail lengkap</span>
        </p>
      </div>
    </div>
  );
}

/** Compact kind tokens: the log line has no room for "Kunjungan halaman". */
function shortKind(kind) {
  const map = {
    PAGE_VIEW: "page",
    API_CALL: "api",
    AUTH_FAILURE: "auth-fail",
    WEBHOOK: "webhook",
    FATAL: "fatal",
    BOT: "bot",
    SCAN: "scan",
  };
  return map[kind] ?? KIND_LABEL[kind] ?? String(kind ?? "").toLowerCase();
}
