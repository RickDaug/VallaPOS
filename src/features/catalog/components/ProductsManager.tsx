"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { formatMoney } from "@/lib/money";
import type { ManagedCatalog } from "@/features/catalog/queries";
import {
  createCategory,
  createItem,
  deleteCategory,
  deleteItem,
} from "@/features/catalog/actions";

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

  // Add-item form state
  const [name, setName] = useState("");
  const [type, setType] = useState<"PRODUCT" | "SERVICE">("PRODUCT");
  const [categoryId, setCategoryId] = useState("");
  const [price, setPrice] = useState("");

  // Add-category form state
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
      () =>
        createItem({
          businessId,
          name: name.trim(),
          type,
          categoryId: categoryId || null,
          priceCents,
        }),
      () => {
        setName("");
        setPrice("");
      },
    );
  }

  function onAddCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!categoryName.trim()) return;
    run(() => createCategory({ businessId, name: categoryName.trim() }), () =>
      setCategoryName(""),
    );
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
      {/* Item list */}
      <div className="rounded-3xl bg-white p-4 shadow-sm md:p-5">
        <h2 className="mb-4 text-xl font-bold">Items</h2>
        {error && <p className="mb-3 text-sm font-medium text-red-600">{error}</p>}
        {catalog.items.length === 0 ? (
          <p className="rounded-2xl bg-slate-50 p-6 text-center text-sm text-slate-500">
            No items yet. Add your first one on the right.
          </p>
        ) : (
          <ul className="divide-y">
            {catalog.items.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{item.name}</p>
                  <p className="text-sm text-slate-500">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium">
                      {item.type === "SERVICE" ? "Service" : "Product"}
                    </span>{" "}
                    {item.categoryName ?? "Uncategorized"} ·{" "}
                    {item.variations.map((v) => formatMoney(v.priceCents, currency)).join(", ")}
                  </p>
                </div>
                <button
                  onClick={() => {
                    if (confirm(`Delete "${item.name}"?`))
                      run(() => deleteItem({ businessId, id: item.id }));
                  }}
                  disabled={pending}
                  aria-label={`Delete ${item.name}`}
                  className="rounded-xl p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 size={18} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Forms */}
      <aside className="space-y-6">
        <form onSubmit={onAddItem} className="space-y-3 rounded-3xl bg-white p-4 shadow-sm md:p-5">
          <h2 className="text-xl font-bold">Add item</h2>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Item name"
            className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950"
          />
          <div className="flex gap-2">
            {(["PRODUCT", "SERVICE"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={`flex-1 rounded-2xl px-3 py-2 font-semibold ${
                  type === t ? "bg-slate-900 text-white" : "bg-slate-100 hover:bg-slate-200"
                }`}
              >
                {t === "PRODUCT" ? "Product" : "Service"}
              </button>
            ))}
          </div>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950"
          >
            <option value="">Uncategorized</option>
            {catalog.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="Price (e.g. 9.99)"
            className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950"
          />
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-2xl bg-slate-950 px-5 py-3 font-bold text-white disabled:bg-slate-300"
          >
            {pending ? "Saving…" : "Add item"}
          </button>
        </form>

        <div className="space-y-3 rounded-3xl bg-white p-4 shadow-sm md:p-5">
          <h2 className="text-xl font-bold">Categories</h2>
          <form onSubmit={onAddCategory} className="flex gap-2">
            <input
              value={categoryName}
              onChange={(e) => setCategoryName(e.target.value)}
              placeholder="New category"
              className="w-full rounded-2xl border border-slate-300 px-4 py-2 outline-none focus:border-slate-950"
            />
            <button
              type="submit"
              disabled={pending}
              className="rounded-2xl bg-slate-900 px-4 py-2 font-bold text-white disabled:bg-slate-300"
            >
              Add
            </button>
          </form>
          {catalog.categories.length > 0 && (
            <ul className="divide-y">
              {catalog.categories.map((c) => (
                <li key={c.id} className="flex items-center justify-between py-2">
                  <span className="font-medium">{c.name}</span>
                  <button
                    onClick={() => {
                      if (confirm(`Delete category "${c.name}"? Items become uncategorized.`))
                        run(() => deleteCategory({ businessId, id: c.id }));
                    }}
                    disabled={pending}
                    aria-label={`Delete category ${c.name}`}
                    className="rounded-xl p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
