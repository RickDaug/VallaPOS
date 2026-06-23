"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Boxes,
  LayoutGrid,
  Receipt,
  Settings,
  ShoppingCart,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type BusinessMode = "STORE" | "RESTAURANT";
type NavItem = { slug: string; label: string; Icon: LucideIcon };

// The "Floor" screen is the restaurant home, so it sits right after Register and
// only appears in RESTAURANT mode.
function navFor(mode: BusinessMode): NavItem[] {
  return [
    { slug: "register", label: "Register", Icon: ShoppingCart },
    ...(mode === "RESTAURANT" ? [{ slug: "floor", label: "Floor", Icon: LayoutGrid }] : []),
    { slug: "orders", label: "Orders", Icon: Receipt },
    { slug: "products", label: "Products", Icon: Boxes },
    { slug: "reports", label: "Reports", Icon: BarChart3 },
    { slug: "drawer", label: "Drawer", Icon: Wallet },
    { slug: "employees", label: "Team", Icon: Users },
    { slug: "settings", label: "Settings", Icon: Settings },
  ];
}

function useActive(businessId: string) {
  const pathname = usePathname();
  return (slug: string) => pathname.startsWith(`/${businessId}/${slug}`);
}

/** Desktop sidebar nav (vertical). */
export function SideNav({ businessId, mode }: { businessId: string; mode: BusinessMode }) {
  const isActive = useActive(businessId);
  return (
    <nav className="space-y-1">
      {navFor(mode).map(({ slug, label, Icon }) => (
        <Link
          key={slug}
          href={`/${businessId}/${slug}`}
          aria-current={isActive(slug) ? "page" : undefined}
          className={cn(
            "flex items-center gap-3 rounded-md px-4 py-3 text-sm font-medium transition-colors",
            isActive(slug)
              ? "bg-sidebar-accent text-sidebar-foreground"
              : "text-sidebar-muted hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
          )}
        >
          <Icon size={18} />
          {label}
        </Link>
      ))}
    </nav>
  );
}

/** Mobile bottom-tab nav (fixed, safe-area aware). */
export function BottomNav({ businessId, mode }: { businessId: string; mode: BusinessMode }) {
  const isActive = useActive(businessId);
  const items = navFor(mode);
  return (
    <nav
      // Column count tracks the item count (7 in store, 8 in restaurant); set
      // inline so Tailwind doesn't need to pre-generate a dynamic grid-cols class.
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      className="fixed inset-x-0 bottom-0 z-40 grid border-t border-border bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"
      aria-label="Primary"
    >
      {items.map(({ slug, label, Icon }) => (
        <Link
          key={slug}
          href={`/${businessId}/${slug}`}
          aria-current={isActive(slug) ? "page" : undefined}
          className={cn(
            "flex flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium",
            isActive(slug) ? "text-primary" : "text-muted-foreground",
          )}
        >
          <Icon size={20} />
          {label}
        </Link>
      ))}
    </nav>
  );
}
