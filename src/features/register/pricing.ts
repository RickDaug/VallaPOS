/**
 * Pure register pricing: per-line tax + modifier selection math. INTEGER CENTS
 * only (no floats); tax in BASIS POINTS.
 *
 * Kept free of `server-only` / Prisma imports so it can be unit tested and
 * reused by the UI without dragging server modules into the bundle. The
 * checkout server action calls these AFTER re-looking-up prices/modifiers from
 * the DB — the client never gets to set prices.
 *
 * Reconciliation invariant (load-bearing): order tax is the SUM of per-line
 * taxes. `computePricedOrder` computes each line's tax once and derives the
 * order's `taxCents` by summing those exact line values, so the stored
 * `Order.taxCents` can never drift from `Σ OrderLine.taxCents`. This mirrors —
 * and is verified against — `computeTotals` in `@/lib/money`.
 */

import { taxOf, embeddedTaxOf } from "@/lib/money";

/** A modifier as resolved from the DB (or chosen in the UI). */
export interface ResolvedModifier {
  id: string;
  nameSnapshot: string;
  priceDeltaCents: number;
}

/** Group constraints used to validate a selection. */
export interface GroupConstraint {
  groupId: string;
  minSelect: number;
  maxSelect: number;
  /** Modifier ids that legitimately belong to this group (this business). */
  modifierIds: string[];
}

export interface PricedLineInput {
  unitPriceCents: number;
  quantity: number;
  lineDiscountCents?: number;
  /** Chosen modifiers already resolved from the DB. */
  modifiers?: ResolvedModifier[];
}

export interface PricedLine {
  unitPriceCents: number;
  quantity: number;
  /** Σ of chosen modifier deltas (per single unit). */
  modifierDeltaCents: number;
  discountCents: number; // line discount, capped at gross
  taxableBaseCents: number; // (unit + modifiers) * qty - discount
  taxCents: number; // per-line tax (exclusive added on top / inclusive embedded)
  totalCents: number; // (unit + modifiers) * qty - discount  (excludes tax)
  modifiers: ResolvedModifier[];
}

export interface PricedOrder {
  lines: PricedLine[];
  subtotalCents: number;
  discountCents: number;
  taxCents: number; // Σ line.taxCents — derived, never recomputed a second way
  tipCents: number;
  totalCents: number;
}

/** Σ of the chosen modifiers' per-unit deltas. */
export function modifierDeltaOf(modifiers: ResolvedModifier[] | undefined): number {
  if (!modifiers) return 0;
  return modifiers.reduce((sum, m) => sum + m.priceDeltaCents, 0);
}

/**
 * Price a single line: fold the chosen modifier deltas into the unit price,
 * apply the (capped) line discount, then compute tax on the resulting taxable
 * base. Exclusive tax is added on top; inclusive tax is the embedded portion.
 */
export function priceLine(
  line: PricedLineInput,
  taxRateBps: number,
  taxInclusive: boolean,
): PricedLine {
  const modifiers = line.modifiers ?? [];
  const modifierDeltaCents = modifierDeltaOf(modifiers);
  const unit = line.unitPriceCents + modifierDeltaCents;
  const gross = unit * line.quantity;
  const discountCents = Math.min(line.lineDiscountCents ?? 0, gross);
  const taxableBaseCents = gross - discountCents;
  const taxCents = taxInclusive
    ? embeddedTaxOf(taxableBaseCents, taxRateBps)
    : taxOf(taxableBaseCents, taxRateBps);
  return {
    unitPriceCents: line.unitPriceCents,
    quantity: line.quantity,
    modifierDeltaCents,
    discountCents,
    taxableBaseCents,
    taxCents,
    totalCents: taxableBaseCents,
    modifiers,
  };
}

/**
 * Price a whole order. Per-line tax is computed once and the order tax is the
 * SUM of those line taxes (so reconciliation is exact). Cart-level discount and
 * tip are applied at the order level, matching `computeTotals`.
 */
export function computePricedOrder(
  lines: PricedLineInput[],
  opts: {
    taxRateBps: number;
    cartDiscountCents?: number;
    tipCents?: number;
    taxInclusive?: boolean;
  },
): PricedOrder {
  const inclusive = opts.taxInclusive ?? false;
  const priced = lines.map((l) => priceLine(l, opts.taxRateBps, inclusive));

  let subtotalCents = 0;
  let lineDiscountTotal = 0;
  let taxCents = 0;
  for (const p of priced) {
    subtotalCents += (p.unitPriceCents + p.modifierDeltaCents) * p.quantity;
    lineDiscountTotal += p.discountCents;
    taxCents += p.taxCents; // derive order tax by summing line taxes
  }

  const cartDiscount = Math.min(
    opts.cartDiscountCents ?? 0,
    Math.max(subtotalCents - lineDiscountTotal, 0),
  );
  const discountCents = lineDiscountTotal + cartDiscount;
  const tipCents = opts.tipCents ?? 0;
  const totalCents =
    Math.max(subtotalCents - discountCents, 0) + (inclusive ? 0 : taxCents) + tipCents;

  return { lines: priced, subtotalCents, discountCents, taxCents, tipCents, totalCents };
}

export class ModifierSelectionError extends Error {}

/**
 * Validate a single group's chosen modifier ids against its constraints. Throws
 * `ModifierSelectionError` on any violation:
 *  - an id that does not belong to this group (unknown / foreign / cross-tenant)
 *  - fewer than `minSelect` choices (required group left empty)
 *  - more than `maxSelect` choices
 *
 * Duplicate selections of the same modifier id count as multiple choices (the
 * UI may legitimately allow "Extra cheese ×2" only if maxSelect permits it).
 */
export function validateGroupSelection(
  constraint: GroupConstraint,
  chosenModifierIds: string[],
): void {
  const allowed = new Set(constraint.modifierIds);
  for (const id of chosenModifierIds) {
    if (!allowed.has(id)) {
      throw new ModifierSelectionError(
        `Modifier ${id} does not belong to group ${constraint.groupId}.`,
      );
    }
  }
  if (chosenModifierIds.length < constraint.minSelect) {
    throw new ModifierSelectionError(
      `Group ${constraint.groupId} requires at least ${constraint.minSelect} selection(s).`,
    );
  }
  if (chosenModifierIds.length > constraint.maxSelect) {
    throw new ModifierSelectionError(
      `Group ${constraint.groupId} allows at most ${constraint.maxSelect} selection(s).`,
    );
  }
}
