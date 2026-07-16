import { redirect, notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireMembership, AuthError, ForbiddenError } from "@/lib/tenant";
import { SignOutButton } from "@/components/SignOutButton";
import { SideNav, BottomNav } from "@/components/app-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { FullscreenToggle } from "@/components/fullscreen-toggle";
import { getActiveOperator } from "@/lib/operator";
import { can } from "@/lib/capabilities";
import { listActiveMembers } from "@/features/employees/queries";
import { OperatorLock } from "@/features/employees/components/OperatorLock";
import { OperatorBar } from "@/features/employees/components/OperatorBar";
import { getFirstRunState } from "@/features/onboarding/queries";
import { isFirstRun, onboardingView } from "@/features/onboarding/first-run";
import { FirstRunChecklist } from "@/features/onboarding/components/FirstRunChecklist";
import { countIncomingOnlineOrders } from "@/features/online/queries";
import { OnlineOrderAlerts } from "@/features/online/components/OnlineOrderAlerts";

export default async function BusinessLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;

  let deviceMembershipId: string;
  try {
    const ctx = await requireMembership(businessId);
    deviceMembershipId = ctx.membershipId;
  } catch (err) {
    if (err instanceof AuthError) redirect("/sign-in");
    if (err instanceof ForbiddenError) notFound();
    throw err;
  }

  const business = await db.business.findUnique({
    where: { id: businessId },
    select: { name: true, mode: true, singleOperatorMode: true, onlineOrderingEnabled: true },
  });
  if (!business) notFound();

  // First-run activation state (derived from data — no completed sale yet), used
  // to soften the lock framing, show the get-started checklist, and emphasize the
  // build-catalog→sell path in the nav.
  const firstRun = await getFirstRunState(businessId);
  const brandNew = isFirstRun(firstRun);

  // Shared-terminal gate: the device is signed in, but nothing is reachable until
  // a worker identifies themselves via PIN (the active operator). When locked, we
  // render the lock screen INSTEAD of the app shell.
  const operator = await getActiveOperator(businessId);
  if (!operator) {
    const members = await listActiveMembers(businessId);
    return (
      <OperatorLock
        businessId={businessId}
        businessName={business.name}
        members={members}
        selfMembershipId={deviceMembershipId}
        firstRun={brandNew}
      />
    );
  }

  const onboardingCaps = {
    canManageSettings: can(operator.role, operator.permissions, "manage_settings"),
    canManageProducts: can(operator.role, operator.permissions, "manage_products"),
  };
  // Only owners/managers (who can set up the catalog/settings) see onboarding
  // surfaces, and only while there's something to prompt.
  const showOnboarding =
    onboardingView(firstRun) !== "none" &&
    (onboardingCaps.canManageSettings || onboardingCaps.canManageProducts);

  // QR self-ordering: the "Online" nav tab + live new-order badge/alerts show only
  // when the merchant has enabled online ordering AND this operator can take sales.
  const onlineEnabled = business.onlineOrderingEnabled;
  const showOnline = onlineEnabled && can(operator.role, operator.permissions, "take_orders");
  const onlineBadge = showOnline ? (await countIncomingOnlineOrders(businessId)).submitted : 0;

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-sidebar p-4 text-sidebar-foreground lg:flex">
        <div className="mb-6 px-2">
          <div className="text-xl font-black tracking-tight">VallaPOS</div>
          <p className="mt-0.5 truncate text-sm text-sidebar-muted">{business.name}</p>
        </div>
        <SideNav
          businessId={businessId}
          mode={business.mode}
          operator={operator}
          firstRun={brandNew}
          onlineEnabled={onlineEnabled}
          onlineBadge={onlineBadge}
        />
        <div className="mt-auto flex items-center gap-2 pt-6">
          <div className="flex-1">
            <SignOutButton />
          </div>
          <FullscreenToggle />
          <ThemeToggle />
        </div>
        <div className="mt-2 border-t border-sidebar-accent/40 pt-2">
          <OperatorBar
            businessId={businessId}
            operatorName={operator.name}
            singleOperatorMode={business.singleOperatorMode}
            className="w-full justify-start"
          />
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="fixed inset-x-0 top-0 z-30 flex items-center justify-between border-b border-border bg-card/95 px-4 py-3 backdrop-blur lg:hidden">
        <div className="min-w-0">
          <span className="text-base font-black tracking-tight">VallaPOS</span>
          <span className="ml-2 truncate text-sm text-muted-foreground">{business.name}</span>
        </div>
        <div className="flex items-center gap-1">
          <OperatorBar
            businessId={businessId}
            operatorName={operator.name}
            singleOperatorMode={business.singleOperatorMode}
            className="text-muted-foreground hover:bg-muted hover:text-foreground"
          />
          <FullscreenToggle className="text-muted-foreground hover:bg-muted hover:text-foreground" />
          <ThemeToggle className="text-muted-foreground hover:bg-muted hover:text-foreground" />
        </div>
      </header>

      {/* Content (offset for mobile top bar + bottom nav) */}
      <main className="flex-1 px-4 pb-24 pt-20 md:px-6 lg:p-6">
        {showOnboarding && (
          <FirstRunChecklist businessId={businessId} state={firstRun} caps={onboardingCaps} />
        )}
        {children}
      </main>

      <BottomNav
        businessId={businessId}
        mode={business.mode}
        operator={operator}
        firstRun={brandNew}
        onlineEnabled={onlineEnabled}
        onlineBadge={onlineBadge}
      />

      {/* Global live poller: new-order toast + nav-badge refresh (poll-on-visible). */}
      {showOnline && <OnlineOrderAlerts businessId={businessId} />}
    </div>
  );
}
