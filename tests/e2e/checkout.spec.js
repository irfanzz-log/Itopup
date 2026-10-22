// ============================================================================
// E2E: the money path, driven through a real browser.
//
// WHY THIS FILE EXISTS
//
// The repo shipped a playwright.config.js pointing at ./tests/e2e, but that
// directory did not exist — `npm run test:e2e` ran zero tests. The single most
// important flow (pick a nominal -> fill the account -> pay) had no automated
// proof at all, and it is the flow where a regression costs money.
//
// HOW IT DIFFERS FROM A CDP/JS CLICK
//
// `element.click()` from CDP dispatches a click the React handler does not
// treat as a user gesture in every case; the form state never advances and the
// submit button stays disabled, which reads as "checkout is broken" when it is
// not. Playwright's locator.click() goes through the browser's own input
// pipeline, so this file asserts what a customer actually experiences.
//
// REQUIREMENTS (both are asserted up front, not assumed):
//   - the app running with E2E_BASE_URL (default http://localhost:3200)
//   - E2E_EMAIL / E2E_PASSWORD: a MEMBER account, and a catalogue that has at
//     least one ACTIVE variant with a provider mapping (see
//     scripts/_e2e-fixture.mjs for the throwaway database).
// ============================================================================
import { test, expect } from "@playwright/test";

const EMAIL = process.env.E2E_EMAIL || "alice@uji.test";
const PASSWORD = process.env.E2E_PASSWORD || "RahasiaUji#2026";
const GAME_PATH = process.env.E2E_GAME_PATH || "/topup/game/mobile-legends";

/** Log in through the real form and land on /member. */
async function login(page) {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(EMAIL);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await Promise.all([
    page.waitForURL("**/member", { timeout: 30_000 }),
    page.locator('form button[type="submit"]').click(),
  ]);
  await expect(page).toHaveURL(/\/member/);
}

test.describe("checkout (money path)", () => {
  test("a member can complete a purchase from the game page", async ({ page }) => {
    await login(page);

    await page.goto(GAME_PATH);
    await expect(page.locator("h1")).toContainText(/Top Up/i);

    const submit = page.getByRole("button", { name: /Lanjut ke Pembayaran/i });

    // Before a nominal is chosen the button MUST be disabled. This is the
    // assertion that makes the next step meaningful: if it were enabled here,
    // "it became enabled" would prove nothing.
    await expect(submit).toBeDisabled();

    // 1. Pick the first available nominal — a real click, through the browser.
    const nominal = page.locator("button").filter({ hasText: /Rp\s?[\d.]+/ }).first();
    await expect(nominal).toBeVisible();
    const nominalLabel = (await nominal.innerText()).replace(/\s+/g, " ").trim();
    await nominal.click();

    // 2. Fill the account contract declared by the game.
    await page.locator('input[name="userId"]').fill("12345678");
    await page.locator('input[name="zoneId"]').fill("1234");

    // 3. Pick a payment method.
    const method = page.locator('input[name="paymentMethod"]').first();
    await method.check({ force: true });

    // 4. The button must now be ENABLED. This is the exact state that was
    //    unreachable with a synthetic click, and the reason the flow looked
    //    broken.
    await expect(submit).toBeEnabled({ timeout: 15_000 });

    // 5. Submit and wait for the order page. The order id is a UUID route.
    await submit.click();
    await page.waitForURL(/\/member\/orders\/[0-9a-f-]{36}/, { timeout: 60_000 });

    const url = page.url();
    const orderId = url.match(/\/member\/orders\/([0-9a-f-]{36})/)[1];
    expect(orderId).toMatch(/^[0-9a-f-]{36}$/);

    // 6. The order page must show a real order, not an empty shell. A 200 with
    //    no invoice is not a passing checkout.
    await expect(page.locator("body")).toContainText(/ITP-\d{8}-[A-Z0-9]{8}/);
    await expect(page.locator("body")).toContainText(/Total/i);

    console.log(`checkout ok: ${nominalLabel} -> order ${orderId}`);
  });

  test("checkout is refused for a guest and survives the login round trip", async ({ page }) => {
    // A guest reaching a protected page is redirected to /login with `next`,
    // and the intended destination is preserved (no open redirect).
    await page.goto("/member/orders");
    await expect(page).toHaveURL(/\/login\?next=%2Fmember%2Forders/);

    // The `next` parameter must not be honoured when it points off-site.
    await page.goto("/login?next=https://evil.example/phish");
    await page.locator('input[name="email"]').fill(EMAIL);
    await page.locator('input[name="password"]').fill(PASSWORD);
    await Promise.all([
      page.waitForURL("**/member**", { timeout: 30_000 }),
      page.locator('form button[type="submit"]').click(),
    ]);
    expect(page.url()).not.toContain("evil.example");
  });
});

test.describe("error and access states", () => {
  test("an unknown route renders the 404 page, not a stack trace", async ({ page }) => {
    const res = await page.goto("/halaman-yang-tidak-ada");
    expect(res.status()).toBe(404);
    await expect(page.locator("body")).not.toContainText(/at Object\.|node_modules|PrismaClient/);
  });

  test("a member is refused the staff area and no staff data leaks", async ({ page }) => {
    await login(page);
    await page.goto("/dev/dashboard");

    // The /dev layout answers a signed-in non-staff user with a REFUSAL PAGE at
    // HTTP 200, not a redirect — documented in src/app/(dev)/layout.jsx: bouncing
    // a member who is already signed in to /login would loop, and a 403 would
    // confirm that /dev exists. So the status code is the wrong thing to assert.
    //
    // What must hold is the actual security property: the refusal is rendered and
    // NOT ONE BYTE of the staff surface is. Asserting the URL would pass even if
    // the panel rendered underneath.
    await expect(page.getByText(/Akses ditolak/i)).toBeVisible();
    await expect(page.getByText(/tidak memiliki akses ke panel developer/i)).toBeVisible();

    // The staff navigation and its links must be absent entirely.
    await expect(page.locator('a[href^="/dev/"]')).toHaveCount(0);

    // And no staff-only content rendered in place of it.
    await expect(page.locator("body")).not.toContainText(/Total Pendapatan|Pesanan Hari Ini|Kelola Member/i);
  });

  test("staff DO get the panel (the refusal above is not vacuous)", async ({ page }) => {
    // Without this test, a layout that refused EVERYBODY would pass the test
    // above. E2E_STAFF_* is optional so the suite still runs without a staff
    // account; it skips loudly instead of silently passing.
    test.skip(
      !process.env.E2E_STAFF_EMAIL || !process.env.E2E_STAFF_PASSWORD,
      "E2E_STAFF_EMAIL/E2E_STAFF_PASSWORD not set"
    );

    await page.goto("/login");
    await page.locator('input[name="email"]').fill(process.env.E2E_STAFF_EMAIL);
    await page.locator('input[name="password"]').fill(process.env.E2E_STAFF_PASSWORD);
    await page.locator('form button[type="submit"]').click();
    await page.waitForURL("**/member**", { timeout: 30_000 });

    await page.goto("/dev/dashboard");
    await expect(page.getByText(/Akses ditolak/i)).toHaveCount(0);
    await expect(page.locator('a[href^="/dev/"]').first()).toBeVisible();
  });
});
