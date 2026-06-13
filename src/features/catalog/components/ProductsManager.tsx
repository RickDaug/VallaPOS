"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { formatMoney } from "@/lib/money";
import type { ManagedCatalog } from "@/features/catalog/queries";
import {
  createCategory,
  createItem,
  createModifier,
  createModifierGroup,
  deleteCategory,
  deleteItem,
  deleteModifier,
  deleteModifierGroup,
  linkModifierGroup,
  unlinkModifierGroup,
} from "@/features/catalog/actions";
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

  // Modifier group / modifier forms.
  const [groupName, setGroupName] = useState("");
  const [groupMin, setGroupMin] = useState("0");
  const [groupMax, setGroupMax] = useState("1");
  const [modGroupId, setModGroupId] = useState("");
  const [modName, setModName] = useState("");
  const [modPrice, setModPrice] = useState("");

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

  function onAddGroup(e: React.FormEvent) {
    e.preventDefault();
    const minSelect = parseInt(groupMin || "0", 10);
    const maxSelect = parseInt(groupMax || "1", 10);
    if (!groupName.trim()) return setError("Group name is required.");
    if (!Number.isInteger(minSelect) || !Number.isInteger(maxSelect) || maxSelect < 1)
      return setError("Enter valid min/max selections.");
    if (maxSelect < minSelect) return setError("Max must be at least min.");
    run(
      () => createModifierGroup({ businessId, name: groupName.trim(), minSelect, maxSelect }),
      () => {
        setGroupName("");
        setGroupMin("0");
        setGroupMax("1");
      },
    );
  }

  function onAddModifier(e: React.FormEvent) {
    e.preventDefault();
    const priceDeltaCents = Math.round(parseFloat(modPrice || "0") * 100);
    if (!modGroupId) return setError("Pick a modifier group.");
    if (!modName.trim()) return setError("Modifier name is required.");
    if (!Number.isFinite(priceDeltaCents) || priceDeltaCents < 0)
      return setError("Enter a valid price delta.");
    run(
      () => createModifier({ businessId, groupId: modGroupId, name: modName.trim(), priceDeltaCents }),
      () => {
        setModName("");
        setModPrice("");
      },
    );
  }

  function onToggleLink(itemId: string, groupId: string, linked: boolean) {
    run(() =>
      linked
        ? unlinkModifierGroup({ businessId, itemId, groupId })
        : linkModifierGroup({ businessId, itemId, groupId }),
    );
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
                <li key={item.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0 flex-1">
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
                    {catalog.modifierGroups.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {catalog.modifierGroups.map((g) => {
                          const linked = item.modifierGroupIds.includes(g.id);
                          return (
                            <button
                              key={g.id}
                              type="button"
                              onClick={() => onToggleLink(item.id, g.id, linked)}
                              disabled={pending}
                              aria-pressed={linked}
                              className={cn(
                                "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                                linked
                                  ? "border-primary bg-primary/10 text-foreground"
                                  : "border-border text-muted-foreground hover:bg-muted",
                              )}
                            >
                              {linked ? "✓ " : "+ "}
                              {g.name}
                            </button>
                          );
                        })}
                      </div>
                    )}
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

        {/* Modifier groups */}
        <Card>
          <CardContent className="space-y-4 p-4 md:p-5">
            <div>
              <h2 className="text-lg font-bold">Modifier groups</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Add-ons and options (e.g. milk choice, extra cheese). Link them to items above.
              </p>
            </div>

            <form onSubmit={onAddGroup} className="space-y-2">
              <Input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Group name (e.g. Milk)" />
              <div className="flex gap-2">
                <label className="flex-1 text-sm">
                  <span className="mb-1 block text-muted-foreground">Min</span>
                  <Input
                    inputMode="numeric"
                    value={groupMin}
                    onChange={(e) => setGroupMin(e.target.value)}
                    className="numeric"
                  />
                </label>
                <label className="flex-1 text-sm">
                  <span className="mb-1 block text-muted-foreground">Max</span>
                  <Input
                    inputMode="numeric"
                    value={groupMax}
                    onChange={(e) => setGroupMax(e.target.value)}
                    className="numeric"
                  />
                </label>
              </div>
              <Button type="submit" disabled={pending} className="w-full">
                {pending ? "Saving…" : "Add group"}
              </Button>
            </form>

            {catalog.modifierGroups.length > 0 && (
              <ul className="space-y-3 border-t border-border pt-3">
                {catalog.modifierGroups.map((g) => (
                  <li key={g.id} className="rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-semibold">{g.name}</span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          choose {g.minSelect}–{g.maxSelect}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => {
                          if (confirm(`Delete group "${g.name}" and its modifiers?`))
                            run(() => deleteModifierGroup({ businessId, id: g.id }));
                        }}
                        disabled={pending}
                        aria-label={`Delete group ${g.name}`}
                      >
                        <Trash2 size={16} />
                      </Button>
                    </div>
                    {g.modifiers.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {g.modifiers.map((m) => (
                          <li key={m.id} className="flex items-center justify-between text-sm">
                            <span className="numeric text-muted-foreground">
                              {m.name} · {formatMoney(m.priceDeltaCents, currency)}
                            </span>
                            <button
                              type="button"
                              onClick={() => run(() => deleteModifier({ businessId, id: m.id }))}
                              disabled={pending}
                              className="text-muted-foreground hover:text-destructive"
                              aria-label={`Delete modifier ${m.name}`}
                            >
                              <Trash2 size={14} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {catalog.modifierGroups.length > 0 && (
              <form onSubmit={onAddModifier} className="space-y-2 border-t border-border pt-3">
                <p className="text-sm font-semibold">Add modifier</p>
                <select
                  value={modGroupId}
                  onChange={(e) => setModGroupId(e.target.value)}
                  className="h-12 w-full rounded-md border border-input bg-card px-4 text-base text-foreground shadow-sm focus-visible:border-ring"
                >
                  <option value="">Select group…</option>
                  {catalog.modifierGroups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
                <Input value={modName} onChange={(e) => setModName(e.target.value)} placeholder="Modifier name (e.g. Oat milk)" />
                <Input
                  inputMode="decimal"
                  value={modPrice}
                  onChange={(e) => setModPrice(e.target.value)}
                  placeholder="Price delta (e.g. 0.75)"
                  className="numeric"
                />
                <Button type="submit" disabled={pending} className="w-full">
                  {pending ? "Saving…" : "Add modifier"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
