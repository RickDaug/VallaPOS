"use client";

import { useMemo, useState } from "react";
import { Check, Plus, Search } from "lucide-react";
import { formatMoney, computeTotals } from "@/lib/money";
import type { SellableEntry } from "@/features/catalog/queries";
import { checkout, type Receipt } from "@/features/register/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type CartLine = { variationId: string; label: string; priceCents: number; qty: number };

const TIP_PRESETS = [0, 0.15, 0.2, 0.25];

export function Register({
  businessId,
  catalog,
  taxRateBps,
  currency,
  taxInclusive,
}: {
  businessId: string;
  catalog: SellableEntry[];
  taxRateBps: number;
  currency: string;
  taxInclusive: boolean;
}) {
  const [cart, setCart] = useState<CartLine[]>([]);
  const [query, setQuery] = useState("");
  const [tipRate, setTipRate] = useState(0);
  const [discountDollars, setDiscountDollars] = useState("");
  const [tendering, setTendering] = useState(false);
  const [tenderDollars, setTenderDollars] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const money = (c: number) => formatMoney(c, currency);

  const filtered = useMemo(
    () => catalog.filter((e) => `${e.label} ${e.category}`.toLowerCase().includes(query.toLowerCase())),
    [catalog, query],
  );

  const cartDiscountCents = Math.max(0, Math.round(parseFloat(discountDollars || "0") * 100)) || 0;

  const totals = useMemo(() => {
    const lines = cart.map((l) => ({ unitPriceCents: l.priceCents, quantity: l.qty }));
    const subtotal = lines.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0);
    const tipCents = Math.round(Math.max(subtotal - cartDiscountCents, 0) * tipRate);
    return computeTotals(lines, { taxRateBps, cartDiscountCents, tipCents, taxInclusive });
  }, [cart, taxRateBps, cartDiscountCents, tipRate, taxInclusive]);

  function addToCart(entry: SellableEntry) {
    setCart((cur) => {
      const existing = cur.find((l) => l.variationId === entry.variationId);
      if (existing) {
        return cur.map((l) => (l.variationId === entry.variationId ? { ...l, qty: l.qty + 1 } : l));
      }
      return [...cur, { variationId: entry.variationId, label: entry.label, priceCents: entry.priceCents, qty: 1 }];
    });
  }

  function changeQty(variationId: string, delta: number) {
    setCart((cur) =>
      cur
        .map((l) => (l.variationId === variationId ? { ...l, qty: l.qty + delta } : l))
        .filter((l) => l.qty > 0),
    );
  }

  function resetSale() {
    setCart([]);
    setTipRate(0);
    setDiscountDollars("");
    setTenderDollars("");
    setTendering(false);
    setReceipt(null);
    setError(null);
  }

  async function completeSale() {
    setError(null);
    const cashTenderedCents = Math.round(parseFloat(tenderDollars || "0") * 100);
    if (cashTenderedCents < totals.totalCents) {
      setError("Cash tendered is less than the total.");
      return;
    }
    setPending(true);
    try {
      const r = await checkout({
        businessId,
        clientUuid: crypto.randomUUID(),
        lines: cart.map((l) => ({ variationId: l.variationId, quantity: l.qty })),
        tipCents: totals.tipCents,
        cartDiscountCents,
        cashTenderedCents,
      });
      setReceipt(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed.");
    } finally {
      setPending(false);
    }
  }

  if (receipt) {
    return (
      <Card className="mx-auto max-w-md text-center">
        <CardContent className="p-8">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-success/15 text-success">
            <Check size={30} />
          </div>
          <h2 className="text-xl font-bold">Sale complete</h2>
          <p className="mt-1 text-sm text-muted-foreground">Order #{receipt.number}</p>
          <p className="numeric mt-6 text-5xl font-black text-success">{money(receipt.changeCents)}</p>
          <p className="text-sm font-medium text-muted-foreground">change due</p>
          <div className="mt-6 space-y-2 border-t border-border pt-4 text-left text-sm">
            <Row label="Total" value={money(receipt.totalCents)} />
            <Row label="Cash" value={money(receipt.cashTenderedCents)} />
            <Row label="Tax" value={money(receipt.taxCents)} />
            {receipt.tipCents > 0 && <Row label="Tip" value={money(receipt.tipCents)} />}
          </div>
          <Button onClick={resetSale} size="lg" className="mt-6 w-full">
            New sale
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
      {/* Catalog */}
      <Card>
        <CardContent className="p-4 md:p-5">
          <div className="relative mb-4">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search items"
              aria-label="Search items"
              className="pl-10"
            />
          </div>
          {filtered.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((entry) => (
                <button
                  key={entry.variationId}
                  onClick={() => addToCart(entry)}
                  className="group rounded-lg border border-border bg-card p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md active:scale-[0.98]"
                >
                  <div className="mb-6 flex items-center justify-between">
                    <Badge variant={entry.type === "SERVICE" ? "primary" : "muted"}>{entry.category}</Badge>
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-muted-foreground group-hover:bg-primary group-hover:text-primary-foreground">
                      <Plus size={16} />
                    </span>
                  </div>
                  <h3 className="font-semibold leading-tight">{entry.label}</h3>
                  <p className="numeric mt-1 text-2xl font-black">{money(entry.priceCents)}</p>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cart */}
      <Card className="h-fit xl:sticky xl:top-6">
        <CardContent className="p-4 md:p-5">
          <h2 className="mb-4 text-lg font-bold">Current sale</h2>
          <div className="min-h-32 space-y-2">
            {cart.length === 0 && (
              <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">
                Cart is empty. Tap an item to start.
              </p>
            )}
            {cart.map((line) => (
              <div key={line.variationId} className="flex items-center justify-between rounded-lg border border-border p-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{line.label}</p>
                  <p className="numeric text-sm text-muted-foreground">{money(line.priceCents)} each</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="secondary"
                    size="icon"
                    className="h-10 w-10 rounded-full"
                    onClick={() => changeQty(line.variationId, -1)}
                    aria-label={`Remove one ${line.label}`}
                  >
                    −
                  </Button>
                  <span className="numeric w-6 text-center font-bold">{line.qty}</span>
                  <Button
                    size="icon"
                    className="h-10 w-10 rounded-full"
                    onClick={() => changeQty(line.variationId, 1)}
                    aria-label={`Add one ${line.label}`}
                  >
                    +
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 space-y-3 border-t border-border pt-4 text-sm">
            <Row label="Subtotal" value={money(totals.subtotalCents)} />
            <label className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Discount ($)</span>
              <Input
                inputMode="decimal"
                value={discountDollars}
                onChange={(e) => setDiscountDollars(e.target.value)}
                placeholder="0.00"
                className="numeric h-10 w-24 text-right"
              />
            </label>
            <Row label={taxInclusive ? "Tax (included)" : "Tax"} value={money(totals.taxCents)} />
            <div>
              <p className="mb-1.5 text-muted-foreground">Tip</p>
              <div className="flex gap-2">
                {TIP_PRESETS.map((rate) => (
                  <button
                    key={rate}
                    onClick={() => setTipRate(rate)}
                    className={cn(
                      "h-10 flex-1 rounded-md text-sm font-semibold transition-colors",
                      tipRate === rate
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-foreground hover:bg-secondary",
                    )}
                  >
                    {rate === 0 ? "None" : `${rate * 100}%`}
                  </button>
                ))}
              </div>
            </div>
            <Row label="Tip total" value={money(totals.tipCents)} />
            <div className="flex items-center justify-between pt-3 text-2xl font-black">
              <span>Total</span>
              <span className="numeric">{money(totals.totalCents)}</span>
            </div>

            {error && (
              <p className="text-sm font-medium text-destructive" role="alert">
                {error}
              </p>
            )}

            {!tendering ? (
              <Button
                variant="success"
                size="lg"
                disabled={cart.length === 0}
                onClick={() => {
                  setTendering(true);
                  setTenderDollars((totals.totalCents / 100).toFixed(2));
                }}
                className="mt-2 w-full"
              >
                Charge {money(totals.totalCents)}
              </Button>
            ) : (
              <div className="mt-2 space-y-3 rounded-lg bg-muted p-4">
                <div>
                  <label htmlFor="tender" className="mb-1 block font-medium">
                    Cash received
                  </label>
                  <Input
                    id="tender"
                    inputMode="decimal"
                    value={tenderDollars}
                    onChange={(e) => setTenderDollars(e.target.value)}
                    className="numeric h-12 text-right text-xl font-bold"
                    autoFocus
                  />
                </div>
                <Button variant="success" size="lg" onClick={completeSale} disabled={pending} className="w-full">
                  {pending ? "Saving…" : "Complete sale"}
                </Button>
                <Button variant="outline" onClick={() => setTendering(false)} className="w-full">
                  Back
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg bg-muted p-10 text-center">
      <Search size={28} className="text-muted-foreground" />
      <p className="text-sm text-muted-foreground">No items found. Add products in the Products screen.</p>
    </div>
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
