"use client";

import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { formatMoney, computeTotals } from "@/lib/money";
import type { SellableEntry } from "@/features/catalog/queries";
import { checkout, type Receipt } from "@/features/register/actions";

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
    () =>
      catalog.filter((e) => `${e.label} ${e.category}`.toLowerCase().includes(query.toLowerCase())),
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
        return cur.map((l) =>
          l.variationId === entry.variationId ? { ...l, qty: l.qty + 1 } : l,
        );
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
      <div className="mx-auto max-w-md rounded-3xl bg-white p-6 text-center shadow-sm">
        <h2 className="text-xl font-bold">Sale complete</h2>
        <p className="mt-1 text-sm text-slate-500">Order #{receipt.number}</p>
        <p className="mt-6 text-5xl font-black text-green-600">{money(receipt.changeCents)}</p>
        <p className="text-sm font-medium text-slate-500">change due</p>
        <div className="mt-6 space-y-2 border-t pt-4 text-left text-sm">
          <Row label="Total" value={money(receipt.totalCents)} />
          <Row label="Cash" value={money(receipt.cashTenderedCents)} />
          <Row label="Tax" value={money(receipt.taxCents)} />
          {receipt.tipCents > 0 && <Row label="Tip" value={money(receipt.tipCents)} />}
        </div>
        <button
          onClick={resetSale}
          className="mt-6 w-full rounded-2xl bg-slate-950 px-5 py-4 text-lg font-black text-white"
        >
          New sale
        </button>
      </div>
    );
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
      {/* Catalog */}
      <div className="rounded-3xl bg-white p-4 shadow-sm md:p-5">
        <div className="mb-4 flex items-center gap-2 rounded-2xl border bg-white px-3 py-2">
          <Search size={18} className="text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search items"
            aria-label="Search items"
            className="w-full outline-none"
          />
        </div>
        {filtered.length === 0 ? (
          <p className="rounded-2xl bg-slate-50 p-6 text-center text-sm text-slate-500">
            No items yet. Add products in the Products screen.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((entry) => (
              <button
                key={entry.variationId}
                onClick={() => addToCart(entry)}
                className="rounded-3xl border border-slate-200 bg-slate-50 p-4 text-left transition hover:-translate-y-0.5 hover:bg-white hover:shadow-md"
              >
                <div className="mb-6 flex items-center justify-between">
                  <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">
                    {entry.category}
                  </span>
                  <Plus size={18} />
                </div>
                <h3 className="font-bold">{entry.label}</h3>
                <p className="mt-1 text-2xl font-black">{money(entry.priceCents)}</p>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Cart */}
      <aside className="rounded-3xl bg-white p-4 shadow-sm md:p-5">
        <h2 className="mb-4 text-xl font-bold">Current sale</h2>
        <div className="min-h-40 space-y-3">
          {cart.length === 0 && (
            <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">
              Cart is empty. Tap an item to start.
            </p>
          )}
          {cart.map((line) => (
            <div key={line.variationId} className="flex items-center justify-between rounded-2xl border p-3">
              <div>
                <p className="font-semibold">{line.label}</p>
                <p className="text-sm text-slate-500">{money(line.priceCents)} each</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => changeQty(line.variationId, -1)}
                  aria-label={`Remove one ${line.label}`}
                  className="h-11 w-11 rounded-full bg-slate-100 text-lg font-bold"
                >
                  −
                </button>
                <span className="w-6 text-center font-bold">{line.qty}</span>
                <button
                  onClick={() => changeQty(line.variationId, 1)}
                  aria-label={`Add one ${line.label}`}
                  className="h-11 w-11 rounded-full bg-slate-900 text-lg font-bold text-white"
                >
                  +
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 space-y-3 border-t pt-4 text-sm">
          <Row label="Subtotal" value={money(totals.subtotalCents)} />
          <label className="flex items-center justify-between gap-3">
            <span className="text-slate-500">Discount ($)</span>
            <input
              inputMode="decimal"
              value={discountDollars}
              onChange={(e) => setDiscountDollars(e.target.value)}
              placeholder="0.00"
              className="w-24 rounded-xl border px-3 py-2 text-right outline-none"
            />
          </label>
          <Row label={taxInclusive ? "Tax (included)" : "Tax"} value={money(totals.taxCents)} />
          <div>
            <p className="mb-1 text-slate-500">Tip</p>
            <div className="flex gap-2">
              {TIP_PRESETS.map((rate) => (
                <button
                  key={rate}
                  onClick={() => setTipRate(rate)}
                  className={`flex-1 rounded-xl px-2 py-2 font-semibold ${
                    tipRate === rate ? "bg-slate-900 text-white" : "bg-slate-100 hover:bg-slate-200"
                  }`}
                >
                  {rate === 0 ? "None" : `${rate * 100}%`}
                </button>
              ))}
            </div>
          </div>
          <Row label="Tip total" value={money(totals.tipCents)} />
          <div className="flex items-center justify-between pt-3 text-2xl font-black">
            <span>Total</span>
            <span>{money(totals.totalCents)}</span>
          </div>

          {error && <p className="text-sm font-medium text-red-600">{error}</p>}

          {!tendering ? (
            <button
              disabled={cart.length === 0}
              onClick={() => {
                setTendering(true);
                setTenderDollars((totals.totalCents / 100).toFixed(2));
              }}
              className="mt-2 w-full rounded-2xl bg-green-600 px-5 py-4 text-lg font-black text-white disabled:bg-slate-300"
            >
              Charge {money(totals.totalCents)}
            </button>
          ) : (
            <div className="mt-2 space-y-3 rounded-2xl bg-slate-50 p-4">
              <label className="block">
                <span className="mb-1 block font-medium text-slate-700">Cash received</span>
                <input
                  inputMode="decimal"
                  value={tenderDollars}
                  onChange={(e) => setTenderDollars(e.target.value)}
                  className="w-full rounded-xl border px-3 py-3 text-right text-xl font-bold outline-none"
                  autoFocus
                />
              </label>
              <button
                onClick={completeSale}
                disabled={pending}
                className="w-full rounded-2xl bg-green-600 px-5 py-4 text-lg font-black text-white disabled:bg-slate-300"
              >
                {pending ? "Saving…" : "Complete sale"}
              </button>
              <button
                onClick={() => setTendering(false)}
                className="w-full rounded-2xl border px-5 py-2 font-bold"
              >
                Back
              </button>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      <span className="font-bold">{value}</span>
    </div>
  );
}
