"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { getLocalStore, isLocalStoreReady } from "@/lib/data-store/local-runtime";
import { LOCAL_BUSINESS_ID } from "@/lib/edition";
import { formatMoney } from "@/lib/money";
import { Card, CardContent } from "@/components/ui/card";
import type { OrderReceipt } from "@/features/orders/queries";

/**
 * Offline-edition receipt (docs/EDITIONS.md §5b). The cloud receipt is a DYNAMIC
 * route (`/orders/[orderId]/receipt`) — static export can't pre-render runtime
 * order ids, so the desktop app uses a query param (`/receipt?order=<id>`) read
 * client-side. `useSearchParams` requires a Suspense boundary under export.
 */
function ReceiptView() {
  const orderId = useSearchParams().get("order");
  // undefined = loading, null = not found.
  const [receipt, setReceipt] = useState<OrderReceipt | null | undefined>(undefined);

  useEffect(() => {
    if (!orderId) {
      setReceipt(null);
      return;
    }
    let active = true;
    const load = () => {
      if (!isLocalStoreReady()) {
        window.setTimeout(load, 100);
        return;
      }
      getLocalStore()
        .store.getOrderReceipt(LOCAL_BUSINESS_ID, orderId)
        .then((r) => {
          if (active) setReceipt(r);
        });
    };
    load();
    return () => {
      active = false;
    };
  }, [orderId]);

  if (receipt === undefined) return <p className="text-sm text-muted-foreground">Loading receipt&hellip;</p>;
  if (!receipt) return <p className="text-sm text-muted-foreground">Receipt not found.</p>;

  const cur = receipt.currency;
  return (
    <div className="mx-auto max-w-sm">
      <Card>
        <CardContent className="p-5">
          <div className="text-center">
            <p className="text-lg font-black">{receipt.businessName}</p>
            <p className="text-sm text-muted-foreground">
              Order #{receipt.number} · {new Date(receipt.createdAt).toLocaleString()}
            </p>
          </div>

          <ul className="mt-4 space-y-1 text-sm">
            {receipt.lines.map((l) => (
              <li key={l.id} className="flex justify-between gap-3">
                <span>
                  <span className="numeric">{l.quantity}×</span> {l.name}
                </span>
                <span className="numeric">{formatMoney(l.totalCents, cur)}</span>
              </li>
            ))}
          </ul>

          <div className="mt-3 space-y-1 border-t border-border pt-3 text-sm">
            <Row label="Subtotal" value={formatMoney(receipt.subtotalCents, cur)} />
            <Row label="Tax" value={formatMoney(receipt.taxCents, cur)} />
            {receipt.tipCents > 0 ? <Row label="Tip" value={formatMoney(receipt.tipCents, cur)} /> : null}
            <div className="flex justify-between pt-1 font-black">
              <span>Total</span>
              <span className="numeric">{formatMoney(receipt.totalCents, cur)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="mt-4 text-center">
        <Link
          href={`/${LOCAL_BUSINESS_ID}/orders`}
          className="text-sm font-semibold text-primary hover:underline"
        >
          ← Back to orders
        </Link>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-muted-foreground">
      <span>{label}</span>
      <span className="numeric">{value}</span>
    </div>
  );
}

export default function LocalReceiptPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading&hellip;</p>}>
      <ReceiptView />
    </Suspense>
  );
}
