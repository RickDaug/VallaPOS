/**
 * Pure refund/void math. INTEGER CENTS only (no floats); no `server-only` /
 * Prisma imports, so it's unit-testable and reusable on either side of the wire.
 *
 * A refund/void writes REVERSING (negative-amount) Payment rows. The drawer and
 * Z-report count cash by ACTUAL payment movements (sum of CASH Payment.amountCents,
 * negatives included) — never by Order.status — so a cash refund truly reduces the
 * expected drawer cash. This module computes:
 *
 *  - net-collected per method (captured minus already-refunded) from the existing
 *    payment rows, so we never refund more than was actually taken;
 *  - the reversing-payment plan for a full reversal (void or full refund); and
 *  - the reversing-payment plan + validation for a partial refund.
 */

/** A captured/refunded payment on the order, as loaded from the DB. */
export interface PaymentMovement {
  method: string; // PaymentMethod, kept as string so this stays Prisma-free
  amountCents: number; // captured payments are positive; refund reversals negative
}

/** A single reversing payment to write: negative amount, original method, REFUNDED. */
export interface ReversingPayment {
  method: string;
  amountCents: number; // ALWAYS negative
}

/**
 * Net amount actually collected, per method = Σ amountCents for that method
 * (positive captures minus any negative refund reversals already on record).
 * Methods that net to <= 0 are dropped — there is nothing left to reverse.
 */
export function netCollectedByMethod(payments: PaymentMovement[]): Map<string, number> {
  const net = new Map<string, number>();
  for (const p of payments) {
    net.set(p.method, (net.get(p.method) ?? 0) + p.amountCents);
  }
  for (const [method, amount] of net) {
    if (amount <= 0) net.delete(method);
  }
  return net;
}

/** Total still-collected across all methods (never negative). */
export function netCollectedTotal(payments: PaymentMovement[]): number {
  let total = 0;
  for (const amount of netCollectedByMethod(payments).values()) total += amount;
  return total;
}

/**
 * Full reversal (void or full refund): one reversing payment per method that
 * still has a positive net balance, each the exact negative of that balance.
 * Returns [] when nothing is collected (a $0 order voids cleanly with no rows).
 */
export function planFullReversal(payments: PaymentMovement[]): ReversingPayment[] {
  const reversals: ReversingPayment[] = [];
  for (const [method, amount] of netCollectedByMethod(payments)) {
    reversals.push({ method, amountCents: -amount });
  }
  return reversals;
}

export type PartialRefundError =
  | "amount_not_positive"
  | "exceeds_net_collected"
  | "no_collected_payments";

export type PartialRefundPlan =
  | { ok: true; reversals: ReversingPayment[] }
  | { ok: false; error: PartialRefundError };

/**
 * Partial refund of `amountCents` against the order's net-collected payments.
 *
 * Allocation policy (documented & deterministic): PROPORTIONAL across the
 * order's ACTUAL tenders — each method is refunded in proportion to what is
 * still collected on it (`amount * balance / total`), integer cents, with the
 * leftover cents from flooring handed out by largest fractional part (ties
 * broken by method name). This is the SAFE allocation: on a mixed cash+QR order
 * it never refunds cash the customer paid by QR (the old "drain the largest
 * balance first" policy could return the whole refund as cash on a split-tender
 * order). By construction each method's share is <= its balance, so we never
 * over-refund a method, and the reversals sum to exactly -amountCents.
 *
 * Guards: amount must be > 0 and <= total net-collected (never refund more than
 * was actually taken, accounting for prior partial refunds).
 */
export function planPartialRefund(
  payments: PaymentMovement[],
  amountCents: number,
): PartialRefundPlan {
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    return { ok: false, error: "amount_not_positive" };
  }
  const byMethod = netCollectedByMethod(payments);
  const total = [...byMethod.values()].reduce((s, a) => s + a, 0);
  if (total <= 0) return { ok: false, error: "no_collected_payments" };
  if (amountCents > total) return { ok: false, error: "exceeds_net_collected" };

  // Largest balance first; stable tie-break on method name for determinism.
  const ordered = [...byMethod.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  // Floor each method's proportional share, tracking the fractional remainder.
  const shares = ordered.map(([method, balance]) => {
    const exact = (amountCents * balance) / total;
    const base = Math.floor(exact);
    return { method, balance, amount: base, frac: exact - base };
  });
  const allocated = shares.reduce((s, x) => s + x.amount, 0);

  // Hand out the leftover cents (amount - Σ floors) one at a time, largest
  // fractional part first. Every method with a positive fraction still has
  // headroom (base < exact <= balance), so this never exceeds a method's balance.
  let leftover = amountCents - allocated;
  const byFrac = [...shares].sort((a, b) => b.frac - a.frac || a.method.localeCompare(b.method));
  for (const share of byFrac) {
    if (leftover <= 0) break;
    if (share.amount < share.balance) {
      share.amount += 1;
      leftover -= 1;
    }
  }

  const reversals: ReversingPayment[] = shares
    .filter((x) => x.amount > 0)
    .map((x) => ({ method: x.method, amountCents: -x.amount }));
  return { ok: true, reversals };
}
