"use client";

// ============================================================================
// Theme provider.
//
// TWO states, not three: "light" and "dark". There is no "system" mode any
// more — the header offers exactly one button that flips between the two, so
// a stored preference is always one of them.
//
// The resolved theme is written to <html class="dark"> so the CSS tokens
// switch.
//
// FOUC: the class must be applied before first paint. A server-rendered page
// cannot know the client's preference, so the initial class is set by a tiny
// inline script in the root layout (see `themeInitScript`). This provider then
// takes over and keeps localStorage + <html> in sync.
//
// MIGRATING THE OLD "system" VALUE: a visitor who saved "system" before this
// change must not be dumped into light mode on a dark OS, so anything that is
// not a valid explicit theme resolves to the OS preference ONCE and is then
// persisted as that explicit value. After the first load there is no "system"
// state left to resolve.
//
// `suppressHydrationWarning` on <html> is required: the inline script changes
// the class before React hydrates, which React would otherwise flag as a
// mismatch.
// ============================================================================
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "itopup-theme";

export const THEMES = ["light", "dark"];

const ThemeContext = createContext({
  theme: "light",
  resolved: "light",
  setTheme: () => {},
  toggle: () => {},
});

/**
 * The colour the browser paints its own chrome with, per theme. Kept in sync
 * with --background in globals.css; a mismatch shows as a light strip above a
 * dark page in mobile Safari.
 */
const CHROME_COLOR = { light: "#f7f9fc", dark: "#070d19" };

/**
 * Turn a stored value into a real theme.
 *
 * `system`, a missing key, and anything unrecognised all resolve to the OS
 * preference. This is the migration path off the old three-way control, so it
 * must be able to answer without a DOM read when the caller supplies one.
 */
export function normaliseStoredTheme(raw, prefersDark) {
  if (raw === "light" || raw === "dark") return raw;
  return prefersDark ? "dark" : "light";
}

/** The other theme. Two states, so this is its own inverse. */
export function oppositeTheme(theme) {
  return theme === "dark" ? "light" : "dark";
}

/** The blocking script injected into <head>. Kept minimal, it runs before paint. */
export const themeInitScript = `
(function () {
  try {
    var stored = localStorage.getItem('${STORAGE_KEY}');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var theme = stored === 'light' || stored === 'dark' ? stored : (prefersDark ? 'dark' : 'light');
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.dataset.theme = theme;
  } catch (e) { /* localStorage disabled, fall back to the CSS default */ }
})();
`;

function systemPrefersDark() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * Apply a theme to the document and report what was applied.
 *
 * Also repaints the browser chrome: the static theme-color metas in the layout
 * are keyed on `prefers-color-scheme`, which is the OS setting, not this
 * toggle. Without this a customer who picks dark on a light OS keeps a light
 * address bar above a dark page.
 */
function applyTheme(theme) {
  const next = theme === "dark" ? "dark" : "light";
  document.documentElement.classList.toggle("dark", next === "dark");
  document.documentElement.dataset.theme = next;

  const color = CHROME_COLOR[next];
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.setAttribute("content", color);
  }
  return next;
}

export function ThemeProvider({ children }) {
  // Start from "light" on both server and first client render so the markup
  // matches; the effect below reconciles with the real preference.
  const [theme, setThemeState] = useState("light");
  const [resolved, setResolved] = useState("light");

  useEffect(() => {
    let raw = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch {
      /* private mode */
    }

    const stored = normaliseStoredTheme(raw, systemPrefersDark());
    setThemeState(stored);
    setResolved(applyTheme(stored));

    // One-time migration: persist the resolved value so the OS is never
    // consulted again and a later OS flip cannot silently change the theme
    // under a customer who already chose one.
    if (raw !== stored) {
      try {
        localStorage.setItem(STORAGE_KEY, stored);
      } catch {
        /* preference simply will not persist */
      }
    }
  }, []);

  const setTheme = useCallback((next) => {
    if (!THEMES.includes(next)) return;
    setThemeState(next);
    setResolved(applyTheme(next));
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* preference simply will not persist */
    }
  }, []);

  /** Flip light ↔ dark. This is what the header button calls. */
  const toggle = useCallback(() => {
    setThemeState((current) => {
      const next = oppositeTheme(current);
      setResolved(applyTheme(next));
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const value = useMemo(() => ({ theme, resolved, setTheme, toggle }), [theme, resolved, setTheme, toggle]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

export { STORAGE_KEY as THEME_STORAGE_KEY };
