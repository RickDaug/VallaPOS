"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Receipt } from "lucide-react";
import { getLocalStore, isLocalStoreReady } from "@/lib/data-store/local-runtime";
import { LOCAL_BUSINESS_ID } from "@/lib/edition";
import { paymentMethodLabel } from "@/features/orders/payment-method";
import { formatMoney } from "@/lib/money";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { OrderRow } from "@/features/orders/queries";

const STATUS_VARIANT: Record<string, "success" | "warning" | "destructive" | "muted"> = {
  PAID: "success",
  OPEN: "warning",
  REFUNDED: "destructive",
  PARTIALLY_REFUNDED: "warning",
  VOIDED: "muted",
};

// Single-tenant offline install → USD + the device's local time zone.
const fmtTime = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/**
 * Offline-edition Orders — the CLIENT counterpart of the cloud server page. Same
 * UI, but reads from the local SQLite store via `getLocalStore()` at runtime
 * (poll until the app-root boot resolves), so it has no Server Actions /
 * server-only queries / server auth and survives `output:'export'`.
 */
export default function LocalOrdersPage() {
  const [orders, setOrders] = useState<OrderRow[] | null>(null);

  useEffect(() => {
    let active = true;
    const load = () => {
      if (!isLocalStoreReady()) {
        window.setTimeout(load, 100); // wait for the app-root store boot
        return;
      }
      getLocalStore()
        .store.listOrders(LOCAL_BUSINESS_ID)
        .then((rows) => {
          if (active) setOrders(rows);
        });
    };
    load();
    return () => {
      active = false;
    };
  }, []);

  if (!orders) {
    return (
      <section>
        <p className="text-sm text-muted-foreground">Loading orders&hellip;</p>
      </section>
    );
  }

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
              <p className="text-sm text-muted-foreground">
                No orders yet. Ring up a sale on the Register.
              </p>
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
                      <th scope="col" className="p-3"><span className="sr-only">Receipt</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => (
                      <tr key={o.id} className="border-t border-border">
                        <td className="numeric p-3 font-bold">#{o.number}</td>
                        <td className="p-3">{o.customerName ?? "Walk-in"}</td>
                        <td className="numeric p-3 font-semibold">{formatMoney(o.totalCents, "USD")}</td>
                        <td className="p-3">
                          <Badge variant={STATUS_VARIANT[o.status] ?? "muted"}>
                            {o.status.replaceAll("_", " ")}
                          </Badge>
                        </td>
                        <td className="p-3 text-muted-foreground">
                          {o.method ? paymentMethodLabel(o.method) : "—"}
                        </td>
                        <td className="p-3 text-muted-foreground">{fmtTime.format(new Date(o.createdAt))}</td>
                        <td className="p-3 text-right">
                          <Link
                            href={`/${LOCAL_BUSINESS_ID}/receipt?order=${o.id}`}
                            className="font-medium text-primary hover:underline"
                          >
                            Receipt
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <ul className="space-y-2 md:hidden">
                {orders.map((o) => (
                  <li key={o.id}>
                    <Link
                      href={`/${LOCAL_BUSINESS_ID}/receipt?order=${o.id}`}
                      className="flex items-center justify-between rounded-lg border border-border p-3 hover:border-primary/40"
                    >
                      <div>
                        <p className="numeric font-bold">#{o.number}</p>
                        <p className="text-sm text-muted-foreground">
                          {o.customerName ?? "Walk-in"} · {fmtTime.format(new Date(o.createdAt))}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className="numeric font-bold">{formatMoney(o.totalCents, "USD")}</span>
                        <Badge variant={STATUS_VARIANT[o.status] ?? "muted"}>
                          {o.status.replaceAll("_", " ")}
                        </Badge>
                      </div>
                    </Link>
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
