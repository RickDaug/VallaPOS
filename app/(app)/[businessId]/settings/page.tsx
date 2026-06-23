import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/tenant";
import { roleAtLeast } from "@/lib/roles";
import { SettingsForm } from "@/features/settings/components/SettingsForm";
import { FloorPlanEditor } from "@/features/floor/components/FloorPlanEditor";
import { getFloorLayout } from "@/features/floor/queries";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  const { role } = await requireMembership(businessId);

  const business = await db.business.findUnique({
    where: { id: businessId },
    select: { name: true, taxRateBps: true, currency: true, taxInclusive: true, mode: true },
  });
  if (!business) notFound();

  // The floor plan is a manager-level operational tool (not an owner-only
  // business setting), shown only when the business runs in RESTAURANT mode.
  const showFloorEditor = business.mode === "RESTAURANT" && roleAtLeast(role, "MANAGER");
  const rooms = showFloorEditor ? await getFloorLayout(businessId) : [];

  return (
    <section className="space-y-10">
      <div>
        <header className="mb-6">
          <h1 className="text-2xl font-black md:text-3xl">Settings</h1>
          <p className="text-sm text-muted-foreground">Business type, name, sales tax, and currency.</p>
        </header>
        {role === "OWNER" ? (
          <SettingsForm businessId={businessId} initial={business} />
        ) : (
          <div className="max-w-lg rounded-xl border border-border bg-card p-6 text-muted-foreground shadow-sm">
            Only the business owner can change these settings.
          </div>
        )}
      </div>

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
