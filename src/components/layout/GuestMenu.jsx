"use client";

// ============================================================================
// Guest menu — the anonymous counterpart of UserMenu.jsx .
//
// Rendered in the exact same slot as <UserMenu> so the header never shifts
// between \"anon\" and \"signed in\". The button mirrors UserMenu's dimensions,
// border and hover state; the dropdown mirrors its card, radius and shadow.
// Clicking Login/Daftar carries a validated ?next= so the customer lands back
// on the product/checkout page they came from.
//
// Covers both desktop and mobile triggers: on desktop it appears in the right
// side cluster next to ThemeToggle; on mobile it is also reachable via the
// drawer buttons (kept as fallback) so no viewport loses the affordance.
// ============================================================================
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { NavProbe } from "./RouteProgress";

export default function GuestMenu({ nextPath }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === "Escape") setOpen(false);
    }
    function onPointerDown(event) {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  // nextPath is already validated by the caller (pathname + search, starts
  // with /). Only append when it is not the anonymous landing itself (/login,
  // /register) — redirecting back to the login page after login is a loop.
  const safeNext = nextPath && nextPath.startsWith("/") && !nextPath.startsWith("/login") && !nextPath.startsWith("/register") ? nextPath : null;
  const loginHref = safeNext ? `/login?next=${encodeURIComponent(safeNext)}` : "/login";
  const registerHref = safeNext ? `/register?next=${encodeURIComponent(safeNext)}` : "/register";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Menu akun"
        className="flex items-center gap-2 rounded-full border border-border bg-surface py-1 pl-1 pr-2.5 text-sm font-medium text-foreground transition-colors hover:bg-surface-muted"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-muted text-foreground-subtle">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.5 19.5a7.5 7.5 0 0 1 15 0v.75a1.5 1.5 0 0 1-1.5 1.5h-12A1.5 1.5 0 0 1 4.5 20.25V19.5Z" />
          </svg>
        </span>
        <span className="hidden max-w-[7rem] truncate sm:inline">Guest</span>
        <svg className="h-3.5 w-3.5 text-foreground-subtle" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface shadow-xl"
        >
          <div className="border-b border-border px-4 py-3">
            <p className="text-sm font-semibold text-foreground">Belum masuk</p>
            <p className="mt-0.5 text-xs text-foreground-subtle">Masuk untuk melanjutkan transaksi</p>
          </div>
          <div className="p-1.5">
            <MenuLink href={loginHref}>Masuk</MenuLink>
            <MenuLink href={registerHref}>Daftar</MenuLink>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MenuLink({ href, children }) {
  return (
    <Link
      href={href}
      role="menuitem"
      className="block rounded-[var(--radius-control)] px-3 py-2 text-sm font-medium text-foreground-muted transition-colors hover:bg-surface-muted hover:text-foreground"
    >
      {children}
      <NavProbe />
    </Link>
  );
}
