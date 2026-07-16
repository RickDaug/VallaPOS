import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/tenant";
import { pageHasCapability } from "@/lib/operator-guard";
import { NoAccess } from "@/components/no-access";
import { listOnlineOrders } from "@/features/online/queries";
import { OnlineOrdersBoard } from "@/features/online/components/OnlineOrdersBoard";

/**
 * Merchant incoming online-orders board. Gated by `take_orders` (the capability
 * cashiers use to take sales). Live via the layout's OnlineOrderAlerts poller,
 * which refreshes this page's data on an interval.
 */
export default async function OnlineOrdersPage({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  await requireMembership(businessId);

  if (!(await pageHasCapability(businessId, "take_orders"))) {
    return <NoAccess what="online orders" />;
  }

  const business = await db.business.findUnique({
    where: { id: businessId },
    select: { currency: true, onlineOrderingEnabled: true },
  });
  if (!business) notFound();

  const orders = await listOnlineOrders(businessId);

  return (
    <OnlineOrdersBoard
      businessId={businessId}
      currency={business.currency}
      enabled={business.onlineOrderingEnabled}
      orders={orders}
    />
  );
}
