import Link from "next/link";

/**
 * Authenticated POS shell (scaffold).
 *
 * Phase 1: this layout will call `requireSession()`, load the user's business,
 * and redirect to /sign-in if unauthenticated. For now it renders the chrome
 * (sidebar nav) so the route-group structure is visible. Nav links resolve to
 * real routes — no dead buttons (the prototype's nav went nowhere).
 */
const NAV = [
  ["register", "Register"],
  ["orders", "Orders"],
  ["products", "Products"],
  ["reports", "Reports"],
  ["settings", "Settings"],
] as const;

export default function AppLayout({ children }: { children: React.ReactNode }) {
  // businessId is resolved from the URL in Phase 1; placeholder for the shell.
  const businessId = "demo";
  return (
    <div className="flex min-h-screen bg-slate-100 text-slate-950">
      <aside className="hidden w-60 flex-col bg-slate-950 p-5 text-white lg:flex">
        <div className="mb-8">
          <div className="text-2xl font-black tracking-tight">VallaPOS</div>
          <p className="mt-1 text-sm text-slate-300">Just log in and sell.</p>
        </div>
        <nav className="space-y-1 text-sm">
          {NAV.map(([slug, label]) => (
            <Link
              key={slug}
              href={`/${businessId}/${slug}`}
              className="block rounded-2xl px-4 py-3 text-slate-200 hover:bg-white/10"
            >
              {label}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="flex-1 p-4 md:p-6">{children}</main>
    </div>
  );
}
