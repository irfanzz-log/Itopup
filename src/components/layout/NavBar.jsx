"use client";

// ============================================================================
// Top navigation.
//
// Client component because it owns two pieces of interactive state: the mobile
// drawer and the "Top Up" mega-menu. It receives its data as props from a server
// component (SiteHeader), it never fetches, so the nav renders without a
// request waterfall.
//
// The member menu is only rendered when `user` is non-null. The server decides
// that; this component just does not render what it was not given. A client-side
// "isLoggedIn" flag would be cosmetic, the real gate is the server layout.
// ============================================================================
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Logo from "./Logo";
import ThemeToggle from "@/components/theme/ThemeToggle";
import UserMenu from "./UserMenu";

export default function NavBar({ user, categories, popularGames }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [topupOpen, setTopupOpen] = useState(false);
  const menuRef = useRef(null);
  const toggleRef = useRef(null);
  const topupRef = useRef(null);

  // Close every overlay on navigation, otherwise the drawer stays open behind
  // the new page.
  useEffect(() => {
    setMobileOpen(false);
    setTopupOpen(false);
  }, [pathname]);

  // Escape closes; click outside closes. Both are keyboard/pointer basics.
  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === "Escape") {
        setMobileOpen(false);
        setTopupOpen(false);
      }
    }
    function onPointerDown(event) {
      // The hamburger owns its own state: a tap on it toggles, it must not also
      // be read as an outside-tap. Without this exemption, one tap opened the
      // drawer and the same pointerdown immediately closed it again, the menu
      // could never be dismissed from the button.
      if (toggleRef.current && toggleRef.current.contains(event.target)) return;
      if (menuRef.current && !menuRef.current.contains(event.target)) setMobileOpen(false);
      if (topupRef.current && !topupRef.current.contains(event.target)) setTopupOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  // Lock body scroll while the mobile drawer is open.
  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mobileOpen]);

  const isActive = (href) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface/90 backdrop-blur supports-[backdrop-filter]:bg-surface/75">
      <div className="container-page flex h-16 items-center justify-between gap-4">
        <Logo />

        {/* ── Desktop navigation ─────────────────────────────────────────── */}
        <nav className="hidden items-center gap-1 lg:flex" aria-label="Navigasi utama">
          <div className="relative" ref={topupRef}>
            <button
              type="button"
              onClick={() => setTopupOpen((v) => !v)}
              aria-expanded={topupOpen}
              aria-haspopup="true"
              className={[
                "inline-flex items-center gap-1.5 rounded-[var(--radius-control)] px-3.5 py-2 text-sm font-medium transition-colors",
                isActive("/topup")
                  ? "bg-brand-soft text-brand-700 dark:text-brand-300"
                  : "text-foreground-muted hover:bg-surface-muted hover:text-foreground",
              ].join(" ")}
            >
              Top Up
              <svg
                className={`h-3.5 w-3.5 transition-transform ${topupOpen ? "rotate-180" : ""}`}
                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
              </svg>
            </button>

            {topupOpen ? (
              <div className="absolute left-0 top-full z-50 mt-2 w-[42rem] rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-xl">
                <div className="grid grid-cols-3 gap-5">
                  {categories.map((category) => (
                    <div key={category.kind}>
                      <Link
                        href={category.path}
                        className="text-xs font-bold uppercase tracking-wide text-brand-600 dark:text-brand-400 hover:underline"
                      >
                        {category.name}
                      </Link>
                      <ul className="mt-2.5 space-y-1.5">
                        {/* listGamesGrouped returns `entries`, for PULSA those are
                            the OPERATORS (Telkomsel, XL, …), not the bare "Pulsa"
                            game. Reading `games` here showed one "Pulsa" link and
                            hid every provider. */}
                        {(category.entries ?? category.games ?? []).slice(0, 8).map((entry) => (
                          <li key={entry.id}>
                            <Link
                              href={entry.href ?? `/topup/${category.slug}/${entry.slug}`}
                              className="block truncate rounded px-1.5 py-1 text-sm text-foreground-muted transition-colors hover:bg-surface-muted hover:text-foreground"
                            >
                              {entry.name}
                            </Link>
                          </li>
                        ))}
                        {(category.entries ?? category.games ?? []).length === 0 ? (
                          <li className="px-1.5 py-1 text-sm text-foreground-subtle">Belum tersedia</li>
                        ) : null}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <NavLink href="/promo" active={isActive("/promo")}>Promo</NavLink>
          <NavLink href="/bantuan" active={isActive("/bantuan")}>Bantuan</NavLink>
          {popularGames?.length ? (
            <NavLink href="/topup" active={false}>Semua Layanan</NavLink>
          ) : null}
        </nav>

        {/* ── Right side ─────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2">
          <div className="hidden lg:block">
            <ThemeToggle />
          </div>
          <div className="hidden sm:block lg:hidden">
            <ThemeToggle variant="icon" />
          </div>

          {user ? (
            <UserMenu user={user} />
          ) : (
            <div className="hidden items-center gap-2 sm:flex">
              <Link href="/login" className="btn-ghost">Masuk</Link>
              <Link href="/register" className="btn-primary btn-sm px-4 py-2">Daftar</Link>
            </div>
          )}

          {/* ── Mobile hamburger ─────────────────────────────────────────── */}
          <button
            type="button"
            ref={toggleRef}
            onClick={() => setMobileOpen((v) => !v)}
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav"
            aria-label={mobileOpen ? "Tutup menu" : "Buka menu"}
            className="btn-ghost h-10 w-10 rounded-[var(--radius-control)] p-0 lg:hidden"
          >
            {mobileOpen ? (
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path strokeLinecap="round" d="M18 6 6 18M6 6l12 12" />
              </svg>
            ) : (
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* ── Mobile drawer ────────────────────────────────────────────────── */}
      {mobileOpen ? (
        <div
          id="mobile-nav"
          ref={menuRef}
          className="max-h-[calc(100vh-4rem)] overflow-y-auto border-t border-border bg-surface lg:hidden"
        >
          <nav className="container-page py-4" aria-label="Navigasi seluler">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
                Tampilan
              </span>
              <ThemeToggle />
            </div>

            <MobileSection title="Kategori" />
            {categories.map((category) => (
              <div key={category.kind} className="mb-4">
                <Link
                  href={category.path}
                  className="flex items-center justify-between rounded-[var(--radius-control)] bg-surface-muted px-3 py-2.5 text-sm font-semibold text-foreground"
                >
                  {category.name}
                  <ArrowRight />
                </Link>
                <ul className="mt-1.5 grid grid-cols-2 gap-1.5">
                  {(category.entries ?? category.games ?? []).map((entry) => (
                    <li key={entry.id}>
                      <Link
                        href={entry.href ?? `/topup/${category.slug}/${entry.slug}`}
                        className="block truncate rounded-[var(--radius-control)] px-3 py-2 text-sm text-foreground-muted hover:bg-surface-muted"
                      >
                        {entry.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            <MobileSection title="Lainnya" />
            <ul className="mb-5 space-y-1">
              <MobileLink href="/promo">Promo</MobileLink>
              <MobileLink href="/bantuan">Bantuan</MobileLink>
              {user ? (
                <>
                  <MobileLink href="/member">Akun Saya</MobileLink>
                  <MobileLink href="/member/orders">Transaksi</MobileLink>
                  <MobileLink href="/member/profile">Profil</MobileLink>
                  {user.role !== "MEMBER" ? <MobileLink href="/dev/dashboard">Dashboard Dev</MobileLink> : null}
                </>
              ) : null}
            </ul>

            {!user ? (
              <div className="grid grid-cols-2 gap-2 pb-4">
                <Link href="/login" className="btn-secondary">Masuk</Link>
                <Link href="/register" className="btn-primary">Daftar</Link>
              </div>
            ) : null}
          </nav>
        </div>
      ) : null}
    </header>
  );
}

function NavLink({ href, active, children }) {
  return (
    <Link
      href={href}
      className={[
        "rounded-[var(--radius-control)] px-3.5 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-brand-soft text-brand-700 dark:text-brand-300"
          : "text-foreground-muted hover:bg-surface-muted hover:text-foreground",
      ].join(" ")}
    >
      {children}
    </Link>
  );
}

function MobileSection({ title }) {
  return (
    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground-subtle">{title}</p>
  );
}

function MobileLink({ href, children }) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-center justify-between rounded-[var(--radius-control)] px-3 py-2.5 text-sm font-medium text-foreground hover:bg-surface-muted"
      >
        {children}
        <ArrowRight />
      </Link>
    </li>
  );
}

function ArrowRight() {
  return (
    <svg className="h-4 w-4 text-foreground-subtle" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" />
    </svg>
  );
}
