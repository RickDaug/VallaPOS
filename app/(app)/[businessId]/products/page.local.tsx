"use client";

import { type FormEvent, useEffect, useState } from "react";
import { getLocalStore, isLocalStoreReady } from "@/lib/data-store/local-runtime";
import { LOCAL_BUSINESS_ID } from "@/lib/edition";
import { formatMoney } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { ManagedCatalog } from "@/features/catalog/queries";

const USD = "USD";
const toCents = (s: string) => Math.round((parseFloat(s) || 0) * 100);

/**
 * Offline-edition Products (docs/EDITIONS.md §5b) — add/list/delete sellable items
 * so the register has something to sell (the offline app seeds no catalog). Writes
 * go through the local store's `createSimpleItem`/`deleteItem`. v1: name + price
 * (a Default variation); categories, sizes, and modifiers are follow-ups.
 */
export default function LocalProductsPage() {
  const [catalog, setCatalog] = useState<ManagedCatalog | null>(null);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = () =>
    getLocalStore().store.getManagedCatalog(LOCAL_BUSINESS_ID).then(setCatalog);

  useEffect(() => {
    let active = true;
    const load = () => {
      if (!isLocalStoreReady()) {
        window.setTimeout(load, 100);
        return;
      }
      getLocalStore()
        .store.getManagedCatalog(LOCAL_BUSINESS_ID)
        .then((c) => {
          if (active) setCatalog(c);
        });
    };
    load();
    return () => {
      active = false;
    };
  }, []);

  async function addItem(e: FormEvent) {
    e.preventDefault();
    const cents = toCents(price);
    if (!name.trim() || cents <= 0) return;
    setBusy(true);
    await getLocalStore().store.createSimpleItem(LOCAL_BUSINESS_ID, {
      name: name.trim(),
      priceCents: cents,
    });
    setName("");
    setPrice("");
    await refresh();
    setBusy(false);
  }

  async function del(itemId: string) {
    await getLocalStore().store.deleteItem(LOCAL_BUSINESS_ID, itemId);
    await refresh();
  }

  if (!catalog) return <p className="text-sm text-muted-foreground">Loading products&hellip;</p>;

  return (
    <section className="max-w-2xl">
      <h1 className="mb-6 text-2xl font-black md:text-3xl">Products</h1>

      <Card>
        <CardContent className="p-4">
          <form onSubmit={addItem} className="flex flex-wrap items-end gap-2">
            <label className="flex-1 text-sm font-medium">
              Name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Latte"
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2"
              />
            </label>
            <label className="w-28 text-sm font-medium">
              Price
              <input
                type="number"
                min="0"
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0.00"
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-right numeric"
              />
            </label>
            <Button type="submit" disabled={busy}>
              {busy ? "Adding…" : "Add item"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <ul className="mt-4 space-y-2">
        {catalog.items.length === 0 ? (
          <li className="rounded-lg bg-muted p-6 text-center text-sm text-muted-foreground">
            No products yet. Add one above.
          </li>
        ) : (
          catalog.items.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between rounded-lg border border-border p-3"
            >
              <span className="font-medium">{item.name}</span>
              <div className="flex items-center gap-4">
                <span className="numeric text-muted-foreground">
                  {formatMoney(item.variations[0]?.priceCents ?? 0, USD)}
                </span>
                <button
                  onClick={() => del(item.id)}
                  className="text-sm font-medium text-destructive hover:underline"
                >
                  Delete
                </button>
              </div>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
