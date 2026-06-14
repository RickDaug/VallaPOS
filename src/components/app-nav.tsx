"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Boxes,
  Receipt,
  Settings,
  ShoppingCart,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV: { slug: string; label: string; Icon: LucideIcon }[] = [
  { slug: "register", label: "Register", Icon: ShoppingCart },
  { slug: "orders", label: "Orders", Icon: Receipt },
  { slug: "products", label: "Products", Icon: Boxes },
  { slug: "reports", label: "Reports", Icon: BarChart3 },
  { slug: "drawer", label: "Drawer", Icon: Wallet },
  { slug: "employees", label: "Team", Icon: Users },
  { slug: "settings", label: "Settings", Icon: Settings },
];

function useActive(businessId: string) {
  const pathname = usePathname();
  return (slug: string) => pathname.startsWith(`/${businessId}/${slug}`);
}

/** Desktop sidebar nav (vertical). */
export function SideNav({ businessId }: { businessId: string }) {
  const isActive = useActive(businessId);
  return (
    <nav className="space-y-1">
      {NAV.map(({ slug, label, Icon }) => (
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
export function BottomNav({ businessId }: { businessId: string }) {
  const isActive = useActive(businessId);
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-7 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"
      aria-label="Primary"
    >
      {NAV.map(({ slug, label, Icon }) => (
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
