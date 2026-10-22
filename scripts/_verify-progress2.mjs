// VERIFY v2 — progress bar, WebKit (Safari engine).
//
// Regression targets, from the user's report:
//   "sudah masuk ke page tapi loading masih berjalan, saat tekan nav lain baru
//    selesai"  → the bar must reach hidden shortly after every landing, on
//                EVERY navigation (not just the first), and must stay hidden.
//   "bar tidak mengikuti nav saat scroll" → the bar must be a child of <header>
//                and share its bottom edge at page top, mid-scroll, and pinned.
//
// A) fast apiFetch (< SHOW_DELAY_MS): bar must NEVER become visible at all.
// B) slow nav (1.8s): loading while pending → settles hidden, stays hidden.
// C) 5 navigations back to back, mixed speeds: hidden after each landing.
// D) placement + scroll to the very bottom of the page.
// E) slow apiFetch (login): full cycle, and login must still work.
import { webkit } from "playwright";

const BASE = "http://localhost:3000";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS ok" : "FAIL xx"}  ${name}${detail ? `  ${detail}` : ""}`);
};

const browser = await webkit.launch();
const page = await (await browser.newContext()).newPage();

const barState = () =>
  page.evaluate(() => document.querySelector(".route-progress")?.getAttribute("data-state") ?? "(no bar)");

/** Sample the bar every 50ms for `ms`; returns the set of states seen. */
async function sample(ms) {
  const seen = new Set();
  const until = Date.now() + ms;
  while (Date.now() < until) {
    seen.add(await barState());
    await page.waitForTimeout(50);
  }
  return seen;
}

/** Poll until hidden (max `ms`); returns ms elapsed or -1. */
async function waitHidden(ms = 2500) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if ((await barState()) === "hidden") return Date.now() - t0;
    await page.waitForTimeout(25);
  }
  return -1;
}

const ensureCsrf = () =>
  page.evaluate(() => {
    if (!/(?:^|;\s*)itp_csrf=/.test(document.cookie)) {
      const t = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
      document.cookie = `itp_csrf=${t}; path=/; SameSite=Lax`;
    }
  });

/**
 * Wait until React has hydrated the form.
 *
 * Filling before hydration sets the DOM value only; hydration then re-renders
 * the controlled input from React state and wipes it, so the form submits an
 * empty payload and the API answers 422. That looks exactly like a login bug
 * but is a test-timing artifact — a real user cannot type that fast. Probe by
 * round-tripping a value through the input: it survives only once React owns it.
 */
async function waitHydrated(sel = "#email") {
  for (let i = 0; i < 60; i++) {
    await page.fill(sel, "probe");
    const echoed = await page.inputValue(sel);
    await page.fill(sel, "");
    if (echoed === "probe") return true;
    await page.waitForTimeout(100);
  }
  return false;
}

// ── A) fast apiFetch: 401 inside the 120ms show-delay window ───────────────
// This is the exact shape that used to leak the show-timer: pending starts and
// ends before the bar is allowed to appear. The response is stubbed so the
// timing is deterministic — a real dev-server round trip can straddle the
// 120ms threshold (route compilation on the first hit), which would make the
// bar legitimately appear and turn this into a flaky assertion.
const stubFast401 = (route) =>
  route.fulfill({
    status: 401,
    contentType: "application/json",
    body: JSON.stringify({ success: false, error: { code: "ITP_UNAUTHORIZED", message: "Email atau password salah." } }),
  });
await page.route("**/api/auth/login", stubFast401);

await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#email");
await waitHydrated();
await ensureCsrf();
await page.fill("#email", "wrong-fast@itopup.local");
await page.fill("#password", "definitely-not-the-password");
const tFast = Date.now();
await page.click('button[type="submit"]');
const seenFast = await sample(1600);
console.log(`A) fast apiFetch (${Date.now() - tFast}ms window) states seen:`, [...seenFast].join(",") || "(none)");
check("A1 fast request never shows the bar", !seenFast.has("loading"), `saw=${[...seenFast]}`);
check("A2 bar is hidden afterwards", (await barState()) === "hidden");

// Second fast request: a leaked show-timer from the first would surface here
// (the bar would appear on an idle page, with no request in flight).
await page.fill("#password", "still-wrong");
await page.click('button[type="submit"]');
const seenFast2 = await sample(1200);
console.log("A) second fast request states seen:", [...seenFast2].join(",") || "(none)");
check(
  "A3 a second fast request does not leak the show-timer",
  !seenFast2.has("loading") && (await barState()) === "hidden",
  `saw=${[...seenFast2]}`
);
await page.unroute("**/api/auth/login", stubFast401);

// ── D) placement ───────────────────────────────────────────────────────────
const place = await page.evaluate(() => {
  const header = document.querySelector("header");
  const bar = document.querySelector(".route-progress");
  if (!header || !bar) return { ok: false };
  const h = header.getBoundingClientRect();
  const b = bar.getBoundingClientRect();
  return {
    ok: bar.parentElement === header && Math.abs(h.bottom - b.bottom) <= 2,
    parent: bar.parentElement?.tagName,
    headerBottom: Math.round(h.bottom),
    barBottom: Math.round(b.bottom),
  };
});
console.log("D) placement at top:", JSON.stringify(place));
check("D1 bar is a child of <header>, flush with its bottom edge", place.ok, JSON.stringify(place));

await page.goto(`${BASE}/promo`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(400);
const scrolled = await page.evaluate(() => {
  window.scrollTo(0, document.body.scrollHeight); // "pojok bawah"
  const header = document.querySelector("header").getBoundingClientRect();
  const bar = document.querySelector(".route-progress").getBoundingClientRect();
  return {
    headerTop: Math.round(header.top),
    headerBottom: Math.round(header.bottom),
    barBottom: Math.round(bar.bottom),
  };
});
await page.waitForTimeout(200);
console.log("D) scrolled to bottom:", JSON.stringify(scrolled));
check(
  "D2 bar follows the nav at page bottom",
  scrolled.headerTop === 0 && Math.abs(scrolled.barBottom - scrolled.headerBottom) <= 2,
  JSON.stringify(scrolled)
);

// ── B) slow nav ────────────────────────────────────────────────────────────
await page.route("**/bantuan*", async (route) => {
  await new Promise((r) => setTimeout(r, 1800));
  await route.continue();
});
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(600);
await page.click('header a[href="/bantuan"]');
await page.waitForTimeout(700);
const duringSlow = await barState();
console.log("B) during slow nav:", duringSlow, "(expect loading)");
check("B1 bar shows loading during a slow navigation", duringSlow === "loading");

await page.waitForURL("**/bantuan", { timeout: 15000 });
const settleMs = await waitHidden(2500);
console.log(`B) after landing -> hidden in ${settleMs}ms`);
check("B2 bar reaches hidden right after landing", settleMs >= 0, `${settleMs}ms`);
await page.waitForTimeout(3000);
const stillHidden = await barState();
console.log("B) +3s later:", stillHidden, "(must stay hidden - the old bug crawled here)");
check("B3 bar stays hidden 3s after landing", stillHidden === "hidden");
await page.unroute("**/bantuan*");

// ── C) five navigations back to back ──────────────────────────────────────
// The report was "tidak konsisten": sometimes fine, sometimes stuck. Exercise
// alternating fast and slow transitions and assert the same contract each time.
const hops = [
  { href: "/promo", delay: 0 },
  { href: "/bantuan", delay: 900 },
  { href: "/promo", delay: 0 },
  { href: "/bantuan", delay: 1600 },
  { href: "/", delay: 0 },
];
let hopOk = 0;
// One handler per pattern with a mutable delay: re-registering the same route
// per hop made Playwright hand the request to a handler that was already
// resolved ("Route is already handled"). try/catch keeps a double-handled
// request from aborting the whole run.
let hopDelay = 0;
const hopHandler = async (route) => {
  if (hopDelay) await new Promise((r) => setTimeout(r, hopDelay));
  try {
    await route.continue();
  } catch {
    /* already continued by the other matching handler */
  }
};
await page.route("**/bantuan*", hopHandler);
await page.route("**/promo*", hopHandler);
for (const [i, hop] of hops.entries()) {
  hopDelay = hop.delay;
  const sel = hop.href === "/" ? 'header a[aria-label="ITOPUP beranda"]' : `header a[href="${hop.href}"]`;
  await page.click(sel);
  await page.waitForTimeout(hop.delay ? 500 : 60);
  const mid = await barState();
  await page.waitForURL((u) => new URL(hop.href, BASE).pathname === u.pathname, { timeout: 15000 });
  const settled = await waitHidden(2500);
  const seen = await sample(700);
  const clean = settled >= 0 && !seen.has("loading") && (await barState()) === "hidden";
  if (clean) hopOk++;
  console.log(
    `C${i + 1}) ${hop.href} delay=${hop.delay}ms  mid=${mid}  hidden-in=${settled}ms  after=[${[...seen].join(",")}]  ${clean ? "ok" : "STUCK"}`
  );
}
hopDelay = 0;
await page.unroute("**/bantuan*", hopHandler);
await page.unroute("**/promo*", hopHandler);
check("C1 all 5 navigations settle to hidden and stay hidden", hopOk === hops.length, `${hopOk}/${hops.length}`);

// ── E) slow apiFetch full cycle still works (login) ────────────────────────
await page.route("**/api/auth/login", async (route) => {
  await new Promise((r) => setTimeout(r, 1500));
  try {
    await route.continue();
  } catch {
    /* already continued */
  }
});
await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#email");
await waitHydrated();
await ensureCsrf();
await page.fill("#email", "qa-safari@itopup.local");
await page.fill("#password", "QaSafari#2026x");
await page.click('button[type="submit"]');
await page.waitForTimeout(600);
const duringLogin = await barState();
await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 });
const loginSettle = await waitHidden(2500);
const signedIn = await page.evaluate(() => document.querySelector("header")?.innerText.includes("QA Safari"));
console.log(`E) login: during=${duringLogin} hidden-in=${loginSettle}ms signedIn=${signedIn}`);
check("E1 slow apiFetch shows loading then settles hidden", duringLogin === "loading" && loginSettle >= 0);
check("E2 login still lands signed in (no regression)", Boolean(signedIn));

const failed = results.filter((r) => !r.ok);
console.log(
  `\nVERDICT: ${failed.length === 0 ? "ALL PASS" : `${failed.length} FAIL`}  (${results.length - failed.length}/${results.length})`
);
await browser.close();
process.exit(failed.length === 0 ? 0 : 1);
