// ============================================================================
// /dev navigation links — the only client part of the dev chrome.
//
// It exists purely to highlight the active item. Keeping the highlight here
// means DevNav (and every page) stays a server component.
// ============================================================================
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function DevNavLinks({ links }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Navigasi developer" className="overflow-x-auto">
      <ul className="flex min-w-max gap-1 px-2 py-2">
        {links.map((link) => {
          const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`block whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                  active
                    ? "bg-brand-soft text-brand-700 dark:text-brand-100"
                    : "text-foreground-muted hover:bg-surface-muted hover:text-foreground"
                }`}
              >
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
