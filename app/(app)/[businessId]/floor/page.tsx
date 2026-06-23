import { redirect, notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/tenant";
import { getFloorService } from "@/features/tabs/queries";
import { FloorService } from "@/features/tabs/components/FloorService";

export default async function FloorPage({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  await requireMembership(businessId);

  const business = await db.business.findUnique({
    where: { id: businessId },
    select: { mode: true, currency: true },
  });
  if (!business) notFound();
  // Floor is restaurant-only; store businesses use the instant-checkout register.
  if (business.mode !== "RESTAURANT") redirect(`/${businessId}/register`);

  const rooms = await getFloorService(businessId);

  return (
    <section>
      <header className="mb-4">
        <h1 className="text-2xl font-black md:text-3xl">Floor</h1>
        <p className="text-sm text-muted-foreground">
          Tap an open table to view or edit its order, or a free table to start a tab.
        </p>
      </header>
      <FloorService businessId={businessId} currency={business.currency} rooms={rooms} />
    </section>
  );
}
