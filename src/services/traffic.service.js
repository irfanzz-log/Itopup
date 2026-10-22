// ============================================================================
// Statistics reads for /dev/statistics — the self-built view engine.
//
// ONE SOURCE OF TRUTH: traffic_events.
//
// The operator was explicit: the Vercel Analytics numbers belong to the Vercel
// dashboard, and the web UI shows only our own engine. So nothing here reads the
// Vercel API, and /dev/statistics cannot display a number we did not compute.
// Vercel Analytics keeps collecting in the background for their dashboard; that
// is a separate product with a separate reader.
//
// WHY THE ENGINE NEEDS A VISITOR IDENTITY AT ALL
//
// "Total pengunjung" is a count of PEOPLE, and an event table only has events.
// Two naive answers are both wrong:
//   * count of page views — one person reading five pages is five;
//   * count of DISTINCT ip — an office behind NAT is one person for fifty
//     people, and a phone moving between Wi-Fi and mobile data is two.
// So the beacon issues a first-party cookie (`itp_vid`) and stores only its
// SHA-256. Unique visitors = COUNT(DISTINCT visitorHash), with `ip` as the
// fallback for rows written before the cookie existed or by clients that block
// cookies. The fallback is labelled in the UI, not hidden.
//
// AGGREGATION RULE: counts are done in Postgres (groupBy/count/date_trunc),
// never by pulling rows into Node. The trail grows with traffic; the moment this
// page loads 50k rows to count them is the moment it stops working.
// ============================================================================
import { prisma } from "../lib/db.js";
import { VERDICT, KIND, SEVERITY, SEVERITY_RANK } from "../lib/traffic/classify.js";

/** Range presets the operator can pick. Hours, not days: a spike is an hour. */
export const RANGES = {
  "1h": { label: "1 jam", ms: 60 * 60 * 1000 },
  "24h": { label: "24 jam", ms: 24 * 60 * 60 * 1000 },
  "7d": { label: "7 hari", ms: 7 * 24 * 60 * 60 * 1000 },
  "30d": { label: "30 hari", ms: 30 * 24 * 60 * 60 * 1000 },
};

export const DEFAULT_RANGE = "24h";

/** Resolve a range key to concrete bounds. Unknown keys fall back, never throw. */
export function resolveRange(key) {
  const preset = RANGES[key] ?? RANGES[DEFAULT_RANGE];
  const until = new Date();
  const since = new Date(until.getTime() - preset.ms);
  return { key: RANGES[key] ? key : DEFAULT_RANGE, label: preset.label, since, until };
}

/**
 * Headline counters.
 *
 * `visitors` is COUNT(DISTINCT visitorHash) with an IP fallback, so it counts
 * people rather than requests. `visitorsFromCookie` says how many of those came
 * from a real visitor cookie, which is what makes the number's confidence
 * visible instead of implied.
 */
export async function trailTotals({ since, until }) {
  const where = { createdAt: { gte: since, lte: until } };

  const [events, visitorRows, byVerdict, byKind, fatalCount, suspiciousIps] = await Promise.all([
    prisma.trafficEvent.count({ where }),
    // COALESCE: use the cookie hash when present, the IP when not. One query,
    // grouped in the database, so the distinct count never crosses the wire.
    prisma.$queryRawUnsafe(
      `SELECT COALESCE("visitorHash", "ip") AS "identity",
              bool_or("visitorHash" IS NOT NULL) AS "fromCookie"
         FROM "traffic_events"
        WHERE "createdAt" >= $1 AND "createdAt" <= $2
          AND ("visitorHash" IS NOT NULL OR "ip" IS NOT NULL)
        GROUP BY 1`,
      since,
      until
    ),
    prisma.trafficEvent.groupBy({ by: ["verdict"], where, _count: { _all: true } }),
    prisma.trafficEvent.groupBy({ by: ["kind"], where, _count: { _all: true } }),
    prisma.trafficEvent.count({ where: { ...where, OR: [{ severity: SEVERITY.FATAL }, { kind: KIND.FATAL }] } }),
    prisma.trafficEvent.groupBy({
      by: ["ip"],
      where: { ...where, verdict: { in: [VERDICT.SUSPICIOUS, VERDICT.HOSTILE] }, ip: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { ip: "desc" } },
      take: 10,
    }),
  ]);

  const verdicts = { NORMAL: 0, SUSPICIOUS: 0, HOSTILE: 0 };
  for (const row of byVerdict) verdicts[row.verdict] = row._count._all;

  const kinds = {};
  for (const row of byKind) kinds[row.kind] = row._count._all;

  const visitorsFromCookie = visitorRows.filter((row) => row.fromCookie).length;

  return {
    events,
    /// People, not requests. Cookie identity when available, IP otherwise.
    visitors: visitorRows.length,
    /// How many of `visitors` are backed by a real visitor cookie. The rest are
    /// IP fallbacks; the UI states the ratio rather than pretending it is 100%.
    visitorsFromCookie,
    /// Kept for the IP table, which is a security view and legitimately per-IP.
    uniqueIps: new Set(visitorRows.filter((row) => !row.fromCookie).map((row) => row.identity)).size,
    pageViews: kinds[KIND.PAGE_VIEW] ?? 0,
    apiCalls: kinds[KIND.API_CALL] ?? 0,
    fatalCount,
    verdicts,
    kinds,
    topSuspiciousIps: suspiciousIps.map((row) => ({ ip: row.ip, count: row._count._all })),
  };
}

/**
 * Activity per hour (or per day for long ranges).
 *
 * `visitors` per bucket uses the same COALESCE identity as the total, so the
 * series and the headline agree on what a visitor is.
 */
export async function trailSeries({ since, until, bucket = "hour" }) {
  // date_trunc in SQL keeps the bucketing in the database. Prisma has no
  // groupBy for a truncated timestamp, so this is one raw query with the
  // bounds passed as parameters (never interpolated).
  const unit = bucket === "day" ? "day" : "hour";
  const rows = await prisma.$queryRawUnsafe(
    `SELECT date_trunc($1, "createdAt") AS bucket,
            count(*)::int AS events,
            count(*) FILTER (WHERE "kind" = 'PAGE_VIEW')::int AS pageviews,
            count(DISTINCT COALESCE("visitorHash", "ip"))::int AS visitors
       FROM "traffic_events"
      WHERE "createdAt" >= $2 AND "createdAt" <= $3
      GROUP BY 1
      ORDER BY 1 ASC`,
    unit,
    since,
    until
  );

  return rows.map((row) => ({
    at: row.bucket instanceof Date ? row.bucket.toISOString() : String(row.bucket),
    events: Number(row.events ?? 0),
    pageviews: Number(row.pageviews ?? 0),
    visitors: Number(row.visitors ?? 0),
  }));
}

/**
 * The activity log, newest first, with filters.
 *
 * @param {{ page?: number, limit?: number, kind?: string, verdict?: string,
 *           severity?: string, ip?: string, path?: string, q?: string,
 *           since?: Date, until?: Date }} query
 */
export async function listTraffic(query = {}) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 30));

  const where = {};
  if (query.since || query.until) {
    where.createdAt = {};
    if (query.since) where.createdAt.gte = query.since;
    if (query.until) where.createdAt.lte = query.until;
  }
  if (query.kind) where.kind = query.kind;
  if (query.verdict) where.verdict = query.verdict;
  if (query.severity) where.severity = query.severity;
  if (query.ip) where.ip = query.ip;
  if (query.path) where.path = { contains: String(query.path).slice(0, 200), mode: "insensitive" };
  if (query.q) {
    // Free text searches the two columns an operator actually reads.
    const q = String(query.q).slice(0, 100);
    where.OR = [
      { message: { contains: q, mode: "insensitive" } },
      { code: { contains: q, mode: "insensitive" } },
      { path: { contains: q, mode: "insensitive" } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.trafficEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        kind: true,
        method: true,
        path: true,
        status: true,
        code: true,
        message: true,
        ip: true,
        userAgent: true,
        referrer: true,
        userId: true,
        requestId: true,
        verdict: true,
        verdictReason: true,
        verdictRule: true,
        severity: true,
        durationMs: true,
        createdAt: true,
      },
    }),
    prisma.trafficEvent.count({ where }),
  ]);

  return {
    items,
    pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
  };
}

/** One event, with its full (already redacted) metadata. */
export async function getTrafficEvent(id) {
  return prisma.trafficEvent.findUnique({ where: { id } });
}

/**
 * The fatal log: unhandled errors and anything stamped FATAL.
 *
 * Ordered newest first and NOT paginated by range: a fatal is rare enough that
 * the operator wants all of them, and hiding one behind a date filter is how a
 * crash goes unnoticed for a week.
 */
export async function listFatal({ page = 1, limit = 30, since = null } = {}) {
  const where = {
    OR: [{ severity: SEVERITY.FATAL }, { kind: KIND.FATAL }, { severity: SEVERITY.ERROR }],
    ...(since ? { createdAt: { gte: since } } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.trafficEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.trafficEvent.count({ where }),
  ]);

  return {
    items,
    pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
  };
}

/** Top paths. The "what are people hitting" table. */
export async function topPaths({ since, until, limit = 10 }) {
  const rows = await prisma.trafficEvent.groupBy({
    by: ["path"],
    where: { createdAt: { gte: since, lte: until } },
    _count: { _all: true },
    orderBy: { _count: { path: "desc" } },
    take: limit,
  });
  return rows.map((row) => ({ path: row.path, count: row._count._all }));
}

/** Top IPs by event count, with their worst verdict. */
export async function topIps({ since, until, limit = 10 }) {
  const rows = await prisma.trafficEvent.groupBy({
    by: ["ip"],
    where: { createdAt: { gte: since, lte: until }, ip: { not: null } },
    _count: { _all: true },
    orderBy: { _count: { ip: "desc" } },
    take: limit,
  });

  // One extra query for the verdict per IP: the groupBy cannot return a
  // "worst verdict" aggregate, and doing it per row would be N+1.
  const ips = rows.map((row) => row.ip);
  const hostile = await prisma.trafficEvent.groupBy({
    by: ["ip", "verdict"],
    where: { ip: { in: ips }, verdict: { in: [VERDICT.HOSTILE, VERDICT.SUSPICIOUS] } },
    _count: { _all: true },
  });

  const worst = new Map();
  for (const row of hostile) {
    const current = worst.get(row.ip);
    const rank = row.verdict === VERDICT.HOSTILE ? 2 : 1;
    if (!current || rank > current.rank) worst.set(row.ip, { verdict: row.verdict, rank, count: row._count._all });
  }

  return rows.map((row) => ({
    ip: row.ip,
    count: row._count._all,
    verdict: worst.get(row.ip)?.verdict ?? VERDICT.NORMAL,
    flagged: worst.get(row.ip)?.count ?? 0,
  }));
}

/**
 * Everything the statistics page needs, in one call.
 *
 * No Vercel call is made here on purpose: the web UI is our engine only. If a
 * Vercel figure is ever wanted next to these numbers, it belongs in the Vercel
 * dashboard, not in a page that would then be showing two incompatible
 * definitions of "visitor".
 */
export async function statisticsSnapshot({ rangeKey }) {
  const range = resolveRange(rangeKey);
  const bucket = range.key === "1h" || range.key === "24h" ? "hour" : "day";

  const [totals, series, paths, ips] = await Promise.all([
    trailTotals(range),
    trailSeries({ ...range, bucket }),
    topPaths({ ...range, limit: 10 }),
    topIps({ ...range, limit: 10 }),
  ]);

  return {
    range: { key: range.key, label: range.label, since: range.since, until: range.until },
    bucket,
    trail: { totals, series, paths, ips },
  };
}

export { SEVERITY_RANK };
