"use client";

import { useEffect, useMemo, useState } from "react";
import { getLocalStore, isLocalStoreReady } from "@/lib/data-store/local-runtime";
import { LOCAL_BUSINESS_ID } from "@/lib/edition";
import { formatMoney } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { SellableEntry } from "@/features/catalog/queries";
import { type Receipt, isReceipt } from "@/features/register/schema";
import { autoPrintOrder } from "@/features/peripherals/native-print";

/**
 * Offline-edition Register (docs/EDITIONS.md §5b) — the CLIENT cash-only counterpart
 * of the cloud server-action register. It reads the catalog and RINGS UP A SALE
 * directly through the local SQLite store (`getLocalStore().store.checkout`), so it
 * has no Server Actions / offline queue / Stripe and survives `output:'export'`.
 *
 * v1 scope: tap items → cash tender → checkout → receipt. Modifiers, non-cash
 * tenders, discounts and tips are follow-ups (items requiring a modifier group will
 * be rejected server-side by the store until then).
 */
type CartLine = { entry: SellableEntry; qty: number };

const USD = "USD";

export default function LocalRegisterPage() {
  const [catalog, setCatalog] = useState<SellableEntry[] | null>(null);
  const [cart, setCart] = useState<Record<string, CartLine>>({});
  const [tender, setTender] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [printNote, setPrintNote] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = () => {
      if (!isLocalStoreReady()) {
        window.setTimeout(load, 100);
        return;
      }
      getLocalStore()
        .store.getRegisterCatalog(LOCAL_BUSINESS_ID)
        .then((c) => {
          if (active) setCatalog(c);
        });
    };
    load();
    return () => {
      active = false;
    };
  }, []);

  const subtotalCents = useMemo(
    () => Object.values(cart).reduce((sum, l) => sum + l.entry.priceCents * l.qty, 0),
    [cart],
  );
  const tenderCents = Math.round((parseFloat(tender) || 0) * 100);
  const lineCount = Object.values(cart).reduce((n, l) => n + l.qty, 0);

  function addItem(entry: SellableEntry) {
    setReceipt(null);
    setError(null);
    setCart((c) => ({
      ...c,
      [entry.variationId]: { entry, qty: (c[entry.variationId]?.qty ?? 0) + 1 },
    }));
  }

  function removeItem(variationId: string) {
    setCart((c) => {
      const line = c[variationId];
      if (!line) return c;
      const next = { ...c };
      if (line.qty <= 1) delete next[variationId];
      else next[variationId] = { entry: line.entry, qty: line.qty - 1 };
      return next;
    });
  }

  async function checkout() {
    if (lineCount === 0 || tenderCents < subtotalCents) return;
    setBusy(true);
    setError(null);
    try {
      const result = await getLocalStore().store.checkout({
        businessId: LOCAL_BUSINESS_ID,
        clientUuid: crypto.randomUUID(),
        lines: Object.values(cart).map((l) => ({
          variationId: l.entry.variationId,
          quantity: l.qty,
        })),
        tipCents: 0,
        cartDiscountCents: 0,
        method: "CASH",
        cashTenderedCents: tenderCents,
      });
      if (isReceipt(result)) {
        setReceipt(result);
        setCart({});
        setTender("");
        setPrintNote(null);
        // Best-effort native auto-print (no-op unless a printer is set in Settings).
        // The sale is already committed, so a print failure only shows a notice.
        void autoPrintOrder({
          getReceipt: (id) => getLocalStore().store.getOrderReceipt(LOCAL_BUSINESS_ID, id),
          orderId: result.orderId,
        }).catch(() => {
          setPrintNote("Sale saved, but the receipt didn't print. Check the printer in Settings.");
        });
      } else {
        setError("This sale needs an option to be chosen (not supported offline yet).");
      }
    } catch {
      setError("Checkout failed — please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!catalog) return <p className="text-muted-foreground text-sm">Loading register&hellip;</p>;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      {/* Item grid */}
      <section>
        <h1 className="mb-4 text-2xl font-black md:text-3xl">Register</h1>
        {catalog.length === 0 ? (
          <p className="text-muted-foreground text-sm">No items yet. Add products first.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {catalog.map((e) => (
              <button
                key={e.variationId}
                onClick={() => addItem(e)}
                className="border-border bg-card hover:border-primary/40 flex h-24 flex-col items-start justify-between rounded-xl border p-3 text-left transition active:scale-[0.98]"
              >
                <span className="line-clamp-2 text-sm font-semibold">{e.label}</span>
                <span className="numeric text-muted-foreground text-sm">
                  {formatMoney(e.priceCents, USD)}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Cart / tender */}
      <aside className="lg:sticky lg:top-6">
        <Card>
          <CardContent className="flex flex-col gap-4 p-4">
            {receipt ? (
              <div className="bg-muted rounded-lg p-4 text-center">
                <p className="text-lg font-black">Sale #{receipt.number} complete</p>
                <p className="numeric text-muted-foreground mt-1 text-sm">
                  Total {formatMoney(receipt.totalCents, USD)} · Change{" "}
                  {formatMoney(receipt.changeCents, USD)}
                </p>
                {printNote ? <p className="text-destructive mt-2 text-xs">{printNote}</p> : null}
              </div>
            ) : null}

            <ul className="flex-1 space-y-1">
              {Object.values(cart).length === 0 ? (
                <li className="text-muted-foreground py-6 text-center text-sm">Cart is empty</li>
              ) : (
                Object.values(cart).map((l) => (
                  <li
                    key={l.entry.variationId}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <button
                      onClick={() => removeItem(l.entry.variationId)}
                      className="flex-1 text-left"
                      aria-label={`Remove one ${l.entry.label}`}
                    >
                      <span className="numeric font-semibold">{l.qty}×</span> {l.entry.label}
                    </button>
                    <span className="numeric">{formatMoney(l.entry.priceCents * l.qty, USD)}</span>
                  </li>
                ))
              )}
            </ul>

            <div className="border-border flex items-center justify-between border-t pt-3 font-bold">
              <span>Subtotal</span>
              <span className="numeric">{formatMoney(subtotalCents, USD)}</span>
            </div>
            <p className="text-muted-foreground -mt-2 text-xs">Tax is added at checkout.</p>

            <label className="text-sm font-medium">
              Cash tendered
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={tender}
                onChange={(ev) => setTender(ev.target.value)}
                placeholder="0.00"
                className="border-border bg-background numeric mt-1 w-full rounded-lg border px-3 py-2 text-right"
              />
            </label>

            {error ? <p className="text-destructive text-sm">{error}</p> : null}

            <Button
              onClick={checkout}
              disabled={busy || lineCount === 0 || tenderCents < subtotalCents}
              className="w-full"
            >
              {busy ? "Ringing up…" : "Charge cash"}
            </Button>
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
