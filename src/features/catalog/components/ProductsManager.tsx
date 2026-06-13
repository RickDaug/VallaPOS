"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { formatMoney } from "@/lib/money";
import type { ManagedCatalog } from "@/features/catalog/queries";
import { createCategory, createItem, deleteCategory, deleteItem } from "@/features/catalog/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function ProductsManager({
  businessId,
  catalog,
  currency,
}: {
  businessId: string;
  catalog: ManagedCatalog;
  currency: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [type, setType] = useState<"PRODUCT" | "SERVICE">("PRODUCT");
  const [categoryId, setCategoryId] = useState("");
  const [price, setPrice] = useState("");
  const [categoryName, setCategoryName] = useState("");

  function run(fn: () => Promise<void>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
        after?.();
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    });
  }

  function onAddItem(e: React.FormEvent) {
    e.preventDefault();
    const priceCents = Math.round(parseFloat(price || "0") * 100);
    if (!name.trim()) return setError("Item name is required.");
    if (!Number.isFinite(priceCents) || priceCents < 0) return setError("Enter a valid price.");
    run(
      () => createItem({ businessId, name: name.trim(), type, categoryId: categoryId || null, priceCents }),
      () => {
        setName("");
        setPrice("");
      },
    );
  }

  function onAddCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!categoryName.trim()) return;
    run(() => createCategory({ businessId, name: categoryName.trim() }), () => setCategoryName(""));
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
      {/* Item list */}
      <Card>
        <CardContent className="p-4 md:p-5">
          <h2 className="mb-4 text-lg font-bold">Items</h2>
          {error && <p className="mb-3 text-sm font-medium text-destructive" role="alert">{error}</p>}
          {catalog.items.length === 0 ? (
            <p className="rounded-lg bg-muted p-6 text-center text-sm text-muted-foreground">
              No items yet. Add your first one on the right.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {catalog.items.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{item.name}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
                      <Badge variant={item.type === "SERVICE" ? "primary" : "muted"}>
                        {item.type === "SERVICE" ? "Service" : "Product"}
                      </Badge>
                      <span>{item.categoryName ?? "Uncategorized"}</span>
                      <span className="numeric">
                        · {item.variations.map((v) => formatMoney(v.priceCents, currency)).join(", ")}
                      </span>
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => {
                      if (confirm(`Delete "${item.name}"?`)) run(() => deleteItem({ businessId, id: item.id }));
                    }}
                    disabled={pending}
                    aria-label={`Delete ${item.name}`}
                  >
                    <Trash2 size={18} />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Forms */}
      <aside className="space-y-6">
        <Card>
          <CardContent className="space-y-3 p-4 md:p-5">
            <h2 className="text-lg font-bold">Add item</h2>
            <form onSubmit={onAddItem} className="space-y-3">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Item name" />
              <div className="flex gap-2">
                {(["PRODUCT", "SERVICE"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setType(t)}
                    className={cn(
                      "h-11 flex-1 rounded-md text-sm font-semibold transition-colors",
                      type === t ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-secondary",
                    )}
                  >
                    {t === "PRODUCT" ? "Product" : "Service"}
                  </button>
                ))}
              </div>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="h-12 w-full rounded-md border border-input bg-card px-4 text-base text-foreground shadow-sm focus-visible:border-ring"
              >
                <option value="">Uncategorized</option>
                {catalog.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <Input
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="Price (e.g. 9.99)"
                className="numeric"
              />
              <Button type="submit" disabled={pending} className="w-full">
                {pending ? "Saving…" : "Add item"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 p-4 md:p-5">
            <h2 className="text-lg font-bold">Categories</h2>
            <form onSubmit={onAddCategory} className="flex gap-2">
              <Input
                value={categoryName}
                onChange={(e) => setCategoryName(e.target.value)}
                placeholder="New category"
              />
              <Button type="submit" disabled={pending} size="icon" className="w-14 shrink-0">
                Add
              </Button>
            </form>
            {catalog.categories.length > 0 && (
              <ul className="divide-y divide-border">
                {catalog.categories.map((c) => (
                  <li key={c.id} className="flex items-center justify-between py-2">
                    <span className="font-medium">{c.name}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => {
                        if (confirm(`Delete category "${c.name}"? Items become uncategorized.`))
                          run(() => deleteCategory({ businessId, id: c.id }));
                      }}
                      disabled={pending}
                      aria-label={`Delete category ${c.name}`}
                    >
                      <Trash2 size={16} />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
