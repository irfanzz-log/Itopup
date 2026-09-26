// ============================================================================
// /dev navigation.
//
// A SERVER component: the active-item highlight is derived from the pathname
// passed in by the layout's client wrapper, not from a hook here, so the nav
// itself ships no JavaScript. See DevNavLinks for the client-side highlight.
// ============================================================================
import { ROLE_LABEL } from "@/lib/constants";
import { Badge } from "@/components/ui/primitives";
import DevNavLinks from "./DevNavLinks";

export const DEV_LINKS = [
  { href: "/dev/dashboard", label: "Dashboard", icon: "grid" },
  { href: "/dev/orders", label: "Transaksi", icon: "receipt" },
  { href: "/dev/members", label: "Member", icon: "users" },
  { href: "/dev/products", label: "Produk & Harga", icon: "box" },
  { href: "/dev/providers", label: "Provider", icon: "plug" },
  { href: "/dev/promos", label: "Promo", icon: "tag" },
  { href: "/dev/settings", label: "Pengaturan", icon: "cog" },
];

export default function DevNav({ user }) {
  return (
    <header className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface-muted px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-xs font-bold text-white">
            DEV
          </span>
          <div>
            <p className="text-sm font-bold text-foreground">Panel Developer</p>
            <p className="text-xs text-foreground-subtle">
              {user.name} · {ROLE_LABEL[user.role] ?? user.role}
            </p>
          </div>
        </div>
        <Badge tone="info">Akses internal</Badge>
      </div>

      <DevNavLinks links={DEV_LINKS} />
    </header>
  );
}
