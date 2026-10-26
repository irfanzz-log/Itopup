// ============================================================================
// Theme: two states, one button, and a migration that does not blind anyone.
//
// WHAT THESE PIN, and why each one is a real defect if it breaks:
//
//   1. There is no "system" state left. The header has ONE button that flips
//      light ↔ dark, so a third value would be a state the UI cannot show and
//      cannot leave.
//
//   2. A visitor who saved "system" under the old three-way control must keep
//      the theme they were actually looking at. Dropping them into light mode
//      on a dark OS is the migration bug this guards.
//
//   3. `oppositeTheme` must be its own inverse. A one-way function here makes
//      the button work once and then stop.
//
//   4. THE INIT SCRIPT IS TESTED AS SOURCE, not executed: it runs before paint
//      in the browser, and the failure it prevents (a flash of the wrong
//      theme) is invisible to a test that only checks React state. If it stops
//      accepting "system", every existing visitor gets the wrong first paint.
// ============================================================================
import { describe, it, expect } from "vitest";
import {
  THEMES,
  normaliseStoredTheme,
  oppositeTheme,
  themeInitScript,
} from "../../src/components/theme/ThemeProvider.jsx";

describe("theme states", () => {
  it("offers exactly two themes", () => {
    expect(THEMES).toEqual(["light", "dark"]);
    expect(THEMES).not.toContain("system");
  });

  it("flips both ways", () => {
    expect(oppositeTheme("light")).toBe("dark");
    expect(oppositeTheme("dark")).toBe("light");
  });

  it("is its own inverse, so the button keeps working", () => {
    for (const theme of THEMES) {
      expect(oppositeTheme(oppositeTheme(theme))).toBe(theme);
    }
  });
});

describe("normaliseStoredTheme (migration off the old three-way control)", () => {
  it("keeps an explicit choice regardless of the OS", () => {
    expect(normaliseStoredTheme("light", true)).toBe("light");
    expect(normaliseStoredTheme("dark", false)).toBe("dark");
  });

  // The old default was "system". A visitor who never touched the control has
  // that value stored, and must land on what they were already seeing.
  it("resolves the old 'system' value to the OS preference", () => {
    expect(normaliseStoredTheme("system", true)).toBe("dark");
    expect(normaliseStoredTheme("system", false)).toBe("light");
  });

  it("resolves a missing or corrupt value to the OS preference", () => {
    expect(normaliseStoredTheme(null, true)).toBe("dark");
    expect(normaliseStoredTheme(undefined, false)).toBe("light");
    expect(normaliseStoredTheme("", true)).toBe("dark");
    expect(normaliseStoredTheme("sepia", false)).toBe("light");
  });
});

describe("themeInitScript (the blocking pre-paint script)", () => {
  it("accepts both explicit themes", () => {
    expect(themeInitScript).toContain("stored === 'light' || stored === 'dark'");
  });

  // If this regresses, the old "system" value falls through to the OS branch —
  // which is correct — but a script that instead defaulted to 'light' would
  // flash a light page for every dark-mode visitor on every navigation.
  it("falls back to the OS preference, not to light", () => {
    expect(themeInitScript).toContain("prefers-color-scheme: dark");
    expect(themeInitScript).toContain("prefersDark ? 'dark' : 'light'");
  });

  it("toggles the class the CSS tokens key on", () => {
    expect(themeInitScript).toContain("classList.toggle('dark'");
  });

  // localStorage throws in Safari private mode; a script that does not catch
  // it takes the whole page down before React ever runs.
  it("survives localStorage being unavailable", () => {
    expect(themeInitScript).toContain("try {");
    expect(themeInitScript).toContain("catch (e)");
  });
});
