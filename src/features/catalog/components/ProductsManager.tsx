"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Pencil, ChevronUp, ChevronDown, Plus, PackageOpen } from "lucide-react";
import { formatMoney } from "@/lib/money";
import type { ManagedCatalog, ManagedItem, ManagedVariation } from "@/features/catalog/queries";
import {
  addItemIngredientOptions,
  createCategory,
  createItem,
  createModifier,
  createModifierGroup,
  createModifierGroupWithModifiers,
  createVariation,
  deleteCategory,
  deleteItem,
  deleteModifier,
  deleteModifierGroup,
  deleteVariation,
  linkModifierGroup,
  setItemActive,
  unlinkModifierGroup,
  updateCategorySortOrder,
  updateItem,
  updateVariation,
} from "@/features/catalog/actions";
import { parseModifierLines, buildIngredientOptions } from "@/features/catalog/bulk-parse";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

/** DOM id of the add-item name field (targeted by the empty-state CTA). */
const ADD_ITEM_NAME_ID = "add-item-name";

/** Options for the shared {@link run} action runner. */
type RunOpts = { success?: string };

/** Signature of the shared action runner threaded down to child editors. */
type RunFn = (fn: () => Promise<void>, after?: () => void, opts?: RunOpts) => void;

/** Parse a "9.99" string to integer cents; returns NaN when invalid. */
function dollarsToCents(value: string): number {
  return Math.round(parseFloat(value || "0") * 100);
}

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
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [confirm, confirmDialog] = useConfirm();

  const [name, setName] = useState("");
  // Scroll to + focus the add-item name field wherever it sits (below the list on
  // mobile, to the right on xl+) so the empty-state CTA always lands somewhere.
  function focusAddItem() {
    const el = document.getElementById(ADD_ITEM_NAME_ID) as HTMLInputElement | null;
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    el?.focus({ preventScroll: true });
  }
  const [type, setType] = useState<"PRODUCT" | "SERVICE">("PRODUCT");
  const [categoryId, setCategoryId] = useState("");
  const [price, setPrice] = useState("");
  const [categoryName, setCategoryName] = useState("");

  // Modifier group / modifier forms.
  const [groupName, setGroupName] = useState("");
  const [groupMin, setGroupMin] = useState("0");
  const [groupMax, setGroupMax] = useState("1");
  // Multi-line options box: type ALL options at once (one per line) instead of
  // adding them one-by-one afterwards.
  const [groupOptions, setGroupOptions] = useState("");
  const [modGroupId, setModGroupId] = useState("");
  const [modName, setModName] = useState("");
  const [modPrice, setModPrice] = useState("");

  // Which item is open in the inline editor (item edit + variations).
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const run: RunFn = (fn, after, opts) => {
    startTransition(async () => {
      try {
        await fn();
        after?.();
        if (opts?.success) toast({ title: opts.success, variant: "success" });
        router.refresh();
      } catch (err) {
        toast({
          title: "Something went wrong",
          description: err instanceof Error ? err.message : undefined,
          variant: "error",
        });
      }
    });
  };

  function onAddItem(e: React.FormEvent) {
    e.preventDefault();
    const priceCents = dollarsToCents(price);
    if (!name.trim()) return toast({ title: "Item name is required.", variant: "error" });
    if (!Number.isFinite(priceCents) || priceCents < 0)
      return toast({ title: "Enter a valid price.", variant: "error" });
    const itemName = name.trim();
    run(
      () => createItem({ businessId, name: itemName, type, categoryId: categoryId || null, priceCents }),
      () => {
        setName("");
        setPrice("");
      },
      { success: `“${itemName}” added` },
    );
  }

  function onAddCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!categoryName.trim()) return;
    const trimmed = categoryName.trim();
    run(() => createCategory({ businessId, name: trimmed }), () => setCategoryName(""), {
      success: `Category “${trimmed}” added`,
    });
  }

  function onAddGroup(e: React.FormEvent) {
    e.preventDefault();
    const minSelect = parseInt(groupMin || "0", 10);
    const maxSelect = parseInt(groupMax || "1", 10);
    if (!groupName.trim()) return toast({ title: "Group name is required.", variant: "error" });
    if (!Number.isInteger(minSelect) || !Number.isInteger(maxSelect) || maxSelect < 1)
      return toast({ title: "Enter valid min/max selections.", variant: "error" });
    if (maxSelect < minSelect) return toast({ title: "Max must be at least min.", variant: "error" });
    const trimmed = groupName.trim();

    // Parse the optional multi-line options box. When it has options, create the
    // group + all of them in one call; otherwise just the (empty) group.
    const { options, errors } = parseModifierLines(groupOptions);
    if (errors.length > 0) {
      return toast({
        title: "Fix the options first",
        description: `Line ${errors[0]!.line}: ${errors[0]!.message}`,
        variant: "error",
      });
    }

    const reset = () => {
      setGroupName("");
      setGroupMin("0");
      setGroupMax("1");
      setGroupOptions("");
    };

    if (options.length > 0) {
      run(
        () =>
          createModifierGroupWithModifiers({
            businessId,
            name: trimmed,
            minSelect,
            maxSelect,
            options,
          }),
        reset,
        { success: `Group “${trimmed}” + ${options.length} option${options.length === 1 ? "" : "s"} added` },
      );
    } else {
      run(() => createModifierGroup({ businessId, name: trimmed, minSelect, maxSelect }), reset, {
        success: `Group “${trimmed}” added`,
      });
    }
  }

  function onAddModifier(e: React.FormEvent) {
    e.preventDefault();
    const priceDeltaCents = dollarsToCents(modPrice);
    if (!modGroupId) return toast({ title: "Pick a modifier group.", variant: "error" });
    if (!modName.trim()) return toast({ title: "Modifier name is required.", variant: "error" });
    if (!Number.isFinite(priceDeltaCents) || priceDeltaCents < 0)
      return toast({ title: "Enter a valid price delta.", variant: "error" });
    const trimmed = modName.trim();
    run(
      () => createModifier({ businessId, groupId: modGroupId, name: trimmed, priceDeltaCents }),
      () => {
        setModName("");
        setModPrice("");
      },
      { success: `Modifier “${trimmed}” added` },
    );
  }

  function onToggleLink(itemId: string, groupId: string, linked: boolean) {
    run(() =>
      linked
        ? unlinkModifierGroup({ businessId, itemId, groupId })
        : linkModifierGroup({ businessId, itemId, groupId }),
    );
  }

  // Move a category up/down by swapping its sortOrder with the neighbour.
  function onMoveCategory(index: number, dir: -1 | 1) {
    const a = catalog.categories[index];
    const b = catalog.categories[index + dir];
    if (!a || !b) return;
    run(async () => {
      await updateCategorySortOrder({ businessId, id: a.id, sortOrder: b.sortOrder });
      await updateCategorySortOrder({ businessId, id: b.id, sortOrder: a.sortOrder });
    });
  }

  const activeItems = catalog.items.filter((i) => i.active);
  const archivedItems = catalog.items.filter((i) => !i.active);

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
      {/* Item list */}
      <Card>
        <CardContent className="p-4 md:p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold">Items</h2>
            {archivedItems.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowArchived((s) => !s)}
                aria-pressed={showArchived}
              >
                {showArchived ? "Hide" : "Show"} archived ({archivedItems.length})
              </Button>
            )}
          </div>
          {activeItems.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-lg bg-muted/60 p-8 text-center">
              <PackageOpen className="text-muted-foreground" size={32} aria-hidden />
              <p className="font-semibold">No active items yet</p>
              <p className="max-w-xs text-sm text-muted-foreground">
                Add your first product or service in the{" "}
                <span className="font-medium text-foreground">Add item</span> form
                <span className="xl:hidden"> below</span>
                <span className="hidden xl:inline"> on the right</span>.
              </p>
              <Button type="button" onClick={focusAddItem} className="mt-1">
                <Plus size={16} className="mr-1" />
                Add your first item
              </Button>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {activeItems.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  catalog={catalog}
                  currency={currency}
                  businessId={businessId}
                  pending={pending}
                  isEditing={editingItemId === item.id}
                  onToggleEdit={() =>
                    setEditingItemId((id) => (id === item.id ? null : item.id))
                  }
                  onToggleLink={onToggleLink}
                  run={run}
                  confirm={confirm}
                />
              ))}
            </ul>
          )}

          {showArchived && archivedItems.length > 0 && (
            <div className="mt-6">
              <h3 className="mb-2 text-sm font-bold text-muted-foreground">Archived</h3>
              <ul className="divide-y divide-border">
                {archivedItems.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    catalog={catalog}
                    currency={currency}
                    businessId={businessId}
                    pending={pending}
                    isEditing={editingItemId === item.id}
                    onToggleEdit={() =>
                      setEditingItemId((id) => (id === item.id ? null : item.id))
                    }
                    onToggleLink={onToggleLink}
                    run={run}
                    confirm={confirm}
                  />
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Forms */}
      <aside className="space-y-6">
        <Card>
          <CardContent className="space-y-3 p-4 md:p-5">
            <h2 className="text-lg font-bold">Add item</h2>
            <form onSubmit={onAddItem} className="space-y-3">
              <Input
                id={ADD_ITEM_NAME_ID}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Item name"
              />
              <div className="flex gap-2">
                {(["PRODUCT", "SERVICE"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setType(t)}
                    className={cn(
                      "h-11 flex-1 rounded-md text-sm font-semibold transition-[color,background-color,transform] active:scale-[0.98]",
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
                {catalog.categories.map((c, index) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 py-2">
                    <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                    <div className="flex shrink-0 items-center">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 text-muted-foreground"
                        onClick={() => onMoveCategory(index, -1)}
                        disabled={pending || index === 0}
                        aria-label={`Move ${c.name} up`}
                      >
                        <ChevronUp size={16} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 text-muted-foreground"
                        onClick={() => onMoveCategory(index, 1)}
                        disabled={pending || index === catalog.categories.length - 1}
                        aria-label={`Move ${c.name} down`}
                      >
                        <ChevronDown size={16} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        onClick={async () => {
                          if (
                            await confirm({
                              title: `Delete category "${c.name}"?`,
                              description: "Items in this category become uncategorized.",
                              confirmLabel: "Delete",
                            })
                          )
                            run(() => deleteCategory({ businessId, id: c.id }), undefined, {
                              success: `Category “${c.name}” deleted`,
                            });
                        }}
                        disabled={pending}
                        aria-label={`Delete category ${c.name}`}
                      >
                        <Trash2 size={16} />
                      </Button>
                    </div>
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
              <label className="block text-sm">
                <span className="mb-1 block text-muted-foreground">
                  Options — one per line (optional)
                </span>
                <textarea
                  value={groupOptions}
                  onChange={(e) => setGroupOptions(e.target.value)}
                  rows={4}
                  placeholder={"Oat milk +0.75\nWhole milk\nAlmond +0.75"}
                  className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground shadow-sm outline-none focus-visible:border-ring"
                />
                <span className="mt-1 block text-xs text-muted-foreground">
                  Add every option at once. Put a price after the name (<code>Oat milk +0.75</code>);
                  no price means free.
                </span>
              </label>
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
                        onClick={async () => {
                          if (
                            await confirm({
                              title: `Delete group "${g.name}"?`,
                              description: "This group and all its modifiers will be removed.",
                              confirmLabel: "Delete",
                            })
                          )
                            run(() => deleteModifierGroup({ businessId, id: g.id }), undefined, {
                              success: `Group “${g.name}” deleted`,
                            });
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
                              onClick={() =>
                                run(() => deleteModifier({ businessId, id: m.id }), undefined, {
                                  success: `Modifier “${m.name}” deleted`,
                                })
                              }
                              disabled={pending}
                              className="rounded p-1 text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
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
      {confirmDialog}
    </div>
  );
}

// ── Item row (display + inline edit + variations) ─────────────────────────────

function ItemRow({
  item,
  catalog,
  currency,
  businessId,
  pending,
  isEditing,
  onToggleEdit,
  onToggleLink,
  run,
  confirm,
}: {
  item: ManagedItem;
  catalog: ManagedCatalog;
  currency: string;
  businessId: string;
  pending: boolean;
  isEditing: boolean;
  onToggleEdit: () => void;
  onToggleLink: (itemId: string, groupId: string, linked: boolean) => void;
  run: RunFn;
  confirm: (opts: { title: string; description?: string; confirmLabel?: string }) => Promise<boolean>;
}) {
  return (
    <li
      className={cn(
        "-mx-2 rounded-lg px-2 py-3 transition-colors hover:bg-muted/40",
        !item.active && "opacity-60",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">
            {item.name}
            {!item.active && (
              <Badge variant="muted" className="ml-2 align-middle">
                Archived
              </Badge>
            )}
          </p>
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
                      "rounded-full border px-2.5 py-1 text-xs font-medium transition-[color,background-color,transform] active:scale-[0.97] disabled:opacity-50",
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
        <div className="flex shrink-0 items-center">
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 text-muted-foreground"
            onClick={onToggleEdit}
            disabled={pending}
            aria-label={`Edit ${item.name}`}
            aria-pressed={isEditing}
          >
            <Pencil size={16} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() =>
              run(() => setItemActive({ businessId, id: item.id, active: !item.active }), undefined, {
                success: item.active ? `“${item.name}” archived` : `“${item.name}” restored`,
              })
            }
            disabled={pending}
          >
            {item.active ? "Archive" : "Restore"}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            onClick={async () => {
              if (await confirm({ title: `Delete "${item.name}"?`, confirmLabel: "Delete" }))
                run(() => deleteItem({ businessId, id: item.id }), undefined, {
                  success: `“${item.name}” deleted`,
                });
            }}
            disabled={pending}
            aria-label={`Delete ${item.name}`}
          >
            <Trash2 size={18} />
          </Button>
        </div>
      </div>

      {isEditing && (
        <div className="mt-3 rounded-lg border border-border bg-muted/40 p-3">
          <ItemEditor
            item={item}
            catalog={catalog}
            businessId={businessId}
            pending={pending}
            run={run}
            onDone={onToggleEdit}
          />
          <VariationsEditor
            item={item}
            currency={currency}
            businessId={businessId}
            pending={pending}
            run={run}
            confirm={confirm}
          />
          <IngredientOptionsEditor
            item={item}
            businessId={businessId}
            pending={pending}
            run={run}
          />
        </div>
      )}
    </li>
  );
}

// ── Per-item ingredient options (No ___ / Extra ___) ──────────────────────────

/**
 * Type an item's ingredients once; this generates a "No ___" (free) + "Extra ___"
 * (+upcharge) option for each and links them to THIS item, so they appear in the
 * register's options picker when the item is rung up. Co-located with the item so
 * setup is discoverable (no separate group-create + link dance).
 */
function IngredientOptionsEditor({
  item,
  businessId,
  pending,
  run,
}: {
  item: ManagedItem;
  businessId: string;
  pending: boolean;
  run: RunFn;
}) {
  const [text, setText] = useState("");
  const [groupName, setGroupName] = useState("Modifications");

  const { options, errors } = buildIngredientOptions(text);
  const ingredientCount = options.length / 2;

  function onAdd() {
    if (errors.length > 0 || options.length === 0) return;
    const name = groupName.trim() || "Modifications";
    run(
      () => addItemIngredientOptions({ businessId, itemId: item.id, groupName: name, options }),
      () => setText(""),
      { success: `Added ${ingredientCount} ingredient${ingredientCount === 1 ? "" : "s"} to “${item.name}”` },
    );
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      <p className="text-sm font-semibold">Ingredient options (No / Extra)</p>
      <p className="mb-2 text-xs text-muted-foreground">
        One ingredient per line; add <code>+price</code> for the Extra upcharge (blank = free). Each
        becomes a “No ___” and an “Extra ___” the cashier can tap when ringing up this item.
      </p>
      <div className="flex gap-2">
        <Input
          value={groupName}
          onChange={(e) => setGroupName(e.target.value)}
          placeholder="Group name"
          className="max-w-[10rem]"
          aria-label="Options group name"
        />
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        placeholder={"Onion\nTomato\nCheese +0.75\nBacon +1.50"}
        className="mt-2 w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground shadow-sm outline-none focus-visible:border-ring"
        aria-label="Ingredients"
      />
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {errors.length > 0 ? (
            <span className="text-destructive">
              {errors[0]!.line > 0 ? `Line ${errors[0]!.line}: ` : ""}
              {errors[0]!.message}
            </span>
          ) : ingredientCount > 0 ? (
            `${ingredientCount} ingredient${ingredientCount === 1 ? "" : "s"} → ${options.length} options`
          ) : (
            "Add one ingredient per line"
          )}
        </span>
        <Button
          type="button"
          size="sm"
          onClick={onAdd}
          disabled={pending || errors.length > 0 || options.length === 0}
        >
          Add options
        </Button>
      </div>
    </div>
  );
}

// ── Inline item editor (name / type / category / price) ──────────────────────

function ItemEditor({
  item,
  catalog,
  businessId,
  pending,
  run,
  onDone,
}: {
  item: ManagedItem;
  catalog: ManagedCatalog;
  businessId: string;
  pending: boolean;
  run: RunFn;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(item.name);
  const [type, setType] = useState<"PRODUCT" | "SERVICE">(item.type);
  const [categoryId, setCategoryId] = useState(item.categoryId ?? "");
  const [price, setPrice] = useState(
    item.variations[0] ? (item.variations[0].priceCents / 100).toFixed(2) : "",
  );

  function onSave(e: React.FormEvent) {
    e.preventDefault();
    const priceCents = dollarsToCents(price);
    if (!name.trim()) return toast({ title: "Item name is required.", variant: "error" });
    if (!Number.isFinite(priceCents) || priceCents < 0)
      return toast({ title: "Enter a valid price.", variant: "error" });
    run(
      () =>
        updateItem({
          businessId,
          id: item.id,
          name: name.trim(),
          type,
          categoryId: categoryId || null,
          priceCents,
        }),
      onDone,
      { success: "Item saved" },
    );
  }

  return (
    <form onSubmit={onSave} className="space-y-2">
      <p className="text-sm font-semibold">Edit item</p>
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Item name" />
      <div className="flex gap-2">
        {(["PRODUCT", "SERVICE"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setType(t)}
            className={cn(
              "h-10 flex-1 rounded-md text-sm font-semibold transition-[color,background-color,transform] active:scale-[0.98]",
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
        className="h-11 w-full rounded-md border border-input bg-card px-3 text-base text-foreground shadow-sm focus-visible:border-ring"
      >
        <option value="">Uncategorized</option>
        {catalog.categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <label className="block text-xs text-muted-foreground">
        Price (base / first variation)
        <Input
          inputMode="decimal"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="9.99"
          className="numeric mt-1"
        />
      </label>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending} className="flex-1">
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onDone} disabled={pending}>
          Done
        </Button>
      </div>
    </form>
  );
}

// ── Variations editor (multiple sizes per item) ──────────────────────────────

function VariationsEditor({
  item,
  currency,
  businessId,
  pending,
  run,
  confirm,
}: {
  item: ManagedItem;
  currency: string;
  businessId: string;
  pending: boolean;
  run: RunFn;
  confirm: (opts: { title: string; description?: string; confirmLabel?: string }) => Promise<boolean>;
}) {
  const { toast } = useToast();
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newSku, setNewSku] = useState("");

  function onAdd(e: React.FormEvent) {
    e.preventDefault();
    const priceCents = dollarsToCents(newPrice);
    if (!newName.trim()) return toast({ title: "Variation name is required.", variant: "error" });
    if (!Number.isFinite(priceCents) || priceCents < 0)
      return toast({ title: "Enter a valid price.", variant: "error" });
    const variationName = newName.trim();
    run(
      () =>
        createVariation({
          businessId,
          itemId: item.id,
          name: variationName,
          priceCents,
          sku: newSku.trim() || null,
          sortOrder: item.variations.length,
        }),
      () => {
        setNewName("");
        setNewPrice("");
        setNewSku("");
      },
      { success: `Variation “${variationName}” added` },
    );
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      <p className="mb-2 text-sm font-semibold">Variations (sizes)</p>
      <ul className="space-y-2">
        {item.variations.map((v, index) => (
          <VariationRow
            key={v.id}
            variation={v}
            currency={currency}
            businessId={businessId}
            pending={pending}
            canDelete={item.variations.length > 1}
            isFirst={index === 0}
            isLast={index === item.variations.length - 1}
            siblings={item.variations}
            index={index}
            run={run}
            confirm={confirm}
          />
        ))}
      </ul>

      <form onSubmit={onAdd} className="mt-3 space-y-2 border-t border-border pt-3">
        <p className="text-xs font-semibold text-muted-foreground">Add variation</p>
        <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name (e.g. Large)" />
        <div className="flex gap-2">
          <Input
            inputMode="decimal"
            value={newPrice}
            onChange={(e) => setNewPrice(e.target.value)}
            placeholder="Price (e.g. 12.99)"
            className="numeric flex-1"
          />
          <Input
            value={newSku}
            onChange={(e) => setNewSku(e.target.value)}
            placeholder="SKU (optional)"
            className="flex-1"
          />
        </div>
        <Button type="submit" size="sm" disabled={pending} className="w-full">
          <Plus size={14} className="mr-1" />
          Add variation
        </Button>
      </form>
    </div>
  );
}

function VariationRow({
  variation,
  currency,
  businessId,
  pending,
  canDelete,
  isFirst,
  isLast,
  siblings,
  index,
  run,
  confirm,
}: {
  variation: ManagedVariation;
  currency: string;
  businessId: string;
  pending: boolean;
  canDelete: boolean;
  isFirst: boolean;
  isLast: boolean;
  siblings: ManagedVariation[];
  index: number;
  run: RunFn;
  confirm: (opts: { title: string; description?: string; confirmLabel?: string }) => Promise<boolean>;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(variation.name);
  const [price, setPrice] = useState((variation.priceCents / 100).toFixed(2));
  const [sku, setSku] = useState(variation.sku ?? "");

  function onSave(e: React.FormEvent) {
    e.preventDefault();
    const priceCents = dollarsToCents(price);
    if (!name.trim()) return toast({ title: "Name is required.", variant: "error" });
    if (!Number.isFinite(priceCents) || priceCents < 0)
      return toast({ title: "Enter a valid price.", variant: "error" });
    run(
      () =>
        updateVariation({
          businessId,
          id: variation.id,
          name: name.trim(),
          priceCents,
          sku: sku.trim() || null,
          sortOrder: variation.sortOrder,
        }),
      () => setEditing(false),
      { success: "Variation saved" },
    );
  }

  // Swap sortOrder with a neighbour to reorder.
  function move(dir: -1 | 1) {
    const other = siblings[index + dir];
    if (!other) return;
    run(async () => {
      await updateVariation({
        businessId,
        id: variation.id,
        name: variation.name,
        priceCents: variation.priceCents,
        sku: variation.sku,
        sortOrder: other.sortOrder,
      });
      await updateVariation({
        businessId,
        id: other.id,
        name: other.name,
        priceCents: other.priceCents,
        sku: other.sku,
        sortOrder: variation.sortOrder,
      });
    });
  }

  if (editing) {
    return (
      <li className="rounded-md border border-border bg-card p-2">
        <form onSubmit={onSave} className="space-y-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
          <div className="flex gap-2">
            <Input
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="Price"
              className="numeric flex-1"
            />
            <Input
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              placeholder="SKU"
              className="flex-1"
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending} className="flex-1">
              {pending ? "Saving…" : "Save"}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)} disabled={pending}>
              Cancel
            </Button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="flex items-center justify-between gap-2 rounded-md border border-border bg-card px-2 py-1.5 text-sm">
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium">{variation.name}</span>
        <span className="numeric ml-2 text-muted-foreground">
          {formatMoney(variation.priceCents, currency)}
        </span>
        {variation.sku && <span className="ml-2 text-xs text-muted-foreground">SKU {variation.sku}</span>}
      </span>
      <div className="flex shrink-0 items-center">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground"
          onClick={() => move(-1)}
          disabled={pending || isFirst}
          aria-label={`Move ${variation.name} up`}
        >
          <ChevronUp size={14} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground"
          onClick={() => move(1)}
          disabled={pending || isLast}
          aria-label={`Move ${variation.name} down`}
        >
          <ChevronDown size={14} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground"
          onClick={() => setEditing(true)}
          disabled={pending}
          aria-label={`Edit ${variation.name}`}
        >
          <Pencil size={14} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-30"
          onClick={async () => {
            if (
              await confirm({
                title: `Delete variation "${variation.name}"?`,
                confirmLabel: "Delete",
              })
            )
              run(() => deleteVariation({ businessId, id: variation.id }), undefined, {
                success: `Variation “${variation.name}” deleted`,
              });
          }}
          disabled={pending || !canDelete}
          aria-label={`Delete ${variation.name}`}
          title={canDelete ? undefined : "An item must keep at least one variation."}
        >
          <Trash2 size={14} />
        </Button>
      </div>
    </li>
  );
}
