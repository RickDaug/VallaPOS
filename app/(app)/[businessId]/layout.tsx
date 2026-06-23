import { redirect, notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireMembership, AuthError, ForbiddenError } from "@/lib/tenant";
import { SignOutButton } from "@/components/SignOutButton";
import { SideNav, BottomNav } from "@/components/app-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { FullscreenToggle } from "@/components/fullscreen-toggle";

export default async function BusinessLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;

  try {
    await requireMembership(businessId);
  } catch (err) {
    if (err instanceof AuthError) redirect("/sign-in");
    if (err instanceof ForbiddenError) notFound();
    throw err;
  }

  const business = await db.business.findUnique({
    where: { id: businessId },
    select: { name: true, mode: true },
  });
  if (!business) notFound();

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-sidebar p-4 text-sidebar-foreground lg:flex">
        <div className="mb-6 px-2">
          <div className="text-xl font-black tracking-tight">VallaPOS</div>
          <p className="mt-0.5 truncate text-sm text-sidebar-muted">{business.name}</p>
        </div>
        <SideNav businessId={businessId} mode={business.mode} />
        <div className="mt-auto flex items-center gap-2 pt-6">
          <div className="flex-1">
            <SignOutButton />
          </div>
          <FullscreenToggle />
          <ThemeToggle />
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="fixed inset-x-0 top-0 z-30 flex items-center justify-between border-b border-border bg-card/95 px-4 py-3 backdrop-blur lg:hidden">
        <div className="min-w-0">
          <span className="text-base font-black tracking-tight">VallaPOS</span>
          <span className="ml-2 truncate text-sm text-muted-foreground">{business.name}</span>
        </div>
        <div className="flex items-center gap-1">
          <FullscreenToggle className="text-muted-foreground hover:bg-muted hover:text-foreground" />
          <ThemeToggle className="text-muted-foreground hover:bg-muted hover:text-foreground" />
        </div>
      </header>

      {/* Content (offset for mobile top bar + bottom nav) */}
      <main className="flex-1 px-4 pb-24 pt-20 md:px-6 lg:p-6">{children}</main>

      <BottomNav businessId={businessId} mode={business.mode} />
    </div>
  );
}
