// ============================================================================
// Sparkline — activity over time, as inline SVG.
//
// WHY SVG AND NOT A CHART LIBRARY
// A charting dependency would add tens of kilobytes of client JavaScript to a
// server-rendered admin page, for a shape that is four polylines. This renders
// on the server, ships zero JS, and has no hydration cost.
//
// WHY IT HANDLES EMPTY AND FLAT SERIES EXPLICITLY
// A sparkline with one point, or with every point equal, is the normal state of
// a new deployment. A naive path renders as nothing (a division by zero in the
// y-scale) and the operator sees an empty box with no explanation. Both cases
// get a deliberate shape plus a caption.
//
// THE SERIES IS DENSE ON PURPOSE: gaps in a time series mean "no data", not
// "zero activity", and the caller is responsible for passing buckets that cover
// the whole range. This component plots what it is given, in order.
// ============================================================================
import { formatNumber } from "@/lib/format";

const WIDTH = 720;
const HEIGHT = 120;
const PAD_X = 4;
const PAD_Y = 8;

/** Map a series to an SVG polyline path. Returns null when there is nothing to draw. */
function toPath(values, max) {
  if (!values.length) return null;
  const usableW = WIDTH - PAD_X * 2;
  const usableH = HEIGHT - PAD_Y * 2;
  const stepX = values.length > 1 ? usableW / (values.length - 1) : 0;

  return values
    .map((value, index) => {
      const x = PAD_X + (values.length > 1 ? index * stepX : usableW / 2);
      const ratio = max > 0 ? value / max : 0;
      const y = PAD_Y + usableH - ratio * usableH;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

export default function Sparkline({ points = [], unit = "hour" }) {
  const events = points.map((point) => point.events ?? 0);
  const pageviews = points.map((point) => point.pageviews ?? 0);
  const max = Math.max(1, ...events, ...pageviews);

  const eventPath = toPath(events, max);
  const viewPath = toPath(pageviews, max);
  const total = events.reduce((sum, value) => sum + value, 0);
  const label = unit === "day" ? "hari" : "jam";

  if (!points.length) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-surface px-4 py-8 text-center">
        <p className="text-sm text-foreground-muted">Belum ada aktivitas pada rentang ini.</p>
        <p className="mt-1 text-xs text-foreground-subtle">
          Grafik terisi setelah ada kunjungan halaman atau panggilan API.
        </p>
      </div>
    );
  }

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-28 w-full text-brand-500"
        role="img"
        aria-label={`Aktivitas per ${label}: ${formatNumber(total)} event dalam ${points.length} ${label}`}
        preserveAspectRatio="none"
      >
        {/* Baseline: without it a flat series looks like an empty box. */}
        <line x1={PAD_X} y1={HEIGHT - PAD_Y} x2={WIDTH - PAD_X} y2={HEIGHT - PAD_Y} className="stroke-border" strokeWidth="1" />

        {viewPath ? (
          <path
            d={`${viewPath} L${WIDTH - PAD_X},${HEIGHT - PAD_Y} L${PAD_X},${HEIGHT - PAD_Y} Z`}
            className="fill-brand-500/15"
            stroke="none"
          />
        ) : null}

        {viewPath ? <path d={viewPath} fill="none" className="stroke-brand-300" strokeWidth="1.5" strokeLinejoin="round" /> : null}

        {eventPath ? (
          <path d={eventPath} fill="none" className="stroke-brand-600" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        ) : null}

        {/* A single bucket has no line to draw, so mark the point itself. */}
        {points.length === 1 && eventPath ? <circle cx={WIDTH / 2} cy={PAD_Y} r="3" className="fill-brand-600" /> : null}
      </svg>

      <figcaption className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-foreground-subtle">
        <span>
          {formatNumber(total)} event · puncak {formatNumber(max)} per {label}
        </span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block h-0.5 w-4 bg-brand-600" />
            event
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block h-0.5 w-4 bg-brand-300" />
            page view
          </span>
        </span>
      </figcaption>
    </figure>
  );
}
