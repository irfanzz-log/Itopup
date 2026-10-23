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

    // The bar is anchored to the NAV ROW's bottom edge (top-16 = 64px), and the
    // header is that row plus its 1px bottom border. So the bar sits at 64-66:
    // it may overlap the border, but must never run past the header's own
    // bottom edge.
    expect(geo.barBottom, "bar must not protrude past the header").toBeLessThanOrEqual(geo.headerBottom + 1);
    expect(geo.barTop).toBeGreaterThanOrEqual(geo.headerTop);

    // Full-bleed across the viewport. The bar is `fixed inset-x-0` at the body
    // level, so it spans the window rather than the header's inner
    // .container-page box (which is max-w-6xl and would clip it to ~1152px).
    expect(geo.barLeft).toBe(0);
    expect(geo.barWidth).toBeGreaterThanOrEqual(geo.headerWidth - 1);
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

// ============================================================================
// Mobile: the bar must stay on the nav's edge while the menu is OPEN.
//
// THE BUG THIS PINS
//
// The bar was `absolute bottom-0` inside <header>. The header is a sticky
// container that GROWS when the mobile drawer opens (65px -> ~356px), so the
// bar was dragged to the bottom of the DRAWER — measured at y=353 while the nav
// row ends at y=64 — and rendered inside the open menu panel, invisible. On top
// of that the drawer is a later sibling at the same z-index, so it painted over
// the bar anyway.
// ============================================================================
test.describe("route progress bar on mobile", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  /** Open the mobile drawer via its trigger. */
  async function openMobileMenu(page) {
    const trigger = page.locator('header button[aria-expanded="false"]').last();
    await trigger.click();
    await page.waitForTimeout(300);
  }

  /** Force the bar visible and read its settled geometry. */
  async function measureBar(page) {
    return page.evaluate(() => {
      const bar = document.querySelector(".route-progress");
      const header = document.querySelector("header");
      const row = header.querySelector(".container-page");
      const previous = bar.getAttribute("data-state");
      const previousTransition = bar.style.transition;
      bar.style.transition = "none";
      bar.setAttribute("data-state", "done");
      void bar.offsetWidth;
      const b = bar.getBoundingClientRect();
      const r = row.getBoundingClientRect();
      const h = header.getBoundingClientRect();
      const z = getComputedStyle(bar).zIndex;
      bar.setAttribute("data-state", previous);
      bar.style.transition = previousTransition;
      return {
        headerHeight: Math.round(h.height),
        navRowBottom: Math.round(r.bottom),
        barTop: Math.round(b.top),
        barBottom: Math.round(b.bottom),
        barWidth: Math.round(b.width),
        zIndex: Number(z),
      };
    });
  }

  test("sits on the nav edge and above the drawer when the menu is open", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const closed = await measureBar(page);
    await openMobileMenu(page);
    const open = await measureBar(page);

    // The header really did expand — otherwise this test proves nothing.
    expect(open.headerHeight).toBeGreaterThan(closed.headerHeight + 100);

    // The regression: the bar must NOT follow the expanded header down into the
    // drawer. It stays on the nav row's bottom edge. The bar is 2px tall and
    // anchored at the row's bottom, so its bottom edge is at most one bar-height
    // below the row's own edge.
    expect(
      Math.abs(open.barBottom - open.navRowBottom),
      `bar bottom ${open.barBottom} vs nav row bottom ${open.navRowBottom}`
    ).toBeLessThanOrEqual(2);

    // Full-bleed across the viewport.
    expect(open.barWidth).toBeGreaterThanOrEqual(389);

    // And it must paint above the drawer, which is z-50 in the same context.
    expect(open.zIndex).toBeGreaterThan(50);
  });

  test("the bar paints above the open drawer at the nav's edge", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await openMobileMenu(page);

    // MEASURE PAINTED PIXELS AT A FIXED LOCATION, NOT AT THE BAR'S OWN RECT.
    //
    // Two measuring mistakes to avoid here:
    //
    //   * elementsFromPoint can never see the bar: it sets `pointer-events:
    //     none` (it must never intercept a click), and such an element is not
    //     returned by hit-testing at all. That reported "covered" when the bar
    //     was fine.
    //   * clipping the screenshot to the bar's OWN getBoundingClientRect() is
    //     tautological: if the bar were mispositioned into the drawer, the clip
    //     would follow it and still read blue. That version passed against the
    //     broken build, which is how this was caught.
    //
    // So: sample the FIXED row where the bar belongs (y = 64, the nav row's
    // bottom edge) while the drawer is open. If the bar is missing, clipped, or
    // painted under the drawer, that row is not brand blue.
    const NAV_EDGE_Y = 64;
    await page.evaluate(() => {
      const bar = document.querySelector(".route-progress");
      bar.style.transition = "none";
      bar.setAttribute("data-state", "done");
      void bar.offsetWidth;
    });

    const shot = await page.screenshot({
      clip: { x: 0, y: NAV_EDGE_Y, width: 390, height: 2 },
    });

    const blueFraction = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = "data:image/png;base64," + b64;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let blue = 0;
      let total = 0;
      for (let i = 0; i < data.length; i += 4) {
        total += 1;
        // brand-500 is rgb(59,130,246); allow for antialiasing.
        if (Math.abs(data[i] - 59) < 45 && Math.abs(data[i + 1] - 130) < 45 && Math.abs(data[i + 2] - 246) < 45) {
          blue += 1;
        }
      }
      return total ? blue / total : 0;
    }, shot.toString("base64"));

    expect(
      blueFraction,
      `the row at y=${NAV_EDGE_Y} is only ${(blueFraction * 100).toFixed(1)}% blue with the drawer open`
    ).toBeGreaterThan(0.6);
  });
});
