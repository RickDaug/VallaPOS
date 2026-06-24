"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, CloudOff, Plus, RefreshCw, Search, WifiOff } from "lucide-react";
import { formatMoney } from "@/lib/money";
import { lockOperator } from "@/features/employees/actions";
import { computePricedOrder, type PricedLineInput } from "@/features/register/pricing";
import type { SellableEntry, SellableModifierGroup } from "@/features/catalog/queries";
import { type Receipt } from "@/features/register/actions";
import { useOfflineCheckout } from "@/lib/offline/use-offline-checkout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { NumberPad } from "@/components/ui/number-pad";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { quickTenderOptions, dollarsToCents } from "@/features/register/tender";
import { cn } from "@/lib/utils";

type ChosenModifier = { id: string; name: string; priceDeltaCents: number };
type CartLine = {
  // A unique key per (variation + chosen-modifier-set) so two differently
  // modified instances of the same item are distinct cart lines.
  key: string;
  variationId: string;
  label: string;
  priceCents: number;
  qty: number;
  modifiers: ChosenModifier[];
};

const TIP_PRESETS = [0, 0.15, 0.2, 0.25];

/** Stable key for a (variation, chosen modifiers) pair. */
function lineKey(variationId: string, modifierIds: string[]): string {
  return [variationId, ...[...modifierIds].sort()].join("|");
}

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
  const router = useRouter();
  const [cart, setCart] = useState<CartLine[]>([]);
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const [tipRate, setTipRate] = useState(0);
  const [discountDollars, setDiscountDollars] = useState("");
  const [tendering, setTendering] = useState(false);
  const [tenderDollars, setTenderDollars] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [queued, setQueued] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Item awaiting modifier selection (null = picker closed).
  const [picking, setPicking] = useState<SellableEntry | null>(null);
  const { online, pending: queuedCount, syncing, submit } = useOfflineCheckout();

  const money = (c: number) => formatMoney(c, currency);

  // "All" plus the distinct categories present in the catalog, for the tab row.
  const categories = useMemo(() => {
    const set = new Set(catalog.map((e) => e.category));
    return ["All", ...[...set].sort((a, b) => a.localeCompare(b))];
  }, [catalog]);

  const filtered = useMemo(
    () =>
      catalog.filter(
        (e) =>
          (activeCategory === "All" || e.category === activeCategory) &&
          `${e.label} ${e.category}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [catalog, query, activeCategory],
  );

  const cartDiscountCents = Math.max(0, Math.round(parseFloat(discountDollars || "0") * 100)) || 0;

  const totals = useMemo(() => {
    const lines: PricedLineInput[] = cart.map((l) => ({
      unitPriceCents: l.priceCents,
      quantity: l.qty,
      modifiers: l.modifiers.map((m) => ({
        id: m.id,
        nameSnapshot: m.name,
        priceDeltaCents: m.priceDeltaCents,
      })),
    }));
    const subtotal = lines.reduce(
      (s, l) =>
        s +
        (l.unitPriceCents + l.modifiers!.reduce((a, m) => a + m.priceDeltaCents, 0)) * l.quantity,
      0,
    );
    const tipCents = Math.round(Math.max(subtotal - cartDiscountCents, 0) * tipRate);
    return computePricedOrder(lines, { taxRateBps, cartDiscountCents, tipCents, taxInclusive });
  }, [cart, taxRateBps, cartDiscountCents, tipRate, taxInclusive]);

  /** Add an item to the cart with an (already-chosen) modifier set. */
  function addLine(entry: SellableEntry, modifiers: ChosenModifier[]) {
    const key = lineKey(
      entry.variationId,
      modifiers.map((m) => m.id),
    );
    setCart((cur) => {
      const existing = cur.find((l) => l.key === key);
      if (existing) {
        return cur.map((l) => (l.key === key ? { ...l, qty: l.qty + 1 } : l));
      }
      return [
        ...cur,
        { key, variationId: entry.variationId, label: entry.label, priceCents: entry.priceCents, qty: 1, modifiers },
      ];
    });
  }

  function addToCart(entry: SellableEntry) {
    // Items with modifier groups open the picker; everything else adds directly.
    if (entry.modifierGroups.length > 0) {
      setPicking(entry);
      return;
    }
    addLine(entry, []);
  }

  function changeQty(key: string, delta: number) {
    setCart((cur) =>
      cur
        .map((l) => (l.key === key ? { ...l, qty: l.qty + delta } : l))
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
    setQueued(false);
    setError(null);
  }

  // After a completed sale, re-lock the terminal so the next order requires a PIN
  // (the chosen "re-lock after each sale" behavior). The shell re-renders to the
  // operator lock screen on refresh.
  async function finishAndLock() {
    try {
      await lockOperator({ businessId });
    } catch {
      /* best effort — idle auto-lock is the backstop */
    }
    resetSale();
    router.refresh();
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
      const result = await submit({
        businessId,
        clientUuid: crypto.randomUUID(),
        lines: cart.map((l) => ({
          variationId: l.variationId,
          quantity: l.qty,
          modifierIds: l.modifiers.map((m) => m.id),
        })),
        tipCents: totals.tipCents,
        cartDiscountCents,
        cashTenderedCents,
      });
      if (result.status === "completed") {
        setReceipt(result.receipt);
      } else {
        setQueued(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed.");
    } finally {
      setPending(false);
    }
  }

  if (queued) {
    return (
      <Card className="mx-auto max-w-md text-center">
        <CardContent className="p-8">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-warning/15 text-warning">
            <CloudOff size={30} />
          </div>
          <h2 className="text-xl font-bold">Sale saved offline</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            No connection right now. This sale is stored on this device and will be sent
            automatically when you&apos;re back online.
          </p>
          <div className="mt-6 space-y-2 border-t border-border pt-4 text-left text-sm">
            <Row label="Total" value={money(totals.totalCents)} />
            <Row label="Cash" value={money(Math.round(parseFloat(tenderDollars || "0") * 100))} />
          </div>
          <Button onClick={finishAndLock} size="lg" className="mt-6 w-full">
            New sale
          </Button>
        </CardContent>
      </Card>
    );
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
          <Button onClick={finishAndLock} size="lg" className="mt-6 w-full">
            New sale
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {picking && (
        <ModifierPicker
          entry={picking}
          currency={currency}
          onCancel={() => setPicking(null)}
          onConfirm={(modifiers) => {
            addLine(picking, modifiers);
            setPicking(null);
          }}
        />
      )}
      <OfflineBanner online={online} queuedCount={queuedCount} syncing={syncing} />
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
          {categories.length > 2 && (
            <div className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Filter by category">
              {categories.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="tab"
                  aria-selected={activeCategory === c}
                  onClick={() => setActiveCategory(c)}
                  className={cn(
                    "h-9 shrink-0 rounded-full px-4 text-sm font-semibold transition-colors",
                    activeCategory === c
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground hover:bg-secondary",
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
          )}
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
            {cart.map((line) => {
              const lineUnit =
                line.priceCents + line.modifiers.reduce((a, m) => a + m.priceDeltaCents, 0);
              return (
                <div key={line.key} className="flex items-center justify-between rounded-lg border border-border p-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{line.label}</p>
                    {line.modifiers.length > 0 && (
                      <ul className="mt-0.5 space-y-0.5">
                        {line.modifiers.map((m) => (
                          <li key={m.id} className="numeric truncate text-xs text-muted-foreground">
                            + {m.name}
                            {m.priceDeltaCents !== 0 && <> ({money(m.priceDeltaCents)})</>}
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="numeric text-sm text-muted-foreground">{money(lineUnit)} each</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="secondary"
                      size="icon"
                      className="h-10 w-10 rounded-full"
                      onClick={() => changeQty(line.key, -1)}
                      aria-label={`Remove one ${line.label}`}
                    >
                      −
                    </Button>
                    <span className="numeric w-6 text-center font-bold">{line.qty}</span>
                    <Button
                      size="icon"
                      className="h-10 w-10 rounded-full"
                      onClick={() => changeQty(line.key, 1)}
                      aria-label={`Add one ${line.label}`}
                    >
                      +
                    </Button>
                  </div>
                </div>
              );
            })}
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
                  // Start empty so the numpad/quick-cash chips fill it cleanly.
                  setTenderDollars("");
                }}
                className="mt-2 w-full"
              >
                Charge {money(totals.totalCents)}
              </Button>
            ) : (
              <div className="mt-2 space-y-3 rounded-lg bg-muted p-4">
                <div>
                  <span className="mb-1 block font-medium">Cash received</span>
                  <div
                    className="numeric flex h-14 items-center justify-end rounded-md border border-border bg-card px-4 text-3xl font-black"
                    aria-live="polite"
                  >
                    {money(dollarsToCents(tenderDollars))}
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {quickTenderOptions(totals.totalCents).map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setTenderDollars((c / 100).toFixed(2))}
                      className="h-11 rounded-md border border-border bg-card text-sm font-bold transition-colors hover:bg-secondary active:scale-[0.98]"
                    >
                      {c === totals.totalCents ? "Exact" : money(c)}
                    </button>
                  ))}
                </div>
                <NumberPad value={tenderDollars} onChange={setTenderDollars} />
                <div className="flex items-center justify-between border-t border-border pt-3 text-lg font-bold">
                  <span>Change due</span>
                  <span className="numeric">
                    {money(Math.max(0, dollarsToCents(tenderDollars) - totals.totalCents))}
                  </span>
                </div>
                <Button
                  variant="success"
                  size="lg"
                  onClick={completeSale}
                  disabled={pending || dollarsToCents(tenderDollars) < totals.totalCents}
                  className="w-full"
                >
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
    </div>
  );
}

function OfflineBanner({
  online,
  queuedCount,
  syncing,
}: {
  online: boolean;
  queuedCount: number;
  syncing: boolean;
}) {
  if (online && queuedCount === 0) return null;

  if (!online) {
    return (
      <div
        role="status"
        className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm font-medium text-warning-foreground"
      >
        <WifiOff size={16} className="shrink-0 text-warning" />
        <span>
          Offline — sales are saved on this device
          {queuedCount > 0 ? ` (${queuedCount} waiting to sync)` : ""} and sent when you reconnect.
        </span>
      </div>
    );
  }

  // Online but draining the backlog.
  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-4 py-2.5 text-sm font-medium text-foreground"
    >
      <RefreshCw size={16} className={cn("shrink-0 text-primary", syncing && "animate-spin")} />
      <span>
        {syncing ? "Syncing" : "Pending"} {queuedCount} offline{" "}
        {queuedCount === 1 ? "sale" : "sales"}…
      </span>
    </div>
  );
}

/**
 * Modal that prompts the cashier to choose modifiers for an item, honoring each
 * group's minSelect/maxSelect. The "Add" button is disabled until every group's
 * minimum is satisfied; the server re-validates the same rules at checkout.
 */
function ModifierPicker({
  entry,
  currency,
  onCancel,
  onConfirm,
}: {
  entry: SellableEntry;
  currency: string;
  onCancel: () => void;
  onConfirm: (modifiers: ChosenModifier[]) => void;
}) {
  const money = (c: number) => formatMoney(c, currency);
  // Selected modifier ids per group.
  const [selected, setSelected] = useState<Record<string, string[]>>({});

  function toggle(group: SellableModifierGroup, modifierId: string) {
    setSelected((cur) => {
      const chosen = cur[group.id] ?? [];
      const has = chosen.includes(modifierId);
      let next: string[];
      if (has) {
        next = chosen.filter((id) => id !== modifierId);
      } else if (group.maxSelect <= 1) {
        // Single-select: replace.
        next = [modifierId];
      } else if (chosen.length >= group.maxSelect) {
        return cur; // at the cap — ignore
      } else {
        next = [...chosen, modifierId];
      }
      return { ...cur, [group.id]: next };
    });
  }

  const satisfied = entry.modifierGroups.every(
    (g) => (selected[g.id]?.length ?? 0) >= g.minSelect,
  );

  function confirm() {
    const modifiers: ChosenModifier[] = [];
    for (const g of entry.modifierGroups) {
      for (const id of selected[g.id] ?? []) {
        const m = g.modifiers.find((x) => x.id === id);
        if (m) modifiers.push({ id: m.id, name: m.name, priceDeltaCents: m.priceDeltaCents });
      }
    }
    onConfirm(modifiers);
  }

  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        // Closing via Escape / overlay / X counts as cancel.
        if (!isOpen) onCancel();
      }}
    >
      <DialogContent
        aria-label={`Choose options for ${entry.label}`}
        className="max-h-[85vh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>{entry.label}</DialogTitle>
          <p className="numeric text-sm text-muted-foreground">{money(entry.priceCents)}</p>
        </DialogHeader>

        <div className="space-y-5">
          {entry.modifierGroups.map((group) => {
            const chosen = selected[group.id] ?? [];
            const rule =
              group.minSelect > 0
                ? `Choose ${group.minSelect}${group.maxSelect > group.minSelect ? `–${group.maxSelect}` : ""}`
                : group.maxSelect > 1
                  ? `Optional · up to ${group.maxSelect}`
                  : "Optional";
            return (
              <div key={group.id}>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="font-semibold">{group.name}</h3>
                  <span className="text-xs text-muted-foreground">{rule}</span>
                </div>
                <div className="space-y-1.5">
                  {group.modifiers.map((m) => {
                    const active = chosen.includes(m.id);
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => toggle(group, m.id)}
                        aria-pressed={active}
                        className={cn(
                          "flex w-full items-center justify-between rounded-md border p-3 text-left text-sm transition-colors",
                          active
                            ? "border-primary bg-primary/10 font-semibold"
                            : "border-border hover:bg-muted",
                        )}
                      >
                        <span>{m.name}</span>
                        <span className="numeric text-muted-foreground">
                          {m.priceDeltaCents > 0 ? `+${money(m.priceDeltaCents)}` : money(m.priceDeltaCents)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <DialogFooter className="mt-6">
          <Button variant="outline" onClick={onCancel} className="flex-1">
            Cancel
          </Button>
          <Button onClick={confirm} disabled={!satisfied} className="flex-1">
            Add to cart
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
