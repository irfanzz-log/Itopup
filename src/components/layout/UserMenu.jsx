"use client";

// ============================================================================
// Signed-in user menu.
//
// Logout posts to /api/auth/logout and then does a FULL navigation
// (window.location.assign) rather than router.push. Reason: the session cookie
// is HttpOnly and every server component on the next page reads it, so a client
// transition would re-use the already-rendered RSC payload in the router cache
// and briefly show the signed-in UI. A full load guarantees a clean state.
//
// The menu renders only what it was given: `user.role` decides whether the
// dashboard link exists. The server re-checks the role on that page regardless.
// ============================================================================
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { initials } from "@/lib/format";
import { ROLE_LABEL } from "@/lib/constants";

export default function UserMenu({ user }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
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

  async function logout() {
    setPending(true);
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
      });
    } finally {
      window.location.assign("/");
    }
  }

  const isStaff = user.role === "DEV" || user.role === "SUPERADMIN";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-full border border-border bg-surface py-1 pl-1 pr-2.5 text-sm font-medium text-foreground transition-colors hover:bg-surface-muted"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">
          {initials(user.name)}
        </span>
        <span className="hidden max-w-[7rem] truncate sm:inline">{user.name}</span>
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
            <p className="truncate text-sm font-semibold text-foreground">{user.name}</p>
            <p className="truncate text-xs text-foreground-subtle">{user.email}</p>
            <p className="mt-1.5 inline-flex rounded-full bg-brand-soft px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide text-brand-700 dark:text-brand-300">
              {ROLE_LABEL[user.role] ?? user.role}
            </p>
          </div>

          <div className="p-1.5">
            <MenuLink href="/member">Akun Saya</MenuLink>
            <MenuLink href="/member/orders">Riwayat Transaksi</MenuLink>
            <MenuLink href="/member/profile">Profil</MenuLink>
            {isStaff ? <MenuLink href="/dev/dashboard">Dashboard Dev</MenuLink> : null}
          </div>

          <div className="border-t border-border p-1.5">
            <button
              type="button"
              role="menuitem"
              onClick={logout}
              disabled={pending}
              className="flex w-full items-center gap-2.5 rounded-[var(--radius-control)] px-3 py-2 text-left text-sm font-medium text-danger-fg transition-colors hover:bg-danger-bg disabled:opacity-60"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m5 5H9" />
              </svg>
              {pending ? "Keluar…" : "Keluar"}
            </button>
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
    </Link>
  );
}
