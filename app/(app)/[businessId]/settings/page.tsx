import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/tenant";
import { SettingsForm } from "@/features/settings/components/SettingsForm";
import { DevicesManager } from "@/features/peripherals/components/DevicesManager";
import { HardwareReadiness } from "@/features/peripherals/components/HardwareReadiness";
import { PaymentsConnect } from "@/features/payments/components/PaymentsConnect";
import { getPaymentsConnectStatus } from "@/features/payments/connect-queries";
import { SubscriptionCard } from "@/features/billing/components/SubscriptionCard";
import { getSubscriptionState } from "@/features/billing/billing-queries";
import { isBillingConfigured } from "@/features/billing/subscription-access";
import { FloorPlanEditor } from "@/features/floor/components/FloorPlanEditor";
import { getFloorLayout } from "@/features/floor/queries";
import { OnlineOrderingSettings } from "@/features/online/components/OnlineOrderingSettings";
import { pageHasCapability } from "@/lib/operator-guard";
import { getActiveOperator } from "@/lib/operator";
import { NoAccess } from "@/components/no-access";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  await requireMembership(businessId);

  // Capability-gated for the active operator: business settings (manage_settings)
  // and/or the floor plan (manage_products). No access to either → NoAccess.
  const canSettings = await pageHasCapability(businessId, "manage_settings");
  const canFloor = await pageHasCapability(businessId, "manage_products");
  if (!canSettings && !canFloor) return <NoAccess what="settings" />;

  const business = await db.business.findUnique({
    where: { id: businessId },
    select: {
      name: true,
      taxRateBps: true,
      currency: true,
      timezone: true,
      taxInclusive: true,
      mode: true,
      singleOperatorMode: true,
      qrPayEnabled: true,
      qrPayLabel: true,
      qrPayValue: true,
      onlineOrderingEnabled: true,
      onlineOrderInstructions: true,
    },
  });
  if (!business) notFound();

  const showFloorEditor = business.mode === "RESTAURANT" && canFloor;
  const rooms = showFloorEditor ? await getFloorLayout(businessId) : [];

  const paymentsStatus = canSettings ? await getPaymentsConnectStatus(businessId) : null;

  // Flat SaaS subscription (PAYMENTS.md §9, PR-D). Shown only when billing is
  // configured on this deployment; actions are OWNER-only (others see read-only).
  const billingConfigured = isBillingConfigured();
  const subscriptionState =
    canSettings && billingConfigured ? await getSubscriptionState(businessId) : null;
  const operator = billingConfigured ? await getActiveOperator(businessId) : null;
  const isOwner = operator?.role === "OWNER";

  return (
    <section className="space-y-10">
      <div>
        <header className="mb-6">
          <h1 className="text-2xl font-black md:text-3xl">Settings</h1>
          <p className="text-sm text-muted-foreground">Business type, name, sales tax, and currency.</p>
        </header>
        {canSettings ? (
          <SettingsForm businessId={businessId} initial={business} />
        ) : (
          <div className="max-w-lg rounded-xl border border-border bg-card p-6 text-muted-foreground shadow-sm">
            You don&apos;t have permission to change business settings.
          </div>
        )}
      </div>

      {canSettings && (
        <div>
          <header className="mb-4">
            <h2 className="text-xl font-black">Devices</h2>
            <p className="text-sm text-muted-foreground">
              Check this device&apos;s hardware support, test a barcode scanner, and connect a receipt
              printer + cash drawer (Epson/Star, USB) — all with an on-screen preview, no hardware
              required.
            </p>
          </header>
          <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
            <HardwareReadiness />
            <DevicesManager businessName={business.name} />
          </div>
        </div>
      )}

      {canSettings && (
        <div>
          <header className="mb-4">
            <h2 className="text-xl font-black">Online ordering</h2>
            <p className="text-sm text-muted-foreground">
              Let customers scan a QR to order from their phone. Orders land on your Online screen to
              accept and fulfill.
            </p>
          </header>
          <OnlineOrderingSettings
            businessId={businessId}
            initial={{
              onlineOrderingEnabled: business.onlineOrderingEnabled,
              onlineOrderInstructions: business.onlineOrderInstructions,
            }}
          />
        </div>
      )}

      {canSettings && paymentsStatus && (
        <div>
          <header className="mb-4">
            <h2 className="text-xl font-black">Payments</h2>
            <p className="text-sm text-muted-foreground">
              Connect your Stripe account to accept card &amp; QR payments. You stay the merchant of
              record and keep your payouts — VallaPOS takes no cut.
            </p>
          </header>
          <PaymentsConnect businessId={businessId} initial={paymentsStatus} />
        </div>
      )}

      {canSettings && subscriptionState && (
        <div>
          <header className="mb-4">
            <h2 className="text-xl font-black">Subscription</h2>
            <p className="text-sm text-muted-foreground">
              Your VallaPOS plan — a flat monthly subscription for the cloud POS. This is separate
              from the Stripe account you connect above to accept your own customers&apos; payments.
            </p>
          </header>
          <SubscriptionCard businessId={businessId} initial={subscriptionState} isOwner={isOwner} />
        </div>
      )}

      {showFloorEditor && (
        <div>
          <header className="mb-4">
            <h2 className="text-xl font-black">Floor plan</h2>
            <p className="text-sm text-muted-foreground">
              Lay out your dining room so the Floor screen matches your tables.
            </p>
          </header>
          <FloorPlanEditor businessId={businessId} initialRooms={rooms} />
        </div>
      )}
    </section>
  );
}
