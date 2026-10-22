// ============================================================================
// POST /api/traffic/scan — internal sink for scanner probes seen by the proxy.
//
// WHY THIS ROUTE EXISTS
//
// A probe for /wp-admin.php or /.env never reaches a page or an API handler:
// Next resolves it to 404 without running our code, so no route-level recorder
// ever sees it. The proxy sees every request, but the proxy runtime must not
// load Prisma (see the scope note in src/proxy.js). This route is the bridge:
// proxy detects the probe, posts it here, this handler writes the row.
//
// AUTHENTICATION: the same shared secret the internal cron routes use
// (`X-Internal-Key` against INTERNAL_KEY), compared in constant time. An UNSET
// key denies everything — an empty env var must not turn this into an open
// endpoint that lets anyone write arbitrary rows into the traffic table.
//
// NOT UNDER THE PROXY MATCHER: the matcher excludes /api, so this call does not
// recurse. That exclusion is load-bearing; changing it would make every scan
// probe call itself.
//
// THE BODY IS TREATED AS UNTRUSTED even though it comes from our own proxy: the
// endpoint is reachable by anyone who learns INTERNAL_KEY, and the fields land in
// a table the security page reads. Paths are re-validated here rather than
// trusted, and the length caps match the columns.
// ============================================================================
import { route, readJson } from "@/lib/api.js";
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { recordTraffic } from "@/lib/traffic/record.js";
import { scanPathHit, KIND } from "@/lib/traffic/classify.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Constant-time string comparison; length is not secret-dependent. */
function safeEqual(a, b) {
  const left = Buffer.from(String(a), "utf8");
  const right = Buffer.from(String(b), "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export const POST = route(async (req, _ctx, { log }) => {
  const expected = process.env.INTERNAL_KEY;
  const supplied = req.headers.get("x-internal-key");

  if (!expected || !supplied || !safeEqual(expected, supplied)) {
    // No detail in the response: this endpoint is internal, a caller has no
    // business learning whether the key was missing or wrong.
    log.warn("traffic.scan_unauthorized", {});
    return NextResponse.json({ success: false }, { status: 401 });
  }

  const body = await readJson(req, { maxBytes: 4 * 1024 }).catch(() => ({}));
  const path = typeof body?.path === "string" ? body.path.slice(0, 512) : "";

  // Re-check the pattern here. The proxy already matched it, but this endpoint
  // must not become a way to write an arbitrary "scan" row for a normal path.
  if (!path.startsWith("/") || !scanPathHit(path)) {
    return NextResponse.json({ success: true, recorded: false });
  }

  await recordTraffic({
    kind: KIND.SCAN,
    method: "GET",
    path,
    status: 404,
    message: "Permintaan ke path yang tidak dimiliki aplikasi",
    ip: typeof body?.ip === "string" ? body.ip.slice(0, 64) : null,
    userAgent: typeof body?.userAgent === "string" ? body.userAgent.slice(0, 255) : null,
    referrer: typeof body?.referrer === "string" ? body.referrer.slice(0, 255) : null,
  });

  return NextResponse.json({ success: true, recorded: true });
});
