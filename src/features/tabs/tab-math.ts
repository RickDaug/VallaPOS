/**
 * Pure open-tab / split-check math. INTEGER CENTS only. No `server-only` / Prisma
 * imports so it can be unit-tested and reused by the UI; the settle action calls
 * these AFTER reading the persisted lines from the DB (client never sets amounts).
 *
 * It operates on PERSISTED OrderLine values (`totalCents` = taxable base excl tax,
 * `taxCents` = the line's tax), so the numbers reconcile exactly with the order:
 *   amount the customer pays for a line
 *     = totalCents + (taxInclusive ? 0 : taxCents)
 * (exclusive: base + tax on top; inclusive: the tax-inclusive price, tax already
 * embedded in totalCents). Summing every line's amount equals the order total
 * (excluding tip), mirroring `computePricedOrder` in register/pricing.ts.
 */

export interface TabLine {
  id: string;
  seat: number | null; // null = shared / unassigned
  totalCents: number; // taxable base, excludes on-top tax (as stored on OrderLine)
  taxCents: number;
  settledByPaymentId: string | null; // null = not yet paid
}

/** What a single line costs the customer (base + on-top tax, or the inclusive price). */
export function lineAmountDue(line: Pick<TabLine, "totalCents" | "taxCents">, taxInclusive: boolean): number {
  return line.totalCents + (taxInclusive ? 0 : line.taxCents);
}

export interface SeatGroup {
  seat: number | null;
  lines: TabLine[];
  subtotalCents: number; // Σ totalCents
  taxCents: number; // Σ taxCents
  amountDueCents: number; // Σ lineAmountDue
  settled: boolean; // every line in this seat is settled
  unsettledAmountCents: number; // Σ lineAmountDue of this seat's UNSETTLED lines
}

/** A stable sort key: real seats ascending, the shared/null group last. */
function seatSortKey(seat: number | null): number {
  return seat === null ? Number.MAX_SAFE_INTEGER : seat;
}

/** Group a tab's lines by seat (shared/null last), with per-seat totals. */
export function groupBySeat(lines: TabLine[], taxInclusive: boolean): SeatGroup[] {
  const bySeat = new Map<number | null, TabLine[]>();
  for (const line of lines) {
    const arr = bySeat.get(line.seat) ?? [];
    arr.push(line);
    bySeat.set(line.seat, arr);
  }
  const groups: SeatGroup[] = [];
  for (const [seat, seatLines] of bySeat) {
    let subtotalCents = 0;
    let taxCents = 0;
    let amountDueCents = 0;
    let unsettledAmountCents = 0;
    let allSettled = true;
    for (const l of seatLines) {
      subtotalCents += l.totalCents;
      taxCents += l.taxCents;
      const due = lineAmountDue(l, taxInclusive);
      amountDueCents += due;
      if (l.settledByPaymentId === null) {
        allSettled = false;
        unsettledAmountCents += due;
      }
    }
    groups.push({
      seat,
      lines: seatLines,
      subtotalCents,
      taxCents,
      amountDueCents,
      settled: allSettled,
      unsettledAmountCents,
    });
  }
  return groups.sort((a, b) => seatSortKey(a.seat) - seatSortKey(b.seat));
}

export interface TabTotals {
  subtotalCents: number;
  taxCents: number;
  amountDueCents: number; // full tab (excl tip)
  remainingCents: number; // unsettled portion (excl tip)
}

export function tabTotals(lines: TabLine[], taxInclusive: boolean): TabTotals {
  let subtotalCents = 0;
  let taxCents = 0;
  let amountDueCents = 0;
  let remainingCents = 0;
  for (const l of lines) {
    subtotalCents += l.totalCents;
    taxCents += l.taxCents;
    const due = lineAmountDue(l, taxInclusive);
    amountDueCents += due;
    if (l.settledByPaymentId === null) remainingCents += due;
  }
  return { subtotalCents, taxCents, amountDueCents, remainingCents };
}

/** True once every line on the tab has been settled (the tab can close to PAID). */
export function allSettled(lines: TabLine[]): boolean {
  return lines.length > 0 && lines.every((l) => l.settledByPaymentId !== null);
}

export class SettlementError extends Error {}

export interface SettlementPlan {
  lineIds: string[]; // the UNSETTLED lines this settlement will cover
  amountCents: number; // amount due for those lines (excl tip)
  closesTab: boolean; // true if these are the last unsettled lines on the tab
}

/**
 * Plan settling either the WHOLE remaining tab or a chosen set of seats. Only
 * UNSETTLED lines are ever included (re-settling a paid line is impossible).
 * Throws `SettlementError` if the resulting selection is empty (nothing to pay).
 *
 * `seats: "all"` → every unsettled line. Otherwise the unsettled lines whose
 * seat is in `seats` (use `null` in the array to include the shared group).
 */
export function planSettlement(
  lines: TabLine[],
  opts: { seats: (number | null)[] | "all"; taxInclusive: boolean },
): SettlementPlan {
  const unsettled = lines.filter((l) => l.settledByPaymentId === null);
  if (unsettled.length === 0) {
    throw new SettlementError("This tab is already fully settled.");
  }

  let covered: TabLine[];
  if (opts.seats === "all") {
    covered = unsettled;
  } else {
    const wanted = new Set<number | null>(opts.seats);
    covered = unsettled.filter((l) => wanted.has(l.seat));
  }

  if (covered.length === 0) {
    throw new SettlementError("Nothing to settle for the selected seats.");
  }

  const amountCents = covered.reduce((sum, l) => sum + lineAmountDue(l, opts.taxInclusive), 0);
  const closesTab = covered.length === unsettled.length;

  return { lineIds: covered.map((l) => l.id), amountCents, closesTab };
}
