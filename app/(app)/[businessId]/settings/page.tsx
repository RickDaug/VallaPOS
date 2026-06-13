import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/tenant";
import { SettingsForm } from "@/features/settings/components/SettingsForm";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  const { role } = await requireMembership(businessId);

  const business = await db.business.findUnique({
    where: { id: businessId },
    select: { name: true, taxRateBps: true, currency: true, taxInclusive: true },
  });
  if (!business) notFound();

  return (
    <section>
      <header className="mb-6">
        <h1 className="text-2xl font-black md:text-3xl">Settings</h1>
        <p className="text-sm text-muted-foreground">Business name, sales tax, and currency.</p>
      </header>
      {role === "OWNER" ? (
        <SettingsForm businessId={businessId} initial={business} />
      ) : (
        <div className="max-w-lg rounded-xl border border-border bg-card p-6 text-muted-foreground shadow-sm">
          Only the business owner can change these settings.
        </div>
      )}
    </section>
  );
}
