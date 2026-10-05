// ============================================================================
// Regression test — D1/D2/D3: Date.now() during React render
//
// Baseline (before this fix): `npm run lint` reported 4 errors, all from
// react-hooks purity rules triggered by calling Date.now() during render. Two
// of those were in SERVER components, so the server and the browser evaluated
// the clock a few hundred milliseconds apart and React logged a hydration
// mismatch on `/member/orders/[id]` and the promo strip.
//
// The guard uses the same ESLint engine the project's own `npm run lint` uses,
// rather than a text scan, because a text scan cannot distinguish an impure
// render call from the legitimate forms (an event handler, an effect body, or
// a useState initializer). It asserts zero ERRORS on the files that were
// affected plus the two new components, so any future impure render call in
// them fails this test.
// ============================================================================
import { describe, it, expect } from "vitest";
import { ESLint } from "eslint";
import { join } from "node:path";

const TARGETS = [
  "src/app/(member)/member/orders/[id]/page.jsx",
  "src/components/member/DeadlineNote.jsx",
  "src/components/promo/PromoStrip.jsx",
  "src/components/topup/MyVouchers.jsx",
];

const eslint = new ESLint({ cwd: process.cwd() });

describe("D1/D2/D3 — no impure Date.now() during React render", () => {
  it("the four defect sites report zero ESLint errors", async () => {
    const results = await eslint.lintFiles(TARGETS);
    const errors = results.flatMap((r) =>
      r.messages
        .filter((m) => m.severity === 2)
        .map((m) => `${r.filePath.replace(process.cwd(), "")}:${m.line} ${m.message}`)
    );
    expect(errors).toEqual([]);
  });

  it("the full src/ tree reports zero errors (baseline was 4)", async () => {
    const results = await eslint.lintFiles(["src/**/*.{js,jsx}"]);
    const errors = results.flatMap((r) =>
      r.messages
        .filter((m) => m.severity === 2)
        .map((m) => `${r.filePath.replace(process.cwd(), "")}:${m.line} ${m.message}`)
    );
    expect(errors).toEqual([]);
  });
});
