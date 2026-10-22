// ============================================================================
// JSON-LD must not be able to close its own <script> element.
//
// THE BUG THIS PINS
//
// <JsonLd> injects JSON.stringify(data) via dangerouslySetInnerHTML. A script
// element's body is RAW TEXT — the parser stops it at the first literal
// `</script`, and JSON.stringify does not escape `<` or `/`. So a catalogue name
// of `</script><img src=x onerror=alert(1)>` (typed by an operator in
// /dev/products, and echoed into the Product/Breadcrumb nodes) escaped the tag
// and injected executable markup on every game page.
//
// The render is done through react-dom/server, i.e. the real component, not a
// reimplementation of it.
// ============================================================================
import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import React from "react";

import JsonLd from "../../src/components/seo/JsonLd.jsx";
import { productJsonLd, breadcrumbJsonLd, faqJsonLd } from "../../src/lib/json-ld.js";

const HOSTILE = `</script><img src=x onerror=alert(1)>`;

/** The exact body the component writes into the tag. */
function scriptBody(html) {
  const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  return match ? match[1] : null;
}

describe("JsonLd escaping", () => {
  it("never emits a literal closing script tag from hostile data", () => {
    const html = renderToString(
      React.createElement(JsonLd, { data: productJsonLd({ name: HOSTILE, path: "/topup/x" }) })
    );

    // Exactly one opening and one closing tag: the injected one is gone.
    expect(html.match(/<\/script>/g)?.length).toBe(1);
    // No executable markup survives. The words "onerror"/"img" may remain as
    // inert text INSIDE the JSON string, which is harmless — what must not
    // exist is a real tag, i.e. an unescaped "<".
    expect(html).not.toContain("<img");
    const body = scriptBody(html);
    expect(body).not.toContain("<");
    expect(body).not.toContain(">");
  });

  it("keeps the JSON semantically identical after escaping", () => {
    const payload = productJsonLd({ name: HOSTILE, path: "/topup/x" });
    const html = renderToString(React.createElement(JsonLd, { data: payload }));
    const body = scriptBody(html);

    expect(body).toBeTruthy();
    // Parsed back, the value is exactly what went in — escaping is lossless.
    expect(JSON.parse(body)).toEqual(payload);
  });

  it("escapes hostile breadcrumb names too", () => {
    const trail = [
      { name: "Beranda", path: "/" },
      { name: HOSTILE, path: "/topup" },
    ];
    const html = renderToString(React.createElement(JsonLd, { data: breadcrumbJsonLd(trail) }));
    expect(html.match(/<\/script>/g)?.length).toBe(1);
    expect(JSON.parse(scriptBody(html))).toEqual(breadcrumbJsonLd(trail));
  });

  it("escapes hostile FAQ entries", () => {
    const html = renderToString(
      React.createElement(JsonLd, { data: faqJsonLd([{ q: HOSTILE, a: HOSTILE }]) })
    );
    expect(html.match(/<\/script>/g)?.length).toBe(1);
  });

  it("escapes a bare ampersand so the body stays valid raw text", () => {
    const html = renderToString(
      React.createElement(JsonLd, { data: { name: "Tom & Jerry <b>" } })
    );
    expect(scriptBody(html)).not.toContain("&");
    expect(scriptBody(html)).not.toContain("<b>");
  });

  it("still renders ordinary data unchanged", () => {
    const payload = { "@type": "Product", name: "Mobile Legends", price: 22000 };
    const body = scriptBody(renderToString(React.createElement(JsonLd, { data: payload })));
    expect(JSON.parse(body)).toEqual(payload);
  });

  it("renders nothing when there is no data", () => {
    expect(renderToString(React.createElement(JsonLd, { data: null }))).toBe("");
  });
});
