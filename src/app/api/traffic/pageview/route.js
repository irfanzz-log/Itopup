// ============================================================================
// POST /api/traffic/pageview
//
// Receives the client beacon from <PageViewBeacon/> and feeds the SELF-BUILT
// view engine. This is the only visitor source the web UI shows: Vercel Web
// Analytics keeps collecting for the Vercel dashboard, and nothing here reads it.
//
// VISITOR IDENTITY: the first request from a browser that has no `itp_vid`
// cookie gets one issued here, and the response carries it. Only its SHA-256 is
// stored (see src/lib/traffic/visitor.js), so the table holds no raw identifier.
//
// WHY THIS IS DELIBERATELY LOOSE ON AUTH, STRICT ON ABUSE
//
// It must work for an anonymous visitor, so it cannot require a session. What it
// does instead:
//   * caps the body at 4 KB (no payload dump can be smuggled in),
//   * accepts only a `path` that looks like a path (no scheme, no host),
//   * rate-limits per IP so a script cannot inflate the visitor count,
//   * always answers 204, so a caller learns nothing about whether it was
//     recorded. A beacon that returns 429 to a real browser just loses a view;
//     one that returns 429 to an attacker tells them the limiter is there.
// ============================================================================
import { route, readJson } from "@/lib/api.js";
import { NextResponse } from "next/server";
import { clientIp, check, presets } from "@/lib/rate-limit.js";
import { recordTraffic } from "@/lib/traffic/record.js";
import { KIND } from "@/lib/traffic/classify.js";
import {
  VISITOR_COOKIE,
  readVisitorId,
  newVisitorId,
  hashVisitorId,
  visitorCookieOptions,
} from "@/lib/traffic/visitor.js";

export const runtime = "nodejs";
// A beacon must never be cached by an intermediary.
export const dynamic = "force-dynamic";

/** Same-origin only: the beacon is posted by our own page, nothing else. */
function sameOrigin(req) {
  const origin = req.headers.get("origin");
  if (!origin) return true; // sendBeacon may omit it; the rate limit covers abuse
  try {
    const host = req.headers.get("host");
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export const POST = route(async (req) => {
  const ip = clientIp(req);

  // A dedicated bucket: page views are cheap but numerous, and sharing the
  // default bucket would let a browsing visitor exhaust their API budget.
  const limit = await check(`pageview:ip:${ip ?? "anon"}`, presets.pageview).catch(() => ({ allowed: true }));
  if (!limit.allowed) {
    // Silent drop: see the header comment. 204, not 429.
    return new NextResponse(null, { status: 204 });
  }

  if (!sameOrigin(req)) return new NextResponse(null, { status: 204 });

  // Issue an identity when the browser does not have one yet. This is the moment
  // the engine can start telling two visitors apart; before it, the only signal
  // was the IP, which is wrong in both directions (NAT collapses many people
  // into one, mobile data splits one person into many).
  const existing = readVisitorId(req);
  const visitorId = existing ?? newVisitorId();

  const body = await readJson(req, { maxBytes: 4 * 1024 }).catch(() => ({}));
  const rawPath = typeof body?.path === "string" ? body.path : "/";

  // Reject anything that is not a site-relative path. A beacon claiming to be
  // https://evil.example/x must not become a row in our table.
  if (!rawPath.startsWith("/") || rawPath.startsWith("//")) {
    return new NextResponse(null, { status: 204 });
  }

  await recordTraffic({
    kind: KIND.PAGE_VIEW,
    method: "GET",
    path: rawPath,
    status: null,
    ip,
    userAgent: req.headers.get("user-agent"),
    referrer: body?.referrer ?? req.headers.get("referer"),
    requestId: req.headers.get("x-request-id"),
    visitorHash: hashVisitorId(visitorId),
    metadata: typeof body?.viewport === "string" ? { viewport: body.viewport.slice(0, 16) } : null,
  });

  const res = new NextResponse(null, { status: 204 });
  // Only set the cookie when it is new, so an existing one keeps its original
  // expiry instead of being silently extended on every navigation.
  if (!existing) res.cookies.set(VISITOR_COOKIE, visitorId, visitorCookieOptions());
  return res;
});
