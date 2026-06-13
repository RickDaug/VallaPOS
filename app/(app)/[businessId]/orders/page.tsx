import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/tenant";
import { listOrders } from "@/features/orders/queries";
import { formatMoney } from "@/lib/money";

const STATUS_STYLES: Record<string, string> = {
  PAID: "bg-green-100 text-green-700",
  OPEN: "bg-amber-100 text-amber-700",
  REFUNDED: "bg-red-100 text-red-700",
  PARTIALLY_REFUNDED: "bg-orange-100 text-orange-700",
  VOIDED: "bg-slate-200 text-slate-600",
};

export default async function OrdersPage({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  await requireMembership(businessId);

  const business = await db.business.findUnique({
    where: { id: businessId },
    select: { currency: true },
  });
  if (!business) notFound();

  const orders = await listOrders(businessId);
  const fmtTime = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <section>
      <header className="mb-6">
        <h1 className="text-2xl font-black md:text-3xl">Orders</h1>
        <p className="text-sm text-slate-500">Your most recent {orders.length} orders.</p>
      </header>

      <div className="rounded-3xl bg-white p-4 shadow-sm md:p-5">
        {orders.length === 0 ? (
          <p className="rounded-2xl bg-slate-50 p-6 text-center text-sm text-slate-500">
            No orders yet. Ring up a sale on the Register.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-slate-500">
                <tr>
                  <th scope="col" className="p-3">Order</th>
                  <th scope="col" className="p-3">Customer</th>
                  <th scope="col" className="p-3">Total</th>
                  <th scope="col" className="p-3">Status</th>
                  <th scope="col" className="p-3">Method</th>
                  <th scope="col" className="p-3">Time</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="border-t">
                    <td className="p-3 font-bold">#{o.number}</td>
                    <td className="p-3">{o.customerName ?? "Walk-in"}</td>
                    <td className="p-3 font-semibold">{formatMoney(o.totalCents, business.currency)}</td>
                    <td className="p-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          STATUS_STYLES[o.status] ?? "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {o.status.replace("_", " ")}
                      </span>
                    </td>
                    <td className="p-3">{o.method ?? "—"}</td>
                    <td className="p-3 text-slate-500">{fmtTime.format(new Date(o.createdAt))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
