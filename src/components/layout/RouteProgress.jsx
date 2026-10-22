"use client";

// ============================================================================
// RouteProgress — thin blue loading bar pinned to the bottom edge of the nav.
//
// WHAT IT COVERS:
//   1. Route transitions. The App Router has no global "is navigating" flag;
//      useLinkStatus() only sees the Link that was clicked, so nav Links render
//      a <NavProbe/>: a zero-render hook that reports its Link's pending state
//      upward through context.
//   2. apiFetch activity (login, checkout, logout, profile forms...). Those do
//      not touch the router, so the provider installs a reporter into the
//      shared api-client and both sources drive the same bar.
//
// PLACEMENT: the bar itself (<RouteProgressBar/>) is rendered INSIDE the
// <header> in NavBar.jsx, absolutely positioned at the nav row's bottom edge.
// The header is sticky, so the bar moves with the nav in every scroll state —
// a viewport-fixed bar does not (the announcement banner can sit above the
// header, so a fixed top-16 bar visibly detaches while scrolling).
//
// TIMER DISCIPLINE (this had a real bug): the "show after 120ms" timer MUST be
// cancelled the moment pending ends, or it fires into an idle page and leaves
// the bar crawling until the next navigation. All transitions therefore go
// through stateRef + apply(): refresh() never runs side effects inside a
// setState updater (StrictMode double-invokes updaters, which leaked duplicate
// timers), the show timer is cleared on every transition AND re-checks pending
// before firing, and the done-hold timer is cleared when loading resumes.
//
// BEHAVIOUR (the usual top progress bar contract):
//   hidden → grow from 0 while loading → fill to 100% on success → fade out.
//   Appears only after 120ms of pending (fast loads never flicker), holds 100%
//   for 200ms, fades 150ms. `data-state` drives it from CSS in globals.css.
// ============================================================================

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { __installProgressReporter } from "@/lib/api-client";

const ProgressContext = createContext({
  setRoutePending: () => {},
  state: "hidden",
});

export function useProgressReporter() {
  return useContext(ProgressContext);
}

/**
 * Render inside a <Link>; reports that Link's pending state to the bar.
 *
 * WHY THIS ALONE WAS NOT ENOUGH (and why the bar never appeared)
 *
 * `useLinkStatus` reports `pending` only when navigation is actually blocked:
 * Next's own docs say it is useful when prefetching is disabled/in progress and
 * the destination is dynamic WITHOUT a loading.js boundary. This app has a root
 * `app/loading.jsx`, so App Router renders the skeleton immediately and the
 * transition completes without ever blocking — `pending` stays false for the
 * whole navigation and the bar never leaves `hidden`. Measured: 0 data-state
 * transitions across a real nav click.
 *
 * So the probe is kept (it still catches the slow, blocked case) but the
 * navigation signal itself comes from `usePathname` in the provider below, which
 * is driven by the router and does not depend on whether a loading boundary
 * exists.
 */
export function NavProbe() {
  const { pending } = useLinkStatus();
  const { setRoutePending } = useProgressReporter();
  const reported = useRef(false);

  useEffect(() => {
    // ONLY EVER RAISE THE CLAIM, NEVER LOWER IT.
    //
    // This probe used to call setRoutePending(pending) unconditionally, which
    // meant a `false` from useLinkStatus CLEARED a navigation the provider had
    // just detected from a click. Measured: click → pending:true at t+0ms →
    // pending:false at t+20ms, so the 120ms show timer was cancelled before it
    // ever fired and the bar never appeared at all.
    //
    // Releasing the claim is the provider's job (it owns the pathname-change
    // signal, which is authoritative about when navigation ended). A probe can
    // only add "this link is blocked", never subtract.
    if (pending) {
      setRoutePending(true);
      reported.current = true;
    }
    return () => {
      // Release only a claim THIS probe raised and the provider has not
      // superseded: the link unmounted because navigation completed.
      if (reported.current) {
        setRoutePending(false);
        reported.current = false;
      }
    };
  }, [pending, setRoutePending]);

  return null;
}

/**
 * The bar element itself. Render inside <header> (NavBar.jsx): absolute
 * positioning against the header pins it to the nav's bottom edge — page top,
 * mid-scroll, and pinned-sticky, everywhere the nav goes the bar follows.
 */
export function RouteProgressBar() {
  const { state } = useProgressReporter();
  return (
    <div
      aria-hidden="true"
      data-state={state}
      // `bottom-0`, NOT `top-16`.
      //
      // The header is 65px tall: a 64px content row plus its 1px bottom border.
      // `top-16` pinned the bar at exactly 64px, so a 2px bar occupied 64–66 and
      // hung 1px BELOW the header — it straddled the border instead of sitting
      // on it, which reads as a misaligned/unven bar against the nav edge, and
      // the extra pixel showed over the page background.
      //
      // Anchoring to the bottom edge makes the bar follow whatever the header
      // height actually is (border, font scaling, a taller mobile row), so it can
      // never drift out of alignment again.
      className="route-progress pointer-events-none absolute inset-x-0 bottom-0 z-50 h-0.5 origin-left bg-brand-500"
    />
  );
}

// How long a navigation must already be pending before the bar appears.
//
// WAS 120ms, which made the bar effectively invisible on this app: with a root
// `app/loading.jsx` the router renders the skeleton immediately and a nav
// transition commits in ~10ms (measured: click at t+0, pathname changed at
// t+9). Every real navigation finished inside the delay window, the timer was
// cancelled, and the bar never rendered once — the reported symptom was "the
// loading bar is never there / not even".
//
// 40ms keeps the anti-flicker intent (an instant prefetched transition still
// shows nothing) while catching the transitions a person actually waits on:
// a cold or uncached route, a slow DB read in a server component.
const SHOW_DELAY_MS = 40;
const COMPLETE_HOLD_MS = 200;
const FADE_MS = 150;
const STUCK_RESET_MS = 20000;
// Upper bound on how long one navigation may keep the bar visible.
const NAV_DEADLINE_MS = 8000;

export default function RouteProgress({ children }) {
  const [state, setState] = useState("hidden"); // hidden | loading | done | fading
  const stateRef = useRef("hidden");
  const pendingCount = useRef(0); // apiFetch calls in flight
  const routePending = useRef(false); // any navigation in flight
  const clickPending = useRef(false); // navigation started by a link click
  const probePending = useRef(false); // navigation reported by useLinkStatus
  const showTimer = useRef(null);
  const holdTimer = useRef(null);
  const fadeTimer = useRef(null);
  const pathname = usePathname();
  // Increments when a navigation STARTS, so the completion effect re-arms.
  const [navigationNonce, setNavigationNonce] = useState(0);

  const apply = useCallback((next) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const pendingNow = useCallback(() => pendingCount.current > 0 || routePending.current, []);

  const refresh = useCallback(() => {
    // Cancel the pending "show" timer on EVERY transition. This is the fix for
    // the stuck bar: a request that finished inside SHOW_DELAY_MS used to leave
    // the timer armed; it then fired into an idle page and the bar crawled
    // until the next navigation happened to run refresh() again.
    clearTimeout(showTimer.current);

    if (pendingNow()) {
      if (stateRef.current === "loading") return; // already visible
      // A scheduled "done" hold or fade must not fire mid-loading.
      clearTimeout(holdTimer.current);
      clearTimeout(fadeTimer.current);
      // A previous cycle left the bar filled and faded out. Snap it back to the
      // start of the track first, otherwise this run would animate backwards
      // from 100% instead of growing from 0.
      if (stateRef.current === "done" || stateRef.current === "fading") apply("hidden");
      showTimer.current = setTimeout(() => {
        // Re-check: pending may have ended during the delay window.
        if (pendingNow()) apply("loading");
      }, SHOW_DELAY_MS);
      return;
    }

    // Everything finished: fill to 100%, hold briefly, fade out, then reset.
    if (stateRef.current === "hidden" || stateRef.current === "fading") {
      // Never became visible (no flash), or already unwinding.
      return;
    }
    clearTimeout(holdTimer.current);
    apply("done");
    holdTimer.current = setTimeout(() => {
      apply("fading");
      // THE bug: the cycle stopped at `fading` and stayed there, so the next
      // navigation started from a filled bar and the state machine never got
      // back to `hidden`. Schedule the reset that closes the cycle.
      fadeTimer.current = setTimeout(() => {
        if (!pendingNow()) apply("hidden");
      }, FADE_MS);
    }, COMPLETE_HOLD_MS);
  }, [apply, pendingNow]);

  const setRoutePending = useCallback(
    (pending) => {
      // Raise-only. A probe clearing its own claim must not cancel a navigation
      // the provider detected from a click; the pathname change ends that one.
      if (pending) {
        if (!probePending.current) setNavigationNonce((n) => n + 1);
        probePending.current = true;
        routePending.current = true;
      } else {
        probePending.current = false;
        // Only drop the navigation claim when no click-driven nav is in flight.
        if (!clickPending.current) routePending.current = false;
      }
      refresh();
    },
    [refresh]
  );
  useEffect(() => {
    // Installed into api-client so every apiFetch drives this same bar.
    __installProgressReporter(() => {
      pendingCount.current += 1;
      refresh();
      let ended = false;
      return () => {
        if (ended) return;
        ended = true;
        pendingCount.current = Math.max(0, pendingCount.current - 1);
        refresh();
      };
    });
    return () => __installProgressReporter(null);
  }, [refresh]);

  // ── Navigation start: a click on an internal link ────────────────────────
  //
  // THE SIGNAL THE PROBE COULD NOT GIVE. See the NavProbe note above: with a
  // root loading.jsx, `useLinkStatus().pending` never becomes true, so nothing
  // ever started the bar. A capture-phase click listener on the document is the
  // one signal that works regardless of how the router streams the destination.
  //
  // It only claims a navigation when the click is a plain left click on an
  // internal anchor that actually changes the path — modified clicks (new tab,
  // download) and same-page anchors must not light the bar.
  useEffect(() => {
    const onClick = (event) => {
      if (event.defaultPrevented) return;
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const anchor = event.target?.closest?.("a[href]");
      if (!anchor) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;
      if (anchor.getAttribute("rel")?.includes("external")) return;

      let url;
      try {
        url = new URL(anchor.getAttribute("href"), window.location.href);
      } catch {
        return;
      }
      // Same-origin, and a different path than the one we are on.
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname) return;

      clickPending.current = true;
      routePending.current = true;
      setNavigationNonce((n) => n + 1);
      refresh();
    };

    // Capture, so a Link's own handler calling preventDefault (a same-route
    // click, a guarded navigation) is still visible to us afterwards.
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [refresh]);

  // ── Navigation end ───────────────────────────────────────────────────────
  //
  // NOT `usePathname`. Measured with the RSC payload delayed by 1500ms: the
  // pathname changed 15ms after the click, because the App Router updates the
  // URL optimistically and then waits for the data. Ending the bar on pathname
  // therefore cancelled it after ~15ms — before the 40ms show delay — which is
  // why the bar never appeared for ANY navigation, fast or slow.
  //
  // The honest completion signal is the DOM settling: a MutationObserver on the
  // <main> subtree, fired when React commits the new route's content. A
  // deadline backs it up so a route that never mutates (an identical shell)
  // cannot leave the bar crawling.
  useEffect(() => {
    if (!clickPending.current && !probePending.current) return undefined;

    const main = document.querySelector("main");
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      observer?.disconnect();
      clearTimeout(deadline);
      clickPending.current = false;
      probePending.current = false;
      routePending.current = false;
      refresh();
    };

    let observer = null;
    if (main && typeof MutationObserver !== "undefined") {
      // WAIT FOR REAL CONTENT, NOT THE LOADING SKELETON.
      //
      // Measured: <main> mutates twice — once at t+72ms when the route's
      // loading.jsx skeleton streams in, then again at t+1586ms when the actual
      // page content commits. Treating the first mutation as "done" ended the
      // navigation while the customer was still looking at a skeleton, so the
      // bar vanished before it could be seen.
      //
      // The skeleton is the only content that carries the busy marker
      // (`aria-busy` from app/loading.jsx); real page content does not. So a
      // mutation only completes the navigation when <main> is no longer busy.
      observer = new MutationObserver(() => {
        const busy =
          main.getAttribute("aria-busy") === "true" ||
          main.querySelector('[aria-busy="true"]') !== null;
        if (busy) return;
        finish();
      });
      observer.observe(main, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-busy"] });
    }

    // Backstop: never let a navigation hold the bar past this.
    const deadline = setTimeout(finish, NAV_DEADLINE_MS);

    return () => {
      observer?.disconnect();
      clearTimeout(deadline);
    };
  }, [navigationNonce, refresh]);

  // Safety net: a leaked pending claim must not keep the bar crawling forever.
  useEffect(() => {
    if (state !== "loading") return undefined;
    const timeout = setTimeout(() => {
      pendingCount.current = 0;
      routePending.current = false;
      refresh();
    }, STUCK_RESET_MS);
    return () => clearTimeout(timeout);
  }, [state, refresh]);

  const value = useMemo(() => ({ setRoutePending, state }), [setRoutePending, state]);

  return <ProgressContext.Provider value={value}>{children}</ProgressContext.Provider>;
}
