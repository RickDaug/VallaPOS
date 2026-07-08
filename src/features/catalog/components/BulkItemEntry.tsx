"use client";

/**
 * Bulk item entry — a paste-or-type grid so a merchant can add 20 (or 300) items
 * at once instead of one form at a time. Type across cells (Tab/Enter), and a new
 * blank row appears automatically; or paste straight from Excel/Sheets/Notes and
 * every row fills in. Live per-row validation, then one "Save all" → a single
 * bulk action. Rows it can't create (bad price, dup SKU) are kept + explained,
 * never silently dropped.
 *
 * Preset-aware (Menu / Retail / Services) so the columns + defaults fit the kind
 * of business — retail shows a SKU/barcode column, services default each row to a
 * service. manage_products-gated by the page.
 */

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, ClipboardPaste, TriangleAlert, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { bulkCreateItems } from "@/features/catalog/actions";
import {
  PRESETS,
  isBlankRow,
  validateRow,
  parsePastedText,
  type CatalogPreset,
  type ColumnKey,
  type RawRow,
} from "@/features/catalog/bulk-parse";

const COLUMN_LABEL: Record<ColumnKey, string> = {
  name: "Name",
  price: "Price",
  category: "Category",
  sku: "SKU / barcode",
  type: "Type",
};

const PLACEHOLDER: Record<ColumnKey, string> = {
  name: "Item name",
  price: "9.99  or  S:2.50, L:3.50",
  category: "Category",
  sku: "optional",
  type: "product",
};

interface SkippedSummary {
  created: number;
  categoriesCreated: string[];
  skipped: { row: number; name: string; reason: string }[];
}

export function BulkItemEntry({
  businessId,
  defaultPreset,
  categoryNames,
}: {
  businessId: string;
  defaultPreset: CatalogPreset;
  categoryNames: string[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [preset, setPreset] = useState<CatalogPreset>(defaultPreset);
  const [rows, setRows] = useState<RawRow[]>([{}]);
  const [result, setResult] = useState<SkippedSummary | null>(null);
  const [pending, startTransition] = useTransition();
  const lastNameRef = useRef<HTMLInputElement>(null);

  const config = PRESETS[preset];
  const columns = config.columns;

  // Keep exactly one trailing blank row so there's always somewhere to type.
  function normalize(next: RawRow[]): RawRow[] {
    const trimmed = next.length === 0 ? [] : next;
    const last = trimmed[trimmed.length - 1];
    if (!last || !isBlankRow(last)) return [...trimmed, {}];
    return trimmed;
  }

  function setCell(i: number, col: ColumnKey, value: string) {
    setRows((prev) => {
      const next = prev.map((r, idx) => (idx === i ? { ...r, [col]: value } : r));
      return normalize(next);
    });
  }

  function removeRow(i: number) {
    setRows((prev) => normalize(prev.filter((_, idx) => idx !== i)));
  }

  function onPaste(i: number, col: ColumnKey, e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text");
    // Only intercept a MULTI-cell/row paste; a plain value pastes normally.
    if (!text.includes("\n") && !text.includes("\t")) return;
    e.preventDefault();
    const parsed = parsePastedText(text, columns);
    if (parsed.length === 0) return;
    setRows((prev) => {
      const next = [...prev.slice(0, i), ...parsed, ...prev.slice(i + 1)];
      return normalize(next);
    });
    setResult(null);
  }

  // Per-row validation status (blank rows are neither valid nor errors).
  const statuses = useMemo(
    () => rows.map((r) => (isBlankRow(r) ? null : validateRow(r, config))),
    [rows, config],
  );
  const validCount = statuses.filter((s) => s?.ok).length;
  const errorCount = statuses.filter((s) => s && !s.ok).length;

  function save() {
    if (validCount === 0) {
      toast({ title: "Nothing to add yet", description: "Fill in at least one valid row.", variant: "default" });
      return;
    }
    startTransition(async () => {
      try {
        const res = await bulkCreateItems({ businessId, preset, rows });
        setResult(res);
        // Keep only the skipped rows (with their data) so they can be fixed.
        const skippedIdx = new Set(res.skipped.map((s) => s.row - 1));
        const remaining = rows.filter((_, idx) => skippedIdx.has(idx));
        setRows(normalize(remaining));
        toast({
          title: `Added ${res.created} item${res.created === 1 ? "" : "s"}`,
          description: res.skipped.length ? `${res.skipped.length} row(s) need fixing.` : undefined,
          variant: res.created > 0 ? "success" : "default",
        });
        if (res.created > 0) router.refresh();
      } catch {
        toast({ title: "Couldn't save", description: "Please try again.", variant: "error" });
      }
    });
  }

  const gridCols = columns
    .map((c) => (c === "name" ? "minmax(9rem,1.6fr)" : c === "price" ? "minmax(7rem,1.2fr)" : "minmax(6rem,1fr)"))
    .join(" ");

  return (
    <Card>
      <CardContent className="space-y-4 p-5 md:p-6">
        {/* Preset selector */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Adding:</span>
          {(Object.keys(PRESETS) as CatalogPreset[]).map((key) => (
            <Button
              key={key}
              type="button"
              size="sm"
              variant={preset === key ? "primary" : "outline"}
              onClick={() => setPreset(key)}
            >
              {PRESETS[key].label}
            </Button>
          ))}
          <span className="ml-auto text-xs text-muted-foreground">
            {validCount} ready{errorCount > 0 ? ` · ${errorCount} to fix` : ""}
          </span>
        </div>

        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <ClipboardPaste size={14} className="mt-0.5 shrink-0" />
          Type across the row (a new one appears as you go) or <b>paste</b> from a spreadsheet. Prices
          can be a single value (<code>9.99</code>) or sizes (<code>Small:2.50, Large:3.50</code>). New
          categories are created automatically.
        </p>

        {/* Grid */}
        <div className="overflow-x-auto">
          <div className="min-w-[32rem]">
            {/* Header */}
            <div
              className="grid gap-2 border-b border-border pb-1 text-xs font-medium text-muted-foreground"
              style={{ gridTemplateColumns: `${gridCols} 2rem` }}
            >
              {columns.map((c) => (
                <div key={c}>{c === "category" ? config.categoryLabel : COLUMN_LABEL[c]}</div>
              ))}
              <div />
            </div>

            {/* Rows */}
            {rows.map((row, i) => {
              const status = statuses[i];
              const isError = status ? !status.ok : false;
              return (
                <div key={i} className="border-b border-border/60 py-1">
                  <div className="grid items-center gap-2" style={{ gridTemplateColumns: `${gridCols} 2rem` }}>
                    {columns.map((c) => (
                      <input
                        key={c}
                        ref={c === "name" && i === rows.length - 1 ? lastNameRef : undefined}
                        value={row[c] ?? ""}
                        onChange={(e) => setCell(i, c, e.target.value)}
                        onPaste={(e) => onPaste(i, c, e)}
                        placeholder={PLACEHOLDER[c]}
                        list={c === "category" ? "bulk-category-list" : undefined}
                        inputMode={c === "price" ? "decimal" : undefined}
                        aria-label={`${COLUMN_LABEL[c]} row ${i + 1}`}
                        className={cn(
                          "w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/30",
                          isError ? "border-destructive/60" : "border-border focus:border-primary",
                        )}
                      />
                    ))}
                    {isBlankRow(row) ? (
                      <span aria-hidden className="text-center text-muted-foreground/40">
                        <Plus size={14} className="mx-auto" />
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => removeRow(i)}
                        aria-label={`Remove row ${i + 1}`}
                        className="mx-auto rounded p-1 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                  {isError && status && !status.ok && (
                    <p className="mt-0.5 pl-1 text-xs text-destructive">{status.error}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <datalist id="bulk-category-list">
          {categoryNames.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>

        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={pending || validCount === 0} className="gap-2">
            <Plus size={16} /> Save all {validCount > 0 ? `${validCount} ` : ""}items
          </Button>
          {errorCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-destructive">
              <TriangleAlert size={14} /> {errorCount} row(s) have errors
            </span>
          )}
        </div>

        {/* Result summary */}
        {result && (
          <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3 text-sm">
            <p className="flex items-center gap-2 font-medium">
              <CheckCircle2 size={16} className="text-success" />
              Added {result.created} item{result.created === 1 ? "" : "s"}
              {result.categoriesCreated.length > 0 &&
                ` · new categories: ${result.categoriesCreated.join(", ")}`}
            </p>
            {result.skipped.length > 0 && (
              <div>
                <p className="mb-1 flex items-center gap-1 text-xs font-medium text-destructive">
                  <TriangleAlert size={13} /> {result.skipped.length} kept below to fix:
                </p>
                <ul className="space-y-0.5 text-xs text-muted-foreground">
                  {result.skipped.map((s, i) => (
                    <li key={i}>
                      <span className="font-medium text-foreground">{s.name}</span> — {s.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
