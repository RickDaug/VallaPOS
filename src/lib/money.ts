/**
 * Money math. Everything is INTEGER CENTS. Never use floats for money —
 * `0.1 + 0.2 !== 0.3` silently corrupts totals over many transactions.
 *
 * Tax rates are BASIS POINTS: 825 = 8.25%.
 */

/** Format integer cents as a currency string for display only. */
export function formatMoney(cents: number, currency = "USD", locale = "en-US"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);
}

/** Round to the nearest whole cent (banker-free, standard half-up). */
export function roundCents(value: number): number {
  return Math.round(value);
}

/** Apply a basis-point tax rate to a cents amount, rounded to the cent. */
export function taxOf(baseCents: number, rateBps: number): number {
  return roundCents((baseCents * rateBps) / 10_000);
}

export interface CartLineInput {
  unitPriceCents: number; // item variation price
  modifierDeltaCents?: number; // sum of selected modifier deltas
  quantity: number;
  lineDiscountCents?: number;
}

export interface OrderTotals {
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  tipCents: number;
  totalCents: number;
}

/** Tax already embedded in a tax-inclusive price: base - base/(1 + rate). */
export function embeddedTaxOf(baseCents: number, rateBps: number): number {
  const net = roundCents((baseCents * 10_000) / (10_000 + rateBps));
  return baseCents - net;
}

/**
 * Allocate a cart-level discount across lines proportionally to each line's
 * post-line-discount taxable base, so the cart discount reduces each line's
 * taxable base — and therefore its tax — EXACTLY like an equivalent line
 * discount would.
 *
 * Returns a per-line discount (index-aligned with `bases`). Guarantees:
 *  - the entries sum to EXACTLY `min(cartDiscount, Σ bases)` (rounding never
 *    loses or invents a cent — leftover cents go to the largest fractional
 *    remainders, the standard largest-remainder method),
 *  - no line is ever allocated more than its own base (bases never go negative),
 *  - a base-0 line is never allocated a cent (it has no taxable base to reduce).
 */
export function allocateCartDiscount(bases: number[], cartDiscount: number): number[] {
  const alloc = new Array<number>(bases.length).fill(0);
  const totalBase = bases.reduce((sum, b) => sum + b, 0);
  const target = Math.min(Math.max(cartDiscount, 0), Math.max(totalBase, 0));
  if (target <= 0 || totalBase <= 0) return alloc;

  const remainders: { i: number; frac: number }[] = [];
  let distributed = 0;
  for (let i = 0; i < bases.length; i++) {
    const raw = (target * bases[i]!) / totalBase;
    const floor = Math.floor(raw);
    alloc[i] = floor;
    distributed += floor;
    remainders.push({ i, frac: raw - floor });
  }
  // Hand out the leftover cents to the largest fractional remainders. Because
  // Σ raw === target exactly, there are always at least `leftover` lines with a
  // positive fraction, so a +1 only ever lands on a line whose base exceeds its
  // floored allocation — the cap (alloc <= base) is preserved.
  let leftover = target - distributed;
  remainders.sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < remainders.length && leftover > 0; k++) {
    const idx = remainders[k]!.i;
    alloc[idx] = alloc[idx]! + 1;
    leftover -= 1;
  }
  return alloc;
}

/**
 * Compute order totals on the server. The client may *display* a total, but the
 * server is the source of truth at checkout — never trust client-sent totals.
 *
 * Policy (documented & consistent): tax is computed per line, AFTER the line
 * discount AND after the line's proportional share of any cart-level discount,
 * then summed. So a cart discount lowers the taxable base — and the tax — the
 * same way an equivalent line discount does. Tip is applied on the order.
 *
 * Tax modes:
 *  - exclusive (default): tax is added on top of the subtotal.
 *  - inclusive: prices already include tax; `taxCents` reports the embedded
 *    portion and is NOT added again to the total.
 */
export function computeTotals(
  lines: CartLineInput[],
  opts: {
    taxRateBps: number;
    cartDiscountCents?: number;
    tipCents?: number;
    taxInclusive?: boolean;
  },
): OrderTotals {
  const inclusive = opts.taxInclusive ?? false;
  let subtotalCents = 0;
  let lineDiscountTotal = 0;
  const bases: number[] = [];

  for (const line of lines) {
    const unit = line.unitPriceCents + (line.modifierDeltaCents ?? 0);
    const gross = unit * line.quantity;
    const discount = Math.min(line.lineDiscountCents ?? 0, gross);
    const taxableBase = gross - discount;
    subtotalCents += gross;
    lineDiscountTotal += discount;
    bases.push(taxableBase);
  }

  const cartDiscount = Math.min(
    opts.cartDiscountCents ?? 0,
    Math.max(subtotalCents - lineDiscountTotal, 0),
  );

  // Reduce each line's taxable base by its proportional share of the cart
  // discount BEFORE computing per-line tax, then sum the per-line taxes.
  const allocation = allocateCartDiscount(bases, cartDiscount);
  let taxCents = 0;
  for (let i = 0; i < bases.length; i++) {
    const net = bases[i]! - allocation[i]!;
    taxCents += inclusive ? embeddedTaxOf(net, opts.taxRateBps) : taxOf(net, opts.taxRateBps);
  }

  const discountCents = lineDiscountTotal + cartDiscount;
  const tipCents = opts.tipCents ?? 0;
  const totalCents =
    Math.max(subtotalCents - discountCents, 0) + (inclusive ? 0 : taxCents) + tipCents;

  return { subtotalCents, discountCents, taxCents, tipCents, totalCents };
}
