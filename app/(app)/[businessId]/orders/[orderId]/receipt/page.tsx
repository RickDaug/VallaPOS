import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireMembership } from "@/lib/tenant";
import { roleAtLeast } from "@/lib/roles";
import { getOrderReceipt } from "@/features/orders/queries";
import { formatMoney } from "@/lib/money";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ReceiptActions } from "@/features/orders/components/ReceiptActions";
import { OrderActions } from "@/features/orders/components/OrderActions";

const STATUS_VARIANT: Record<string, "success" | "warning" | "destructive" | "muted"> = {
  PAID: "success",
  OPEN: "warning",
  REFUNDED: "destructive",
  PARTIALLY_REFUNDED: "warning",
  VOIDED: "muted",
};

export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ businessId: string; orderId: string }>;
}) {
  const { businessId, orderId } = await params;
  const { role } = await requireMembership(businessId);

  const receipt = await getOrderReceipt(businessId, orderId);
  if (!receipt) notFound();

  // Refund/void are MANAGER+ controls (mirrors the action's assertRole gate).
  const canManage = roleAtLeast(role, "MANAGER");

  const money = (c: number) => formatMoney(c, receipt.currency);
  const when = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(receipt.createdAt));
  const taxPct = (receipt.taxRateBps / 100).toFixed(2);
  const cashPayment = receipt.payments.find((p) => p.method === "CASH");

  return (
    <section className="mx-auto max-w-md">
      {/* Controls — hidden when printing */}
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link
          href={`/${businessId}/orders`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={16} /> Orders
        </Link>
      </div>

      <Card className="print:border-0 print:shadow-none">
        <CardContent className="p-6 md:p-8">
          {/* Header */}
          <div className="text-center">
            <h1 className="text-xl font-black">{receipt.businessName}</h1>
            <p className="mt-1 text-sm text-muted-foreground">Order #{receipt.number}</p>
            <p className="text-sm text-muted-foreground">{when}</p>
            <div className="mt-2 flex items-center justify-center gap-2">
              <Badge variant={STATUS_VARIANT[receipt.status] ?? "muted"}>
                {receipt.status.replaceAll("_", " ")}
              </Badge>
              {receipt.customerName && (
                <span className="text-sm text-muted-foreground">{receipt.customerName}</span>
              )}
            </div>
          </div>

          {/* Line items */}
          <div className="mt-6 border-t border-border pt-4">
            <ul className="space-y-3">
              {receipt.lines.map((l) => (
                <li key={l.id} className="flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-semibold">{l.name}</p>
                    {l.modifiers.length > 0 && (
                      <ul className="mt-0.5">
                        {l.modifiers.map((m) => (
                          <li key={m.id} className="numeric text-xs text-muted-foreground">
                            + {m.name}
                            {m.priceDeltaCents !== 0 && <> ({money(m.priceDeltaCents)})</>}
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="numeric text-muted-foreground">
                      {l.quantity} × {money(l.unitPriceCents)}
                      {l.discountCents > 0 && <> · −{money(l.discountCents)}</>}
                    </p>
                  </div>
                  <span className="numeric shrink-0 font-semibold">{money(l.totalCents)}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Totals */}
          <div className="mt-4 space-y-2 border-t border-border pt-4 text-sm">
            <Row label="Subtotal" value={money(receipt.subtotalCents)} />
            {receipt.discountCents > 0 && (
              <Row label="Discount" value={`−${money(receipt.discountCents)}`} />
            )}
            <Row
              label={receipt.taxInclusive ? `Tax (incl., ${taxPct}%)` : `Tax (${taxPct}%)`}
              value={money(receipt.taxCents)}
            />
            {receipt.tipCents > 0 && <Row label="Tip" value={money(receipt.tipCents)} />}
            <div className="flex items-center justify-between pt-2 text-lg font-black">
              <span>Total</span>
              <span className="numeric">{money(receipt.totalCents)}</span>
            </div>
          </div>

          {/* Payment */}
          <div className="mt-4 space-y-2 border-t border-border pt-4 text-sm">
            {receipt.payments.map((p, i) => (
              <Row key={i} label={`Paid · ${p.method}`} value={money(p.amountCents)} />
            ))}
            {cashPayment?.tenderedCents != null && (
              <Row label="Cash tendered" value={money(cashPayment.tenderedCents)} />
            )}
            {cashPayment?.changeCents != null && (
              <Row label="Change" value={money(cashPayment.changeCents)} />
            )}
          </div>

          <p className="mt-6 text-center text-sm text-muted-foreground">Thank you!</p>
        </CardContent>
      </Card>

      <div className="mt-4">
        <ReceiptActions businessId={businessId} orderId={receipt.id} />
      </div>

      {canManage && (
        <div className="mt-4 border-t border-border pt-4 print:hidden">
          <h2 className="mb-2 text-sm font-bold text-muted-foreground">Manager actions</h2>
          <OrderActions
            businessId={businessId}
            orderId={receipt.id}
            status={receipt.status}
            totalCents={receipt.totalCents}
            currency={receipt.currency}
          />
        </div>
      )}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="numeric font-bold">{value}</span>
    </div>
  );
}
