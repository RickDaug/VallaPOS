"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Minus, Plus, Trash2, Users, Split, Merge, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { NumberPad } from "@/components/ui/number-pad";
import { useToast } from "@/components/ui/toast";
import { dollarsToCents, quickTenderOptions } from "@/features/register/tender";
import { formatMoney } from "@/lib/money";
import { groupBySeat, planSettlement, tabTotals, type TabLine } from "@/features/tabs/tab-math";
import {
  addTabLines,
  setTabLineQty,
  removeTabLine,
  assignLineSeat,
  mergeTables,
  transferTab,
  settleTab,
} from "@/features/tabs/actions";
import { lockOperator } from "@/features/employees/actions";
import type { TabView, TabLineView } from "@/features/tabs/queries";
import type { SellableEntry, SellableModifierGroup } from "@/features/catalog/queries";

const SHARED = "shared";
type SeatKey = number | null;
function seatLabel(seat: SeatKey): string {
  return seat === null ? "Shared" : `Seat ${seat}`;
}

export function TableDetail({
  businessId,
  currency,
  tab,
  menu,
  currentTables,
  availableTables,
}: {
  businessId: string;
  currency: string;
  tab: TabView;
  menu: SellableEntry[];
  currentTables: { id: string; label: string }[];
  availableTables: { id: string; label: string; room: string }[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const fmt = (c: number) => formatMoney(c, currency);
  const mathLines: TabLine[] = tab.lines.map((l) => ({
    id: l.id,
    seat: l.seat,
    totalCents: l.totalCents,
    taxCents: l.taxCents,
    settledByPaymentId: l.settledByPaymentId,
  }));
  const totals = tabTotals(mathLines, tab.taxInclusive);
  const seatGroups = groupBySeat(mathLines, tab.taxInclusive);

  // Seat chips: Shared + 1..N. N grows via "Add seat".
  const maxSeatInUse = tab.lines.reduce((m, l) => Math.max(m, l.seat ?? 0), 0);
  const [seatCount, setSeatCount] = useState(Math.max(maxSeatInUse, 1));
  const [activeSeat, setActiveSeat] = useState<SeatKey>(1);

  const [picking, setPicking] = useState<SellableEntry | null>(null);
  const [settleOpen, setSettleOpen] = useState(false);

  // Group the display lines by seat (numeric seats asc, Shared last).
  const linesBySeat = useMemo(() => {
    const map = new Map<SeatKey, TabLineView[]>();
    for (const l of tab.lines) {
      const arr = map.get(l.seat) ?? [];
      arr.push(l);
      map.set(l.seat, arr);
    }
    const seatKeys: SeatKey[] = [];
    for (let s = 1; s <= seatCount; s++) seatKeys.push(s);
    if (map.has(null)) seatKeys.push(null);
    // include any in-use seats beyond seatCount (defensive)
    for (const k of map.keys()) if (k !== null && !seatKeys.includes(k)) seatKeys.push(k);
    return seatKeys.map((seat) => ({ seat, lines: map.get(seat) ?? [] }));
  }, [tab.lines, seatCount]);

  function run(fn: () => Promise<unknown>, opts?: { closeOnDone?: boolean; success?: string }) {
    startTransition(async () => {
      try {
        await fn();
        if (opts?.success) toast({ title: opts.success, variant: "success" });
        if (opts?.closeOnDone) {
          // A closed tab is a completed sale → re-lock so the next order needs a PIN.
          await lockOperator({ businessId }).catch(() => {});
          router.push(`/${businessId}/floor`);
        } else {
          router.refresh();
        }
      } catch (err) {
        toast({
          title: "Something went wrong",
          description: err instanceof Error ? err.message : undefined,
          variant: "error",
        });
      }
    });
  }

  function addItem(entry: SellableEntry, modifierIds?: string[]) {
    run(() =>
      addTabLines({
        businessId,
        orderId: tab.orderId,
        seat: activeSeat,
        lines: [{ variationId: entry.variationId, quantity: 1, modifierIds }],
      }),
    );
  }

  function onMenuClick(entry: SellableEntry) {
    if (entry.modifierGroups.length > 0) setPicking(entry);
    else addItem(entry);
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" aria-label="Back to floor" onClick={() => router.push(`/${businessId}/floor`)}>
            <ArrowLeft size={18} />
          </Button>
          <div>
            <h1 className="text-xl font-black">
              {currentTables.map((t) => t.label).join(" + ") || "Tab"} · #{tab.number}
            </h1>
            <p className="text-sm text-muted-foreground numeric">
              {fmt(totals.amountDueCents)} total
              {totals.remainingCents !== totals.amountDueCents && ` · ${fmt(totals.remainingCents)} unpaid`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <MergeMenu
            disabled={pending}
            availableTables={availableTables}
            currentTables={currentTables}
            onMerge={(tableId) =>
              run(() => mergeTables({ businessId, orderId: tab.orderId, tableId }), { success: "Tables merged" })
            }
            onTransfer={(fromTableId, toTableId) =>
              run(() => transferTab({ businessId, orderId: tab.orderId, fromTableId, toTableId }), {
                success: "Tab moved",
              })
            }
          />
          <Button onClick={() => setSettleOpen(true)} disabled={pending || totals.remainingCents <= 0}>
            {pending ? <Loader2 size={16} className="animate-spin" /> : <Split size={16} />} Settle
          </Button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_minmax(340px,420px)]">
        {/* Order by seat */}
        <div className="space-y-3">
          {linesBySeat.map(({ seat, lines }) => {
            const group = seatGroups.find((g) => g.seat === seat);
            return (
              <div key={seat === null ? SHARED : seat} className="rounded-xl border border-border bg-card p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-semibold">{seatLabel(seat)}</span>
                  <span className="numeric text-sm text-muted-foreground">{group ? fmt(group.amountDueCents) : ""}</span>
                </div>
                {lines.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No items.</p>
                ) : (
                  <ul className="space-y-2">
                    {lines.map((l) => (
                      <LineRow
                        key={l.id}
                        line={l}
                        seatCount={seatCount}
                        currency={currency}
                        disabled={pending}
                        onInc={() => run(() => setTabLineQty({ businessId, orderId: tab.orderId, lineId: l.id, quantity: l.quantity + 1 }))}
                        onDec={() =>
                          l.quantity <= 1
                            ? run(() => removeTabLine({ businessId, orderId: tab.orderId, lineId: l.id }))
                            : run(() => setTabLineQty({ businessId, orderId: tab.orderId, lineId: l.id, quantity: l.quantity - 1 }))
                        }
                        onRemove={() => run(() => removeTabLine({ businessId, orderId: tab.orderId, lineId: l.id }))}
                        onMoveSeat={(s) => run(() => assignLineSeat({ businessId, orderId: tab.orderId, lineId: l.id, seat: s }))}
                      />
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>

        {/* Menu + seat selector */}
        <div className="space-y-3">
          <div className="rounded-xl border border-border bg-card p-3">
            <Label className="mb-1.5">Adding to</Label>
            <div className="flex flex-wrap gap-1.5">
              <SeatChip active={activeSeat === null} onClick={() => setActiveSeat(null)}>
                Shared
              </SeatChip>
              {Array.from({ length: seatCount }, (_, i) => i + 1).map((s) => (
                <SeatChip key={s} active={activeSeat === s} onClick={() => setActiveSeat(s)}>
                  {s}
                </SeatChip>
              ))}
              <button
                type="button"
                onClick={() => {
                  setSeatCount((n) => n + 1);
                  setActiveSeat(seatCount + 1);
                }}
                className="inline-flex h-9 items-center gap-1 rounded-full border border-dashed border-border px-3 text-sm text-muted-foreground hover:text-foreground"
              >
                <Plus size={14} /> Seat
              </button>
            </div>
          </div>

          <MenuGrid menu={menu} currency={currency} disabled={pending} onPick={onMenuClick} />
        </div>
      </div>

      {picking && (
        <ModifierPickerDialog
          entry={picking}
          currency={currency}
          onClose={() => setPicking(null)}
          onConfirm={(ids) => {
            const entry = picking;
            setPicking(null);
            addItem(entry, ids);
          }}
        />
      )}

      {settleOpen && (
        <SettleDialog
          currency={currency}
          taxInclusive={tab.taxInclusive}
          lines={mathLines}
          seatGroups={seatGroups.filter((g) => g.unsettledAmountCents > 0)}
          disabled={pending}
          onClose={() => setSettleOpen(false)}
          onSettle={({ seats, tipCents, cashTenderedCents, willClose }) =>
            run(
              () =>
                settleTab({
                  businessId,
                  orderId: tab.orderId,
                  seats: seats === "all" ? undefined : seats,
                  tipCents,
                  cashTenderedCents,
                }),
              { closeOnDone: willClose, success: willClose ? "Tab settled and closed" : "Payment taken" },
            )
          }
        />
      )}
    </div>
  );
}

function SeatChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex h-9 min-w-9 items-center justify-center rounded-full px-3 text-sm font-medium transition-colors active:scale-[0.97] ${
        active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"
      }`}
    >
      {children}
    </button>
  );
}

function LineRow({
  line,
  seatCount,
  currency,
  disabled,
  onInc,
  onDec,
  onRemove,
  onMoveSeat,
}: {
  line: TabLineView;
  seatCount: number;
  currency: string;
  disabled: boolean;
  onInc: () => void;
  onDec: () => void;
  onRemove: () => void;
  onMoveSeat: (seat: SeatKey) => void;
}) {
  const settled = line.settledByPaymentId !== null;
  return (
    <li className={`flex items-center gap-2 ${settled ? "opacity-60" : ""}`}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {line.quantity}× {line.nameSnapshot}
        </p>
        {line.modifiers.length > 0 && (
          <p className="truncate text-xs text-muted-foreground">{line.modifiers.map((m) => m.nameSnapshot).join(", ")}</p>
        )}
      </div>
      <span className="numeric text-sm">{formatMoney(line.totalCents, currency)}</span>
      {settled ? (
        <span className="rounded bg-success/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-success">Paid</span>
      ) : (
        <div className="flex items-center gap-1">
          <select
            aria-label="Move to seat"
            value={line.seat === null ? SHARED : line.seat}
            disabled={disabled}
            onChange={(e) => onMoveSeat(e.target.value === SHARED ? null : Number(e.target.value))}
            className="h-9 rounded-md border border-input bg-card px-1 text-xs"
          >
            <option value={SHARED}>Shared</option>
            {Array.from({ length: Math.max(seatCount, line.seat ?? 0) }, (_, i) => i + 1).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <Button variant="outline" size="icon" aria-label="Decrease" disabled={disabled} onClick={onDec}>
            <Minus size={14} />
          </Button>
          <Button variant="outline" size="icon" aria-label="Increase" disabled={disabled} onClick={onInc}>
            <Plus size={14} />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Remove" disabled={disabled} onClick={onRemove}>
            <Trash2 size={14} />
          </Button>
        </div>
      )}
    </li>
  );
}

function MenuGrid({
  menu,
  currency,
  disabled,
  onPick,
}: {
  menu: SellableEntry[];
  currency: string;
  disabled: boolean;
  onPick: (entry: SellableEntry) => void;
}) {
  const [query, setQuery] = useState("");
  const categories = useMemo(() => ["All", ...Array.from(new Set(menu.map((m) => m.category)))], [menu]);
  const [cat, setCat] = useState("All");
  const filtered = menu.filter(
    (m) => (cat === "All" || m.category === cat) && m.label.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <Input placeholder="Search menu…" value={query} onChange={(e) => setQuery(e.target.value)} className="mb-2 h-10" />
      {categories.length > 2 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCat(c)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                cat === c ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {filtered.map((entry) => (
          <button
            key={entry.variationId}
            type="button"
            disabled={disabled}
            onClick={() => onPick(entry)}
            className="flex min-h-16 flex-col justify-between rounded-lg border border-border bg-background p-2 text-left transition-[transform,border-color,box-shadow] hover:border-primary/50 hover:shadow-sm active:scale-[0.98] disabled:pointer-events-none disabled:opacity-60"
          >
            <span className="line-clamp-2 text-sm font-medium">{entry.label}</span>
            <span className="numeric mt-1 text-xs text-muted-foreground">{formatMoney(entry.priceCents, currency)}</span>
          </button>
        ))}
        {filtered.length === 0 && <p className="col-span-full py-4 text-center text-sm text-muted-foreground">No items.</p>}
      </div>
    </div>
  );
}

function ModifierPickerDialog({
  entry,
  currency,
  onClose,
  onConfirm,
}: {
  entry: SellableEntry;
  currency: string;
  onClose: () => void;
  onConfirm: (modifierIds: string[]) => void;
}) {
  const [chosen, setChosen] = useState<Record<string, string[]>>({});

  function toggle(group: SellableModifierGroup, id: string) {
    setChosen((prev) => {
      const cur = prev[group.id] ?? [];
      if (cur.includes(id)) return { ...prev, [group.id]: cur.filter((x) => x !== id) };
      // Single-select groups replace; multi-select append up to maxSelect.
      if (group.maxSelect <= 1) return { ...prev, [group.id]: [id] };
      if (cur.length >= group.maxSelect) return prev;
      return { ...prev, [group.id]: [...cur, id] };
    });
  }

  const valid = entry.modifierGroups.every((g) => {
    const n = (chosen[g.id] ?? []).length;
    return n >= g.minSelect && n <= g.maxSelect;
  });
  const allIds = Object.values(chosen).flat();

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{entry.label}</DialogTitle>
          <DialogDescription>Choose options, then add to the tab.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[50vh] space-y-4 overflow-y-auto">
          {entry.modifierGroups.map((g) => (
            <div key={g.id}>
              <p className="mb-1 text-sm font-semibold">
                {g.name}{" "}
                <span className="font-normal text-muted-foreground">
                  {g.minSelect > 0 ? `(choose ${g.minSelect}${g.maxSelect > g.minSelect ? `–${g.maxSelect}` : ""})` : "(optional)"}
                </span>
              </p>
              <div className="space-y-1">
                {g.modifiers.map((m) => {
                  const selected = (chosen[g.id] ?? []).includes(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => toggle(g, m.id)}
                      className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm ${
                        selected ? "border-primary bg-primary/10" : "border-input hover:bg-muted"
                      }`}
                    >
                      <span>{m.name}</span>
                      {m.priceDeltaCents > 0 && (
                        <span className="numeric text-muted-foreground">+{formatMoney(m.priceDeltaCents, currency)}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={!valid} onClick={() => onConfirm(allIds)}>
            Add to tab
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MergeMenu({
  disabled,
  availableTables,
  currentTables,
  onMerge,
  onTransfer,
}: {
  disabled: boolean;
  availableTables: { id: string; label: string; room: string }[];
  currentTables: { id: string; label: string }[];
  onMerge: (tableId: string) => void;
  onTransfer: (fromTableId: string, toTableId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("");

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} disabled={disabled}>
        <Merge size={16} /> Tables
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Merge or move tables</DialogTitle>
            <DialogDescription>
              This tab is on {currentTables.map((t) => t.label).join(", ") || "no table"}.
            </DialogDescription>
          </DialogHeader>
          {availableTables.length === 0 ? (
            <p className="text-sm text-muted-foreground">No free tables available.</p>
          ) : (
            <div className="space-y-3">
              <div>
                <Label htmlFor="merge-target">Free table</Label>
                <select
                  id="merge-target"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  className="h-11 w-full rounded-md border border-input bg-card px-3"
                >
                  <option value="">Select a table…</option>
                  {availableTables.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.room} · {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={!target}
                  onClick={() => {
                    onMerge(target);
                    setOpen(false);
                  }}
                >
                  <Merge size={15} /> Merge in
                </Button>
                {currentTables.length === 1 && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!target}
                    onClick={() => {
                      onTransfer(currentTables[0]!.id, target);
                      setOpen(false);
                    }}
                  >
                    Move tab here
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function SettleDialog({
  currency,
  taxInclusive,
  lines,
  seatGroups,
  disabled,
  onClose,
  onSettle,
}: {
  currency: string;
  taxInclusive: boolean;
  lines: TabLine[];
  seatGroups: { seat: SeatKey; unsettledAmountCents: number }[];
  disabled: boolean;
  onClose: () => void;
  onSettle: (args: { seats: (number | null)[] | "all"; tipCents: number; cashTenderedCents: number; willClose: boolean }) => void;
}) {
  const [mode, setMode] = useState<"whole" | "seats">("whole");
  const [selectedSeats, setSelectedSeats] = useState<Set<SeatKey>>(new Set());
  const [tipStr, setTipStr] = useState("");
  const [tenderStr, setTenderStr] = useState("");

  const seats: (number | null)[] | "all" =
    mode === "whole" ? "all" : Array.from(selectedSeats);

  let amountCents = 0;
  let willClose = false;
  let planError: string | null = null;
  try {
    if (mode === "seats" && selectedSeats.size === 0) {
      planError = "Pick at least one seat.";
    } else {
      const plan = planSettlement(lines, { seats, taxInclusive });
      amountCents = plan.amountCents;
      willClose = plan.closesTab;
    }
  } catch (e) {
    planError = e instanceof Error ? e.message : "Cannot settle.";
  }

  const tipCents = dollarsToCents(tipStr);
  const dueCents = amountCents + tipCents;
  const tenderCents = dollarsToCents(tenderStr);
  const changeCents = Math.max(tenderCents - dueCents, 0);
  const canPay = !planError && amountCents > 0 && tenderCents >= dueCents;

  function toggleSeat(seat: SeatKey) {
    setSelectedSeats((prev) => {
      const next = new Set(prev);
      if (next.has(seat)) next.delete(seat);
      else next.add(seat);
      return next;
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settle tab</DialogTitle>
          <DialogDescription>Take cash for the whole table or split by seat.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMode("whole")}
              aria-pressed={mode === "whole"}
              className={`h-10 rounded-md border text-sm font-medium transition-colors active:scale-[0.98] ${mode === "whole" ? "border-primary bg-primary/10" : "border-input hover:bg-muted"}`}
            >
              Whole table
            </button>
            <button
              type="button"
              onClick={() => setMode("seats")}
              aria-pressed={mode === "seats"}
              className={`h-10 rounded-md border text-sm font-medium transition-colors active:scale-[0.98] ${mode === "seats" ? "border-primary bg-primary/10" : "border-input hover:bg-muted"}`}
            >
              Split by seat
            </button>
          </div>

          {mode === "seats" && (
            <div className="flex flex-wrap gap-1.5">
              {seatGroups.map((g) => (
                <button
                  key={g.seat === null ? SHARED : g.seat}
                  type="button"
                  onClick={() => toggleSeat(g.seat)}
                  aria-pressed={selectedSeats.has(g.seat)}
                  className={`inline-flex h-9 items-center gap-1 rounded-full px-3 text-sm transition-colors active:scale-[0.97] ${
                    selectedSeats.has(g.seat) ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"
                  }`}
                >
                  {g.seat === null ? <Users size={13} /> : null}
                  {seatLabel(g.seat)} · {formatMoney(g.unsettledAmountCents, currency)}
                </button>
              ))}
            </div>
          )}

          <div className="rounded-lg bg-muted p-3 text-sm">
            <div className="flex justify-between">
              <span>Amount due</span>
              <span className="numeric font-semibold">{formatMoney(amountCents, currency)}</span>
            </div>
            {tipCents > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span>Tip</span>
                <span className="numeric">{formatMoney(tipCents, currency)}</span>
              </div>
            )}
            <div className="mt-1 flex justify-between border-t border-border pt-1">
              <span>Total</span>
              <span className="numeric font-bold">{formatMoney(dueCents, currency)}</span>
            </div>
            <div className="flex justify-between text-success">
              <span>Change</span>
              <span className="numeric">{formatMoney(changeCents, currency)}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="tip">Tip ($)</Label>
              <Input id="tip" inputMode="decimal" className="numeric" value={tipStr} onChange={(e) => setTipStr(e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <Label htmlFor="tender">Cash ($)</Label>
              <Input id="tender" inputMode="decimal" className="numeric" value={tenderStr} onChange={(e) => setTenderStr(e.target.value)} placeholder="0.00" />
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {quickTenderOptions(dueCents).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setTenderStr((c / 100).toFixed(2))}
                className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted"
              >
                {formatMoney(c, currency)}
              </button>
            ))}
          </div>

          <NumberPad value={tenderStr} onChange={setTenderStr} />

          {planError && <p className="text-sm font-medium text-destructive">{planError}</p>}
          {willClose && !planError && <p className="text-xs text-muted-foreground">This settles the last items — the tab will close.</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={disabled || !canPay}
            onClick={() => onSettle({ seats, tipCents, cashTenderedCents: tenderCents, willClose })}
          >
            {disabled && <Loader2 size={15} className="animate-spin" />}
            Take {formatMoney(dueCents, currency)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
