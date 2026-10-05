"use client";

// ============================================================================
// Theme provider.
//
// Three states: "light", "dark", "system". The resolved theme is written to
// <html class="dark"> so the CSS tokens switch.
//
// FOUC: the class must be applied before first paint. A server-rendered page
// cannot know the client's preference, so the initial class is set by a tiny
// inline script in the root layout (see `themeInitScript`). This provider then
// takes over and keeps localStorage + <html> in sync.
//
// `suppressHydrationWarning` on <html> is required: the inline script changes
// the class before React hydrates, which React would otherwise flag as a
// mismatch.
// ============================================================================
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "itopup-theme";

export const THEMES = ["light", "dark", "system"];

const ThemeContext = createContext({
  theme: "system",
  resolved: "light",
  setTheme: () => {},
  toggle: () => {},
});

/** The blocking script injected into <head>. Kept minimal, it runs before paint. */
export const themeInitScript = `
(function () {
  try {
    var stored = localStorage.getItem('${STORAGE_KEY}');
    var theme = stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
    var dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.dataset.theme = theme;
  } catch (e) { /* localStorage disabled, fall back to the CSS default */ }
})();
`;

function systemPrefersDark() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyTheme(theme) {
  const dark = theme === "dark" || (theme === "system" && systemPrefersDark());
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.dataset.theme = theme;
  return dark ? "dark" : "light";
}

export function ThemeProvider({ children }) {
  // Start from "system" on both server and first client render so the markup
  // matches; the effect below reconciles with the real preference.
  const [theme, setThemeState] = useState("system");
  const [resolved, setResolved] = useState("light");

  useEffect(() => {
    let stored = "system";
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === "light" || raw === "dark" || raw === "system") stored = raw;
    } catch {
      /* private mode */
    }
    setThemeState(stored);
    setResolved(applyTheme(stored));
  }, []);

  // Follow the OS while in "system" mode.
  useEffect(() => {
    if (theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setResolved(applyTheme("system"));
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [theme]);

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

  /** Cycle light → dark → system, for the compact header button. */
  const toggle = useCallback(() => {
    setThemeState((current) => {
      const next = current === "light" ? "dark" : current === "dark" ? "system" : "light";
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
