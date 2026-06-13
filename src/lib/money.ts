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

/**
 * Compute order totals on the server. The client may *display* a total, but the
 * server is the source of truth at checkout — never trust client-sent totals.
 *
 * Policy (documented & consistent): tax is computed per line, AFTER line
 * discount, then summed. Cart-level discount and tip are applied to the order.
 */
export function computeTotals(
  lines: CartLineInput[],
  opts: { taxRateBps: number; cartDiscountCents?: number; tipCents?: number },
): OrderTotals {
  let subtotalCents = 0;
  let lineDiscountTotal = 0;
  let taxCents = 0;

  for (const line of lines) {
    const unit = line.unitPriceCents + (line.modifierDeltaCents ?? 0);
    const gross = unit * line.quantity;
    const discount = Math.min(line.lineDiscountCents ?? 0, gross);
    const taxableBase = gross - discount;
    subtotalCents += gross;
    lineDiscountTotal += discount;
    taxCents += taxOf(taxableBase, opts.taxRateBps);
  }

  const cartDiscount = Math.min(
    opts.cartDiscountCents ?? 0,
    Math.max(subtotalCents - lineDiscountTotal, 0),
  );
  const discountCents = lineDiscountTotal + cartDiscount;
  const tipCents = opts.tipCents ?? 0;
  const totalCents = Math.max(subtotalCents - discountCents, 0) + taxCents + tipCents;

  return { subtotalCents, discountCents, taxCents, tipCents, totalCents };
}
