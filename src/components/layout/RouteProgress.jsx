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
import { __installProgressReporter } from "@/lib/api-client";

const ProgressContext = createContext({
  setRoutePending: () => {},
  state: "hidden",
});

export function useProgressReporter() {
  return useContext(ProgressContext);
}

/** Render inside a <Link>; reports that Link's pending state to the bar. */
export function NavProbe() {
  const { pending } = useLinkStatus();
  const { setRoutePending } = useProgressReporter();
  const reported = useRef(false);

  useEffect(() => {
    setRoutePending(pending);
    reported.current = pending;
    return () => {
      // Release the claim on unmount (navigation finished and this Link went
      // away) — but only if THIS probe ever claimed it, otherwise an idle
      // menu link's cleanup would clobber another link's in-flight claim.
      if (reported.current) setRoutePending(false);
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
      className="route-progress pointer-events-none absolute inset-x-0 top-16 z-50 h-0.5 origin-left bg-brand-500"
    />
  );
}

const SHOW_DELAY_MS = 120;
const COMPLETE_HOLD_MS = 200;
const FADE_MS = 150;
const STUCK_RESET_MS = 20000;

export default function RouteProgress({ children }) {
  const [state, setState] = useState("hidden"); // hidden | loading | done | fading
  const stateRef = useRef("hidden");
  const pendingCount = useRef(0); // apiFetch calls in flight
  const routePending = useRef(false); // a probed Link is transitioning
  const showTimer = useRef(null);
  const holdTimer = useRef(null);
  const fadeTimer = useRef(null);

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
      routePending.current = Boolean(pending);
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
