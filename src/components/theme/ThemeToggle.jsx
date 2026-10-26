"use client";

// ============================================================================
// Theme toggle — ONE button that flips between light and dark.
//
// There used to be a three-way segmented control (Terang / Gelap / Sistem).
// "Sistem" is gone: the header now offers a single control, because a theme
// picker with three choices in a navigation bar is a settings panel, and the
// only decision a customer actually makes here is "dark or not dark".
//
// THE BUTTON SHOWS THE STATE IT IS IN, not the state it will switch to. It
// reads "Terang" with a sun while the page is light, "Gelap" with a moon while
// it is dark, and the icon is what a returning customer recognises at a glance.
// `aria-pressed` carries the same fact for assistive tech.
//
// `mounted` guard: the resolved theme is only known after hydration, so the
// control renders a neutral placeholder on the server. Without it the button
// flickers and React reports a hydration mismatch on `aria-pressed`.
// ============================================================================
import { useEffect, useState } from "react";
import { useTheme } from "./ThemeProvider";

export default function ThemeToggle({ variant = "labelled", className = "" }) {
  const { resolved, toggle } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // A fixed width, not a content width: the label changes from "Terang" to
  // "Gelap" on click, and a button that resizes under the pointer moves the
  // thing the customer is about to click next.
  if (!mounted) {
    return (
      <div
        className={`h-9 w-9 shrink-0 rounded-full border border-border bg-surface-muted sm:w-[5.75rem] ${className}`}
        aria-hidden="true"
      />
    );
  }

  const dark = resolved === "dark";
  const Icon = dark ? MoonIcon : SunIcon;
  const label = dark ? "Gelap" : "Terang";
  const nextLabel = dark ? "Terang" : "Gelap";

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-pressed={dark}
        aria-label={`Mode ${label}. Ganti ke mode ${nextLabel}.`}
        title={`Mode ${label}`}
        className={`btn-ghost h-9 w-9 rounded-full p-0 ${className}`}
      >
        <Icon className="h-4.5 w-4.5" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={dark}
      aria-label={`Mode ${label}. Ganti ke mode ${nextLabel}.`}
      title={`Mode ${label}`}
      className={[
        "inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-surface",
        "px-2.5 text-xs font-semibold text-foreground-muted transition-colors",
        "hover:bg-surface-muted hover:text-foreground",
        className,
      ].join(" ")}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function SunIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path strokeLinecap="round" d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function MoonIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
    </svg>
  );
}
