// ============================================================================
// Brand mark and the password reveal control.
//
// TWO REGRESSIONS THESE PIN:
//
//   1. The wordmark used to split as ITO + PUP, with the blue on "PUP". The
//      accented fragment is what the eye lands on, so the mark read as an
//      unfortunate word rather than as a top-up brand. The split is ITOP + UP
//      and the blue belongs to "UP" only. A test that only checked for
//      "ITOPUP" in the output would pass against the broken version, because
//      the rendered text was identical, so this asserts the SPAN BOUNDARY.
//
//   2. Every password field needs a reveal toggle in the corner of its input.
//      Five forms had a bare <input type="password">; the assertion is that
//      the control exists and that it starts masked, because a toggle that
//      defaults to visible would be worse than none.
// ============================================================================
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Logo from "../../src/components/layout/Logo.jsx";
import PasswordInput from "../../src/components/ui/PasswordInput.jsx";

describe("wordmark", () => {
  const html = renderToStaticMarkup(<Logo />);

  it("splits the name as ITOP + UP", () => {
    // React may insert <!-- --> between adjacent text nodes; strip comments
    // before looking for the span boundary.
    const clean = html.replace(/<!--.*?-->/g, "");
    expect(clean).toContain('<span class="text-brand-600 dark:text-brand-400">UP</span>');
  });

  it("never accents PUP", () => {
    const clean = html.replace(/<!--.*?-->/g, "");
    expect(clean).not.toContain(">PUP<");
    // And the whole name still reads ITOPUP.
    expect(clean.replace(/<[^>]+>/g, "")).toContain("ITOPUP");
  });
});

describe("PasswordInput", () => {
  it("starts masked and offers a reveal button", () => {
    const html = renderToStaticMarkup(
      <PasswordInput id="password" name="password" value="" onChange={() => {}} />
    );
    expect(html).toContain('type="password"');
    expect(html).toContain("Tampilkan password");
    // A reveal button inside a form must never submit it.
    expect(html).toContain('type="button"');
    // Room for the icon so a long password never runs under it.
    expect(html).toContain("pr-11");
  });

  it("carries the error state through to the input", () => {
    const html = renderToStaticMarkup(
      <PasswordInput id="password" name="password" value="" onChange={() => {}} invalid describedBy="password-error" />
    );
    expect(html).toContain("field-error");
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="password-error"');
  });
});
