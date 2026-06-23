import { redirect, notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/tenant";
import { getTab, getFloorService } from "@/features/tabs/queries";
import { getRegisterCatalog } from "@/features/catalog/queries";
import { TableDetail } from "@/features/tabs/components/TableDetail";

export default async function TabPage({
  params,
}: {
  params: Promise<{ businessId: string; orderId: string }>;
}) {
  const { businessId, orderId } = await params;
  await requireMembership(businessId);

  const business = await db.business.findUnique({
    where: { id: businessId },
    select: { mode: true, currency: true },
  });
  if (!business) notFound();
  if (business.mode !== "RESTAURANT") redirect(`/${businessId}/register`);

  const tab = await getTab(businessId, orderId);
  // Closed/settled or unknown → back to the floor.
  if (!tab) redirect(`/${businessId}/floor`);

  const [menu, rooms] = await Promise.all([getRegisterCatalog(businessId), getFloorService(businessId)]);

  // This tab's tables, and the free tables it can merge/transfer onto.
  const currentTables: { id: string; label: string }[] = [];
  const availableTables: { id: string; label: string; room: string }[] = [];
  for (const room of rooms) {
    for (const t of room.tables) {
      if (t.tab?.orderId === orderId) currentTables.push({ id: t.id, label: t.label });
      else if (!t.tab) availableTables.push({ id: t.id, label: t.label, room: room.name });
    }
  }

  return (
    <TableDetail
      businessId={businessId}
      currency={business.currency}
      tab={tab}
      menu={menu}
      currentTables={currentTables}
      availableTables={availableTables}
    />
  );
}
