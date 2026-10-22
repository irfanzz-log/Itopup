// ============================================================================
// Route progress bar — the contract a user actually observes.
//
// THE BUGS THIS PINS (both were real, both made the bar invisible)
//
// 1. `useLinkStatus().pending` never becomes true when the destination has a
//    loading.jsx boundary, so the probe alone never started the bar.
// 2. The pathname is updated OPTIMISTICALLY by the App Router — measured 15ms
//    after the click with the RSC payload held for 1500ms — so ending the
//    navigation on a pathname change cancelled it before the show delay.
// 3. `top-16` pinned the bar at 64px while the header is 65px tall (64px row +
//    1px border), so the 2px bar straddled the border and hung 1px outside.
//
// The tests drive a REAL browser and assert on geometry sampled over time, not
// on a single screenshot: a bar that flashes for one frame would pass a static
// check and still be invisible to a person.
// ============================================================================
import { test, expect } from "@playwright/test";

/** Record data-state and geometry at a high sample rate. */
async function startSampling(page) {
  await page.evaluate(() => {
    window.__barSamples = [];
    const bar = document.querySelector(".route-progress");
    const header = document.querySelector("header");
    window.__barTimer = setInterval(() => {
      const b = bar.getBoundingClientRect();
      const h = header.getBoundingClientRect();
      window.__barSamples.push({
        state: bar.getAttribute("data-state"),
        width: +b.width.toFixed(1),
        top: +b.top.toFixed(2),
        bottom: +b.bottom.toFixed(2),
        headerBottom: +h.bottom.toFixed(2),
        headerWidth: +h.width.toFixed(1),
        opacity: getComputedStyle(bar).opacity,
      });
    }, 15);
  });
}

async function stopSampling(page) {
  return page.evaluate(() => {
    clearInterval(window.__barTimer);
    const samples = window.__barSamples || [];
    const sequence = [];
    for (const s of samples) {
      if (!sequence.length || sequence[sequence.length - 1].state !== s.state) sequence.push(s);
    }
    return { samples, sequence };
  });
}

test.describe("route progress bar", () => {
  test("appears, fills to the full width, and fades on a slow navigation", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Make the destination slow, which is the only case the bar is for: with a
    // prefetched instant transition it must stay invisible (asserted below).
    await page.route("**/bantuan*", async (route) => {
      await new Promise((r) => setTimeout(r, 1200));
      await route.continue();
    });

    await startSampling(page);
    await page.click('header a[href="/bantuan"]');
    await page.waitForURL("**/bantuan");
    await page.waitForTimeout(1500);
    const { samples, sequence } = await stopSampling(page);

    const states = sequence.map((s) => s.state);

    // The full lifecycle, in order. `loading` is the state that was unreachable.
    expect(states, `observed sequence: ${states.join(" -> ")}`).toContain("loading");
    expect(states.indexOf("loading")).toBeLessThan(states.indexOf("done"));
    expect(states).toContain("fading");

    // It grew while loading (not a zero-width no-op) …
    const loadingWidths = samples.filter((s) => s.state === "loading").map((s) => s.width);
    expect(Math.max(...loadingWidths)).toBeGreaterThan(0);

    // … and reached exactly the full track on completion.
    const doneWidths = samples.filter((s) => s.state === "done").map((s) => s.width);
    expect(Math.max(...doneWidths)).toBeCloseTo(samples[0].headerWidth, 0);
  });

  test("sits flush inside the header, never straddling its border", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const geo = await page.evaluate(() => {
      const bar = document.querySelector(".route-progress");
      const header = document.querySelector("header");
      // Measure the TRACK, not the animated fill: the bar is scaleX(0) while
      // hidden and transitions over 180ms, so reading it mid-animation reports
      // zero width. Disabling the transition for the measurement gives the
      // settled geometry, which is what alignment is about.
      const previousTransition = bar.style.transition;
      bar.style.transition = "none";
      bar.setAttribute("data-state", "done");
      void bar.offsetWidth;
      const b = bar.getBoundingClientRect();
      const h = header.getBoundingClientRect();
      const out = {
        barTop: +b.top.toFixed(2),
        barBottom: +b.bottom.toFixed(2),
        barLeft: +b.left.toFixed(2),
        barWidth: +b.width.toFixed(1),
        headerTop: +h.top.toFixed(2),
        headerBottom: +h.bottom.toFixed(2),
        headerLeft: +h.left.toFixed(2),
        headerWidth: +h.width.toFixed(1),
        barHeight: b.height,
      };
      bar.setAttribute("data-state", "hidden");
      bar.style.transition = previousTransition;
      return out;
    });

    // The regression: the bar used to end 1px BELOW the header because it was
    // pinned with a hardcoded `top-16` instead of the bottom edge.
    expect(geo.barBottom, "bar must not protrude past the header").toBeLessThanOrEqual(geo.headerBottom);
    expect(geo.barTop).toBeGreaterThanOrEqual(geo.headerTop);

    // Full-bleed horizontally, so the two edges line up.
    expect(geo.barLeft).toBeCloseTo(geo.headerLeft, 0);
    expect(geo.barWidth).toBeCloseTo(geo.headerWidth, 0);
    expect(geo.barHeight).toBeGreaterThan(0);
  });

  test("stays hidden for a fast, prefetched transition", async ({ page }) => {
    // The anti-flicker contract: a navigation that completes inside the show
    // delay must not flash the bar. Without this, "it appeared" above could be
    // satisfied by a bar that appears on every single click.
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    // Warm the route so the transition is instant.
    await page.goto("/promo");
    await page.waitForLoadState("networkidle");
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await startSampling(page);
    await page.click('header a[href="/promo"]');
    await page.waitForURL("**/promo");
    await page.waitForTimeout(600);
    const { sequence } = await stopSampling(page);

    expect(sequence.map((s) => s.state)).not.toContain("loading");
  });

  test("does not light up for a modified click (new tab)", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await startSampling(page);
    // Cmd/Ctrl-click opens a new tab; the current page must not show progress.
    await page.click('header a[href="/bantuan"]', { modifiers: ["Meta"] }).catch(() => {});
    await page.waitForTimeout(500);
    const { sequence } = await stopSampling(page);
    expect(sequence.map((s) => s.state)).not.toContain("loading");
  });
});
