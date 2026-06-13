import { notFound } from "next/navigation";
import { Receipt } from "lucide-react";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/tenant";
import { listOrders } from "@/features/orders/queries";
import { formatMoney } from "@/lib/money";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const STATUS_VARIANT: Record<string, "success" | "warning" | "destructive" | "muted"> = {
  PAID: "success",
  OPEN: "warning",
  REFUNDED: "destructive",
  PARTIALLY_REFUNDED: "warning",
  VOIDED: "muted",
};

export default async function OrdersPage({ params }: { params: Promise<{ businessId: string }> }) {
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
        <p className="text-sm text-muted-foreground">Your most recent {orders.length} orders.</p>
      </header>

      <Card>
        <CardContent className="p-4 md:p-5">
          {orders.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-lg bg-muted p-10 text-center">
              <Receipt size={28} className="text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No orders yet. Ring up a sale on the Register.</p>
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="text-muted-foreground">
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
                      <tr key={o.id} className="border-t border-border">
                        <td className="numeric p-3 font-bold">#{o.number}</td>
                        <td className="p-3">{o.customerName ?? "Walk-in"}</td>
                        <td className="numeric p-3 font-semibold">{formatMoney(o.totalCents, business.currency)}</td>
                        <td className="p-3">
                          <Badge variant={STATUS_VARIANT[o.status] ?? "muted"}>{o.status.replaceAll("_", " ")}</Badge>
                        </td>
                        <td className="p-3 text-muted-foreground">{o.method ?? "—"}</td>
                        <td className="p-3 text-muted-foreground">{fmtTime.format(new Date(o.createdAt))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <ul className="space-y-2 md:hidden">
                {orders.map((o) => (
                  <li key={o.id} className="flex items-center justify-between rounded-lg border border-border p-3">
                    <div>
                      <p className="numeric font-bold">#{o.number}</p>
                      <p className="text-sm text-muted-foreground">
                        {o.customerName ?? "Walk-in"} · {fmtTime.format(new Date(o.createdAt))}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="numeric font-bold">{formatMoney(o.totalCents, business.currency)}</span>
                      <Badge variant={STATUS_VARIANT[o.status] ?? "muted"}>{o.status.replaceAll("_", " ")}</Badge>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
