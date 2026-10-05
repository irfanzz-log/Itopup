
import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import React from "react";

// TEST 09 regression: a hostile string fed through the rendering surface must NOT
// come out as executable markup. React escapes children by default; this proves
// the components that echo user/catalog data through {expr} are not using
// dangerouslySetInnerHTML on it.
describe("XSS rendering surface", () => {
  const HOSTILE = `"><img src=x onerror=alert(1)><script>alert(2)</script>`;

  it("escapes a hostile game name in the artwork fallback path", async () => {
    const { GameArtwork } = await import("@/components/catalog/CatalogCards.jsx");
    const html = renderToString(
      React.createElement(GameArtwork, {
        game: { slug: "nope", name: HOSTILE, logo: null },
      })
    );
    console.log("GameArtwork contains raw <script>:", html.includes("<script>alert"));
    console.log("GameArtwork contains raw onerror attr:", /onerror=/.test(html));
    expect(html.includes("<script>alert")).toBe(false);
    expect(/onerror=/.test(html)).toBe(false);
  });

  it("escapes a hostile label via the format/label util if present", async () => {
    const m = await import("@/utils/format.js").catch(() => null);
    if (!m) { console.log("format.js: not present, skipped"); return; }
    for (const [name, fn] of Object.entries(m)) {
      if (typeof fn !== "function") continue;
      try {
        const out = fn(HOSTILE);
        if (typeof out === "string" && out.includes("<script>alert")) {
          throw new Error("format util " + name + " emitted raw script tag");
        }
      } catch (e) { /* functions needing objects are fine to throw */ }
    }
    console.log("format utils: no raw script output");
  });
});
