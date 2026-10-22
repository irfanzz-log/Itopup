// ============================================================================
// Vercel Web Analytics — collection only, for the Vercel dashboard.
//
// THE SPLIT, AND WHY IT IS EXPLICIT
//
// The operator was clear: Vercel's numbers are for the Vercel dashboard, and the
// web UI shows only our own engine. So this component does exactly one thing —
// hand page views to Vercel's collector so their dashboard has data — and the
// app never reads that data back. /dev/statistics is fed exclusively by
// traffic_events.
//
// The two systems answer different questions and must not be conflated:
//   * Vercel Analytics — cookieless, deduplicated, geography and referrers. Read
//     it on vercel.com, nowhere else.
//   * our engine — per-event trail with IP, status and a security verdict. Read
//     it at /dev/statistics.
//
// WHY A WRAPPER AT ALL
//
// Two things the raw `<Analytics/>` does not do:
//   1. It ships its script on every deployment including localhost, where
//      `/_vercel/insights/view` does not exist and every page view 404s. The
//      wrapper reports `development` mode off-Vercel so the collector stays quiet
//      locally instead of polluting the console.
//   2. Our own beacon is a SEPARATE request to a SEPARATE endpoint
//      (`/api/traffic/pageview`). Keeping both in one component means a page view
//      is recorded once in each system from the same navigation event, with no
//      chance of one drifting out of sync with the other.
//
// DISABLE: `NEXT_PUBLIC_VERCEL_ANALYTICS=false` turns off both the collector and
// the beacon, for a deployment that must not phone home.
// ============================================================================
"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { Analytics } from "@vercel/analytics/next";

/** True only where Vercel's own endpoints exist. */
function onVercel() {
  return process.env.NEXT_PUBLIC_VERCEL_ENV === "production" || process.env.NEXT_PUBLIC_VERCEL === "1";
}

/**
 * Send one page-view to our own traffic table.
 *
 * `keepalive` matters: a visitor who lands and immediately navigates away would
 * otherwise cancel the request, and the landing page — the one that counts — is
 * exactly the page that gets lost.
 *
 * `navigator.sendBeacon` is preferred when available because the browser owns
 * the lifetime; fetch+keepalive is the fallback. Either way the result is
 * ignored: a failed beacon must never surface to the visitor.
 */
function beacon(pathname) {
  try {
    const body = JSON.stringify({
      path: pathname,
      referrer: document.referrer || null,
      // Screen bucket, not exact pixels: enough for "mobile vs desktop" without
      // turning the trail into a fingerprint.
      viewport: window.innerWidth < 640 ? "mobile" : window.innerWidth < 1024 ? "tablet" : "desktop",
    });

    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon("/api/traffic/pageview", blob)) return;
    }

    fetch("/api/traffic/pageview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
      credentials: "same-origin",
    }).catch(() => {});
  } catch {
    /* never let analytics break a page */
  }
}

export default function WebAnalytics() {
  const pathname = usePathname();
  const lastPath = useRef(null);

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_VERCEL_ANALYTICS === "false") return;
    // Skip internal surfaces: an operator refreshing /dev must not inflate the
    // visitor count, and their own requests are already in the server-side trail.
    if (!pathname || pathname.startsWith("/dev") || pathname.startsWith("/api")) return;
    // A re-render with the same path (state change) is not a new page view.
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    beacon(pathname);
  }, [pathname]);

  if (process.env.NEXT_PUBLIC_VERCEL_ANALYTICS === "false") return null;

  return <Analytics mode={onVercel() ? "production" : "development"} />;
}
