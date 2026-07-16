"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Boxes,
  LayoutGrid,
  MoreHorizontal,
  Receipt,
  Settings,
  ShoppingCart,
  Smartphone,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { can, type Capability } from "@/lib/capabilities";
import type { Role } from "@prisma/client";

type BusinessMode = "STORE" | "RESTAURANT";
type NavItem = { slug: string; label: string; Icon: LucideIcon; cap: Capability };

export interface NavOperator {
  role: Role;
  permissions: string[];
}

// The "Floor" screen is the restaurant home, so it sits right after Register and
// only appears in RESTAURANT mode. "Online" appears only when the merchant has
// enabled QR self-ordering. Each item is gated by the active operator's
// capability, so a worker only sees the screens they're permitted to use.
function navFor(mode: BusinessMode, operator: NavOperator, onlineEnabled: boolean): NavItem[] {
  const all: NavItem[] = [
    { slug: "register", label: "Register", Icon: ShoppingCart, cap: "take_orders" },
    ...(mode === "RESTAURANT"
      ? [{ slug: "floor", label: "Floor", Icon: LayoutGrid, cap: "take_orders" as Capability }]
      : []),
    ...(onlineEnabled
      ? [{ slug: "online", label: "Online", Icon: Smartphone, cap: "take_orders" as Capability }]
      : []),
    { slug: "orders", label: "Orders", Icon: Receipt, cap: "take_orders" },
    { slug: "products", label: "Products", Icon: Boxes, cap: "manage_products" },
    { slug: "reports", label: "Reports", Icon: BarChart3, cap: "view_reports" },
    { slug: "drawer", label: "Drawer", Icon: Wallet, cap: "cash_drawer" },
    { slug: "employees", label: "Team", Icon: Users, cap: "manage_team" },
    { slug: "settings", label: "Settings", Icon: Settings, cap: "manage_settings" },
  ];
  return all.filter((item) => can(operator.role, operator.permissions, item.cap));
}

/** A small count pill rendered on the Online nav item when orders are waiting. */
function NavBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      aria-label={`${count} incoming`}
      className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground"
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

function useActive(businessId: string) {
  const pathname = usePathname();
  return (slug: string) => pathname.startsWith(`/${businessId}/${slug}`);
}

// During first run (before the first sale) we steer the owner down the
// build-catalog → sell path: Products and Register stay full-strength while the
// other tabs are dimmed (still tapped/reachable — just de-emphasized). Audit #24.
const FIRST_RUN_PRIMARY = new Set(["register", "products"]);
function isMuted(slug: string, firstRun: boolean, active: boolean): boolean {
  return firstRun && !active && !FIRST_RUN_PRIMARY.has(slug);
}

// On phones the bottom bar shows only the sale-critical tabs as first-class; the
// rest go behind a "More" sheet so the bar stays scannable (audit R2 #2). Floor
// is sale-critical in RESTAURANT mode (it's the restaurant home).
const BOTTOM_PRIMARY = new Set(["register", "floor", "online", "orders", "products"]);

/** Desktop sidebar nav (vertical). */
export function SideNav({
  businessId,
  mode,
  operator,
  firstRun = false,
  onlineEnabled = false,
  onlineBadge = 0,
}: {
  businessId: string;
  mode: BusinessMode;
  operator: NavOperator;
  firstRun?: boolean;
  onlineEnabled?: boolean;
  onlineBadge?: number;
}) {
  const isActive = useActive(businessId);
  return (
    <nav className="space-y-1">
      {navFor(mode, operator, onlineEnabled).map(({ slug, label, Icon }) => (
        <Link
          key={slug}
          href={`/${businessId}/${slug}`}
          aria-current={isActive(slug) ? "page" : undefined}
          className={cn(
            "flex items-center gap-3 rounded-md px-4 py-3 text-sm font-medium transition-colors",
            isActive(slug)
              ? "bg-sidebar-accent text-sidebar-foreground"
              : "text-sidebar-muted hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
            isMuted(slug, firstRun, isActive(slug)) && "opacity-50",
          )}
        >
          <Icon size={18} />
          {label}
          {slug === "online" && <NavBadge count={onlineBadge} />}
        </Link>
      ))}
    </nav>
  );
}

const tabClass = "flex min-h-[52px] flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium";

/**
 * Mobile bottom-tab nav (fixed, safe-area aware). Shows the sale-critical tabs
 * first-class and tucks secondary tabs (Reports/Drawer/Team/Settings) into a
 * "More" sheet so the bar never crowds past 5 targets (audit R2 #2). Capability
 * gating is preserved — the split happens after filtering, and "More" only shows
 * when the operator actually has secondary tabs.
 */
export function BottomNav({
  businessId,
  mode,
  operator,
  firstRun = false,
  onlineEnabled = false,
  onlineBadge = 0,
}: {
  businessId: string;
  mode: BusinessMode;
  operator: NavOperator;
  firstRun?: boolean;
  onlineEnabled?: boolean;
  onlineBadge?: number;
}) {
  const isActive = useActive(businessId);
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  // Close the More sheet after navigating.
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  const items = navFor(mode, operator, onlineEnabled);
  const primary = items.filter((i) => BOTTOM_PRIMARY.has(i.slug));
  const overflow = items.filter((i) => !BOTTOM_PRIMARY.has(i.slug));
  const overflowActive = overflow.some((i) => isActive(i.slug));
  const columns = primary.length + (overflow.length > 0 ? 1 : 0);

  return (
    <>
      {moreOpen && (
        <>
          {/* Backdrop closes the sheet; the sheet lists the secondary tabs. */}
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMoreOpen(false)}
            className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          />
          <div
            id="more-menu"
            role="menu"
            aria-label="More"
            className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+56px)] z-50 border-t border-border bg-card p-2 shadow-lg lg:hidden"
          >
            <div className="grid grid-cols-2 gap-1">
              {overflow.map(({ slug, label, Icon }) => (
                <Link
                  key={slug}
                  href={`/${businessId}/${slug}`}
                  role="menuitem"
                  aria-current={isActive(slug) ? "page" : undefined}
                  className={cn(
                    "flex min-h-12 items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium",
                    isActive(slug)
                      ? "bg-muted text-primary"
                      : "text-foreground hover:bg-muted",
                  )}
                >
                  <Icon size={20} />
                  {label}
                </Link>
              ))}
            </div>
          </div>
        </>
      )}

      <nav
        // Column count tracks primary tabs (+1 for More); set inline so Tailwind
        // doesn't need to pre-generate a dynamic grid-cols class.
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        className="fixed inset-x-0 bottom-0 z-40 grid border-t border-border bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"
        aria-label="Primary"
      >
        {primary.map(({ slug, label, Icon }) => (
          <Link
            key={slug}
            href={`/${businessId}/${slug}`}
            aria-current={isActive(slug) ? "page" : undefined}
            className={cn(
              tabClass,
              isActive(slug) ? "text-primary" : "text-muted-foreground",
              isMuted(slug, firstRun, isActive(slug)) && "opacity-50",
            )}
          >
            <span className="relative">
              <Icon size={20} />
              {slug === "online" && onlineBadge > 0 && (
                <span
                  aria-label={`${onlineBadge} incoming`}
                  className="absolute -right-2 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground"
                >
                  {onlineBadge > 99 ? "99+" : onlineBadge}
                </span>
              )}
            </span>
            {label}
          </Link>
        ))}
        {overflow.length > 0 && (
          <button
            type="button"
            onClick={() => setMoreOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            aria-controls="more-menu"
            className={cn(
              tabClass,
              moreOpen || overflowActive ? "text-primary" : "text-muted-foreground",
            )}
          >
            <MoreHorizontal size={20} />
            More
          </button>
        )}
      </nav>
    </>
  );
}
