"use client";

// ============================================================================
// Theme toggle.
//
// Renders a three-way segmented control on desktop and a single cycling button
// on mobile. The labels are explicit ("Terang"/"Gelap"/"Sistem") rather than
// icon-only, because an icon-only theme toggle is ambiguous to a lot of users,
// and `aria-label` alone does not help sighted ones.
//
// `mounted` guard: the resolved theme is only known after hydration, so the
// control renders a neutral placeholder on the server. Without this, the button
// flickers and React reports a hydration mismatch on the `aria-pressed` state.
// ============================================================================
import { useEffect, useState } from "react";
import { useTheme } from "./ThemeProvider";

const OPTIONS = [
  { value: "light", label: "Terang", icon: SunIcon },
  { value: "dark", label: "Gelap", icon: MoonIcon },
  { value: "system", label: "Sistem", icon: MonitorIcon },
];

export default function ThemeToggle({ variant = "segmented" }) {
  const { theme, resolved, setTheme, toggle } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <div
        className="h-9 w-[9.5rem] rounded-full border border-border bg-surface-muted"
        aria-hidden="true"
      />
    );
  }

  if (variant === "icon") {
    const next = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
    const Icon = resolved === "dark" ? MoonIcon : SunIcon;
    return (
      <button
        type="button"
        onClick={toggle}
        className="btn-ghost h-9 w-9 rounded-full p-0"
        title={`Tema: ${labelFor(theme)}. Klik untuk ${labelFor(next)}`}
        aria-label={`Tema saat ini ${labelFor(theme)}. Ganti ke ${labelFor(next)}.`}
      >
        <Icon className="h-4.5 w-4.5" />
      </button>
    );
  }

  return (
    <div
      role="group"
      aria-label="Pilih tema tampilan"
      className="inline-flex items-center gap-0.5 rounded-full border border-border bg-surface-muted p-0.5"
    >
      {OPTIONS.map((option) => {
        const active = theme === option.value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => setTheme(option.value)}
            aria-pressed={active}
            title={`Tema ${option.label}`}
            className={[
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
              active
                ? "bg-surface text-foreground shadow-sm"
                : "text-foreground-subtle hover:text-foreground",
            ].join(" ")}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function labelFor(theme) {
  return theme === "light" ? "terang" : theme === "dark" ? "gelap" : "sistem";
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

function MonitorIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path strokeLinecap="round" d="M8 21h8m-4-4v4" />
    </svg>
  );
}
